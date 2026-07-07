const HISTORY_KEY = "uniwiseChatHistory_v5";
const THEME_KEY = "uniwiseTheme_v4";
const COLOR_KEY = "uniwiseColorTheme_v1";
const FONT_KEY = "uniwiseFontStyle_v1";
const SIZE_KEY = "uniwiseFontSize_v1";
const BUBBLE_KEY = "uniwiseBubbleTheme_v1";
const OPEN_CONV_KEY = "uniwiseOpenConversationId";
const HISTORY_TAB_VISIBLE_KEY = "uniwiseHistoryTabVisible_v1";
const PRIVACY_SESSION_KEY = "uniwisePrivacyAccepted";
const RASA_URL = "http://localhost:5005/webhooks/rest/webhook";

/* =========================
   PRIVACY CONSENT HELPERS
========================= */
function getNavigationType() {
  const navEntries = performance.getEntriesByType("navigation");
  if (navEntries && navEntries.length > 0) {
    return navEntries[0].type;
  }

  if (performance.navigation) {
    switch (performance.navigation.type) {
      case 1:
        return "reload";
      case 2:
        return "back_forward";
      default:
        return "navigate";
    }
  }

  return "navigate";
}

async function revokeConsentAndRedirect() {
  sessionStorage.removeItem(PRIVACY_SESSION_KEY);

  try {
    await fetch("/revoke-consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Failed to revoke consent:", error);
  }

  window.location.replace("/privacy-consent");
}

function handlePrivacyConsentForChatPage() {
  const navType = getNavigationType();

  if (navType === "reload") {
    revokeConsentAndRedirect();
    return true;
  }

  return false;
}

/* =========================
   APPEARANCE
========================= */
function applySavedAppearance() {
  const theme = localStorage.getItem(THEME_KEY) || "night";
  const color = localStorage.getItem(COLOR_KEY) || "bluegold";
  const font = localStorage.getItem(FONT_KEY) || "inter";
  const size = localStorage.getItem(SIZE_KEY) || "medium";
  const bubble = localStorage.getItem(BUBBLE_KEY) || "default";

  document.body.classList.remove("day", "night");
  document.body.classList.add(theme);

  document.body.classList.remove("theme-bluegold", "theme-greengold", "theme-whiteblack");
  document.body.classList.add(`theme-${color}`);

  document.body.classList.remove(
    "font-inter",
    "font-poppins",
    "font-roboto",
    "font-jetbrains",
    "font-fira",
    "font-specialelite",
    "font-courierprime"
  );
  document.body.classList.add(`font-${font}`);

  document.body.classList.remove("size-small", "size-medium", "size-large");
  document.body.classList.add(`size-${size}`);

  document.body.classList.remove("bubble-default", "bubble-solid-bluegold", "bubble-solid-greengold");
  document.body.classList.add(`bubble-${bubble}`);
}

/* =========================
   ELEMENTS
========================= */
const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const uploadBtn = document.getElementById("uploadBtn");
const imageBtn = document.getElementById("imageBtn");
const fileInput = document.getElementById("fileInput");
const imageInput = document.getElementById("imageInput");
const composerHint = document.getElementById("composerHint");

const drawer = document.getElementById("drawer");
const drawerToggle = document.getElementById("drawerToggle");
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");
const appMain = document.querySelector(".app-main");

/* =========================
   STORAGE HELPERS
========================= */
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

function nowLabel() {
  return new Date().toLocaleString();
}

let conversations = loadConversations();
let activeConvId = conversations[0]?.id || null;

if (!activeConvId) {
  const id = crypto.randomUUID();
  conversations.unshift({
    id,
    title: "New chat",
    createdAt: nowLabel(),
    createdAtTs: Date.now(),
    messages: [
      {
        role: "bot",
        type: "bot_bundle",
        text: "Hello! 👋 I’m UniWise, your AI school assistant. How may I help you today?",
        buttons: []
      }
    ]
  });
  activeConvId = id;
  saveConversations(conversations);
}

conversations = conversations.map((conv) => ({
  ...conv,
  createdAtTs: conv.createdAtTs || Date.now()
}));
saveConversations(conversations);

