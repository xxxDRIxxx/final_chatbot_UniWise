const HISTORY_KEY = "uniwiseChatHistory_v5";
const THEME_KEY = "uniwiseTheme_v4";
const COLOR_KEY = "uniwiseColorTheme_v1";
const FONT_KEY = "uniwiseFontStyle_v1";
const SIZE_KEY = "uniwiseFontSize_v1";
const BUBBLE_KEY = "uniwiseBubbleTheme_v1";
const OPEN_CONV_KEY = "uniwiseOpenConversationId";

const historyBigList = document.getElementById("historyBigList");
const clearAllHistoryBtn = document.getElementById("clearAllHistoryBtn");
const historySearchInput = document.getElementById("historySearchInput");

function applySavedAppearance() {
  const theme = localStorage.getItem(THEME_KEY) || "night";
  const color = localStorage.getItem(COLOR_KEY) || "bluegold";
  const font = localStorage.getItem(FONT_KEY) || "inter";
  const size = localStorage.getItem(SIZE_KEY) || "medium";
  const bubble = localStorage.getItem(BUBBLE_KEY) || "default";

  document.body.classList.remove("day", "night");
  document.body.classList.add(theme);

  document.body.classList.remove("theme-bluegold", "theme-greengold");
  document.body.classList.add(`theme-${color}`);

  document.body.classList.remove("font-inter", "font-poppins", "font-roboto");
  document.body.classList.add(`font-${font}`);

  document.body.classList.remove("size-small", "size-medium", "size-large");
  document.body.classList.add(`size-${size}`);

  document.body.classList.remove("bubble-default", "bubble-solid-bluegold", "bubble-solid-greengold");
  document.body.classList.add(`bubble-${bubble}`);
}

function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveConversations(convs) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(convs));
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showConfirmDialog({ title = "Delete chat?", message = "This action cannot be undone.", confirmText = "Delete", cancelText = "Cancel" }) {
  return new Promise(resolve => {
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

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector(".cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".danger").addEventListener("click", () => close(true));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
  });
}

function isToday(ts) {
  const now = new Date();
  const d = new Date(ts);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isYesterday(ts) {
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);

  const d = new Date(ts);
  return (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  );
}

function groupConversations(convs) {
  const groups = { today: [], yesterday: [], older: [] };

  convs.forEach(conv => {
    const ts = conv.createdAtTs || Date.now();
    if (isToday(ts)) groups.today.push(conv);
    else if (isYesterday(ts)) groups.yesterday.push(conv);
    else groups.older.push(conv);
  });

  return groups;
}

function getConversationPreviewMessages(messages, limit = 4) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-limit);
}

function getSearchableText(conv) {
  const title = conv.title || "";
  const created = conv.createdAt || "";
  const messages = Array.isArray(conv.messages) ? conv.messages : [];

  const mergedMessages = messages.map(msg => {
    if (msg.type === "text") return msg.text || "";
    if (msg.type === "image") return msg.fileName || "image";
    if (msg.type === "file") return msg.fileName || "file";
    if (msg.type === "buttons") return msg.text || "buttons";
    return msg.text || "";
  }).join(" ");

  return `${title} ${created} ${mergedMessages}`.toLowerCase();
}

function renderPreviewText(msg) {
  if (msg.type === "image") {
    return `<div class="history-preview-msg ${msg.role === "user" ? "user" : "bot"}">🖼️ ${escapeHtml(msg.fileName || "Image")}</div>`;
  }

  if (msg.type === "file") {
    return `<div class="history-preview-msg ${msg.role === "user" ? "user" : "bot"}">📎 ${escapeHtml(msg.fileName || "File")}</div>`;
  }

  const safeText =
    msg.type === "text"
      ? escapeHtml(msg.text || "")
      : msg.type === "buttons"
        ? escapeHtml(msg.text || "[Buttons]")
        : escapeHtml(msg.text || "");

  return `<div class="history-preview-msg ${msg.role === "user" ? "user" : "bot"}">${safeText}</div>`;
}

function openConversation(convId) {
  localStorage.setItem(OPEN_CONV_KEY, convId);
  window.location.href = "/";
}

