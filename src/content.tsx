import React, { StrictMode, useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import panelCss from "./styles/content.css?inline";
import { useEmailObserver } from "./hooks/useEmailObserver";
import { SidePanel } from "./components/SidePanel";
import type { EmailRecord, SummaryState, EmailRule, ManualOverride } from "./types/email";

const HOST_ID = "mail-organizer-react-host";
const SHADOW_MOUNT_ID = "mail-organizer-shadow-app";
let reactRoot: ReturnType<typeof createRoot> | null = null;
let persistenceObserver: MutationObserver | null = null;

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
    stats,
    refreshEmails,
    upsertRule,
    setManualOverride,
  } = useEmailObserver();
  const [focusedId, setFocusedId] = useState("");
  const [summary, setSummary] = useState<SummaryState>({
    loading: false,
    bullets: [],
    insight: "",
  });

  const effectiveSelectedEmail = useMemo(() => {
    if (selectedEmail) return selectedEmail;
    return emails.find((email) => email.id === focusedId) || null;
  }, [emails, focusedId, selectedEmail]);

  const handleSelectEmail = useCallback((email: EmailRecord) => {
    setFocusedId(email.id);
    email.rowElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    email.rowElement?.click();
  }, []);

  const handleGenerateSummary = useCallback(async () => {
    if (!effectiveSelectedEmail?.selected) return;

    setSummary((current) => ({ ...current, loading: true, error: undefined }));

    try {
      setSummary({
        loading: false,
        bullets: [
          `Sender: ${effectiveSelectedEmail.sender || "Unknown"}`,
          `Priority reason: ${effectiveSelectedEmail.priorityReason}`,
          `Snippet: ${effectiveSelectedEmail.snippet || "No preview available"}`,
        ],
        insight:
          effectiveSelectedEmail.priorityScore >= 85
            ? "This email is likely urgent and should stay near the top of the workflow."
            : "This email looks informational and can be processed after higher-priority items.",
      });
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

  return (
    <SidePanel
      categories={categories}
      emailsByCategory={emailsByCategory}
      rules={rules}
      selectedEmail={effectiveSelectedEmail}
      stats={stats}
      summary={summary}
      onRefresh={refreshEmails}
      onSelectEmail={handleSelectEmail}
      onGenerateSummary={handleGenerateSummary}
      onCreateRule={handleCreateRule}
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