/* =========================
   BASIC HELPERS
========================= */
function getActiveConv() {
  return conversations.find((c) => c.id === activeConvId);
}

function setActiveConv(id) {
  activeConvId = id;
  localStorage.setItem(OPEN_CONV_KEY, id);
  renderHistory();
  renderChat();
}

function makeTitleFromText(text) {
  const s = (text || "").trim().replace(/\s+/g, " ");
  return s.length > 28 ? `${s.slice(0, 28)}…` : (s || "New chat");
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes = 0) {
  if (!bytes) return "";
  const sizes = ["B", "KB", "MB", "GB"];
  let i = 0;
  let num = bytes;

  while (num >= 1024 && i < sizes.length - 1) {
    num /= 1024;
    i++;
  }

  return `${num.toFixed(num >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    if (chatArea) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  });
}

function normalizeCompareText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   CONFIRM MODAL
========================= */
function showConfirmDialog({
  title = "Delete chat?",
  message = "This action cannot be undone.",
  confirmText = "Delete",
  cancelText = "Cancel"
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

    overlay.querySelector(".cancel").addEventListener("click", () => cleanup(false));
    overlay.querySelector(".danger").addEventListener("click", () => cleanup(true));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });

    const onKey = (e) => {
      if (e.key === "Escape") cleanup(false);
    };

    document.addEventListener("keydown", onKey);
  });
}

/* =========================
   HISTORY TAB
========================= */
function applyHistoryTabVisibility(isVisible) {
  if (!drawer || !appMain || !drawerToggle) return;

  if (isVisible) {
    drawer.classList.remove("history-hidden");
    appMain.classList.remove("history-tab-hidden");
    drawerToggle.checked = true;
  } else {
    drawer.classList.add("history-hidden");
    appMain.classList.add("history-tab-hidden");
    drawerToggle.checked = false;
  }
}

function loadHistoryTabVisibility() {
  const saved = localStorage.getItem(HISTORY_TAB_VISIBLE_KEY);
  const isVisible = saved !== "false";
  applyHistoryTabVisibility(isVisible);
}

function saveHistoryTabVisibility(isVisible) {
  localStorage.setItem(HISTORY_TAB_VISIBLE_KEY, String(isVisible));
}

drawerToggle?.addEventListener("change", () => {
  const isVisible = drawerToggle.checked;
  applyHistoryTabVisibility(isVisible);
  saveHistoryTabVisibility(isVisible);
});

/* =========================
   CONVERSATION CRUD
========================= */
newChatBtn?.addEventListener("click", () => {
  const id = crypto.randomUUID();

  conversations.unshift({
    id,
    title: "New chat",
    createdAt: nowLabel(),
    createdAtTs: Date.now(),
    messages: [
      {
        role: "bot",
        type: "bot_bundle",
        text: "Hello! 👋 I’m UniWise, your school assistant. How may I help you today?",
        buttons: []
      }
    ]
  });

  saveConversations(conversations);
  setActiveConv(id);
});

function deleteConversation(convId) {
  const index = conversations.findIndex((c) => c.id === convId);
  if (index === -1) return;

  conversations.splice(index, 1);

  if (!conversations.length) {
    const id = crypto.randomUUID();
    conversations.unshift({
      id,
      title: "New chat",
      createdAt: nowLabel(),
      createdAtTs: Date.now(),
      messages: [
        {
          role: "bot",
          type: "bot_bundle",
          text: "Hello! 👋 I’m UniWise, your school assistant. How may I help you today?",
          buttons: []
        }
      ]
    });
    activeConvId = id;
  } else if (activeConvId === convId) {
    activeConvId = conversations[0].id;
  }

  localStorage.setItem(OPEN_CONV_KEY, activeConvId);
  saveConversations(conversations);
  renderHistory();
  renderChat();
}

/* =========================
   HISTORY RENDER
========================= */
function getLastMessagePreview(conv) {
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return "";

  if (last.type === "bot_bundle") {
    const text = stripSuggestionLines(last.text || "");
    if (text) return text;
    if (Array.isArray(last.buttons) && last.buttons.length) {
      return last.buttons.map((b) => b.title).join(", ");
    }
    return "Bot reply";
  }

  if (last.type === "text") return last.text || "";
  if (last.type === "image") return "[Image]";
  if (last.type === "file") return `[File] ${last.fileName || ""}`;
  if (last.type === "buttons") return last.text || "Options";

  return "";
}

function createHistoryItem(conv) {
  const item = document.createElement("div");
  item.className = "history-item";
  if (conv.id === activeConvId) {
    item.classList.add("active");
  }

  item.innerHTML = `
    <div class="history-main">
      <div class="h-title">${escapeHtml(conv.title || "New chat")}</div>
      <div class="h-sub">${escapeHtml(getLastMessagePreview(conv))}</div>
    </div>
    <div class="history-actions">
      <button class="history-delete-btn" type="button" title="Delete conversation" aria-label="Delete conversation">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
  `;

  item.addEventListener("click", () => {
    setActiveConv(conv.id);
  });

  const deleteBtn = item.querySelector(".history-delete-btn");
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await showConfirmDialog({
      title: "Delete this chat?",
      message: `This will remove "${conv.title || "New chat"}" from your history.`,
      confirmText: "Delete",
      cancelText: "Cancel"
    });
    if (ok) deleteConversation(conv.id);
  });

  return item;
}

function renderHistory() {
  if (!historyList) return;

  historyList.innerHTML = "";

  conversations
    .slice()
    .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0))
    .slice(0, 30)
    .forEach((conv) => {
      historyList.appendChild(createHistoryItem(conv));
    });
}

/* =========================
   BOT TEXT CLEANER
========================= */
function cleanBotReplyText(text, sourceQuestion = "") {
  let raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";

  const { mainText, suggestions } = splitTextAndSuggestions(raw);
  let cleaned = mainText.trim();

  if (!cleaned) {
    return rebuildTextWithSuggestions("", suggestions);
  }

  const questionNorm = normalizeCompareText(sourceQuestion);
  let lines = cleaned.split("\n");

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  if (lines.length) {
    let firstLine = lines[0].trim();
    let firstNorm = normalizeCompareText(firstLine);

    if (questionNorm && firstNorm === questionNorm) {
      lines.shift();
    } else if (
      questionNorm &&
      firstNorm &&
      (
        firstNorm.includes(questionNorm) ||
        questionNorm.includes(firstNorm)
      ) &&
      firstLine.length <= 90
    ) {
      lines.shift();
    }
  }

  if (lines.length) {
    let firstLine = lines[0].trim();

    const headingLike =
      /^[#*_`-\s]*[A-Za-z0-9][A-Za-z0-9\s/&(),.-]{1,60}:?\s*$/.test(firstLine) &&
      firstLine.length <= 60 &&
      lines.length > 1;

    const genericHeaderLike =
      /^(sure|certainly|of course|regarding|about|for|here(?:'s| is)|below is|the following are)\b/i.test(firstLine);

    if (headingLike || genericHeaderLike) {
      const normalizedFirst = normalizeCompareText(firstLine.replace(/:$/, ""));
      if (
        !normalizedFirst ||
        (questionNorm && (
          normalizedFirst === questionNorm ||
          normalizedFirst.includes(questionNorm) ||
          questionNorm.includes(normalizedFirst)
        )) ||
        headingLike
      ) {
        lines.shift();
      }
    }
  }

  cleaned = lines.join("\n").trim();

  cleaned = cleaned.replace(/^(sure|certainly|of course)[!,.:\s-]*/i, "");
  cleaned = cleaned.replace(/^(here(?:'s| is)\s+(?:the\s+)?(?:answer|information|details)[!,.:\s-]*)/i, "");
  cleaned = cleaned.replace(/^(please note that\s+)/i, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return rebuildTextWithSuggestions(cleaned, suggestions);
}

function rebuildTextWithSuggestions(mainText, suggestions) {
  const text = String(mainText || "").trim();
  const items = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];

  if (!items.length) return text;

  const suggestionBlock = [
    "You can also ask:",
    ...items.map((s) => `- ${s}`)
  ].join("\n");

  return text ? `${text}\n\n${suggestionBlock}` : suggestionBlock;
}

/* =========================
   BOT TEXT FORMATTERS
========================= */
function splitTextAndSuggestions(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { mainText: "", suggestions: [] };
  }

  const lines = raw.split("\n");
  const cleanLines = [];
  const suggestions = [];

  let captureSuggestions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const isSuggestHeader =
      /^you may also ask[:]?$/i.test(line) ||
      /^you can also ask[:]?$/i.test(line) ||
      /^you may also ask about[:]?$/i.test(line) ||
      /^you may ask about[:]?$/i.test(line) ||
      /^suggested follow[- ]?ups[:]?$/i.test(line) ||
      /^follow[- ]?up questions[:]?$/i.test(line);

    if (isSuggestHeader) {
      captureSuggestions = true;
      continue;
    }

    if (captureSuggestions) {
      if (/^[-•]\s+/.test(line)) {
        const suggestion = line.replace(/^[-•]\s+/, "").trim();
        if (suggestion) suggestions.push(suggestion);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const suggestion = line.replace(/^\d+\.\s+/, "").trim();
        if (suggestion) suggestions.push(suggestion);
        continue;
      }

      cleanLines.push(lines[i]);
    } else {
      cleanLines.push(lines[i]);
    }
  }

  const mainText = cleanLines.join("\n").trim();
  return { mainText, suggestions };
}

function stripSuggestionLines(text) {
  return splitTextAndSuggestions(text).mainText;
}

function formatInlineMarkdown(text) {
  let html = escapeHtml(text);

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<u>$1</u>");
  html = html.replace(/(^|[\s(])\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])_(?!_)([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  // NEW: Convert chatbot attachment links into clickable buttons
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: var(--accent); text-decoration: underline; font-weight: 700;">$1 <i class="bi bi-box-arrow-up-right" style="font-size: 10px;"></i></a>');

  return html;
}

function formatParagraphLine(line) {
  let html = formatInlineMarkdown(line);

  html = html.replace(
    /^([A-Za-z][A-Za-z0-9\s/&()\-]{1,40}):\s+/,
    "<strong>$1:</strong> "
  );

  return html;
}

function renderTextToHtml(text) {
  const source = String(text || "").trim();
  if (!source) return "";

  const normalized = source.replace(/<br\s*\/?>/gi, "\n");
  const blocks = normalized.split(/\n\s*\n/);
  const htmlBlocks = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const isBulletList = lines.every((line) => /^[-•]\s+/.test(line));
    const isNumberList = lines.every((line) => /^\d+\)\s+/.test(line) || /^\d+\.\s+/.test(line));

    if (isBulletList) {
      htmlBlocks.push(
        `<ul>${lines
          .map((line) => `<li>${formatParagraphLine(line.replace(/^[-•]\s+/, ""))}</li>`)
          .join("")}</ul>`
      );
      continue;
    }

    if (isNumberList) {
      htmlBlocks.push(
        `<ol>${lines
          .map((line) => `<li>${formatParagraphLine(line.replace(/^\d+[\.\)]\s+/, ""))}</li>`)
          .join("")}</ol>`
      );
      continue;
    }

    const paragraphHtml = lines.map((line) => formatParagraphLine(line)).join("<br>");
    htmlBlocks.push(`<p>${paragraphHtml}</p>`);
  }

  return htmlBlocks.join("");
}