function createHistoryThreadCard(conv, allConversations) {
  const totalMessages = conv.messages.length;
  const previewMessages = getConversationPreviewMessages(conv.messages, 4);

  const card = document.createElement("div");
  card.className = "history-thread-card history-card-clickable";

  const previewHtml = previewMessages.map(renderPreviewText).join("");
  const hiddenCount = Math.max(0, totalMessages - previewMessages.length);

  card.innerHTML = `
    <div class="history-thread-top">
      <div class="history-thread-info">
        <div class="history-thread-title">${escapeHtml(conv.title || "New chat")}</div>
        <div class="history-thread-meta">${escapeHtml(conv.createdAt || "")} • ${totalMessages} messages</div>
      </div>

      <div class="history-thread-actions">
        <button class="history-open-btn" type="button">Open</button>
        <button class="history-delete-btn" type="button" title="Delete conversation" aria-label="Delete conversation">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    </div>

    <div class="history-thread-preview history-gradient-link">
      ${previewHtml}
      ${hiddenCount > 0 ? `<div class="history-more">+ ${hiddenCount} earlier message${hiddenCount > 1 ? "s" : ""}</div>` : ""}
    </div>
  `;

  const openBtn = card.querySelector(".history-open-btn");
  const deleteBtn = card.querySelector(".history-delete-btn");
  const previewArea = card.querySelector(".history-gradient-link");

  card.addEventListener("click", (e) => {
    if (e.target.closest(".history-delete-btn")) return;
    if (e.target.closest(".history-open-btn")) return;
    openConversation(conv.id);
  });

  previewArea.addEventListener("click", (e) => {
    e.stopPropagation();
    openConversation(conv.id);
  });

  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openConversation(conv.id);
  });

  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();

    const ok = await showConfirmDialog({
      title: "Delete this chat?",
      message: `This will remove "${conv.title || "New chat"}" from your history.`,
      confirmText: "Delete",
      cancelText: "Cancel"
    });

    if (!ok) return;

    const updated = allConversations.filter(c => c.id !== conv.id);
    saveConversations(updated);
    renderHistoryBig();
  });

  return card;
}

function createHistoryGroup(title, items) {
  if (!items.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "history-group";

  const heading = document.createElement("div");
  heading.className = "history-group-title";
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = "history-group-list";

  items.forEach(item => list.appendChild(item));

  wrap.appendChild(heading);
  wrap.appendChild(list);

  return wrap;
}

function renderHistoryBig() {
  if (!historyBigList) return;

  historyBigList.innerHTML = "";

  const search = (historySearchInput?.value || "").trim().toLowerCase();

  let conversations = loadConversations()
    .slice()
    .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0));

  if (search) {
    conversations = conversations.filter(conv => getSearchableText(conv).includes(search));
  }

  const groups = groupConversations(conversations);

  const todayGroup = createHistoryGroup(
    "Today",
    groups.today.map(conv => createHistoryThreadCard(conv, conversations))
  );

  const yesterdayGroup = createHistoryGroup(
    "Yesterday",
    groups.yesterday.map(conv => createHistoryThreadCard(conv, conversations))
  );

  const olderGroup = createHistoryGroup(
    "Older",
    groups.older.map(conv => createHistoryThreadCard(conv, conversations))
  );

  [todayGroup, yesterdayGroup, olderGroup].forEach(group => {
    if (group) historyBigList.appendChild(group);
  });

  if (!historyBigList.children.length) {
    historyBigList.innerHTML = `<div class="history-empty">${search ? "No matching conversations found." : "No saved conversations yet."}</div>`;
  }
}

clearAllHistoryBtn?.addEventListener("click", async () => {
  const ok = await showConfirmDialog({
    title: "Clear all history?",
    message: "This will remove every saved conversation.",
    confirmText: "Clear All",
    cancelText: "Cancel"
  });

  if (!ok) return;

  localStorage.removeItem(HISTORY_KEY);
  renderHistoryBig();
});

historySearchInput?.addEventListener("input", () => {
  renderHistoryBig();
});

document.addEventListener("DOMContentLoaded", () => {
  applySavedAppearance();
  renderHistoryBig();
});