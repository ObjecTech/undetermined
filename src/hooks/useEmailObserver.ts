import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArchiveCategory,
  EmailRecord,
  EmailRule,
  ManualOverride,
  ScanState,
} from "../types/email";

const DEFAULT_CATEGORIES: ArchiveCategory[] = [
  "高优先级",
  "待处理",
  "本周跟进",
  "没用",
  "已归档",
];

const STORAGE_KEYS = {
  rules: "mail-organizer:rules",
  overrides: "mail-organizer:overrides",
  cache: "mail-organizer:email-cache-v1",
} as const;

const ROW_SELECTORS = [
  'div[tabindex="-1"][data-convid]',
  '[role="option"][data-convid]',
  '[data-convid]',
];

const FIELD_SELECTORS = {
  sender: [
    ".lvHighlightFromClass",
    '[data-automationid="MessageListSender"]',
    'span[title]',
  ],
  subject: [
    ".lvHighlightSubjectClass",
    '[data-automationid="MessageListSubject"]',
    'a[href*="ReadMessageItem"]',
  ],
  snippet: [
    "._lvv_o1 .ms-font-weight-semilight",
    "._lvv_o1 .ms-font-color-neutralSecondary",
    '[data-automationid="MessageListPreview"]',
  ],
  time: [
    "._lvv_t1",
    '[data-automationid="MessageListReceivedDate"]',
    "time",
  ],
};

const DATE_PATTERNS = [
  /\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/,
  /\b(?:due on|deadline|截止[日期于]?|截至?)\s*[:：]?\s*([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i,
];

const SCAN_WINDOW_DAYS = 20;
const SCAN_WINDOW_MS = SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const MAX_SCAN_STEPS = 120;
const SCAN_DELAY_MS = 420;

interface EmailSnapshot {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  timeText: string;
  dueDate?: string;
  receivedAt?: string;
  receivedDateText?: string;
  cachedAt: number;
  lastSeenAt: number;
}

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number) {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readNodeText(root: ParentNode, selectors: string[]) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const text = normalizeText(node?.textContent || (node as HTMLElement | null)?.title);
    if (text) return text;
  }
  return "";
}

function findVisibleRows() {
  for (const selector of ROW_SELECTORS) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.height > 24 && rect.width > 320;
    });
    if (rows.length) return rows;
  }
  return [];
}

function findScrollContainer(rows = findVisibleRows()) {
  for (const row of rows) {
    let node: HTMLElement | null = row.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const canScroll = /(auto|scroll)/.test(style.overflowY);
      if (canScroll && node.scrollHeight > node.clientHeight + 80) return node;
      node = node.parentElement;
    }
  }

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="main"], [aria-label*="Message list"], [aria-label*="邮件"], [aria-label*="邮件列表"]'
    )
  );
  return (
    candidates.find((node) => node.scrollHeight > node.clientHeight + 80) ||
    document.scrollingElement as HTMLElement | null
  );
}

function parseDueDate(text: string) {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return undefined;
}

function dateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseTimeCandidate(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return undefined;

  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);
    const date = new Date(text.length === 10 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  const today = dateOnly(new Date());
  if (/^(now|today|今天|刚刚)$/i.test(text)) return today.toISOString();
  if (/^(yesterday|昨天)$/i.test(text)) {
    today.setDate(today.getDate() - 1);
    return today.toISOString();
  }

  return undefined;
}

function readReceivedAt(row: HTMLElement, timeText: string) {
  const timeNode = row.querySelector<HTMLElement>("time");
  const candidates = [
    row.getAttribute("data-time"),
    row.getAttribute("datetime"),
    row.dataset.time,
    timeNode?.getAttribute("datetime"),
    timeNode?.getAttribute("title"),
    timeNode?.textContent,
    timeText,
  ];

  for (const candidate of candidates) {
    const parsed = parseTimeCandidate(candidate);
    if (parsed) return parsed;
  }
  return undefined;
}

function isOlderThanScanWindow(receivedAt?: string) {
  if (!receivedAt) return false;
  const time = new Date(receivedAt).getTime();
  if (Number.isNaN(time)) return false;
  return time < Date.now() - SCAN_WINDOW_MS;
}

function computePriority(
  override?: ManualOverride,
  matchedRule?: EmailRule
) {
  if (override?.isPinnedHigh || override?.category === "高优先级") {
    return { score: 100, reason: "manual-high" };
  }
  if (matchedRule?.targetCategory === "高优先级") {
    return { score: 90, reason: "rule-high-priority" };
  }
  return { score: 40, reason: "normal" };
}

