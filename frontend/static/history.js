/* ============================================================
   HISTORY.JS  v300
   Fixes:
   - THEME_KEY synced to "uniwiseTheme_v5" (matches chat page)
   - bubble-solid-uniwise added to class cleanup list
   - All other logic unchanged
   ============================================================ */

const HISTORY_KEY    = "uniwiseChatHistory_v6";   /* must match chat page */
const THEME_KEY      = "uniwiseTheme_v5";          /* FIXED: was v4, chat uses v5 */
const COLOR_KEY      = "uniwiseColorTheme_v1";
const FONT_KEY       = "uniwiseFontStyle_v1";
const SIZE_KEY       = "uniwiseFontSize_v1";
const BUBBLE_KEY     = "uniwiseBubbleTheme_v1";
const OPEN_CONV_KEY  = "uniwiseOpenConversationId";

/* =========================
   APPEARANCE
========================= */
function applySavedAppearance() {
  const theme  = localStorage.getItem(THEME_KEY)  || "light";
  const font   = localStorage.getItem(FONT_KEY)   || "inter";
  const size   = localStorage.getItem(SIZE_KEY)   || "medium";
  const bubble = localStorage.getItem(BUBBLE_KEY) || "default";

  /* Theme (night / light) */
  document.body.classList.remove("light", "night");
  document.body.classList.add(theme);

  /* Bubble / school theme — FIXED: includes bubble-solid-uniwise */
  document.body.classList.remove(
    "bubble-default",
    "bubble-solid-bluegold",
    "bubble-solid-greengold",
    "bubble-solid-uniwise"
  );
  if (bubble !== "default") {
    document.body.classList.add(`bubble-${bubble}`);
  }

  /* Font family */
  document.body.classList.remove("font-inter", "font-poppins", "font-roboto");
  document.body.classList.add(`font-${font}`);

  /* Font size */
  document.body.classList.remove("size-small", "size-medium", "size-large", "size-xl");
  document.body.classList.add(`size-${size}`);
}

/* =========================
   STORAGE
========================= */
function loadConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(conversations));
}

/* =========================
   HELPERS
========================= */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateLabel(ts) {
  const date      = new Date(ts || Date.now());
  const today     = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate();

  if (sameDay(date, today))     return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "long",
    day:   "numeric",
    year:  "numeric"
  });
}

function formatDateTime(ts, fallback = "") {
  if (!ts) return fallback || "";
  try {
    return new Date(ts).toLocaleString([], {
      month:   "short",
      day:     "numeric",
      year:    "numeric",
      hour:    "numeric",
      minute:  "2-digit"
    });
  } catch {
    return fallback || "";
  }
}

function formatMessagePreview(msg) {
  if (!msg) return "";

  if (msg.type === "bot_bundle") {
    const text = stripSuggestionLines(msg.text || "").trim();
    if (text) return text;
    if (Array.isArray(msg.buttons) && msg.buttons.length) {
      return msg.buttons.map((b) => b.title || "").filter(Boolean).join(", ");
    }
    return "Bot reply";
  }

  if (msg.type === "text")    return msg.text    || "";
  if (msg.type === "image")   return "[Image]";
  if (msg.type === "file")    return `[File] ${msg.fileName || ""}`;
  if (msg.type === "buttons") return msg.text    || "Options";

  return "";
}

function getConversationSearchBlob(conv) {
  const parts = [];
  parts.push(conv.title || "");

  (conv.messages || []).forEach((msg) => {
    if (msg.text)     parts.push(msg.text);
    if (msg.fileName) parts.push(msg.fileName);
    if (Array.isArray(msg.buttons)) {
      msg.buttons.forEach((btn) => {
        if (btn?.title)   parts.push(btn.title);
        if (btn?.payload) parts.push(btn.payload);
      });
    }
  });

  return normalizeText(parts.join(" "));
}

function splitTextAndSuggestions(text) {
  const raw = String(text || "").trim();
  if (!raw) return { mainText: "", suggestions: [] };

  const lines        = raw.split("\n");
  const cleanLines   = [];
  const suggestions  = [];
  let captureSuggestions = false;

  for (const originalLine of lines) {
    const line = originalLine.trim();

    const isSuggestHeader =
      /^you may also ask[:]?$/i.test(line)          ||
      /^you can also ask[:]?$/i.test(line)          ||
      /^you may also ask about[:]?$/i.test(line)    ||
      /^you may ask about[:]?$/i.test(line)         ||
      /^suggested follow[- ]?ups[:]?$/i.test(line)  ||
      /^follow[- ]?up questions[:]?$/i.test(line);

    if (isSuggestHeader) { captureSuggestions = true; continue; }

    if (captureSuggestions) {
      if (/^[-•]\s+/.test(line)) {
        const s = line.replace(/^[-•]\s+/, "").trim();
        if (s) suggestions.push(s);
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const s = line.replace(/^\d+\.\s+/, "").trim();
        if (s) suggestions.push(s);
        continue;
      }
    }

    cleanLines.push(originalLine);
  }

  return { mainText: cleanLines.join("\n").trim(), suggestions };
}