function dedupeSuggestionItems(items) {
  const seen = new Set();
  const clean = [];

  for (const item of items || []) {
    if (!item) continue;

    const title = String(item.title || item.text || item.value || "").trim();
    const payload = String(item.payload || title).trim();
    const key = `${title}|||${payload}`;

    if (!title || seen.has(key)) continue;
    seen.add(key);
    clean.push({ title, payload });
  }

  return clean;
}

function createSuggestionChips(items) {
  const normalizedItems = dedupeSuggestionItems(items);
  if (!normalizedItems.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "suggestion-chip-wrap";

  normalizedItems.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "chip-btn";
    btn.type = "button";
    btn.textContent = item.title;

    btn.addEventListener("click", () => {
      sendMessage(item.payload, item.title);
    });

    wrap.appendChild(btn);
  });

  return wrap;
}

/* =========================
   MESSAGE BUILDERS
========================= */
function buildBotBundle(msg) {
  const row = document.createElement("div");
  row.className = "msg-row bot";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.innerHTML = `<i class="bi bi-robot"></i>`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const content = document.createElement("div");
  content.className = "bot-text-content";

  const cleanedText = cleanBotReplyText(msg.text || "", msg.sourceQuestion || "");
  const { mainText, suggestions } = splitTextAndSuggestions(cleanedText);

  if (mainText) {
    content.innerHTML = renderTextToHtml(mainText);
    bubble.appendChild(content);
  }

  const textSuggestionItems = (suggestions || []).map((s) => ({
    title: s,
    payload: s
  }));

  const buttonSuggestionItems = Array.isArray(msg.buttons)
    ? msg.buttons.map((b) => ({
        title: String(b.title || "").trim(),
        payload: String(b.payload || b.title || "").trim()
      }))
    : [];

  const finalSuggestionItems = dedupeSuggestionItems([
    ...textSuggestionItems,
    ...buttonSuggestionItems
  ]);

  if (finalSuggestionItems.length) {
    const label = document.createElement("div");
    label.className = "suggestion-label";
    label.textContent = "You can also ask:";
    bubble.appendChild(label);

    const chips = createSuggestionChips(finalSuggestionItems);
    if (chips) bubble.appendChild(chips);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  return row;
}

function buildRegularMessage(msg) {
  const row = document.createElement("div");
  row.className = `msg-row ${msg.role === "user" ? "user" : "bot"}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.innerHTML = msg.role === "user"
    ? `<i class="bi bi-person-fill"></i>`
    : `<i class="bi bi-robot"></i>`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (msg.type === "image" && msg.url) {
    const inner = document.createElement("div");
    inner.className = msg.role === "user" ? "user-text-content" : "bot-text-content";

    const img = document.createElement("img");
    img.src = msg.url; // This will now display the image directly
    img.alt = msg.fileName || "image";
    img.className = "chat-image";
    
    // Add click-to-enlarge functionality
    img.style.cursor = "pointer";
    img.onclick = () => window.open(img.src, "_blank");
    
    inner.appendChild(img);
    bubble.appendChild(inner);
  } else if (msg.type === "file") {
    const inner = document.createElement("div");
    inner.className = msg.role === "user" ? "user-text-content" : "bot-text-content";
    inner.innerHTML = `
      <div class="file-chip">
        <i class="bi bi-file-earmark"></i>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(msg.fileName || "Attached file")}</div>
          <div class="file-size">${escapeHtml(msg.fileSizeLabel || "")}</div>
        </div>
      </div>
    `;
    bubble.appendChild(inner);
  } else if (msg.type === "buttons" && Array.isArray(msg.buttons)) {
    const text = document.createElement("div");
    text.className = "bot-text-content";
    text.innerHTML = renderTextToHtml(cleanBotReplyText(msg.text || "", msg.sourceQuestion || ""));
    bubble.appendChild(text);

    const label = document.createElement("div");
    label.className = "suggestion-label";
    label.textContent = "You can also ask:";
    bubble.appendChild(label);

    const chipWrap = createSuggestionChips(msg.buttons);
    if (chipWrap) bubble.appendChild(chipWrap);
  } else {
    if (msg.role === "bot") {
      const cleanedBotText = cleanBotReplyText(msg.text || "", msg.sourceQuestion || "");
      bubble.innerHTML = `<div class="bot-text-content">${renderTextToHtml(cleanedBotText)}</div>`;
    } else {
      bubble.innerHTML = `<div class="user-text-content">${escapeHtml(msg.text || "")}</div>`;
    }
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  return row;
}

function buildMessage(msg) {
  if (msg.type === "bot_bundle") {
    return buildBotBundle(msg);
  }
  return buildRegularMessage(msg);
}

function renderChat() {
  const conv = getActiveConv();
  if (!conv || !chatArea) return;

  chatArea.innerHTML = "";
  conv.messages.forEach((m) => chatArea.appendChild(buildMessage(m)));
  scrollChatToBottom();
}

/* =========================
   FILE ATTACHMENTS
========================= */
function attachFileMessage(file, type = "file") {
  const conv = getActiveConv();
  if (!conv || !file) return;

  const msg = {
    role: "user",
    type,
    fileName: file.name,
    fileSizeLabel: formatBytes(file.size)
  };

  if (type === "image") {
    msg.url = URL.createObjectURL(file);
  }

  conv.messages.push(msg);

  if (!conv.title || conv.title === "New chat") {
    conv.title = makeTitleFromText(file.name);
  }

  saveConversations(conversations);
  renderHistory();
  renderChat();

  if (composerHint) {
    composerHint.textContent = type === "image"
      ? `🖼️ Image added: ${file.name}`
      : `📎 File attached: ${file.name}`;
  }
}

/* =========================
   RASA API
========================= */
/* =========================
   AI BACKEND API (Replaced Rasa)
========================= */
async function sendToAI(sender, message) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: message }) // Matches what app.py expects
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Flask HTTP ${res.status} ${t}`);
  }

  const data = await res.json();

  // We wrap the Flask reply in an array so your existing normalizeRasaReplies function still works perfectly!
  if (data.success) {
      return [{ text: data.reply }];
  } else {
      return [{ text: "I encountered an error: " + data.error }];
  }
}