function applyRules(
  email: Pick<EmailRecord, "sender" | "subject" | "snippet">,
  rules: EmailRule[]
) {
  return rules.find((rule) => {
    if (!rule.enabled || !rule.keyword.trim()) return false;
    const source = normalizeText(email[rule.field]).toLowerCase();
    return source.includes(rule.keyword.toLowerCase());
  });
}

function resolveCategory(
  override?: ManualOverride,
  matchedRule?: EmailRule
): ArchiveCategory {
  if (override?.category) return override.category;
  if (matchedRule) return matchedRule.targetCategory;
  return "待处理";
}

function isSelectedRow(row: HTMLElement) {
  return (
    row.getAttribute("aria-selected") === "true" ||
    row.dataset.isSelected === "true" ||
    row.classList.contains("is-selected")
  );
}

function snapshotFromRow(row: HTMLElement, index: number, existing?: EmailSnapshot) {
  const sender = readNodeText(row, FIELD_SELECTORS.sender);
  const subject = readNodeText(row, FIELD_SELECTORS.subject) || "(No subject)";
  const snippet = readNodeText(row, FIELD_SELECTORS.snippet);
  const timeText = readNodeText(row, FIELD_SELECTORS.time);
  if (!sender && !subject && !snippet) return null;

  const stableId = row.dataset.convid || row.dataset.id || row.id;
  const id = stableId || `visible-${index}`;
  const now = Date.now();
  const receivedAt = readReceivedAt(row, timeText) || existing?.receivedAt;

  return {
    id,
    sender,
    subject,
    snippet,
    timeText,
    dueDate: parseDueDate(`${subject} ${snippet}`),
    receivedAt,
    receivedDateText: timeText || existing?.receivedDateText,
    cachedAt: existing?.cachedAt || now,
    lastSeenAt: now,
  } satisfies EmailSnapshot;
}

function enrichEmail(
  snapshot: EmailSnapshot,
  rowElement: HTMLElement | undefined,
  rules: EmailRule[],
  overrides: Record<string, ManualOverride>
) {
  const matchedRule = applyRules(snapshot, rules);
  const override = overrides[snapshot.id];
  const priority = computePriority(override, matchedRule);
  const category = resolveCategory(override, matchedRule);

  return {
    ...snapshot,
    selected: rowElement ? isSelectedRow(rowElement) : false,
    category,
    priorityScore: priority.score,
    priorityReason: priority.reason,
    matchedRuleId: matchedRule?.id,
    rowElement,
    isCachedOnly: !rowElement,
  } satisfies EmailRecord;
}

function cacheSignature(cache: Record<string, EmailSnapshot>) {
  return JSON.stringify(
    Object.values(cache)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => [
        item.id,
        item.sender,
        item.subject,
        item.snippet,
        item.timeText,
        item.dueDate,
        item.receivedAt,
      ])
  );
}

