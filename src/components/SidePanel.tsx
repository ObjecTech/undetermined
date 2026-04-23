import type {
  ArchiveCategory,
  EmailRecord,
  EmailRule,
  ManualOverride,
  RuleField,
  ScanState,
  SummaryLanguage,
  SummaryState,
} from "../types/email";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Pin,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface SidePanelProps {
  categories: ArchiveCategory[];
  emailsByCategory: Record<ArchiveCategory, EmailRecord[]>;
  rules: EmailRule[];
  selectedEmail: EmailRecord | null;
  stats: {
    visibleCount: number;
    highPriorityCount: number;
    rulesCount: number;
  };
  scanState: ScanState;
  summary: SummaryState;
  onRefresh: () => void;
  onStartScan20Days: () => void;
  onStopScan: () => void;
  onSelectEmail: (email: EmailRecord) => void;
  onGenerateSummary: (language: SummaryLanguage) => void;
  onCreateRule: (rule: Omit<EmailRule, "id" | "enabled">) => void;
  onUpdateRule: (rule: EmailRule) => void;
  onDeleteRule: (id: string) => void;
  onUpdateSelectedEmail: (override: ManualOverride) => void;
}

const categoryIcons: Record<ArchiveCategory, typeof Inbox> = {
  高优先级: AlertTriangle,
  待处理: Inbox,
  本周跟进: CalendarClock,
  没用: Archive,
  已归档: Archive,
};

const LAUNCHER_POSITION_KEY = "mail-organizer:launcher-top";
const THEME_KEY = "mail-organizer:theme";
const PANEL_OPEN_KEY = "mail-organizer:panel-open";
const PANEL_PINNED_KEY = "mail-organizer:panel-pinned";
const SUMMARY_LANGUAGE_KEY = "mail-organizer:summary-language";
const PANEL_RIGHT = 18;
const PANEL_WIDTH = 392;
const PANEL_GAP = 12;
const LAUNCHER_SIZE = 56;
const DEFAULT_LAUNCHER_TOP = 184;
const DRAG_THRESHOLD = 8;
type ThemeName = "mono" | "morandi" | "glacier";
type PanelPage = "inbox" | "rules" | "summary";

const THEMES: Record<
  ThemeName,
  {
    label: string;
    swatch: string;
    tokens: Record<string, string>;
  }
