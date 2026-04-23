export type ArchiveCategory =
  | "高优先级"
  | "待处理"
  | "本周跟进"
  | "没用"
  | "已归档";

export type RuleField = "sender" | "subject" | "snippet";
export type SummaryLanguage = "zh" | "en";

export interface EmailRule {
  id: string;
  field: RuleField;
  keyword: string;
  targetCategory: ArchiveCategory;
  enabled: boolean;
}

export interface ManualOverride {
  category?: ArchiveCategory;
  isPinnedHigh?: boolean;
}

export interface EmailRecord {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  timeText: string;
  dueDate?: string;
  receivedAt?: string;
  receivedDateText?: string;
  cachedAt?: number;
  lastSeenAt?: number;
  isCachedOnly?: boolean;
  selected: boolean;
  category: ArchiveCategory;
  priorityScore: number;
  priorityReason: string;
  matchedRuleId?: string;
  rowElement?: HTMLElement;
}

export interface ScanState {
  scanning: boolean;
  status: "idle" | "scanning" | "complete" | "stopped" | "error";
  cachedCount: number;
  visibleCount: number;
  steps: number;
  message: string;
}

export interface SummaryState {
  loading: boolean;
  bullets: string[];
  insight: string;
  error?: string;
}
