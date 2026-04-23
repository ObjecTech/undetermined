import type { EmailRecord, SummaryLanguage, SummaryState } from "./types/email";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const BUILT_IN_DEEPSEEK_API_KEY = "sk-b545ea81d8bd435e96d9630816cef148";

interface SummarizeMessage {
  type: "mail-organizer:summarize-email";
  payload: {
    language: SummaryLanguage;
    email: Pick<
      EmailRecord,
      "sender" | "subject" | "snippet" | "timeText" | "category" | "priorityReason"
    > & {
      bodyText?: string;
    };
  };
}

interface DeepSeekChoice {
  message?: {
    content?: string | null;
  };
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

function parseSummaryContent(content: string): Pick<SummaryState, "bullets" | "insight"> {
  try {
    const parsed = JSON.parse(content) as { bullets?: unknown; insight?: unknown };
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const insight = typeof parsed.insight === "string" ? parsed.insight.trim() : "";
    if (bullets.length || insight) return { bullets, insight };
  } catch {
    // Fall back to plain-text parsing below.
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean);

  return {
    bullets: lines.slice(0, 6),
    insight: lines.slice(6).join(" ") || "Summary generated from the currently available email preview.",
  };
}

function apiErrorMessage(status: number, response: DeepSeekResponse) {
  if (status === 401) return "DeepSeek API key is invalid or expired.";
  if (status === 402) return "DeepSeek account balance is insufficient.";
  if (status === 429) return "DeepSeek rate limit reached. Try again later.";
  return response.error?.message || `DeepSeek request failed with HTTP ${status}.`;
}

function languageInstruction(language: SummaryLanguage) {
  return language === "zh"
    ? "Write the entire JSON content in Simplified Chinese."
    : "Write the entire JSON content in clear, natural English.";
}

async function summarizeEmail(
  email: SummarizeMessage["payload"]["email"],
  language: SummaryLanguage
): Promise<SummaryState> {
  const availableBody = (email.bodyText || "").trim();
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BUILT_IN_DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: "system",
          content:
            [
              "You summarize mailbox emails for a university student who needs practical triage help.",
              languageInstruction(language),
              "Return only valid JSON with keys bullets and insight.",
              "bullets must contain 4-6 concise but informative items.",
              "Cover: core purpose, required action, deadline or date if present, sender expectation, useful context, and risk/priority.",
              "If the email is purely informational, say that clearly and mention what can be ignored.",
              "insight must be 1-2 sentences with a recommended next step.",
              "Do not invent facts that are not in the email text.",
            ].join(" "),
        },
        {
          role: "user",
          content: [
            `Sender: ${email.sender || "Unknown"}`,
            `Subject: ${email.subject || "(No subject)"}`,
            `Received: ${email.timeText || "Unknown"}`,
            `Category: ${email.category}`,
            `Priority reason: ${email.priorityReason}`,
            `Preview: ${email.snippet || "No preview available"}`,
            `Body: ${availableBody || "No full body captured; summarize from preview and metadata only."}`,
          ].join("\n"),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 900,
      stream: false,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as DeepSeekResponse;
  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, data));
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek returned an empty summary.");
  }

  return {
    loading: false,
    ...parseSummaryContent(content),
  };
}

chrome.runtime.onMessage.addListener((message: SummarizeMessage, _sender, sendResponse) => {
  if (message?.type !== "mail-organizer:summarize-email") return false;

  void summarizeEmail(message.payload.email, message.payload.language)
    .then((summary) => sendResponse({ ok: true, summary }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to summarize email.",
      })
    );

  return true;
});