function dedupeButtons(buttons) {
  const seen = new Set();
  const clean = [];

  for (const btn of buttons || []) {
    const title = String(btn?.title || "").trim();
    const payload = String(btn?.payload || "").trim();
    const key = `${title}|||${payload}`;

    if (!title || seen.has(key)) continue;
    seen.add(key);
    clean.push({
      title,
      payload: payload || title
    });
  }

  return clean;
}

function normalizeRasaReplies(replies, sourceQuestion = "") {
  const out = [];
  if (!Array.isArray(replies)) return out;

  let combinedTextParts = [];
  let combinedButtons = [];

  for (const r of replies) {
    if (r.text) {
      combinedTextParts.push(r.text);
    }

    if (Array.isArray(r.buttons) && r.buttons.length) {
      combinedButtons.push(...r.buttons);
    }

    if (r.image) {
      if (combinedTextParts.length || combinedButtons.length) {
        out.push({
          role: "bot",
          type: "bot_bundle",
          text: cleanBotReplyText(combinedTextParts.join("\n\n").trim(), sourceQuestion),
          buttons: dedupeButtons(combinedButtons),
          sourceQuestion
        });
        combinedTextParts = [];
        combinedButtons = [];
      }

      out.push({
        role: "bot",
        type: "image",
        url: r.image,
        fileName: "Bot image",
        sourceQuestion
      });
    }
  }

  if (combinedTextParts.length || combinedButtons.length) {
    out.push({
      role: "bot",
      type: "bot_bundle",
      text: cleanBotReplyText(combinedTextParts.join("\n\n").trim() || "…", sourceQuestion),
      buttons: dedupeButtons(combinedButtons),
      sourceQuestion
    });
  }

  if (!out.length && replies.length) {
    out.push({
      role: "bot",
      type: "bot_bundle",
      text: "…",
      buttons: [],
      sourceQuestion
    });
  }

  return out;
}

