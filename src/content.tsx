import React, { StrictMode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import panelCss from "./styles/content.css?inline";
import { useEmailObserver } from "./hooks/useEmailObserver";
import { SidePanel } from "./components/SidePanel";
import type {
  EmailRecord,
  SummaryState,
  EmailRule,
  ManualOverride,
  SummaryLanguage,
} from "./types/email";

const HOST_ID = "mail-organizer-react-host";
const SHADOW_MOUNT_ID = "mail-organizer-shadow-app";
const OWA_ROW_SELECTORS = [
  'div[tabindex="-1"][data-convid]',
  '[role="option"][data-convid]',
  '[data-convid]',
];
const OPEN_SEARCH_MAX_STEPS = 110;
const OPEN_SEARCH_DELAY_MS = 120;
const MAX_SUMMARY_BODY_CHARS = 6000;
let reactRoot: ReturnType<typeof createRoot> | null = null;
let persistenceObserver: MutationObserver | null = null;

interface SummaryRuntimeResponse {
  ok: boolean;
  summary?: SummaryState;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 120 &&
    rect.height > 40 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

function findVisibleOwaRows() {
  for (const selector of OWA_ROW_SELECTORS) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.height > 24 && rect.width > 320;
    });
    if (rows.length) return rows;
  }
  return [];
}

function findMessageListScrollContainer(rows = findVisibleOwaRows()) {
  for (const row of rows) {
    let node: HTMLElement | null = row.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const canScroll = /(auto|scroll)/.test(style.overflowY);
      if (canScroll && node.scrollHeight > node.clientHeight + 80) return node;
      node = node.parentElement;
    }
  }
  return document.scrollingElement as HTMLElement | null;
}

function rowMatchesEmail(row: HTMLElement, email: EmailRecord) {
  const rowId = row.dataset.convid || row.dataset.id || row.id;
  if (rowId && rowId === email.id) return true;

  const rowText = normalizeText(row.textContent).toLowerCase();
  const sender = normalizeText(email.sender).toLowerCase();
  const subject = normalizeText(email.subject).toLowerCase();
  const snippet = normalizeText(email.snippet).toLowerCase();
  const subjectNeedle = subject.slice(0, Math.min(subject.length, 54));
  const snippetNeedle = snippet.slice(0, Math.min(snippet.length, 42));
  const senderMatches = sender.length > 2 && rowText.includes(sender);
  const subjectMatches = subjectNeedle.length > 8 && rowText.includes(subjectNeedle);
  const snippetMatches = snippetNeedle.length > 12 && rowText.includes(snippetNeedle);

  return subjectMatches && (senderMatches || snippetMatches || !sender);
}

function findVisibleRowForEmail(email: EmailRecord) {
  if (email.rowElement && document.contains(email.rowElement)) return email.rowElement;
  return findVisibleOwaRows().find((row) => rowMatchesEmail(row, email)) || null;
}

async function findRowByScrolling(email: EmailRecord, shouldContinue: () => boolean) {
  const visibleRow = findVisibleRowForEmail(email);
  if (visibleRow) return visibleRow;

  const scrollContainer = findMessageListScrollContainer();
  if (!scrollContainer) return null;

  const originalTop = scrollContainer.scrollTop;
  scrollContainer.scrollTop = 0;
  await sleep(OPEN_SEARCH_DELAY_MS * 2);

  let previousTop = -1;
  for (let step = 0; step < OPEN_SEARCH_MAX_STEPS && shouldContinue(); step += 1) {
    const row = findVisibleRowForEmail(email);
    if (row) return row;

    const nextTop = Math.min(
      scrollContainer.scrollTop + Math.max(320, Math.floor(scrollContainer.clientHeight * 0.86)),
      scrollContainer.scrollHeight - scrollContainer.clientHeight
    );
    if (Math.abs(nextTop - previousTop) < 4 || nextTop <= scrollContainer.scrollTop) break;

    previousTop = scrollContainer.scrollTop;
    scrollContainer.scrollTop = nextTop;
    await sleep(OPEN_SEARCH_DELAY_MS);
  }

  scrollContainer.scrollTop = originalTop;
  return null;
}