> = {
  mono: {
    label: "Mono",
    swatch: "#151718",
    tokens: {
      "--mo-overlay": "rgba(17, 19, 21, 0.08)",
      "--mo-launcher-bg": "rgba(242, 243, 238, 0.94)",
      "--mo-launcher-border": "rgba(255, 255, 255, 0.68)",
      "--mo-launcher-ring": "rgba(179, 192, 168, 0.86)",
      "--mo-launcher-text": "#111315",
      "--mo-panel-bg": "rgba(245, 246, 242, 0.94)",
      "--mo-panel-border": "rgba(57, 64, 67, 0.12)",
      "--mo-panel-text": "#111315",
      "--mo-panel-muted": "#5f6864",
      "--mo-panel-soft": "rgba(255, 255, 255, 0.74)",
      "--mo-panel-softer": "rgba(255, 255, 255, 0.6)",
      "--mo-chip-border": "rgba(57, 64, 67, 0.12)",
      "--mo-chip-bg": "rgba(255, 255, 255, 0.72)",
      "--mo-chip-active-bg": "#111315",
      "--mo-chip-active-text": "#ffffff",
      "--mo-accent": "#65765e",
      "--mo-accent-soft": "#d8e0d4",
      "--mo-accent-text": "#4f5e49",
      "--mo-strong-bg": "#111315",
      "--mo-strong-text": "#ffffff",
      "--mo-summary-bg": "#111315",
      "--mo-summary-text": "#f5f6f2",
      "--mo-shadow": "0 22px 80px rgba(17, 19, 21, 0.18)",
      "--mo-launcher-shadow": "0 12px 34px rgba(17, 19, 21, 0.22)",
    },
  },
  morandi: {
    label: "Morandi",
    swatch: "#9c847d",
    tokens: {
      "--mo-overlay": "rgba(67, 56, 52, 0.1)",
      "--mo-launcher-bg": "rgba(241, 234, 229, 0.95)",
      "--mo-launcher-border": "rgba(255, 255, 255, 0.68)",
      "--mo-launcher-ring": "rgba(202, 182, 172, 0.86)",
      "--mo-launcher-text": "#2f2928",
      "--mo-panel-bg": "rgba(239, 233, 228, 0.95)",
      "--mo-panel-border": "rgba(124, 108, 102, 0.14)",
      "--mo-panel-text": "#2f2928",
      "--mo-panel-muted": "#776863",
      "--mo-panel-soft": "rgba(252, 248, 245, 0.74)",
      "--mo-panel-softer": "rgba(252, 248, 245, 0.6)",
      "--mo-chip-border": "rgba(124, 108, 102, 0.12)",
      "--mo-chip-bg": "rgba(252, 248, 245, 0.74)",
      "--mo-chip-active-bg": "#6e5d59",
      "--mo-chip-active-text": "#fffaf8",
      "--mo-accent": "#9c847d",
      "--mo-accent-soft": "#dac8c1",
      "--mo-accent-text": "#866f68",
      "--mo-strong-bg": "#6e5d59",
      "--mo-strong-text": "#fffaf8",
      "--mo-summary-bg": "#6e5d59",
      "--mo-summary-text": "#fff8f5",
      "--mo-shadow": "0 22px 80px rgba(98, 81, 76, 0.18)",
      "--mo-launcher-shadow": "0 12px 34px rgba(98, 81, 76, 0.2)",
    },
  },
  glacier: {
    label: "Glacier",
    swatch: "#4f6d76",
    tokens: {
      "--mo-overlay": "rgba(18, 32, 38, 0.1)",
      "--mo-launcher-bg": "rgba(236, 243, 244, 0.95)",
      "--mo-launcher-border": "rgba(255, 255, 255, 0.68)",
      "--mo-launcher-ring": "rgba(185, 210, 216, 0.88)",
      "--mo-launcher-text": "#122026",
      "--mo-panel-bg": "rgba(232, 239, 240, 0.95)",
      "--mo-panel-border": "rgba(79, 109, 118, 0.14)",
      "--mo-panel-text": "#122026",
      "--mo-panel-muted": "#5b737b",
      "--mo-panel-soft": "rgba(247, 251, 252, 0.76)",
      "--mo-panel-softer": "rgba(247, 251, 252, 0.6)",
      "--mo-chip-border": "rgba(79, 109, 118, 0.12)",
      "--mo-chip-bg": "rgba(247, 251, 252, 0.74)",
      "--mo-chip-active-bg": "#20353c",
      "--mo-chip-active-text": "#f7fbfc",
      "--mo-accent": "#4f6d76",
      "--mo-accent-soft": "#c7dbe0",
      "--mo-accent-text": "#49656d",
      "--mo-strong-bg": "#20353c",
      "--mo-strong-text": "#f7fbfc",
      "--mo-summary-bg": "#20353c",
      "--mo-summary-text": "#f7fbfc",
      "--mo-shadow": "0 22px 80px rgba(32, 53, 60, 0.18)",
      "--mo-launcher-shadow": "0 12px 34px rgba(32, 53, 60, 0.2)",
    },
  },
};

function clampLauncherTop(top: number) {
  const min = 88;
  const max = Math.max(min, window.innerHeight - LAUNCHER_SIZE - 28);
  return Math.min(Math.max(top, min), max);
}

function priorityLabel(email: EmailRecord) {
  if (email.priorityScore >= 95) return "DDL Today";
  if (email.priorityScore >= 85) return "High Priority";
  if (email.priorityScore >= 70) return "Needs Attention";
  return "Normal";
}

function prioritySourceLabel(email: EmailRecord) {
  if (email.matchedRuleId) return "Rule";
  switch (email.priorityReason) {
    case "manual-high":
      return "Manual";
    default:
      return "Unsorted";
  }
}