async function readSyncStorage<T>(key: string, fallback: T): Promise<T> {
  const storage = chrome?.storage?.sync;
  if (!storage) return fallback;
  const result = await storage.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function writeSyncStorage<T>(key: string, value: T) {
  const storage = chrome?.storage?.sync;
  if (!storage) return;
  await storage.set({ [key]: value });
}

async function readLocalStorage<T>(key: string, fallback: T): Promise<T> {
  const storage = chrome?.storage?.local;
  if (!storage) return fallback;
  const result = await storage.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function writeLocalStorage<T>(key: string, value: T) {
  const storage = chrome?.storage?.local;
  if (!storage) return;
  await storage.set({ [key]: value });
}

export function useEmailObserver() {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [rules, setRules] = useState<EmailRule[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ManualOverride>>({});
  const [cachedEmails, setCachedEmails] = useState<Record<string, EmailSnapshot>>({});
  const [scanState, setScanState] = useState<ScanState>({
    scanning: false,
    status: "idle",
    cachedCount: 0,
    visibleCount: 0,
    steps: 0,
    message: "Ready to scan visible OWA mail.",
  });
  const observerRef = useRef<MutationObserver | null>(null);
  const cachedEmailsRef = useRef<Record<string, EmailSnapshot>>({});
  const stopScanRef = useRef(false);
  const cacheHydratedRef = useRef(false);

  const refreshEmails = useCallback(() => {
    const currentCache = cachedEmailsRef.current;
    const rows = findVisibleRows();
    const visibleMap = new Map<string, { snapshot: EmailSnapshot; row: HTMLElement }>();

    rows.forEach((row, index) => {
      const id = row.dataset.convid || row.dataset.id || row.id || `visible-${index}`;
      const snapshot = snapshotFromRow(row, index, currentCache[id]);
      if (snapshot) visibleMap.set(snapshot.id, { snapshot, row });
    });

    const nextCache: Record<string, EmailSnapshot> = {};
    Object.entries(currentCache).forEach(([id, snapshot]) => {
      if (!isOlderThanScanWindow(snapshot.receivedAt)) {
        nextCache[id] = snapshot;
      }
    });

    visibleMap.forEach(({ snapshot }) => {
      if (!snapshot.id.startsWith("visible-") && !isOlderThanScanWindow(snapshot.receivedAt)) {
        nextCache[snapshot.id] = {
          ...nextCache[snapshot.id],
          ...snapshot,
          cachedAt: nextCache[snapshot.id]?.cachedAt || snapshot.cachedAt,
          lastSeenAt: snapshot.lastSeenAt,
        };
      }
    });

    if (cacheSignature(nextCache) !== cacheSignature(currentCache)) {
      cachedEmailsRef.current = nextCache;
      setCachedEmails(nextCache);
    }

    const snapshots = new Map<string, EmailSnapshot>();
    Object.entries(nextCache).forEach(([id, snapshot]) => snapshots.set(id, snapshot));
    visibleMap.forEach(({ snapshot }) => snapshots.set(snapshot.id, snapshot));

    const nextEmails = Array.from(snapshots.values())
      .map((snapshot) => enrichEmail(snapshot, visibleMap.get(snapshot.id)?.row, rules, overrides))
      .sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        const bReceived = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
        const aReceived = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
        if (bReceived !== aReceived) return bReceived - aReceived;
        return a.subject.localeCompare(b.subject);
      });

    setEmails(nextEmails);
    setScanState((current) => ({
      ...current,
      cachedCount: Object.keys(nextCache).length,
      visibleCount: rows.length,
    }));
  }, [overrides, rules]);

  useEffect(() => {
    void Promise.all([
      readSyncStorage<EmailRule[]>(STORAGE_KEYS.rules, []),
      readSyncStorage<Record<string, ManualOverride>>(STORAGE_KEYS.overrides, {}),
      readLocalStorage<Record<string, EmailSnapshot>>(STORAGE_KEYS.cache, {}),
    ]).then(([storedRules, storedOverrides, storedCache]) => {
      const prunedCache = Object.fromEntries(
        Object.entries(storedCache || {}).filter(([, snapshot]) => !isOlderThanScanWindow(snapshot.receivedAt))
      );
      setRules(storedRules);
      setOverrides(storedOverrides);
      cachedEmailsRef.current = prunedCache;
      setCachedEmails(prunedCache);
      cacheHydratedRef.current = true;
      setScanState((current) => ({
        ...current,
        cachedCount: Object.keys(prunedCache).length,
      }));
    });
  }, []);

  useEffect(() => {
    if (!cacheHydratedRef.current) return;
    void writeLocalStorage(STORAGE_KEYS.cache, cachedEmails);
  }, [cachedEmails]);

  useEffect(() => {
    refreshEmails();

    const observeTarget =
      document.querySelector('[role="main"]') ||
      document.querySelector('[aria-label*="Message list"]') ||
      document.body;

    const debouncedRefresh = debounce(refreshEmails, 180);
    const observer = new MutationObserver(() => debouncedRefresh());
    observer.observe(observeTarget, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-selected", "data-convid", "data-time"],
    });
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [refreshEmails]);

  const startScan20Days = useCallback(async () => {
    if (scanState.scanning) return;
    stopScanRef.current = false;
    setScanState((current) => ({
      ...current,
      scanning: true,
      status: "scanning",
      steps: 0,
      message: "Scanning rendered OWA mail rows...",
    }));

    const scrollContainer = findScrollContainer();
    if (!scrollContainer) {
      setScanState((current) => ({
        ...current,
        scanning: false,
        status: "error",
        message: "Could not find the OWA message list scroll area.",
      }));
      return;
    }

    let stagnantSteps = 0;
    let previousTop = scrollContainer.scrollTop;

    for (let step = 1; step <= MAX_SCAN_STEPS; step += 1) {
      if (stopScanRef.current) {
        setScanState((current) => ({
          ...current,
          scanning: false,
          status: "stopped",
          steps: step - 1,
          message: "Scan stopped. Cached mail collected so far is still available.",
        }));
        refreshEmails();
        return;
      }

      refreshEmails();
      const rows = findVisibleRows();
      const visibleSnapshots = rows
        .map((row, index) => snapshotFromRow(row, index))
        .filter(Boolean) as EmailSnapshot[];
      const knownDates = visibleSnapshots
        .map((snapshot) => snapshot.receivedAt)
        .filter(Boolean) as string[];
      const reachedOldMail = knownDates.some((receivedAt) => isOlderThanScanWindow(receivedAt));

      setScanState((current) => ({
        ...current,
        steps: step,
        visibleCount: rows.length,
        message: `Scanning 20 days: pass ${step}, ${rows.length} rows visible, ${current.cachedCount} cached.`,
      }));

      if (reachedOldMail) {
        setScanState((current) => ({
          ...current,
          scanning: false,
          status: "complete",
          steps: step,
          message: "Scan complete. Reached mail older than 20 days.",
        }));
        refreshEmails();
        return;
      }

      const nextTop = Math.min(
        scrollContainer.scrollTop + Math.max(320, Math.floor(scrollContainer.clientHeight * 0.82)),
        scrollContainer.scrollHeight - scrollContainer.clientHeight
      );
      scrollContainer.scrollTop = nextTop;
      await sleep(SCAN_DELAY_MS);

      if (Math.abs(scrollContainer.scrollTop - previousTop) < 4) {
        stagnantSteps += 1;
      } else {
        stagnantSteps = 0;
      }
      previousTop = scrollContainer.scrollTop;

      if (stagnantSteps >= 3 || nextTop <= 0 || nextTop >= scrollContainer.scrollHeight - scrollContainer.clientHeight) {
        setScanState((current) => ({
          ...current,
          scanning: false,
          status: "complete",
          steps: step,
          message: "Scan complete. Reached the end of the loaded OWA list.",
        }));
        refreshEmails();
        return;
      }
    }

    setScanState((current) => ({
      ...current,
      scanning: false,
      status: "complete",
      steps: MAX_SCAN_STEPS,
      message: "Scan stopped at safety limit. Cached mail collected so far is available.",
    }));
    refreshEmails();
  }, [refreshEmails, scanState.scanning]);

  const stopScan = useCallback(() => {
    stopScanRef.current = true;
  }, []);

  const emailsByCategory = useMemo(() => {
    return DEFAULT_CATEGORIES.reduce<Record<ArchiveCategory, EmailRecord[]>>((acc, category) => {
      acc[category] = emails.filter((email) => email.category === category);
      return acc;
    }, {} as Record<ArchiveCategory, EmailRecord[]>);
  }, [emails]);

  const selectedEmail = useMemo(
    () => emails.find((email) => email.selected) || null,
    [emails]
  );

  const stats = useMemo(() => {
    return {
      visibleCount: emails.length,
      highPriorityCount: emails.filter((email) => email.priorityScore >= 85).length,
      rulesCount: rules.length,
    };
  }, [emails, rules.length]);

  const upsertRule = useCallback(async (rule: EmailRule) => {
    setRules((current) => {
      const next = current.some((item) => item.id === rule.id)
        ? current.map((item) => (item.id === rule.id ? rule : item))
        : [...current, rule];
      void writeSyncStorage(STORAGE_KEYS.rules, next);
      return next;
    });
  }, []);

  const updateRule = useCallback(async (rule: EmailRule) => {
    setRules((current) => {
      const next = current.map((item) => (item.id === rule.id ? rule : item));
      void writeSyncStorage(STORAGE_KEYS.rules, next);
      return next;
    });
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    setRules((current) => {
      const next = current.filter((item) => item.id !== id);
      void writeSyncStorage(STORAGE_KEYS.rules, next);
      return next;
    });
  }, []);

  const setManualOverride = useCallback(async (id: string, override: ManualOverride) => {
    setOverrides((current) => {
      const next = { ...current, [id]: { ...current[id], ...override } };
      void writeSyncStorage(STORAGE_KEYS.overrides, next);
      return next;
    });
  }, []);

  return {
    categories: DEFAULT_CATEGORIES,
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
  };
}
