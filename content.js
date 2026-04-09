(function () {
  const ROOT_ID = "mail-organizer-root";
  const STORAGE_PREFIX = "mail-organizer";
  const DEFAULT_CATEGORIES = ["高优先级", "待处理", "本周跟进", "没用", "已归档"];
  const DEFAULT_CONFIG = {
    apiKey: "sk-b545ea81d8bd435e96d9630816cef148",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  };
  const FIELD_LABELS = {
    sender: "发件人",
    subject: "标题",
    snippet: "摘要",
  };
  const SELECTORS = {
    rows: [
      'div[tabindex="-1"][data-convid][data-time]',
      '[role="option"][data-convid]',
      '[data-convid][data-time]',
    ],
    sender: [
      ".lvHighlightFromClass",
      '[data-automationid="MessageListSender"]',
      "[title]"
    ],
    subject: [
      ".lvHighlightSubjectClass",
      '[data-automationid="MessageListSubject"]',
      '[aria-label*="主题"]'
    ],
    snippet: [
      "._lvv_o1 .ms-font-weight-semilight",
      "._lvv_o1 .ms-font-color-neutralSecondary",
      '[data-automationid="MessageListPreview"]'
    ],
    time: [
      "._lvv_t1",
      '[data-automationid="MessageListReceivedDate"]',
      "time"
    ],
    readingPane: [
      '[aria-label*="Reading pane"]',
      '[aria-label*="阅读窗格"]',
      '[role="main"]',
    ],
  };

  const state = {
    emails: [],
    selectedId: "",
    collapsed: false,
    panelScrollTop: 0,
    lastSignature: "",
    observer: null,
    storage: {
      categories: [...DEFAULT_CATEGORIES],
      rules: [],
      overrides: {},
      config: { ...DEFAULT_CONFIG },
      analyses: {},
    },
    draftCategory: "",
    draftRule: {
      field: "sender",
      value: "",
      targetCategory: "没用",
    },
    loadingSummaryFor: "",
    lastError: "",
  };

  function generateId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getStorageApi() {
    if (window.chrome && chrome.storage && chrome.storage.local) {
      return {
        async get(keys) {
          return chrome.storage.local.get(keys);
        },
        async set(values) {
          return chrome.storage.local.set(values);
        },
      };
    }

    return {
      async get(keys) {
        const entries = {};
        for (const key of keys) {
          const raw = localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
          entries[key] = raw ? JSON.parse(raw) : undefined;
        }
        return entries;
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => {
          localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
        });
      },
    };
  }

  const storageApi = getStorageApi();

  function uniqueCategories(list) {
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...(list || [])].filter(Boolean)));
  }

  function createRule(rule = {}) {
    return {
      id: rule.id || generateId(),
      field: rule.field || "sender",
      value: rule.value || "",
      targetCategory: rule.targetCategory || "没用",
      enabled: rule.enabled !== false,
    };
  }

  function hydrateConfig(config = {}) {
    return {
      apiKey: config.apiKey || DEFAULT_CONFIG.apiKey,
      baseUrl: config.baseUrl || DEFAULT_CONFIG.baseUrl,
      model: config.model || DEFAULT_CONFIG.model,
    };
  }

  async function loadStorage() {
    const result = await storageApi.get(["categories", "rules", "overrides", "config", "analyses", "collapsed"]);
    state.storage.categories = uniqueCategories(result.categories || DEFAULT_CATEGORIES);
    state.storage.rules = Array.isArray(result.rules) ? result.rules.map(createRule) : [];
    state.storage.overrides = result.overrides || {};
    state.storage.config = hydrateConfig(result.config || {});
    state.storage.analyses = result.analyses || {};
    state.collapsed = Boolean(result.collapsed);
    state.draftRule.targetCategory = state.storage.categories.includes("没用")
      ? "没用"
      : state.storage.categories[0];
  }

  async function persistStorage() {
    await storageApi.set({
      categories: state.storage.categories,
      rules: state.storage.rules,
      overrides: state.storage.overrides,
      config: state.storage.config,
      analyses: state.storage.analyses,
      collapsed: state.collapsed,
    });
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
    return root;
  }

  function queryFirst(row, selectors) {
    for (const selector of selectors) {
      const node = row.querySelector(selector);
      if (node && normalizeText(node.textContent || node.getAttribute("title") || "")) return node;
    }
    return null;
  }

  function findRows() {
    for (const selector of SELECTORS.rows) {
      const rows = Array.from(document.querySelectorAll(selector));
      if (rows.length) return rows;
    }
    return [];
  }

  function parseTimeValue(row, timeText) {
    const dataTime = row.getAttribute("data-time") || row.getAttribute("datetime") || "";
    if (dataTime) return dataTime;
    return timeText;
  }

  function getCurrentReadingPaneText() {
    for (const selector of SELECTORS.readingPane) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const richNode = nodes.find((node) => normalizeText(node.textContent).length > 200);
      if (richNode) return normalizeText(richNode.textContent);
    }
    return "";
  }

  function buildEmail(row, index) {
    const senderNode = queryFirst(row, SELECTORS.sender);
    const subjectNode = queryFirst(row, SELECTORS.subject);
    const snippetNode = queryFirst(row, SELECTORS.snippet);
    const timeNode = queryFirst(row, SELECTORS.time);
    const sender = normalizeText(senderNode ? senderNode.textContent || senderNode.getAttribute("title") : "");
    const subject = normalizeText(subjectNode ? subjectNode.textContent || subjectNode.getAttribute("title") : "");
    const snippet = normalizeText(snippetNode ? snippetNode.textContent : "");
    const timeText = normalizeText(timeNode ? timeNode.textContent || timeNode.getAttribute("title") : "");

    if (!sender && !subject && !snippet) return null;

    const id =
      row.getAttribute("data-convid") ||
      row.getAttribute("data-id") ||
      row.id ||
      `row-${index}`;

    const override = state.storage.overrides[id] || {};
    const dataTime = parseTimeValue(row, timeText);

    return {
      id,
      sender,
      subject: subject || "(无标题)",
      snippet,
      timeText,
      dataTime,
      row,
      manualCategory: override.manualCategory || "",
      manualPriority: override.priority || "auto",
      deadline: override.deadline || "",
      summarySource: override.summarySource || "",
    };
  }

  function extractEmails() {
    return findRows()
      .map(buildEmail)
      .filter(Boolean)
      .map((email) => {
        const priority = getPriorityMeta(email);
        const resolution = resolveCategory(email);
        return {
          ...email,
          priority,
          category: resolution.category,
          categorySource: resolution.source,
          matchedRule: resolution.rule,
        };
      })
      .sort(sortEmails);
  }

  function daysUntil(dateString) {
    if (!dateString) return null;
    const target = new Date(`${dateString}T23:59:59`);
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }

  function getPriorityMeta(email) {
    const manualMap = {
      high: { score: 100, label: "手动高优", tone: "urgent" },
      medium: { score: 72, label: "手动中优", tone: "soon" },
      low: { score: 30, label: "手动低优", tone: "low" },
    };

    if (email.manualPriority && email.manualPriority !== "auto" && manualMap[email.manualPriority]) {
      return { ...manualMap[email.manualPriority], days: daysUntil(email.deadline) };
    }

    const days = daysUntil(email.deadline);
    const text = `${email.subject} ${email.snippet}`.toLowerCase();
    const hasUrgentWord = /(ddl|deadline|due|urgent|asap|submission|today|tomorrow|截止|今天|明天|尽快|本周)/i.test(text);

    if (days !== null && days <= 0) {
      return { score: 98, label: "今日截止", tone: "urgent", days };
    }
    if (days !== null && days <= 2) {
      return { score: 90, label: "临近 DDL", tone: "soon", days };
    }
    if (hasUrgentWord) {
      return { score: 82, label: "疑似紧急", tone: "soon", days };
    }
    if (days !== null && days <= 7) {
      return { score: 68, label: "本周到期", tone: "normal", days };
    }
    return { score: 45, label: "普通", tone: "low", days };
  }

  function matchRule(email, rule) {
    if (!rule.enabled || !rule.value.trim()) return false;
    const haystack = normalizeText(email[rule.field] || "").toLowerCase();
    return haystack.includes(rule.value.trim().toLowerCase());
  }

  function resolveCategory(email) {
    const categories = new Set(state.storage.categories);

    if (email.manualCategory && categories.has(email.manualCategory)) {
      return { category: email.manualCategory, source: "manual", rule: null };
    }

    const matchedRule = state.storage.rules.find((rule) => matchRule(email, rule));
    if (matchedRule && categories.has(matchedRule.targetCategory)) {
      return { category: matchedRule.targetCategory, source: "rule", rule: matchedRule };
    }

    if (email.priority.score >= 85) {
      return { category: "高优先级", source: "priority", rule: null };
    }
    if (email.priority.days !== null && email.priority.days <= 7) {
      return { category: "本周跟进", source: "priority", rule: null };
    }
    return { category: "待处理", source: "default", rule: null };
  }

  function sortEmails(a, b) {
    if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;

    const da = daysUntil(a.deadline);
    const db = daysUntil(b.deadline);
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null) return -1;
    if (db !== null) return 1;

    const ta = new Date(a.dataTime).getTime();
    const tb = new Date(b.dataTime).getTime();
    if (!Number.isNaN(tb) && !Number.isNaN(ta) && tb !== ta) return tb - ta;
    return 0;
  }

  function groupEmails(emails) {
    const groups = Object.fromEntries(state.storage.categories.map((name) => [name, []]));
    emails.forEach((email) => {
      if (!groups[email.category]) groups[email.category] = [];
      groups[email.category].push(email);
    });
    return groups;
  }

  function emailSignature(emails) {
    return emails
      .map((email) => [
        email.id,
        email.sender,
        email.subject,
        email.snippet,
        email.timeText,
        email.category,
        email.priority.score,
        email.deadline,
      ].join("|"))
      .join("||");
  }

  function selectEmail(id) {
    state.selectedId = id;
    render();
  }

  function selectedEmail() {
    return state.emails.find((email) => email.id === state.selectedId) || state.emails[0] || null;
  }

  function focusRow(email) {
    document.querySelectorAll(".mail-organizer-row-highlight").forEach((node) => {
      node.classList.remove("mail-organizer-row-highlight");
    });

    if (!email || !email.row) return;
    email.row.classList.add("mail-organizer-row-highlight");
    email.row.scrollIntoView({ behavior: "smooth", block: "center" });
    email.row.click();
  }

  function selectedSignature(email) {
    return JSON.stringify([
      email.id,
      email.subject,
      email.sender,
      email.snippet,
      email.deadline,
      email.manualPriority,
    ]);
  }

  function getStoredAnalysis(email) {
    const summary = state.storage.analyses[email.id];
    if (!summary) return null;
    return summary.signature === selectedSignature(email) ? summary : null;
  }

  function fieldLabel(field) {
    return FIELD_LABELS[field] || field;
  }

  function formatDate(dateString) {
    if (!dateString) return "未设置";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }

  function renderLoadingSummary() {
    return `
      <div class="mail-organizer-loading">
        <div class="mail-organizer-loading-line" style="width: 92%"></div>
        <div class="mail-organizer-loading-line" style="width: 78%"></div>
        <div class="mail-organizer-loading-line" style="width: 65%"></div>
      </div>
    `;
  }

  function renderSummary(email) {
    const summary = getStoredAnalysis(email);
    if (state.loadingSummaryFor === email.id) return renderLoadingSummary();
    if (!summary) {
      return `<p class="mail-organizer-empty">这里显示当前邮件的小型摘要，不影响归档主流程。</p>`;
    }

    return `
      <div class="mail-organizer-summary">
        <ul class="mail-organizer-summary-list">
          ${summary.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        <p class="mail-organizer-note" style="margin-top: 10px; color: rgba(238, 245, 255, 0.82);">
          ${escapeHtml(summary.insight)}
        </p>
      </div>
    `;
  }

  function renderSelectedEmail(email) {
    if (!email) {
      return `<p class="mail-organizer-empty">当前页面还没有抓到邮件列表，请先打开收件箱并滚动到邮件列表区域。</p>`;
    }

    const currentAnalysis = getStoredAnalysis(email);
    const detailTone = email.categorySource === "rule"
      ? `规则命中（${fieldLabel(email.matchedRule.field)}包含“${escapeHtml(email.matchedRule.value)}”）`
      : email.categorySource === "manual"
      ? "手动指定"
      : email.categorySource === "priority"
      ? "自动优先级"
      : "默认待处理";

    return `
      <div class="mail-organizer-grid">
        <label class="mail-organizer-label">
          <span class="mail-organizer-label-text">标题</span>
          <input class="mail-organizer-input" data-action="edit-subject" value="${escapeHtml(email.subject)}" />
        </label>
        <label class="mail-organizer-label">
          <span class="mail-organizer-label-text">发件人</span>
          <input class="mail-organizer-input" data-action="edit-sender" value="${escapeHtml(email.sender)}" />
        </label>
        <div class="mail-organizer-grid three">
          <label class="mail-organizer-label">
            <span class="mail-organizer-label-text">归档类别</span>
            <select class="mail-organizer-select" data-action="set-category">
              <option value="__auto__">自动归档</option>
              ${state.storage.categories.map((name) => `
                <option value="${escapeHtml(name)}" ${email.manualCategory === name ? "selected" : ""}>${escapeHtml(name)}</option>
              `).join("")}
            </select>
          </label>
          <label class="mail-organizer-label">
            <span class="mail-organizer-label-text">优先级</span>
            <select class="mail-organizer-select" data-action="set-priority">
              <option value="auto" ${email.manualPriority === "auto" ? "selected" : ""}>自动</option>
              <option value="high" ${email.manualPriority === "high" ? "selected" : ""}>高</option>
              <option value="medium" ${email.manualPriority === "medium" ? "selected" : ""}>中</option>
              <option value="low" ${email.manualPriority === "low" ? "selected" : ""}>低</option>
            </select>
          </label>
          <label class="mail-organizer-label">
            <span class="mail-organizer-label-text">DDL</span>
            <input class="mail-organizer-input" type="date" data-action="set-deadline" value="${escapeHtml(email.deadline)}" />
          </label>
        </div>
        <div class="mail-organizer-card" style="padding: 12px; background: rgba(255, 255, 255, 0.8);">
          <p class="mail-organizer-note">当前归档结果：<strong>${escapeHtml(email.category)}</strong></p>
          <p class="mail-organizer-note">排序标签：<strong>${escapeHtml(email.priority.label)}</strong></p>
          <p class="mail-organizer-note">归档来源：<strong>${detailTone}</strong></p>
          ${currentAnalysis ? `<p class="mail-organizer-note">摘要状态：<strong>已生成</strong></p>` : ""}
        </div>
        <label class="mail-organizer-label">
          <span class="mail-organizer-label-text">正文 / 摘要</span>
          <textarea class="mail-organizer-textarea" data-action="edit-snippet">${escapeHtml(email.snippet)}</textarea>
        </label>
      </div>
    `;
  }

  function renderBoard(groups) {
    return state.storage.categories.map((category) => {
      const emails = groups[category] || [];
      return `
        <section class="mail-organizer-category">
          <div class="mail-organizer-category-head">
            <div>
              <p class="mail-organizer-category-name">${escapeHtml(category)}</p>
              <p class="mail-organizer-category-count">${emails.length} 封邮件</p>
            </div>
            ${DEFAULT_CATEGORIES.includes(category) ? "" : `<button class="mail-organizer-tag" data-action="delete-category" data-category="${escapeHtml(category)}">删除</button>`}
          </div>
          <div class="mail-organizer-list">
            ${emails.length ? emails.map((email) => `
              <button class="mail-organizer-item ${email.id === state.selectedId ? "is-active" : ""}" data-action="select-email" data-id="${escapeHtml(email.id)}">
                <div class="mail-organizer-item-top">
                  <span class="mail-organizer-chip ${email.priority.tone}">${escapeHtml(email.priority.label)}</span>
                  <span class="mail-organizer-item-meta">${escapeHtml(category)}</span>
                </div>
                <p class="mail-organizer-item-title">${escapeHtml(email.subject)}</p>
                <p class="mail-organizer-item-sender">${escapeHtml(email.sender || "未填写发件人")}</p>
                <p class="mail-organizer-item-snippet">${escapeHtml(email.snippet || "暂无摘要")}</p>
                <div class="mail-organizer-item-top" style="margin-top: 10px;">
                  <span class="mail-organizer-item-meta">${escapeHtml(email.timeText || "")}</span>
                  <span class="mail-organizer-item-meta">${email.deadline ? `DDL ${escapeHtml(formatDate(email.deadline))}` : ""}</span>
                </div>
              </button>
            `).join("") : `<p class="mail-organizer-empty">当前没有邮件</p>`}
          </div>
        </section>
      `;
    }).join("");
  }

  function renderRuleList() {
    if (!state.storage.rules.length) {
      return `<p class="mail-organizer-empty">还没有规则。你可以先加一条：发件人包含 vendor-a -> 没用。</p>`;
    }

    return `
      <div class="mail-organizer-rule-list">
        ${state.storage.rules.map((rule) => `
          <div class="mail-organizer-rule-item">
            <div class="mail-organizer-rule-head">
              <p class="mail-organizer-item-title">${fieldLabel(rule.field)} 包含 “${escapeHtml(rule.value)}” -> ${escapeHtml(rule.targetCategory)}</p>
              <button class="mail-organizer-tag" data-action="delete-rule" data-id="${escapeHtml(rule.id)}">删除</button>
            </div>
            <label class="mail-organizer-note">
              <input type="checkbox" data-action="toggle-rule" data-id="${escapeHtml(rule.id)}" ${rule.enabled ? "checked" : ""} />
              启用这条规则
            </label>
          </div>
        `).join("")}
      </div>
    `;
  }

  function render() {
    const previousBody = document.querySelector(`#${ROOT_ID} .mail-organizer-body`);
    if (previousBody) state.panelScrollTop = previousBody.scrollTop;

    const root = ensureRoot();
    const groups = groupEmails(state.emails);
    const selected = selectedEmail();
    const urgentCount = state.emails.filter((email) => email.priority.score >= 85).length;
    const visibleCount = state.emails.length;

    root.innerHTML = `
      <aside class="mail-organizer-panel ${state.collapsed ? "is-collapsed" : ""}">
        <div class="mail-organizer-header">
          <div class="mail-organizer-eyebrow">Chrome Extension</div>
          <div class="mail-organizer-header-row">
            <div class="${state.collapsed ? "mail-organizer-hidden" : ""}">
              <h2 class="mail-organizer-title">邮件归档器</h2>
              <p class="mail-organizer-muted">主流程是分类归档和优先级排序，摘要只是辅助小窗。</p>
            </div>
            <button class="mail-organizer-button secondary" data-action="toggle-panel">${state.collapsed ? "展开" : "收起"}</button>
          </div>
          <div class="mail-organizer-actions ${state.collapsed ? "mail-organizer-hidden" : ""}">
            <button class="mail-organizer-button" data-action="refresh">刷新列表</button>
            <button class="mail-organizer-button secondary" data-action="focus-selected">定位选中</button>
          </div>
        </div>
        <div class="mail-organizer-body ${state.collapsed ? "mail-organizer-hidden" : ""}">
          ${state.lastError ? `<section class="mail-organizer-card"><p class="mail-organizer-note" style="color:#af2742;">${escapeHtml(state.lastError)}</p></section>` : ""}

          <section class="mail-organizer-card">
            <div class="mail-organizer-stats">
              <div class="mail-organizer-stat">
                <p class="mail-organizer-stat-label">当前可见邮件</p>
                <p class="mail-organizer-stat-value">${visibleCount}</p>
              </div>
              <div class="mail-organizer-stat">
                <p class="mail-organizer-stat-label">高优先级</p>
                <p class="mail-organizer-stat-value">${urgentCount}</p>
              </div>
              <div class="mail-organizer-stat">
                <p class="mail-organizer-stat-label">规则数量</p>
                <p class="mail-organizer-stat-value">${state.storage.rules.length}</p>
              </div>
            </div>
          </section>

          <section class="mail-organizer-card">
            <h3 class="mail-organizer-section-title">归档看板</h3>
            <div class="mail-organizer-board">
              ${renderBoard(groups)}
            </div>
          </section>

          <section class="mail-organizer-card">
            <div class="mail-organizer-header-row" style="margin:0 0 10px;">
              <div>
                <h3 class="mail-organizer-section-title" style="margin:0;">当前邮件</h3>
                <p class="mail-organizer-note">手动修改后会立刻重新归档。</p>
              </div>
              ${selected ? `<button class="mail-organizer-link" data-action="focus-selected">定位原邮件</button>` : ""}
            </div>
            ${renderSelectedEmail(selected)}
          </section>

          <section class="mail-organizer-card">
            <div class="mail-organizer-header-row" style="margin:0 0 10px;">
              <div>
                <h3 class="mail-organizer-section-title" style="margin:0;">AI 小窗摘要</h3>
                <p class="mail-organizer-note">只做辅助查看，不改动归档结果。</p>
              </div>
              ${selected ? `<button class="mail-organizer-link" data-action="generate-summary">生成摘要</button>` : ""}
            </div>
            ${selected ? renderSummary(selected) : `<p class="mail-organizer-empty">先选中一封邮件。</p>`}
            <details style="margin-top:12px;">
              <summary class="mail-organizer-note" style="cursor:pointer;">AI 配置</summary>
              <div class="mail-organizer-grid" style="margin-top:10px;">
                <input class="mail-organizer-input" data-action="set-base-url" value="${escapeHtml(state.storage.config.baseUrl)}" placeholder="API Base URL" />
                <input class="mail-organizer-input" data-action="set-api-key" type="password" value="${escapeHtml(state.storage.config.apiKey)}" placeholder="API Key" />
                <input class="mail-organizer-input" data-action="set-model" value="${escapeHtml(state.storage.config.model)}" placeholder="Model" />
              </div>
            </details>
          </section>

          <section class="mail-organizer-card">
            <h3 class="mail-organizer-section-title">规则与类别</h3>
            <div class="mail-organizer-grid">
              <div class="mail-organizer-grid two">
                <input class="mail-organizer-input" data-action="draft-category" value="${escapeHtml(state.draftCategory)}" placeholder="新增类别，例如：客户成功" />
                <button class="mail-organizer-link" data-action="add-category">添加类别</button>
              </div>
              <div class="mail-organizer-grid two">
                <select class="mail-organizer-select" data-action="draft-rule-field">
                  <option value="sender" ${state.draftRule.field === "sender" ? "selected" : ""}>发件人</option>
                  <option value="subject" ${state.draftRule.field === "subject" ? "selected" : ""}>标题</option>
                  <option value="snippet" ${state.draftRule.field === "snippet" ? "selected" : ""}>摘要</option>
                </select>
                <input class="mail-organizer-input" data-action="draft-rule-value" value="${escapeHtml(state.draftRule.value)}" placeholder="例如：vendor-a / no-reply" />
              </div>
              <div class="mail-organizer-grid two">
                <select class="mail-organizer-select" data-action="draft-rule-category">
                  ${state.storage.categories.map((name) => `
                    <option value="${escapeHtml(name)}" ${state.draftRule.targetCategory === name ? "selected" : ""}>${escapeHtml(name)}</option>
                  `).join("")}
                </select>
                <button class="mail-organizer-link" data-action="add-rule">添加规则</button>
              </div>
            </div>
            ${renderRuleList()}
          </section>
        </div>
      </aside>
    `;

    bindEvents(root);
    const nextBody = document.querySelector(`#${ROOT_ID} .mail-organizer-body`);
    if (nextBody) nextBody.scrollTop = state.panelScrollTop;
  }

  async function updateOverride(id, changes) {
    state.storage.overrides[id] = {
      ...(state.storage.overrides[id] || {}),
      ...changes,
    };
    await persistStorage();
    refreshEmails(true);
  }

  async function removeCategory(category) {
    if (DEFAULT_CATEGORIES.includes(category)) return;
    state.storage.categories = state.storage.categories.filter((item) => item !== category);
    Object.keys(state.storage.overrides).forEach((id) => {
      if (state.storage.overrides[id].manualCategory === category) {
        state.storage.overrides[id].manualCategory = "";
      }
    });
    state.storage.rules = state.storage.rules.map((rule) =>
      rule.targetCategory === category ? { ...rule, targetCategory: "待处理" } : rule
    );
    await persistStorage();
    refreshEmails(true);
  }

  async function generateSummary() {
    const email = selectedEmail();
    if (!email) return;
    if (!state.storage.config.apiKey.trim() || !state.storage.config.baseUrl.trim() || !state.storage.config.model.trim()) {
      state.lastError = "先填写 AI 配置。";
      render();
      return;
    }

    state.loadingSummaryFor = email.id;
    state.lastError = "";
    render();

    try {
      const readingPaneText = getCurrentReadingPaneText();
      const payload = {
        model: state.storage.config.model.trim(),
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "你是一个企业邮件助手。",
              "请只输出 JSON，不要输出 markdown。",
              '格式：{"summary":["要点1","要点2"],"insight":"一句话判断"}',
              "summary 最多 4 条，每条尽量短，优先提取行动项、DDL、负责人和关键事实。",
              "输出语言为简体中文。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              sender: email.sender,
              subject: email.subject,
              snippet: email.snippet,
              deadline: email.deadline,
              reading_pane: readingPaneText,
            }),
          },
        ],
      };

      const response = await fetch(`${state.storage.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.storage.config.apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(raw || `请求失败，状态码 ${response.status}`);
      }

      const parsed = JSON.parse(raw);
      const content = parsed.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("AI 返回为空。");
      }

      const data = parseJsonResponse(content);
      state.storage.analyses[email.id] = {
        signature: selectedSignature(email),
        summary: Array.isArray(data.summary) ? data.summary.map((item) => String(item).trim()).filter(Boolean).slice(0, 4) : [],
        insight: String(data.insight || "").trim(),
      };
      await persistStorage();
    } catch (error) {
      const message = String(error.message || error);
      state.lastError = /Failed to fetch|NetworkError|Load failed/i.test(message)
        ? "浏览器无法直接访问该接口。若报跨域错误，需要换成支持浏览器调用的代理或网关。"
        : message;
    } finally {
      state.loadingSummaryFor = "";
      render();
    }
  }

  function parseJsonResponse(rawText) {
    const cleaned = String(rawText || "")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw error;
    }
  }

  function bindEvents(root) {
    root.querySelectorAll("[data-action='select-email']").forEach((button) => {
      button.addEventListener("click", () => {
        selectEmail(button.dataset.id);
      });
    });

    root.querySelector("[data-action='toggle-panel']")?.addEventListener("click", async () => {
      state.collapsed = !state.collapsed;
      await persistStorage();
      render();
    });

    root.querySelector("[data-action='refresh']")?.addEventListener("click", () => {
      refreshEmails(true);
    });

    root.querySelectorAll("[data-action='focus-selected']").forEach((button) => {
      button.addEventListener("click", () => {
        focusRow(selectedEmail());
      });
    });

    root.querySelector("[data-action='add-category']")?.addEventListener("click", async () => {
      const value = state.draftCategory.trim();
      if (!value) return;
      state.storage.categories = uniqueCategories([...state.storage.categories, value]);
      state.draftCategory = "";
      await persistStorage();
      refreshEmails(true);
    });

    root.querySelector("[data-action='draft-category']")?.addEventListener("input", (event) => {
      state.draftCategory = event.target.value;
    });

    root.querySelector("[data-action='draft-rule-field']")?.addEventListener("change", (event) => {
      state.draftRule.field = event.target.value;
    });

    root.querySelector("[data-action='draft-rule-value']")?.addEventListener("input", (event) => {
      state.draftRule.value = event.target.value;
    });

    root.querySelector("[data-action='draft-rule-category']")?.addEventListener("change", (event) => {
      state.draftRule.targetCategory = event.target.value;
    });

    root.querySelector("[data-action='add-rule']")?.addEventListener("click", async () => {
      if (!state.draftRule.value.trim()) return;
      state.storage.rules.push(createRule(state.draftRule));
      state.draftRule.value = "";
      await persistStorage();
      refreshEmails(true);
    });

    root.querySelectorAll("[data-action='delete-rule']").forEach((button) => {
      button.addEventListener("click", async () => {
        state.storage.rules = state.storage.rules.filter((rule) => rule.id !== button.dataset.id);
        await persistStorage();
        refreshEmails(true);
      });
    });

    root.querySelectorAll("[data-action='toggle-rule']").forEach((input) => {
      input.addEventListener("change", async (event) => {
        state.storage.rules = state.storage.rules.map((rule) =>
          rule.id === input.dataset.id ? { ...rule, enabled: event.target.checked } : rule
        );
        await persistStorage();
        refreshEmails(true);
      });
    });

    root.querySelectorAll("[data-action='delete-category']").forEach((button) => {
      button.addEventListener("click", async () => {
        await removeCategory(button.dataset.category);
      });
    });

    const selected = selectedEmail();
    if (selected) {
      root.querySelector("[data-action='set-category']")?.addEventListener("change", async (event) => {
        await updateOverride(selected.id, {
          manualCategory: event.target.value === "__auto__" ? "" : event.target.value,
        });
      });

      root.querySelector("[data-action='set-priority']")?.addEventListener("change", async (event) => {
        await updateOverride(selected.id, {
          priority: event.target.value,
        });
      });

      root.querySelector("[data-action='set-deadline']")?.addEventListener("change", async (event) => {
        await updateOverride(selected.id, {
          deadline: event.target.value,
        });
      });

      root.querySelector("[data-action='edit-subject']")?.addEventListener("change", async (event) => {
        await updateOverride(selected.id, {
          customSubject: event.target.value,
        });
      });

      root.querySelector("[data-action='edit-sender']")?.addEventListener("change", async (event) => {
        await updateOverride(selected.id, {
          customSender: event.target.value,
        });
      });

      root.querySelector("[data-action='edit-snippet']")?.addEventListener("change", async (event) => {
        await updateOverride(selected.id, {
          customSnippet: event.target.value,
        });
      });
    }

    root.querySelector("[data-action='generate-summary']")?.addEventListener("click", () => {
      generateSummary();
    });

    root.querySelector("[data-action='set-base-url']")?.addEventListener("input", async (event) => {
      state.storage.config.baseUrl = event.target.value;
      await persistStorage();
    });

    root.querySelector("[data-action='set-api-key']")?.addEventListener("input", async (event) => {
      state.storage.config.apiKey = event.target.value;
      await persistStorage();
    });

    root.querySelector("[data-action='set-model']")?.addEventListener("input", async (event) => {
      state.storage.config.model = event.target.value;
      await persistStorage();
    });
  }

  function mergeOverrides(email) {
    const override = state.storage.overrides[email.id] || {};
    return {
      ...email,
      sender: override.customSender || email.sender,
      subject: override.customSubject || email.subject,
      snippet: override.customSnippet || email.snippet,
      manualCategory: override.manualCategory || email.manualCategory,
      manualPriority: override.priority || email.manualPriority,
      deadline: override.deadline || email.deadline,
    };
  }

  function refreshEmails(forceRender) {
    const extracted = extractEmails().map(mergeOverrides).map((email) => {
      const priority = getPriorityMeta(email);
      const resolution = resolveCategory({ ...email, priority });
      return {
        ...email,
        priority,
        category: resolution.category,
        categorySource: resolution.source,
        matchedRule: resolution.rule,
      };
    }).sort(sortEmails);

    state.emails = extracted;
    if (!state.selectedId || !state.emails.some((email) => email.id === state.selectedId)) {
      state.selectedId = state.emails[0]?.id || "";
    }

    const signature = emailSignature(state.emails);
    if (forceRender || signature !== state.lastSignature) {
      state.lastSignature = signature;
      render();
    }
  }

  function observeMailbox() {
    if (state.observer) state.observer.disconnect();

    const observer = new MutationObserver(() => {
      window.clearTimeout(observeMailbox._timer);
      observeMailbox._timer = window.setTimeout(() => refreshEmails(false), 250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-convid", "data-time", "aria-selected"],
    });

    state.observer = observer;
  }

  async function boot() {
    await loadStorage();
    refreshEmails(true);
    observeMailbox();
  }

  boot().catch((error) => {
    state.lastError = String(error.message || error);
    render();
  });
})();