function stripSuggestionLines(text) {
  return splitTextAndSuggestions(text).mainText;
}

function getMessageTextForPreview(msg) {
  if (!msg) return "";
  if (msg.type === "bot_bundle") return stripSuggestionLines(msg.text || "").trim();
  if (msg.type === "text")       return String(msg.text || "").trim();
  if (msg.type === "file")       return `[File] ${msg.fileName || ""}`.trim();
  if (msg.type === "image")      return "[Image]";
  if (msg.type === "buttons")    return String(msg.text || "Options").trim();
  return "";
}

function truncate(text, length = 180) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, length)}…`;
}

/* =========================
   FAQ INSIGHTS SYNC
========================= */
function extractUserQuestionsFromConversations(convs) {
  const questions = [];

  for (const conv of convs || []) {
    if (!conv || !Array.isArray(conv.messages)) continue;

    for (const msg of conv.messages) {
      if (!msg || msg.role !== "user") continue;
      if (msg.type !== "text")         continue;

      const text = String(msg.text || "").trim();
      if (!text) continue;

      questions.push(text);
    }
  }

  return questions;
}

async function syncHistoryToFaqInsights() {
  try {
    const questions = extractUserQuestionsFromConversations(conversations);

    const res = await fetch("/api/sync-chat-history-to-faqs", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ questions })
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success) {
      console.error("FAQ history sync failed:", result.error || "Unknown error");
    }
  } catch (err) {
    console.error("FAQ history sync error:", err);
  }
}

/* =========================
   DOM ELEMENTS
========================= */
const historyBigList      = document.getElementById("historyBigList");
const historySearchInput  = document.getElementById("historySearchInput");
const clearAllHistoryBtn  = document.getElementById("clearAllHistoryBtn");
const historyCountMetric  = document.getElementById("historyCountMetric");

/* =========================
   STATE
========================= */
let conversations = loadConversations().map((conv) => ({
  ...conv,
  createdAtTs: conv.createdAtTs || Date.now()
}));

let activeConvId =
  localStorage.getItem(OPEN_CONV_KEY) || conversations[0]?.id || null;

/* =========================
   CONFIRM MODAL
========================= */
function showConfirmDialog({
  title       = "Delete chat?",
  message     = "This action cannot be undone.",
  confirmText = "Delete",
  cancelText  = "Cancel"
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="confirm-modal-icon"><i class="bi bi-trash3"></i></div>
        <div class="confirm-modal-title">${escapeHtml(title)}</div>
        <div class="confirm-modal-text">${escapeHtml(message)}</div>
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-btn cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="confirm-btn danger">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    overlay.querySelector(".cancel")?.addEventListener("click", () => cleanup(false));
    overlay.querySelector(".danger")?.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });

    const onKey = (e) => { if (e.key === "Escape") cleanup(false); };
    document.addEventListener("keydown", onKey);
  });
}

/* =========================
   CRUD
========================= */
function deleteConversation(convId) {
  const index = conversations.findIndex((c) => c.id === convId);
  if (index === -1) return;

  conversations.splice(index, 1);

  if (activeConvId === convId) {
    activeConvId = conversations[0]?.id || null;
    if (activeConvId) {
      localStorage.setItem(OPEN_CONV_KEY, activeConvId);
    } else {
      localStorage.removeItem(OPEN_CONV_KEY);
    }
  }

  saveConversations(conversations);
  renderHistoryPage();
}

async function clearAllHistory() {
  const ok = await showConfirmDialog({
    title:       "Clear all history?",
    message:     "This will permanently remove every saved conversation.",
    confirmText: "Clear All",
    cancelText:  "Cancel"
  });

  if (!ok) return;

  conversations = [];
  activeConvId  = null;
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(OPEN_CONV_KEY);
  renderHistoryPage();
}

/* =========================
   RENDER HELPERS
========================= */
function updateMetrics(filteredConversations) {
  if (historyCountMetric) {
    historyCountMetric.textContent = String(filteredConversations.length);
  }
}

function buildThreadPreview(conv) {
  const messages = Array.isArray(conv.messages) ? conv.messages : [];
  const previews = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg  = messages[i];
    const text = getMessageTextForPreview(msg);
    if (!text) continue;

    previews.unshift({
      role: msg.role === "user" ? "user" : "bot",
      text: truncate(text, 160)
    });

    if (previews.length >= 2) break;
  }

  if (!previews.length) {
    return `<div class="history-empty">No preview available.</div>`;
  }

  const html = previews
    .map((p) => `<div class="history-preview-msg ${p.role}">${escapeHtml(p.text)}</div>`)
    .join("");

  const moreCount = Math.max(0, messages.length - previews.length);

  return `
    <div class="history-thread-preview">
      ${html}
      ${moreCount > 0
        ? `<div class="history-more">+${moreCount} more message${moreCount === 1 ? "" : "s"}</div>`
        : ""}
    </div>
  `;
}

function createHistoryThreadCard(conv) {
  const card = document.createElement("div");
  card.className = "history-thread-card history-card-clickable";
  if (conv.id === activeConvId) card.classList.add("active-card");

  const title        = conv.title || "New chat";
  const createdLabel = formatDateTime(conv.createdAtTs, conv.createdAt || "");
  const messageCount = Array.isArray(conv.messages) ? conv.messages.length : 0;

  card.innerHTML = `
    <div class="history-thread-top">
      <div class="history-thread-info">
        <div class="history-thread-title">${escapeHtml(title)}</div>
        <div class="history-thread-meta">
          ${escapeHtml(createdLabel)}
          &nbsp;·&nbsp;
          ${messageCount} message${messageCount === 1 ? "" : "s"}
        </div>
      </div>
      <div class="history-thread-actions">
        <button class="history-open-btn" type="button">
          <i class="bi bi-box-arrow-up-right"></i>
          <span>Open</span>
        </button>
        <button class="history-delete-btn" type="button"
          title="Delete conversation" aria-label="Delete conversation">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    </div>
    ${buildThreadPreview(conv)}
  `;

  const openThread = () => {
    localStorage.setItem(OPEN_CONV_KEY, conv.id);
    window.location.href = "/";
  };

  /* Whole card click → open (unless clicking a button) */
  card.addEventListener("click", (e) => {
    if (e.target.closest(".history-delete-btn") || e.target.closest(".history-open-btn")) return;
    openThread();
  });

  card.querySelector(".history-open-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openThread();
  });

  card.querySelector(".history-delete-btn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await showConfirmDialog({
      title:       "Delete this chat?",
      message:     `This will remove "${title}" from your history.`,
      confirmText: "Delete",
      cancelText:  "Cancel"
    });
    if (ok) deleteConversation(conv.id);
  });

  return card;
}

function groupConversationsByDate(convs) {
  const groups = new Map();

  convs.forEach((conv) => {
    const label = formatDateLabel(conv.createdAtTs);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(conv);
  });

  return Array.from(groups.entries());
}

/* =========================
   MAIN RENDER
========================= */
function renderHistoryPage() {
  if (!historyBigList) return;

  const query = normalizeText(historySearchInput?.value || "");

  const filtered = conversations
    .slice()
    .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0))
    .filter((conv) => {
      if (!query) return true;
      return getConversationSearchBlob(conv).includes(query);
    });

  updateMetrics(filtered);

  if (!filtered.length) {
    historyBigList.innerHTML = `
      <div class="empty-box large-empty">
        <div class="empty-icon-wrap"><i class="bi bi-clock-history"></i></div>
        <strong>${query ? "No matching history found." : "No saved history yet."}</strong>
        <span>${query ? "Try a different search term." : "Start a conversation and it will appear here."}</span>
      </div>
    `;
    return;
  }

  const grouped = groupConversationsByDate(filtered);
  historyBigList.innerHTML = "";

  grouped.forEach(([label, items]) => {
    const group = document.createElement("section");
    group.className = "history-group";

    const title = document.createElement("div");
    title.className = "history-group-title";
    title.textContent = label;

    const list = document.createElement("div");
    list.className = "history-group-list";

    items.forEach((conv) => list.appendChild(createHistoryThreadCard(conv)));

    group.appendChild(title);
    group.appendChild(list);
    historyBigList.appendChild(group);
  });
}

/* =========================
   EVENTS
========================= */
historySearchInput?.addEventListener("input", renderHistoryPage);
clearAllHistoryBtn?.addEventListener("click", clearAllHistory);

window.addEventListener("storage", (event) => {
  /* Re-apply appearance when settings change in another tab */
  if ([THEME_KEY, FONT_KEY, SIZE_KEY, BUBBLE_KEY].includes(event.key)) {
    applySavedAppearance();
  }

  if (event.key === HISTORY_KEY) {
    conversations = loadConversations().map((conv) => ({
      ...conv,
      createdAtTs: conv.createdAtTs || Date.now()
    }));
    renderHistoryPage();
  }

  if (event.key === OPEN_CONV_KEY) {
    activeConvId = localStorage.getItem(OPEN_CONV_KEY) || null;
    renderHistoryPage();
  }
});

/* =========================
   INIT
========================= */
(async function init() {
  applySavedAppearance();
  renderHistoryPage();
  await syncHistoryToFaqInsights();
})();