function getClickTarget(row: HTMLElement) {
  const preferredTarget = row.querySelector<HTMLElement>(
    [
      '[data-automationid="MessageListSubject"]',
      'a[href*="ReadMessageItem"]',
      '[role="link"]',
    ].join(",")
  );
  const target = preferredTarget || row;
  const rect = target.getBoundingClientRect();
  const x = Math.min(Math.max(rect.left + rect.width / 2, rect.left + 8), rect.right - 8);
  const y = Math.min(Math.max(rect.top + rect.height / 2, rect.top + 8), rect.bottom - 8);
  const hitTarget = document.elementFromPoint(x, y);

  return {
    target: hitTarget instanceof HTMLElement && row.contains(hitTarget) ? hitTarget : target,
    x,
    y,
  };
}

async function openOwaRow(row: HTMLElement) {
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  await sleep(180);
  row.focus({ preventScroll: true });

  const { target, x, y } = getClickTarget(row);
  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
  };

  target.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mousedown", eventInit));
  target.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", eventInit));
  target.dispatchEvent(new MouseEvent("click", eventInit));
  target.click();
}

function readCurrentMessageBody(email: EmailRecord) {
  const subject = normalizeText(email.subject).toLowerCase();
  const sender = normalizeText(email.sender).toLowerCase();
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[role="document"]',
        '[aria-label*="Message body"]',
        '[aria-label*="message body"]',
        '[aria-label*="邮件正文"]',
        '[data-automationid*="messageBody"]',
        '[data-automationid*="MessageBody"]',
        '[data-automationid*="ReadingPane"]',
        '[data-testid*="message-body"]',
        "main article",
        "main section",
      ].join(",")
    )
  );

  const scored = candidates
    .filter((candidate) => isVisibleElement(candidate))
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const text = normalizeText(candidate.innerText || candidate.textContent);
      const lowerText = text.toLowerCase();
      const likelyReadingPane = rect.left > 420 && rect.width > 420;
      const subjectMatch = subject.length > 8 && lowerText.includes(subject.slice(0, 48));
      const senderMatch = sender.length > 3 && lowerText.includes(sender.slice(0, 36));
      const score =
        text.length +
        (likelyReadingPane ? 800 : 0) +
        (subjectMatch ? 1200 : 0) +
        (senderMatch ? 500 : 0);

      return { text, score };
    })
    .filter((candidate) => candidate.text.length > Math.max(80, email.snippet.length))
    .sort((a, b) => b.score - a.score);

  return (scored[0]?.text || "").slice(0, MAX_SUMMARY_BODY_CHARS);
}

function sendRuntimeMessage<TResponse>(message: unknown) {
  return new Promise<TResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectShadowStyles(shadowRoot: ShadowRoot) {
  const style = document.createElement("style");
  style.textContent = panelCss;
  shadowRoot.appendChild(style);
}

function ensureShadowMount() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
  }

  host.setAttribute(
    "style",
    [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483646",
      "pointer-events: none",
      "display: block",
    ].join(";")
  );

  const shadowRoot = host.shadowRoot || host.attachShadow({ mode: "open" });
  let mountNode = shadowRoot.getElementById(SHADOW_MOUNT_ID);
  if (mountNode) return mountNode;

  shadowRoot.innerHTML = "";
  injectShadowStyles(shadowRoot);

  mountNode = document.createElement("div");
  mountNode.id = SHADOW_MOUNT_ID;
  mountNode.className = "mail-organizer-root";
  shadowRoot.appendChild(mountNode);

  return mountNode;
}