export function SidePanel({
  categories,
  emailsByCategory,
  rules,
  selectedEmail,
  stats,
  scanState,
  summary,
  onRefresh,
  onStartScan20Days,
  onStopScan,
  onSelectEmail,
  onGenerateSummary,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onUpdateSelectedEmail,
}: SidePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [launcherTop, setLauncherTop] = useState(DEFAULT_LAUNCHER_TOP);
  const [themeName, setThemeName] = useState<ThemeName>("mono");
  const [activePage, setActivePage] = useState<PanelPage>("inbox");
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguage>("zh");
  const [activeCategory, setActiveCategory] = useState<ArchiveCategory>("高优先级");
  const [ruleField, setRuleField] = useState<RuleField>("sender");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleCategory, setRuleCategory] = useState<ArchiveCategory>("没用");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleField, setEditingRuleField] = useState<RuleField>("sender");
  const [editingRuleKeyword, setEditingRuleKeyword] = useState("");
  const [editingRuleCategory, setEditingRuleCategory] = useState<ArchiveCategory>("没用");
  const dragStateRef = useRef<{ startY: number; startTop: number; pointerId: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const launcherTopRef = useRef(DEFAULT_LAUNCHER_TOP);
  const hasHydratedPanelStateRef = useRef(false);

  const activeEmails = useMemo(
    () => emailsByCategory[activeCategory] || [],
    [activeCategory, emailsByCategory]
  );
  const activeTheme = THEMES[themeName];
  const themeStyle = activeTheme.tokens as React.CSSProperties;

  useEffect(() => {
    launcherTopRef.current = launcherTop;
  }, [launcherTop]);

  useEffect(() => {
    chrome?.storage?.sync
      ?.get([LAUNCHER_POSITION_KEY, THEME_KEY, PANEL_OPEN_KEY, PANEL_PINNED_KEY, SUMMARY_LANGUAGE_KEY])
      .then((result) => {
        const storedTop = result?.[LAUNCHER_POSITION_KEY];
        if (typeof storedTop === "number") {
          setLauncherTop(clampLauncherTop(storedTop));
        }
        const storedTheme = result?.[THEME_KEY];
        if (storedTheme && storedTheme in THEMES) {
          setThemeName(storedTheme as ThemeName);
        }
        const storedOpen = result?.[PANEL_OPEN_KEY];
        if (typeof storedOpen === "boolean") {
          setIsOpen(storedOpen);
        }
        const storedPinned = result?.[PANEL_PINNED_KEY];
        if (typeof storedPinned === "boolean") {
          setIsPinned(storedPinned);
        }
        const storedSummaryLanguage = result?.[SUMMARY_LANGUAGE_KEY];
        if (storedSummaryLanguage === "zh" || storedSummaryLanguage === "en") {
          setSummaryLanguage(storedSummaryLanguage);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        hasHydratedPanelStateRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (!hasHydratedPanelStateRef.current) return;
    void chrome?.storage?.sync?.set({
      [PANEL_OPEN_KEY]: isOpen,
      [PANEL_PINNED_KEY]: isPinned,
    });
  }, [isOpen, isPinned]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragStateRef.current) return;
      if (event.pointerId !== dragStateRef.current.pointerId) return;
      const deltaY = event.clientY - dragStateRef.current.startY;
      if (!movedRef.current && Math.abs(deltaY) < DRAG_THRESHOLD) return;
      movedRef.current = true;
      const nextTop = clampLauncherTop(dragStateRef.current.startTop + deltaY);
      setLauncherTop(nextTop);
    }

    function handlePointerUp(event: PointerEvent) {
      if (!dragStateRef.current) return;
      if (event.pointerId !== dragStateRef.current.pointerId) return;
      dragStateRef.current = null;
      if (movedRef.current) {
        suppressClickRef.current = true;
        void chrome?.storage?.sync?.set({
          [LAUNCHER_POSITION_KEY]: launcherTopRef.current,
        });
      }
      movedRef.current = false;
    }

    function handleResize() {
      setLauncherTop((current) => clampLauncherTop(current));
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!editingRuleId || rules.some((rule) => rule.id === editingRuleId)) return;
    setEditingRuleId(null);
    setEditingRuleField("sender");
    setEditingRuleKeyword("");
    setEditingRuleCategory("没用");
  }, [editingRuleId, rules]);

  function resetRuleEditor() {
    setEditingRuleId(null);
    setEditingRuleField("sender");
    setEditingRuleKeyword("");
    setEditingRuleCategory("没用");
  }

  function submitRule() {
    const keyword = ruleKeyword.trim();
    if (!keyword) return;
    onCreateRule({
      field: ruleField,
      keyword,
      targetCategory: ruleCategory,
    });
    setRuleKeyword("");
  }

  function openRulesManager() {
    setIsOpen(true);
    setActivePage("rules");
  }

  function beginRuleEdit(rule: EmailRule) {
    setEditingRuleId(rule.id);
    setEditingRuleField(rule.field);
    setEditingRuleKeyword(rule.keyword);
    setEditingRuleCategory(rule.targetCategory);
    openRulesManager();
  }

  async function saveRuleEdit(rule: EmailRule) {
    const keyword = editingRuleKeyword.trim();
    if (!keyword) return;
    await onUpdateRule({
      ...rule,
      field: editingRuleField,
      keyword,
      targetCategory: editingRuleCategory,
    });
    resetRuleEditor();
  }

  async function handleDeleteRule(id: string) {
    if (editingRuleId === id) {
      resetRuleEditor();
    }
    await onDeleteRule(id);
  }

  function handleLauncherPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      startY: event.clientY,
      startTop: launcherTop,
      pointerId: event.pointerId,
    };
    movedRef.current = false;
  }

  function handleLauncherClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setIsOpen((current) => !current);
  }

  function handleThemeChange(nextTheme: ThemeName) {
    setThemeName(nextTheme);
    void chrome?.storage?.sync?.set({
      [THEME_KEY]: nextTheme,
    });
  }

  function toggleSummaryLanguage() {
    setSummaryLanguage((current) => {
      const nextLanguage = current === "zh" ? "en" : "zh";
      void chrome?.storage?.sync?.set({
        [SUMMARY_LANGUAGE_KEY]: nextLanguage,
      });
      return nextLanguage;
    });
  }

  function togglePinnedPanel() {
    setIsOpen(true);
    setIsPinned((current) => !current);
  }

  return (
    <div className="mail-organizer-app" style={themeStyle}>
      {isOpen && !isPinned ? (
        <button
          aria-label="Close organizer"
          className="mail-organizer-interactive absolute inset-0 bg-[var(--mo-overlay)] backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
        />
      ) : null}

      <button
        onPointerDown={handleLauncherPointerDown}
        onClick={handleLauncherClick}
        className={[
          "mail-organizer-interactive animate-ball-float fixed inline-flex h-14 w-14 items-center justify-center rounded-full",
          "border bg-[var(--mo-launcher-bg)] text-[var(--mo-launcher-text)] backdrop-blur-panel transition",
          "hover:scale-[1.02] hover:brightness-[1.02]",
        ].join(" ")}
        style={{
          top: `${launcherTop}px`,
          right: `${isOpen ? PANEL_RIGHT + PANEL_WIDTH + PANEL_GAP : PANEL_RIGHT}px`,
          borderColor: "var(--mo-launcher-border)",
          boxShadow: "var(--mo-launcher-shadow)",
          zIndex: 3,
        }}
        aria-label={isOpen ? "Collapse organizer sidebar" : "Open organizer sidebar"}
      >
        <div
          className="absolute inset-[5px] rounded-full border"
          style={{ borderColor: "var(--mo-launcher-ring)" }}
        />
        {isOpen ? <ChevronRight className="relative h-5 w-5" /> : <ChevronLeft className="relative h-5 w-5" />}
        {stats.highPriorityCount ? (
          <span
            className="absolute -right-1 -top-1 min-w-[22px] rounded-full px-1.5 py-1 text-center text-[10px] font-semibold leading-none"
            style={{
              backgroundColor: "var(--mo-strong-bg)",
              color: "var(--mo-strong-text)",
            }}
          >
            {stats.highPriorityCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="mail-organizer-shell">
          <aside
            className={[
              "mail-organizer-interactive h-full w-[392px] overflow-hidden rounded-[30px] border",
              "bg-[var(--mo-panel-bg)] text-[var(--mo-panel-text)] backdrop-blur-panel transition-all duration-300 ease-out",
              "pointer-events-auto translate-x-0 opacity-100 animate-panel-in",
            ].join(" ")}
            style={{
              borderColor: "var(--mo-panel-border)",
              boxShadow: "var(--mo-shadow)",
              zIndex: 2,
            }}
          >
            <div className="flex h-full flex-col">
              <div className="border-b px-6 pb-5 pt-6" style={{ borderColor: "var(--mo-panel-border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className="text-[11px] uppercase tracking-[0.24em]"
                      style={{ color: "var(--mo-accent-text)" }}
                    >
                      Mail Organizer
                    </p>
                    <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-[var(--mo-panel-text)]">
                      Quiet triage
                    </h2>
                  </div>
	                  <div className="flex items-start gap-2">
	                    <button
	                      onClick={togglePinnedPanel}
	                      className="inline-flex items-center gap-2 rounded-full border bg-[var(--mo-panel-soft)] px-3 py-2 text-xs font-medium text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
                      style={{ borderColor: "var(--mo-chip-border)" }}
                      aria-pressed={isPinned}
                    >
	                      <Pin className="h-3.5 w-3.5" />
	                      <span>{isPinned ? "Unpin panel" : "Pin panel"}</span>
	                    </button>
	                    <div className="flex flex-col items-center gap-1.5">
	                      <button
	                        onClick={onRefresh}
	                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border bg-[var(--mo-panel-soft)] text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
	                        style={{ borderColor: "var(--mo-chip-border)" }}
	                        aria-label="Refresh email list"
	                      >
	                        <RefreshCw className="h-4 w-4" />
	                      </button>
	                      <button
	                        onClick={toggleSummaryLanguage}
	                        className="rounded-full border bg-[var(--mo-panel-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
	                        style={{ borderColor: "var(--mo-chip-border)" }}
	                        aria-label="Toggle summary language"
	                        title={summaryLanguage === "zh" ? "AI summary language: Chinese" : "AI summary language: English"}
	                      >
	                        {summaryLanguage === "zh" ? "中" : "EN"}
	                      </button>
	                    </div>
	                  </div>
                </div>

                <p className="mt-3 max-w-[250px] text-sm leading-6" style={{ color: "var(--mo-panel-muted)" }}>
                  Sort visible mail by urgency, route noise away, and keep context close to the inbox.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(Object.entries(THEMES) as Array<[ThemeName, (typeof THEMES)[ThemeName]]>).map(
                    ([name, theme]) => {
                      const active = themeName === name;
                      return (
                        <button
                          key={name}
                          onClick={() => handleThemeChange(name)}
                          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition hover:brightness-[1.02]"
                          style={{
                            backgroundColor: active ? "var(--mo-strong-bg)" : "var(--mo-panel-soft)",
                            color: active ? "var(--mo-strong-text)" : "var(--mo-panel-text)",
                            borderColor: active ? "var(--mo-strong-bg)" : "var(--mo-chip-border)",
                          }}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: theme.swatch }}
                          />
                          <span>{theme.label}</span>
                        </button>
                      );
                    }
                  )}
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setActivePage("inbox")}
                    className="rounded-[22px] border px-4 py-3 text-left transition hover:brightness-[1.02]"
                    style={{
                      borderColor: activePage === "inbox" ? "var(--mo-accent-soft)" : "var(--mo-chip-border)",
                      backgroundColor: activePage === "inbox" ? "var(--mo-chip-bg)" : "var(--mo-panel-soft)",
                    }}
                  >
                    <p
                      className="text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: "var(--mo-accent-text)" }}
                    >
                      Inbox
                    </p>
                    <p className="mt-2 text-[28px] font-semibold tracking-[-0.05em] text-[var(--mo-panel-text)]">
                      {stats.visibleCount}
                    </p>
                  </button>
                  <button
                    onClick={() => setActivePage("summary")}
                    className="rounded-[22px] border px-4 py-3 text-left transition hover:brightness-[1.02]"
                    style={{
                      borderColor: activePage === "summary" ? "var(--mo-accent-soft)" : "var(--mo-chip-border)",
                      backgroundColor: activePage === "summary" ? "var(--mo-chip-bg)" : "var(--mo-panel-soft)",
                    }}
                  >
                    <p
                      className="text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: "var(--mo-accent-text)" }}
                    >
                      Summary
                    </p>
                    <p className="mt-2 text-[28px] font-semibold tracking-[-0.05em] text-[var(--mo-panel-text)]">
                      {selectedEmail ? 1 : 0}
                    </p>
                  </button>
                  <button
                    onClick={openRulesManager}
                    className="rounded-[22px] border px-4 py-3 text-left transition hover:brightness-[1.02]"
                    style={{
                      borderColor: activePage === "rules" ? "var(--mo-accent-soft)" : "var(--mo-chip-border)",
                      backgroundColor: activePage === "rules" ? "var(--mo-chip-bg)" : "var(--mo-panel-soft)",
                    }}
                  >
                    <p
                      className="text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: "var(--mo-accent-text)" }}
                    >
                      Rules
                    </p>
                    <p className="mt-2 text-[28px] font-semibold tracking-[-0.05em] text-[var(--mo-panel-text)]">
                      {stats.rulesCount}
                    </p>
                  </button>
                </div>
              </div>

              <div className="mail-organizer-scrollbar flex-1 space-y-6 overflow-y-auto px-6 py-5">
                {activePage === "inbox" ? (
                  <>
                <section>
                  <div
                    className="mb-4 rounded-[22px] border bg-[var(--mo-panel-soft)] px-4 py-4"
                    style={{ borderColor: "var(--mo-chip-border)" }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--mo-panel-text)]">20-day scan</p>
                        <p className="mt-1 text-xs leading-5" style={{ color: "var(--mo-panel-muted)" }}>
                          Collect rendered OWA mail while scrolling. Cached mail stays available for filtering.
                        </p>
                      </div>
                      <button
                        onClick={scanState.scanning ? onStopScan : onStartScan20Days}
                        className="shrink-0 rounded-full px-3 py-2 text-xs font-medium transition hover:brightness-[1.02]"
                        style={{
                          backgroundColor: scanState.scanning ? "var(--mo-panel-softer)" : "var(--mo-strong-bg)",
                          color: scanState.scanning ? "var(--mo-panel-text)" : "var(--mo-strong-text)",
                        }}
                      >
                        {scanState.scanning ? "Stop scan" : "Scan 20 days"}
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs" style={{ color: "var(--mo-panel-muted)" }}>
                      <span>Cached {scanState.cachedCount}</span>
                      <span>Visible DOM {scanState.visibleCount}</span>
                      <span>Pass {scanState.steps}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5" style={{ color: "var(--mo-panel-muted)" }}>
                      {scanState.message}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {categories.map((category) => {
                      const Icon = categoryIcons[category];
                      const active = activeCategory === category;
                      return (
                        <button
                          key={category}
                          onClick={() => setActiveCategory(category)}
                          className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition hover:brightness-[1.02]"
                          style={{
                            borderColor: active ? "var(--mo-chip-active-bg)" : "var(--mo-chip-border)",
                            backgroundColor: active ? "var(--mo-chip-active-bg)" : "var(--mo-chip-bg)",
                            color: active ? "var(--mo-chip-active-text)" : "var(--mo-panel-muted)",
                          }}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{category}</span>
                          <span className="text-[11px] opacity-70">{emailsByCategory[category]?.length ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

	                <section className="border-t pt-5" style={{ borderColor: "var(--mo-panel-border)" }}>
	                  <div className="mb-3 flex items-center justify-between gap-3">
	                    <div>
	                      <p className="text-sm font-semibold text-[var(--mo-panel-text)]">{activeCategory}</p>
	                      <p className="text-xs" style={{ color: "var(--mo-panel-muted)" }}>
	                        Current viewport plus cached scan results. Only your rules or manual changes move mail between categories.
	                      </p>
	                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px]"
                      style={{
                        backgroundColor: "var(--mo-panel-soft)",
                        color: "var(--mo-panel-muted)",
                      }}
                    >
                      {activeEmails.length} items
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {activeEmails.length ? (
                      activeEmails.map((email) => (
                        <button
                          key={email.id}
                          onClick={() => onSelectEmail(email)}
                          className="w-full rounded-[24px] border px-4 py-3 text-left transition hover:brightness-[1.01]"
                          style={{
                            borderColor:
                              selectedEmail?.id === email.id
                                ? "var(--mo-accent-soft)"
                                : "transparent",
                            backgroundColor:
                              selectedEmail?.id === email.id
                                ? "var(--mo-panel-soft)"
                                : "var(--mo-panel-softer)",
                            boxShadow:
                              selectedEmail?.id === email.id
                                ? "0 10px 26px rgba(17, 19, 21, 0.08)"
                                : "none",
                          }}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium" style={{ color: "var(--mo-panel-muted)" }}>
                                {email.sender || "Unknown sender"}
                              </p>
                              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[var(--mo-panel-text)]">
                                {email.subject}
                              </p>
                            </div>
                            <span
                              className="shrink-0 text-[11px] uppercase tracking-[0.16em]"
                              style={{ color: "var(--mo-accent-text)" }}
                            >
                              {email.timeText || "Now"}
                            </span>
                          </div>

                          <div className="mt-3 flex items-center gap-2">
                            <span
                              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                              style={{
                                backgroundColor: "var(--mo-panel-soft)",
                                color: "var(--mo-panel-muted)",
                              }}
                            >
                              {priorityLabel(email)}
                            </span>
	                            {email.matchedRuleId ? (
	                              <span
	                                className="rounded-full px-2.5 py-1 text-[11px] font-medium"
	                                style={{
	                                  backgroundColor: "var(--mo-accent-soft)",
	                                  color: "var(--mo-accent-text)",
	                                }}
	                              >
	                                Rule
	                              </span>
	                            ) : null}
	                            <span
	                              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
	                              title={`Priority reason: ${email.priorityReason}`}
	                              style={{
	                                backgroundColor: "var(--mo-panel-soft)",
	                                color: "var(--mo-accent-text)",
	                              }}
	                            >
	                              {prioritySourceLabel(email)}
	                            </span>
	                            {email.isCachedOnly ? (
	                              <span
	                                className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                                style={{
                                  backgroundColor: "var(--mo-panel-soft)",
                                  color: "var(--mo-accent-text)",
                                }}
                              >
                                Cached
                              </span>
                            ) : null}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div
                        className="rounded-[24px] border border-dashed px-4 py-8 text-center text-sm"
                        style={{
                          borderColor: "var(--mo-panel-border)",
                          color: "var(--mo-panel-muted)",
                        }}
                      >
                        No visible emails in this category yet.
                      </div>
                    )}
                  </div>
                </section>
                  </>
                ) : null}

                {activePage === "rules" ? (
                <section className="border-t pt-5" style={{ borderColor: "var(--mo-panel-border)" }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--mo-panel-text)]">Rules</p>
                      <p className="text-xs" style={{ color: "var(--mo-panel-muted)" }}>
                        Route sender, subject, or snippet keywords automatically.
                      </p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px]"
                      style={{
                        backgroundColor: "var(--mo-panel-soft)",
                        color: "var(--mo-panel-muted)",
                      }}
                    >
                      {rules.length} active
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={ruleField}
                      onChange={(event) => setRuleField(event.target.value as RuleField)}
                      className="rounded-[18px] border bg-[var(--mo-panel-soft)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none"
                      style={{ borderColor: "var(--mo-chip-border)" }}
                    >
                      <option value="sender">Sender</option>
                      <option value="subject">Subject</option>
                      <option value="snippet">Snippet</option>
                    </select>
                    <input
                      value={ruleKeyword}
                      onChange={(event) => setRuleKeyword(event.target.value)}
                      placeholder="Keyword"
                      className="rounded-[18px] border bg-[var(--mo-panel-soft)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none placeholder:text-[var(--mo-panel-muted)]"
                      style={{ borderColor: "var(--mo-chip-border)" }}
                    />
                    <select
                      value={ruleCategory}
                      onChange={(event) => setRuleCategory(event.target.value as ArchiveCategory)}
                      className="rounded-[18px] border bg-[var(--mo-panel-soft)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none"
                      style={{ borderColor: "var(--mo-chip-border)" }}
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={submitRule}
                    className="mt-3 w-full rounded-full px-4 py-3 text-sm font-medium transition hover:brightness-[1.02]"
                    style={{
                      backgroundColor: "var(--mo-strong-bg)",
                      color: "var(--mo-strong-text)",
                    }}
                  >
                    Add rule
                  </button>

                  <div className="mt-3 space-y-2">
                    {rules.length ? (
                      rules.map((rule) => {
                        const isEditing = editingRuleId === rule.id;
                        return (
                          <div
                            key={rule.id}
                            className="rounded-[20px] border bg-[var(--mo-panel-softer)] px-3.5 py-3"
                            style={{ borderColor: "var(--mo-chip-border)" }}
                          >
                            {isEditing ? (
                              <>
                                <div className="grid grid-cols-3 gap-2">
                                  <select
                                    value={editingRuleField}
                                    onChange={(event) => setEditingRuleField(event.target.value as RuleField)}
                                    className="rounded-[16px] border bg-[var(--mo-panel-soft)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none"
                                    style={{ borderColor: "var(--mo-chip-border)" }}
                                  >
                                    <option value="sender">Sender</option>
                                    <option value="subject">Subject</option>
                                    <option value="snippet">Snippet</option>
                                  </select>
                                  <input
                                    value={editingRuleKeyword}
                                    onChange={(event) => setEditingRuleKeyword(event.target.value)}
                                    className="rounded-[16px] border bg-[var(--mo-panel-soft)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none"
                                    style={{ borderColor: "var(--mo-chip-border)" }}
                                  />
                                  <select
                                    value={editingRuleCategory}
                                    onChange={(event) =>
                                      setEditingRuleCategory(event.target.value as ArchiveCategory)
                                    }
                                    className="rounded-[16px] border bg-[var(--mo-panel-soft)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none"
                                    style={{ borderColor: "var(--mo-chip-border)" }}
                                  >
                                    {categories.map((category) => (
                                      <option key={category} value={category}>
                                        {category}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="mt-3 flex gap-2">
                                  <button
                                    onClick={() => void saveRuleEdit(rule)}
                                    disabled={!editingRuleKeyword.trim()}
                                    className="rounded-full px-3 py-2 text-xs font-medium transition hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                                    style={{
                                      backgroundColor: "var(--mo-strong-bg)",
                                      color: "var(--mo-strong-text)",
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={resetRuleEditor}
                                    className="rounded-full border px-3 py-2 text-xs font-medium text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
                                    style={{ borderColor: "var(--mo-chip-border)" }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="flex items-start justify-between gap-3">
                                <div className="text-sm leading-6" style={{ color: "var(--mo-panel-muted)" }}>
                                  <span className="font-medium text-[var(--mo-panel-text)]">{rule.field}</span>
                                  <span> contains </span>
                                  <span className="font-medium text-[var(--mo-panel-text)]">{rule.keyword}</span>
                                  <span>{" -> "}</span>
                                  <span className="font-medium" style={{ color: "var(--mo-accent-text)" }}>
                                    {rule.targetCategory}
                                  </span>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  <button
                                    onClick={() => beginRuleEdit(rule)}
                                    className="rounded-full border px-3 py-2 text-xs font-medium text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
                                    style={{ borderColor: "var(--mo-chip-border)" }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => void handleDeleteRule(rule.id)}
                                    className="rounded-full border px-3 py-2 text-xs font-medium text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
                                    style={{ borderColor: "var(--mo-chip-border)" }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div
                        className="rounded-[20px] border border-dashed px-4 py-4 text-sm"
                        style={{
                          borderColor: "var(--mo-panel-border)",
                          color: "var(--mo-panel-muted)",
                        }}
                      >
                        No rules yet.
                      </div>
                    )}
                  </div>
                </section>
                ) : null}

                {activePage === "summary" ? (
                <section className="border-t pt-5" style={{ borderColor: "var(--mo-panel-border)" }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: "var(--mo-strong-bg)",
                          color: "var(--mo-strong-text)",
                        }}
                      >
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
	                        <p className="text-sm font-semibold text-[var(--mo-panel-text)]">AI summary</p>
	                        <p className="text-xs" style={{ color: "var(--mo-panel-muted)" }}>
	                          {summaryLanguage === "zh" ? "输出中文摘要" : "Output English summary"}
	                        </p>
                      </div>
                    </div>
	                    <button
	                      onClick={() => onGenerateSummary(summaryLanguage)}
	                      disabled={!selectedEmail || summary.loading}
	                      className="rounded-full border bg-[var(--mo-panel-soft)] px-3 py-2 text-xs font-medium text-[var(--mo-panel-text)] transition hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
	                      style={{ borderColor: "var(--mo-chip-border)" }}
	                    >
	                      {summary.loading ? "Summarizing..." : summaryLanguage === "zh" ? "中文摘要" : "Summarize"}
	                    </button>
	                  </div>

	                  {selectedEmail ? (
                    <div className="space-y-3">
                      <div
                        className="rounded-[22px] border bg-[var(--mo-panel-soft)] px-4 py-4"
                        style={{ borderColor: "var(--mo-chip-border)" }}
                      >
                        <p
                          className="text-[11px] uppercase tracking-[0.18em]"
                          style={{ color: "var(--mo-accent-text)" }}
                        >
                          Selected
                        </p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-[var(--mo-panel-text)]">
                          {selectedEmail.subject}
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--mo-panel-muted)" }}>
                          {selectedEmail.sender}
                        </p>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <select
                            value={selectedEmail.category}
                            onChange={(event) =>
                              onUpdateSelectedEmail({
                                category: event.target.value as ArchiveCategory,
                              })
                            }
                            className="rounded-[18px] border bg-[var(--mo-panel-softer)] px-3 py-2 text-sm text-[var(--mo-panel-text)] outline-none"
                            style={{ borderColor: "var(--mo-chip-border)" }}
                          >
                            {categories.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() =>
                              onUpdateSelectedEmail({
                                isPinnedHigh: selectedEmail.priorityScore < 100,
                              })
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-[18px] border bg-[var(--mo-panel-softer)] px-3 py-2 text-sm font-medium text-[var(--mo-panel-text)] transition hover:brightness-[1.02]"
                            style={{ borderColor: "var(--mo-chip-border)" }}
                          >
                            <Pin className="h-3.5 w-3.5" />
                            {selectedEmail.priorityScore >= 100 ? "Unpin" : "Pin high"}
                          </button>
                        </div>
                      </div>

                      <div
                        className="rounded-[22px] px-4 py-4"
                        style={{
                          backgroundColor: "var(--mo-summary-bg)",
                          color: "var(--mo-summary-text)",
                        }}
                      >
	                        {summary.loading ? (
	                          <div className="space-y-2">
                            <div className="h-3 w-[88%] rounded-full bg-white/15" />
                            <div className="h-3 w-[65%] rounded-full bg-white/10" />
                            <div className="h-3 w-[54%] rounded-full bg-white/10" />
                          </div>
	                        ) : summary.error ? (
	                          <p className="rounded-[18px] border border-white/10 bg-white/5 px-3 py-3 text-sm leading-6">
	                            {summary.error}
	                          </p>
	                        ) : summary.bullets.length ? (
	                          <>
                            <ul className="space-y-2.5">
                              {summary.bullets.map((bullet) => (
                                <li key={bullet} className="flex gap-2 text-sm leading-6">
                                  <span
                                    className="mt-2 h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: "var(--mo-accent-soft)" }}
                                  />
                                  <span>{bullet}</span>
                                </li>
                              ))}
                            </ul>
                            {summary.insight ? (
                              <p className="mt-4 rounded-[18px] border border-white/10 bg-white/5 px-3 py-3 text-sm leading-6">
                                {summary.insight}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-sm leading-6 opacity-80">
                            Keep this panel small. Archive flow comes first, summary stays secondary.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="rounded-[22px] border border-dashed px-4 py-8 text-center text-sm"
                      style={{
                        borderColor: "var(--mo-panel-border)",
                        color: "var(--mo-panel-muted)",
                      }}
                    >
                      Select a visible email to enable the AI summary.
                    </div>
                  )}
                </section>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