/* =========================
   OPTIONAL LOCAL DICTIONARY
========================= */
async function tryDictionaryReply(text) {
  const lowerText = text.toLowerCase().trim();
  let word = "";

  if (lowerText.startsWith("define ")) {
    word = lowerText.replace("define ", "").trim();
  } else if (lowerText.startsWith("meaning of ")) {
    word = lowerText.replace("meaning of ", "").trim();
  } else if (lowerText.startsWith("what is ")) {
    word = lowerText.replace("what is ", "").trim();
  }

  if (!word) return null;

  try {
    const dictRes = await fetch("/api/dictionary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ word })
    });

    const dictResult = await dictRes.json();

    if (dictResult.found) {
      return {
        role: "bot",
        type: "bot_bundle",
        text: `**${word}**\n\n${dictResult.definition}`,
        buttons: [],
        sourceQuestion: text
      };
    }
  } catch (err) {
    console.error("Dictionary lookup failed:", err);
  }

  return null;
}

/* =========================
   PREMIUM AI LOADER
========================= */
function createAiLoader() {
  const row = document.createElement("div");
  row.className = "msg-row bot typing-row";

  row.innerHTML = `
    <div class="avatar"><i class="bi bi-robot"></i></div>
    <div class="bubble loader-bubble">
      <div class="ai-loader" aria-label="UniWise is thinking">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;

  return row;
}

/* =========================
   SEND MESSAGE
========================= */
async function sendMessage(messageOverride = null, displayOverride = null) {
  const actualText = String(messageOverride ?? userInput?.value ?? "").trim();
  if (!actualText) return;

  const visibleText = String(displayOverride ?? actualText).trim();
  const conv = getActiveConv();
  if (!conv) return;

  conv.messages.push({ role: "user", type: "text", text: visibleText });

  fetch("/api/log-question", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question: visibleText })
  }).catch((err) => console.error("Question log failed:", err));

  if (!conv.title || conv.title === "New chat") {
    conv.title = makeTitleFromText(visibleText);
  }

  saveConversations(conversations);

  if (userInput) userInput.value = "";
  if (composerHint) composerHint.textContent = "";

  renderHistory();
  renderChat();

  const dictReply = await tryDictionaryReply(actualText);
  if (dictReply) {
    conv.messages.push(dictReply);
    saveConversations(conversations);
    renderHistory();
    renderChat();
    return;
  }

  let loaderRow = createAiLoader();
  chatArea.appendChild(loaderRow);
  scrollChatToBottom();

  try {
    // Send to your backend
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: conv.id,
        message: actualText
      })
    });

    const data = await res.json();

    if (loaderRow) {
      loaderRow.remove();
      loaderRow = null;
    }

    if (data.success) {

      // Add bot text reply
      if (data.reply) {
        conv.messages.push({
          role: "bot",
          type: "text",
          text: data.reply
        });
      }

      // Add image reply if present
      if (data.image_url) {
        conv.messages.push({
          role: "bot",
          type: "image",
          url: data.image_url,
          fileName: "Announcement Image"
        });
      }

      // Optional: Handle buttons if your backend returns them
      if (Array.isArray(data.buttons) && data.buttons.length) {
        conv.messages.push({
          role: "bot",
          type: "bot_bundle",
          text: "",
          buttons: data.buttons,
          sourceQuestion: actualText
        });
      }

    } else {
      conv.messages.push({
        role: "bot",
        type: "text",
        text: data.reply || "No reply received."
      });
    }

  } catch (err) {
    if (loaderRow) {
      loaderRow.remove();
      loaderRow = null;
    }

    conv.messages.push({
      role: "bot",
      type: "bot_bundle",
      text: "⚠️ Can't reach the server.",
      buttons: [],
      sourceQuestion: actualText
    });

    console.error(err);
  }

  saveConversations(conversations);
  renderHistory();
  renderChat();
}

/* =========================
   EVENTS
========================= */
uploadBtn?.addEventListener("click", () => {
  fileInput?.click();
});

imageBtn?.addEventListener("click", () => {
  imageInput?.click();
});

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) attachFileMessage(file, "file");
  e.target.value = "";
});

imageInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) attachFileMessage(file, "image");
  e.target.value = "";
});

sendBtn?.addEventListener("click", () => sendMessage());

userInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll(".faq-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const question = btn.dataset.question || btn.textContent || "";
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    sendMessage(cleanQuestion, cleanQuestion);
  });
});

/* =========================
   INIT
========================= */
(function init() {
  if (handlePrivacyConsentForChatPage()) {
    return;
  }

  applySavedAppearance();

  const openConversationId = localStorage.getItem(OPEN_CONV_KEY);
  if (openConversationId && conversations.some((c) => c.id === openConversationId)) {
    activeConvId = openConversationId;
  }

  loadHistoryTabVisibility();
  renderHistory();
  renderChat();

  window.addEventListener("storage", (event) => {
    if ([THEME_KEY, COLOR_KEY, FONT_KEY, SIZE_KEY, BUBBLE_KEY].includes(event.key)) {
      applySavedAppearance();
    }
  });
})();