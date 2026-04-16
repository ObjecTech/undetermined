import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArchiveCategory,
  EmailRecord,
  EmailRule,
  ManualOverride,
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

const URGENT_WORDS =
  /(ddl|deadline|due|urgent|asap|submission|today|tomorrow|截止|今天|明天|尽快|本周)/i;

const DATE_PATTERNS = [
  /\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/,
  /\b(?:due on|deadline|截止[日期于]?|截至?)\s*[:：]?\s*([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i,
];

function debounce<T extends (...args: never[]) => void>(fn: T, delay: number) {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
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

function computePriority(
  email: Pick<EmailRecord, "subject" | "snippet" | "dueDate">,
  override?: ManualOverride,
  matchedRule?: EmailRule
) {
  const joined = `${email.subject} ${email.snippet}`;
  const dueDate = email.dueDate ? new Date(`${email.dueDate}T23:59:59`) : null;
  const dayDiff = dueDate
    ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  if (override?.isPinnedHigh) {
    return { score: 100, reason: "manual-high" };
  }
  if (dayDiff !== null && dayDiff <= 0) {
    return { score: 96, reason: "ddl-today" };
  }
  if (dayDiff !== null && dayDiff <= 2) {
    return { score: 90, reason: "ddl-near" };
  }
  if (matchedRule?.targetCategory === "高优先级") {
    return { score: 82, reason: "rule-high-priority" };
  }
  if (URGENT_WORDS.test(joined)) {
    return { score: 78, reason: "urgent-keyword" };
  }
  if (dayDiff !== null && dayDiff <= 7) {
    return { score: 65, reason: "follow-up-this-week" };
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
  score: number,
  override?: ManualOverride,
  matchedRule?: EmailRule
): ArchiveCategory {
  if (override?.category) return override.category;
  if (matchedRule) return matchedRule.targetCategory;
  if (score >= 85) return "高优先级";
  if (score >= 60) return "本周跟进";
  return "待处理";
}

function isSelectedRow(row: HTMLElement) {
  return (
    row.getAttribute("aria-selected") === "true" ||
    row.dataset.isSelected === "true" ||
    row.classList.contains("is-selected")
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

export function useEmailObserver() {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [rules, setRules] = useState<EmailRule[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ManualOverride>>({});
  const observerRef = useRef<MutationObserver | null>(null);

  const refreshEmails = useCallback(() => {
    const rows = findVisibleRows();
    const nextEmails = rows
      .map((row, index) => {
        const sender = readNodeText(row, FIELD_SELECTORS.sender);
        const subject = readNodeText(row, FIELD_SELECTORS.subject) || "(No subject)";
        const snippet = readNodeText(row, FIELD_SELECTORS.snippet);
        const timeText = readNodeText(row, FIELD_SELECTORS.time);
        if (!sender && !subject && !snippet) return null;

        const id = row.dataset.convid || row.dataset.id || row.id || `row-${index}`;
        const dueDate = parseDueDate(`${subject} ${snippet}`);
        const matchedRule = applyRules({ sender, subject, snippet }, rules);
        const override = overrides[id];
        const priority = computePriority({ subject, snippet, dueDate }, override, matchedRule);
        const category = resolveCategory(priority.score, override, matchedRule);

        return {
          id,
          sender,
          subject,
          snippet,
          timeText,
          dueDate,
          selected: isSelectedRow(row),
          category,
          priorityScore: priority.score,
          priorityReason: priority.reason,
          matchedRuleId: matchedRule?.id,
          rowElement: row,
        } satisfies EmailRecord;
      })
      .filter(Boolean) as EmailRecord[];

    nextEmails.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return a.subject.localeCompare(b.subject);
    });

    setEmails(nextEmails);
  }, [overrides, rules]);

  useEffect(() => {
    void Promise.all([
      readSyncStorage<EmailRule[]>(STORAGE_KEYS.rules, []),
      readSyncStorage<Record<string, ManualOverride>>(STORAGE_KEYS.overrides, {}),
    ]).then(([storedRules, storedOverrides]) => {
      setRules(storedRules);
      setOverrides(storedOverrides);
    });
  }, []);

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
    stats,
    refreshEmails,
    upsertRule,
    setManualOverride,
  };
}