function ensureHostPersistence() {
  if (persistenceObserver) return;

  const observer = new MutationObserver(() => {
    if (!document.getElementById(HOST_ID)) {
      reactRoot = null;
      mount();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  persistenceObserver = observer;
}

function ContentApp() {
  const {
    categories,
    emails,
    emailsByCategory,
    selectedEmail,
    rules,
    scanState,
    stats,
    refreshEmails,
    startScan20Days,
    stopScan,
    upsertRule,
    updateRule,
    deleteRule,
    setManualOverride,
  } = useEmailObserver();
  const [focusedId, setFocusedId] = useState("");
  const [summary, setSummary] = useState<SummaryState>({
    loading: false,
    bullets: [],
    insight: "",
  });
  const openRequestRef = useRef(0);

  const effectiveSelectedEmail = useMemo(() => {
    if (selectedEmail) return selectedEmail;
    return emails.find((email) => email.id === focusedId) || null;
  }, [emails, focusedId, selectedEmail]);

  const handleSelectEmail = useCallback(async (email: EmailRecord) => {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    setFocusedId(email.id);
    const shouldContinue = () => openRequestRef.current === requestId;
    const row = await findRowByScrolling(email, shouldContinue);
    if (!row || !shouldContinue()) return;

    await openOwaRow(row);
    window.setTimeout(refreshEmails, 420);
  }, [refreshEmails]);

  const handleGenerateSummary = useCallback(async (language: SummaryLanguage) => {
    if (!effectiveSelectedEmail) return;

    setSummary((current) => ({ ...current, loading: true, error: undefined }));

    try {
      const response = await sendRuntimeMessage<SummaryRuntimeResponse>({
        type: "mail-organizer:summarize-email",
        payload: {
          language,
          email: {
            sender: effectiveSelectedEmail.sender,
            subject: effectiveSelectedEmail.subject,
            snippet: effectiveSelectedEmail.snippet,
            timeText: effectiveSelectedEmail.timeText,
            category: effectiveSelectedEmail.category,
            priorityReason: effectiveSelectedEmail.priorityReason,
            bodyText: readCurrentMessageBody(effectiveSelectedEmail),
          },
        },
      });

      if (!response?.ok || !response.summary) {
        throw new Error(response?.error || "Failed to summarize email.");
      }

      setSummary(response.summary);
    } catch (error) {
      setSummary({
        loading: false,
        bullets: [],
        insight: "",
        error: error instanceof Error ? error.message : "Failed to summarize",
      });
    }
  }, [effectiveSelectedEmail]);

  const handleCreateRule = useCallback(
    async (draft: Omit<EmailRule, "id" | "enabled">) => {
      const nextRule: EmailRule = {
        id: window.crypto?.randomUUID?.() || `rule-${Date.now()}`,
        enabled: true,
        ...draft,
      };
      await upsertRule(nextRule);
    },
    [upsertRule]
  );

  const handleUpdateSelectedEmail = useCallback(
    async (override: ManualOverride) => {
      if (!effectiveSelectedEmail) return;
      await setManualOverride(effectiveSelectedEmail.id, override);
    },
    [effectiveSelectedEmail, setManualOverride]
  );

  const handleUpdateRule = useCallback(
    async (rule: EmailRule) => {
      await updateRule(rule);
    },
    [updateRule]
  );

  const handleDeleteRule = useCallback(
    async (id: string) => {
      await deleteRule(id);
    },
    [deleteRule]
  );

  return (
    <SidePanel
      categories={categories}
      emailsByCategory={emailsByCategory}
      rules={rules}
      selectedEmail={effectiveSelectedEmail}
      stats={stats}
      scanState={scanState}
      summary={summary}
      onRefresh={refreshEmails}
      onStartScan20Days={startScan20Days}
      onStopScan={stopScan}
      onSelectEmail={handleSelectEmail}
      onGenerateSummary={handleGenerateSummary}
      onCreateRule={handleCreateRule}
      onUpdateRule={handleUpdateRule}
      onDeleteRule={handleDeleteRule}
      onUpdateSelectedEmail={handleUpdateSelectedEmail}
    />
  );
}

function mount() {
  const mountNode = ensureShadowMount();
  if (!reactRoot) {
    reactRoot = createRoot(mountNode);
  }
  reactRoot.render(
    <StrictMode>
      <ContentApp />
    </StrictMode>
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}

window.addEventListener("hashchange", mount);
ensureHostPersistence();
