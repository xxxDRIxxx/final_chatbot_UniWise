const HISTORY_KEY = "uniwiseChatHistory_v7";
const THEME_KEY = "uniwiseTheme_v5";
const FONT_KEY = "uniwiseFontStyle_v1";
const SIZE_KEY = "uniwiseFontSize_v1";
const BUBBLE_KEY = "uniwiseBubbleTheme_v1";
const OPEN_CONV_KEY = "uniwiseOpenConversationId";
const HISTORY_TAB_VISIBLE_KEY = "uniwiseHistoryTabVisible_v1";
const PRIVACY_SESSION_KEY = "uniwisePrivacyAccepted";
const FAQ_SYNC_KEY = "uniwiseFaqSync_v2";
const PENDING_JOB_KEY = "uniwisePendingChatJob_v1"; // survives navigating to other pages and back
// Chat now goes through /api/chat/start + /api/chat/status/<id> (see startChatJob/pollChatJob below)
// so a reply keeps generating server-side even if the user navigates to another page.

function getNavigationType() {
  const navEntries = performance.getEntriesByType("navigation");
  if (navEntries && navEntries.length > 0) return navEntries[0].type;

  if (performance.navigation) {
    switch (performance.navigation.type) {
      case 1: return "reload";
      case 2: return "back_forward";
      default: return "navigate";
    }
  }

  return "navigate";
}

async function revokeConsentAndRedirect() {
  sessionStorage.removeItem(PRIVACY_SESSION_KEY);

  try {
    await fetch("/revoke-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
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

function applySavedAppearance() {
  const theme = localStorage.getItem(THEME_KEY) || "light";
  const font = localStorage.getItem(FONT_KEY) || "inter";
  const size = localStorage.getItem(SIZE_KEY) || "medium";
  const bubble = localStorage.getItem(BUBBLE_KEY) || "default";

  document.body.classList.remove("light", "night", "bubble-default", "bubble-solid-bluegold", "bubble-solid-greengold", "bubble-solid-uniwise");
  document.body.classList.add(theme);

  if (bubble !== "default") {
    document.body.classList.add(`bubble-${bubble}`);
  }

  document.body.classList.remove("font-inter", "font-poppins", "font-roboto");
  document.body.classList.add(`font-${font}`);

  document.body.classList.remove("size-small", "size-medium", "size-large", "size-xl");
  document.body.classList.add(`size-${size}`);
}

function watchAppearanceKeys(event) {
  const watchedKeys = [THEME_KEY, FONT_KEY, SIZE_KEY, BUBBLE_KEY];
  if (watchedKeys.includes(event.key)) applySavedAppearance();
}

const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const attachBtn = document.getElementById("attachBtn");
const attachMenu = document.getElementById("attachMenu");
const attachFileBtn = document.getElementById("attachFileBtn");
const attachImageBtn = document.getElementById("attachImageBtn");
const fileInput = document.getElementById("fileInput");
const imageInput = document.getElementById("imageInput");
const composerHint = document.getElementById("composerHint");

const drawer = document.getElementById("drawer");
const drawerToggle = document.getElementById("drawerToggle");
const drawerToggleCollapsed = document.getElementById("drawerToggleCollapsed");
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");
const appMain = document.querySelector(".app-main");
const historySearchInput = document.getElementById("historySearchInput");

let isGenerating = false;
let stopGenerationRequested = false;
let lastSubmittedUserText = "";
let lastSubmittedVisibleText = "";
let autoScrollLocked = false;
let currentAbortController = null;

function loadConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
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

function safeUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `conv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getDefaultWelcomeMessage() {
  return {
    role: "bot",
    type: "bot_bundle",
    text: "Hello! 👋 I'm UniWise, your AI school assistant. How may I help you today?",
    buttons: []
  };
}

let conversations = loadConversations();
let activeConvId = conversations[0]?.id || null;

if (!activeConvId) {
  const id = safeUuid();
  conversations.unshift({
    id,
    title: "New chat",
    createdAt: nowLabel(),
    createdAtTs: Date.now(),
    messages: [getDefaultWelcomeMessage()]
  });
  activeConvId = id;
  saveConversations(conversations);
}

conversations = conversations.map((conv) => ({
  ...conv,
  createdAtTs: conv.createdAtTs || Date.now(),
  messages: Array.isArray(conv.messages) && conv.messages.length ? conv.messages : [getDefaultWelcomeMessage()]
}));

saveConversations(conversations);

function getActiveConv() {
  return conversations.find((c) => c.id === activeConvId);
}

function getActiveConversationId() {
  return activeConvId;
}

function setActiveConv(id) {
  activeConvId = id;
  localStorage.setItem(OPEN_CONV_KEY, id);
  autoScrollLocked = false;
  renderHistory();
  renderChat();
}

function makeTitleFromText(text) {
  const s = String(text || "").trim().replace(/\s+/g, " ");
  return s.length > 28 ? `${s.slice(0, 28)}…` : (s || "New chat");
}

function escapeHtml(str) {
  return String(str || "")
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

function isNearBottom(threshold = 120) {
  if (!chatArea) return true;
  const remaining = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
  return remaining <= threshold;
}

function scrollChatToBottom(force = false) {
  requestAnimationFrame(() => {
    if (!chatArea) return;
    if (force || !autoScrollLocked) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  });
}

function smoothScrollChatToBottom(force = false) {
  requestAnimationFrame(() => {
    if (!chatArea) return;
    if (force || !autoScrollLocked) {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: "smooth"
      });
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

function setGeneratingState(active) {
  isGenerating = active;
  document.body.classList.toggle("is-generating", active);

  if (sendBtn) {
    sendBtn.disabled = false;
    const sendIcon = sendBtn.querySelector(".send-icon");
    const stopIcon = sendBtn.querySelector(".stop-icon");
    if (sendIcon) sendIcon.hidden = active;
    if (stopIcon) stopIcon.hidden = !active;
    sendBtn.setAttribute("aria-label", active ? "Stop generating" : "Send message");
  }
}

function autoResizeComposer() {
  if (!userInput) return;
  userInput.style.height = "auto";
  userInput.style.height = `${Math.min(userInput.scrollHeight, 180)}px`;
}

function setHint(text = "") {
  if (composerHint) composerHint.textContent = text;
}

function extractUserQuestionsFromConversations(convs) {
  const questions = [];

  for (const conv of convs || []) {
    if (!conv || !Array.isArray(conv.messages)) continue;

    for (const msg of conv.messages) {
      if (!msg || msg.role !== "user") continue;
      if (msg.type !== "text") continue;

      const text = String(msg.text || "").trim();
      if (!text) continue;

      questions.push(text);
    }
  }

  return questions;
}

async function syncSavedChatsToFaqInsights() {
  try {
    const questions = extractUserQuestionsFromConversations(conversations);
    const signature = JSON.stringify(questions);

    if (localStorage.getItem(FAQ_SYNC_KEY) === signature) return;

    const res = await fetch("/api/sync-chat-history-to-faqs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions })
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success) {
      console.error("Failed to sync saved chats to FAQ Insights:", result.error || "Unknown error");
      return;
    }

    localStorage.setItem(FAQ_SYNC_KEY, signature);
  } catch (err) {
    console.error("Saved chat FAQ sync failed:", err);
  }
}

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

function applyHistoryTabVisibility(isVisible) {
  if (!drawer || !appMain) return;

  if (isVisible) {
    drawer.classList.remove("history-hidden");
    appMain.classList.remove("history-tab-hidden");
    if (drawerToggle) drawerToggle.checked = true;
    if (drawerToggleCollapsed) drawerToggleCollapsed.checked = true;
  } else {
    drawer.classList.add("history-hidden");
    appMain.classList.add("history-tab-hidden");
    if (drawerToggle) drawerToggle.checked = false;
    if (drawerToggleCollapsed) drawerToggleCollapsed.checked = false;
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

drawerToggleCollapsed?.addEventListener("change", () => {
  const isVisible = drawerToggleCollapsed.checked;
  applyHistoryTabVisibility(isVisible);
  saveHistoryTabVisibility(isVisible);
});

newChatBtn?.addEventListener("click", () => {
  const id = safeUuid();

  conversations.unshift({
    id,
    title: "New chat",
    createdAt: nowLabel(),
    createdAtTs: Date.now(),
    messages: [getDefaultWelcomeMessage()]
  });

  saveConversations(conversations);
  setActiveConv(id);
  localStorage.removeItem(FAQ_SYNC_KEY);
});

function deleteConversation(convId) {
  const index = conversations.findIndex((c) => c.id === convId);
  if (index === -1) return;

  conversations.splice(index, 1);

  if (!conversations.length) {
    const id = safeUuid();
    conversations.unshift({
      id,
      title: "New chat",
      createdAt: nowLabel(),
      createdAtTs: Date.now(),
      messages: [getDefaultWelcomeMessage()]
    });
    activeConvId = id;
  } else if (activeConvId === convId) {
    activeConvId = conversations[0].id;
  }

  localStorage.setItem(OPEN_CONV_KEY, activeConvId);
  saveConversations(conversations);
  renderHistory();
  renderChat();
  localStorage.removeItem(FAQ_SYNC_KEY);
}

function stripSuggestionLines(text) {
  return splitTextAndSuggestions(text).mainText;
}

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
  if (conv.id === activeConvId) item.classList.add("active");

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
    if (isGenerating) return;
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

  const query = String(historySearchInput?.value || "").toLowerCase().trim();
  historyList.innerHTML = "";

  const filtered = conversations
    .slice()
    .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0))
    .filter((conv) => {
      if (!query) return true;

      const title = String(conv.title || "").toLowerCase();
      const preview = String(getLastMessagePreview(conv) || "").toLowerCase();

      return title.includes(query) || preview.includes(query);
    })
    .slice(0, 50);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No chats found";
    historyList.appendChild(empty);
    return;
  }

  filtered.forEach((conv) => {
    historyList.appendChild(createHistoryItem(conv));
  });
}

function splitTextAndSuggestions(text) {
  const raw = String(text || "").trim();
  if (!raw) return { mainText: "", suggestions: [] };

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

  return {
    mainText: cleanLines.join("\n").trim(),
    suggestions
  };
}

function cleanBotReplyText(text, sourceQuestion = "") {
  let raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";

  const { mainText, suggestions } = splitTextAndSuggestions(raw);
  let cleaned = mainText.trim();

  if (!cleaned) return rebuildTextWithSuggestions("", suggestions);

  const questionNorm = normalizeCompareText(sourceQuestion);
  let lines = cleaned.split("\n");

  while (lines.length && !lines[0].trim()) lines.shift();

  if (lines.length) {
    const firstLine = lines[0].trim();
    const firstNorm = normalizeCompareText(firstLine);

    if (questionNorm && firstNorm === questionNorm) {
      lines.shift();
    } else if (
      questionNorm &&
      firstNorm &&
      (firstNorm.includes(questionNorm) || questionNorm.includes(firstNorm)) &&
      firstLine.length <= 90
    ) {
      lines.shift();
    }
  }

  cleaned = lines.join("\n").trim();
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

function renderTextToHtml(text) {
  const source = String(text || "").trim();
  if (!source) return "";

  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    return marked.parse(source);
  }

  return source
    .split("\n\n")
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function enhanceRenderedMarkdown(container) {
  if (!container) return;

  const preBlocks = container.querySelectorAll("pre");
  preBlocks.forEach((pre) => {
    if (pre.dataset.enhanced === "true") return;
    pre.dataset.enhanced = "true";

    const code = pre.querySelector("code");
    const wrapper = document.createElement("div");
    wrapper.className = "md-code";

    const head = document.createElement("div");
    head.className = "md-code-head";
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.justifyContent = "space-between";

    const label = document.createElement("span");
    label.textContent = "Code";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "msg-tool-btn";
    copyBtn.innerHTML = `<i class="bi bi-clipboard"></i><span>Copy code</span>`;

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code?.innerText || "");
        copyBtn.innerHTML = `<i class="bi bi-check2"></i><span>Copied</span>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="bi bi-clipboard"></i><span>Copy code</span>`;
        }, 1200);
      } catch (err) {
        console.error("Code copy failed:", err);
      }
    });

    head.appendChild(label);
    head.appendChild(copyBtn);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(head);
    wrapper.appendChild(pre);
  });
}

function buildMessageToolbar(msg) {
  if (msg.role !== "bot") return null;

  const toolbar = document.createElement("div");
  toolbar.className = "msg-toolbar";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "msg-tool-btn";
  copyBtn.innerHTML = `<i class="bi bi-clipboard"></i><span>Copy</span>`;
  copyBtn.addEventListener("click", async () => {
    try {
      const cleaned = cleanBotReplyText(msg.text || "", msg.sourceQuestion || "");
      const { mainText } = splitTextAndSuggestions(cleaned);
      await navigator.clipboard.writeText(String(mainText || "").trim());

      copyBtn.innerHTML = `<i class="bi bi-check2"></i><span>Copied</span>`;
      setTimeout(() => {
        copyBtn.innerHTML = `<i class="bi bi-clipboard"></i><span>Copy</span>`;
      }, 1200);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  });

  const regenBtn = document.createElement("button");
  regenBtn.type = "button";
  regenBtn.className = "msg-tool-btn icon-only";
  regenBtn.title = "Put this question back in the box";
  regenBtn.setAttribute("aria-label", "Regenerate");
  regenBtn.innerHTML = `<i class="bi bi-arrow-repeat"></i>`;
  regenBtn.addEventListener("click", () => {
    if (isGenerating) return;
    const sourceText = msg.sourceQuestion || lastSubmittedVisibleText || lastSubmittedUserText;
    if (!sourceText || !userInput) return;

    userInput.value = sourceText;
    autoResizeComposer();
    userInput.focus();
    const len = userInput.value.length;
    userInput.setSelectionRange(len, len);
  });

  toolbar.appendChild(copyBtn);
  toolbar.appendChild(regenBtn);
  return toolbar;
}

async function streamTextIntoElement(element, fullText, speed = 9, convId = null) {
  const text = String(fullText || "");
  let current = "";
  let chunk = "";

  for (let i = 0; i < text.length; i++) {
    if (stopGenerationRequested) break;
    if (convId && getActiveConversationId() !== convId) break;

    chunk += text[i];

    const flushNow =
      chunk.length >= 2 ||
      text[i] === " " ||
      text[i] === "\n" ||
      i === text.length - 1;

    if (flushNow) {
      current += chunk;
      chunk = "";
      element.innerHTML = renderTextToHtml(current) + `<span class="stream-caret"></span>`;
      smoothScrollChatToBottom();
      await new Promise((resolve) => setTimeout(resolve, speed));
    }
  }

  element.innerHTML = renderTextToHtml(current);
  enhanceRenderedMarkdown(element);
  return current;
}

function buildBotBundle(msg, isLast = true) {
  const row = document.createElement("div");
  row.className = "msg-row bot";

  const avatar = document.createElement("div");
  avatar.className = "avatar assistant-avatar";
  avatar.innerHTML = `<i class="bi bi-robot"></i>`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const stack = document.createElement("div");
  stack.className = "message-stack";

  const meta = document.createElement("div");
  meta.className = "assistant-meta";
  meta.textContent = "UniWise";

  const content = document.createElement("div");
  content.className = "bot-text-content markdown-body";

  const cleanedText = cleanBotReplyText(msg.text || "", msg.sourceQuestion || "");
  const { mainText, suggestions } = splitTextAndSuggestions(cleanedText);

  if (mainText) {
    content.innerHTML = renderTextToHtml(mainText);
    enhanceRenderedMarkdown(content);
  }

  stack.appendChild(meta);
  stack.appendChild(content);

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

  // Only the most recent bot reply should show suggestion chips -- older
  // messages keep their text but drop the chips when the conversation reloads.
  if (isLast && finalSuggestionItems.length) {
    const label = document.createElement("div");
    label.className = "suggestion-label";
    label.textContent = "You can also ask:";
    stack.appendChild(label);

    const chips = createSuggestionChips(finalSuggestionItems);
    if (chips) stack.appendChild(chips);
  }

  const toolbar = buildMessageToolbar(msg);
  if (toolbar) stack.appendChild(toolbar);

  bubble.appendChild(stack);
  row.appendChild(avatar);
  row.appendChild(bubble);
  return row;
}

function buildRegularMessage(msg) {
  const row = document.createElement("div");
  row.className = `msg-row ${msg.role === "user" ? "user" : "bot"}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${msg.role === "bot" ? "assistant-avatar" : ""}`;
  avatar.innerHTML = msg.role === "user"
    ? `<i class="bi bi-person-fill"></i>`
    : `<i class="bi bi-robot"></i>`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (msg.type === "image" && msg.url) {
    const inner = document.createElement("div");
    inner.className = msg.role === "user" ? "user-text-content" : "bot-text-content markdown-body";

    const img = document.createElement("img");
    img.src = msg.url;
    img.alt = msg.fileName || "image";
    img.className = "chat-image";
    inner.appendChild(img);

    if (msg.fileName) {
      const cap = document.createElement("div");
      cap.className = "file-caption";
      cap.textContent = msg.fileName;
      inner.appendChild(cap);
    }

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
    const stack = document.createElement("div");
    stack.className = "message-stack";

    const meta = document.createElement("div");
    meta.className = "assistant-meta";
    meta.textContent = "UniWise";

    const text = document.createElement("div");
    text.className = "bot-text-content markdown-body";
    text.innerHTML = renderTextToHtml(cleanBotReplyText(msg.text || "", msg.sourceQuestion || ""));
    enhanceRenderedMarkdown(text);

    stack.appendChild(meta);
    stack.appendChild(text);

    const label = document.createElement("div");
    label.className = "suggestion-label";
    label.textContent = "You can also ask:";
    stack.appendChild(label);

    const chipWrap = createSuggestionChips(msg.buttons);
    if (chipWrap) stack.appendChild(chipWrap);

    const toolbar = buildMessageToolbar(msg);
    if (toolbar) stack.appendChild(toolbar);

    bubble.appendChild(stack);
  } else {
    if (msg.role === "bot") {
      const stack = document.createElement("div");
      stack.className = "message-stack";

      const meta = document.createElement("div");
      meta.className = "assistant-meta";
      meta.textContent = "UniWise";

      const content = document.createElement("div");
      content.className = "bot-text-content markdown-body";

      const cleanedBotText = cleanBotReplyText(msg.text || "", msg.sourceQuestion || "");
      content.innerHTML = renderTextToHtml(cleanedBotText);
      enhanceRenderedMarkdown(content);

      stack.appendChild(meta);
      stack.appendChild(content);

      const toolbar = buildMessageToolbar(msg);
      if (toolbar) stack.appendChild(toolbar);

      bubble.appendChild(stack);
    } else {
      bubble.innerHTML = `<div class="user-text-content">${escapeHtml(msg.text || "")}</div>`;
    }
  }

  // ── FIX: user messages → bubble first, then avatar
  //         so avatar sits at the right edge with justify-content: flex-end
  if (msg.role === "user") {
    row.appendChild(bubble);
    row.appendChild(avatar);
  } else {
    row.appendChild(avatar);
    row.appendChild(bubble);
  }

  return row;
}

function buildMessage(msg, isLast = false) {
  if (msg.type === "bot_bundle") return buildBotBundle(msg, isLast);
  return buildRegularMessage(msg);
}

function isFreshConversation(conv) {
  if (!conv || !Array.isArray(conv.messages)) return false;
  if (conv.messages.length === 0) return true;
  if (conv.messages.length === 1 && conv.messages[0].role === "bot") return true;
  return false;
}

function renderChat() {
  const conv = getActiveConv();
  if (!conv || !chatArea) return;

  chatArea.innerHTML = "";

  if (isFreshConversation(conv)) {
    document.body.classList.add("welcome-active");
    renderWelcomeScreen();
    return;
  }

  document.body.classList.remove("welcome-active");
  const lastIndex = conv.messages.length - 1;
  conv.messages.forEach((m, i) => chatArea.appendChild(buildMessage(m, i === lastIndex)));
  scrollChatToBottom(true);
}

const _cachedFaqs = { data: null, ts: 0 };

async function fetchFaqs() {
  const now = Date.now();
  if (_cachedFaqs.data && now - _cachedFaqs.ts < 60000) return _cachedFaqs.data;
  try {
    const res = await fetch("/api/chatbot/faqs");
    const json = await res.json();
    const items = Array.isArray(json.data) ? json.data : [];
    _cachedFaqs.data = items;
    _cachedFaqs.ts = now;
    return items;
  } catch {
    return [];
  }
}

// ── FAQ SUGGESTION HELPER ─────────────────────────────────
// Returns up to `limit` other approved FAQs as chip buttons,
// excluding the one already matched so chips are always fresh.
function buildFaqSuggestions(faqs, excludeFaq = null, limit = 5) {
  return faqs
    .filter((f) => {
      if (f === excludeFaq) return false;
      const q = String(f.question || f.normalized_question || "").trim();
      const a = String(f.answer   || "").trim();
      return q && a;
    })
    .slice(0, limit)
    .map((f) => {
      const q = String(f.question || f.normalized_question || "").trim();
      return { title: q, payload: q };
    });
}

// ── FAQ MATCHING — checks approved FAQs before calling the AI ──────
const FAQ_STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","could",
  "should","may","might","can","shall","to","of","in","on",
  "at","for","with","from","by","about","as","into","through",
  "before","after","up","down","then","than","so","and","but",
  "or","nor","not","no","it","i","you","me","my","your","we",
  "they","who","what","when","where","why","how","which","that",
  "this","there","their","any","all","some","other","please",
  "tell","give","show","explain","get","hi","hello","hey"
]);

// Groups of interchangeable words for FAQ matching -- every word in a group
// maps to the same canonical token, so "enroll" and "sign up" are treated as
// identical when comparing a user's question against an admin's FAQ question.
// Add more groups here any time you notice a real question that should have
// matched an existing FAQ but didn't because it used different wording.
const FAQ_SYNONYM_GROUPS = [
  ["enroll", "enrollment", "enrolment", "register", "registration", "signup", "sign", "apply", "application", "admission", "admissions"],
  ["requirement", "requirements", "need", "needed", "needs", "document", "documents", "docs", "papers", "paperwork"],
  ["contact", "phone", "number", "email", "reach", "call"],
  ["fee", "fees", "cost", "costs", "price", "payment", "pay", "tuition"],
  ["schedule", "time", "times", "hours", "when"],
  ["location", "address", "where", "place", "located"],
  ["deadline", "deadlines", "due", "cutoff"],
  ["form", "forms"],
  ["teacher", "teachers", "instructor", "faculty", "adviser", "advisor"],
  ["grade", "grades", "grading", "score", "scores"],
  ["subject", "subjects", "course", "courses", "class", "classes"],
  ["uniform", "uniforms", "attire", "dresscode"],
  ["id", "identification"],
  ["announcement", "announcements", "update", "updates", "news", "post", "posts"],
  ["school", "campus", "shs", "highschool"],
  ["office", "department"],
  ["strand", "strands", "track", "tracks"],
  ["section", "sections"],
  ["absent", "absence", "absences"],
  ["cert", "certificate", "certification", "coc"]
];

const FAQ_SYNONYM_MAP = (() => {
  const map = new Map();
  FAQ_SYNONYM_GROUPS.forEach((group) => {
    const canonical = group[0];
    group.forEach((word) => map.set(word, canonical));
  });
  return map;
})();

function getFaqKeywords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1 && !FAQ_STOP_WORDS.has(w))
    .map((w) => FAQ_SYNONYM_MAP.get(w) || w);
}

async function tryFaqReply(text) {
  try {
    // Bust cache so admin edits appear immediately
    _cachedFaqs.ts = 0;
    const faqs = await fetchFaqs();
    if (!faqs || !faqs.length) return null;

    const userNorm = normalizeCompareText(text);
    if (!userNorm || userNorm.length < 2) return null;

    const userWords = new Set(getFaqKeywords(text));

    let bestFaq   = null;
    let bestScore = 0;

    for (const faq of faqs) {
      const answer = String(faq.answer || "").trim();
      if (!answer) continue;

      const rawQ  = String(faq.question || faq.normalized_question || "").trim();
      if (!rawQ) continue;

      const qNorm = normalizeCompareText(rawQ);

      // ① Exact match — always wins
      if (userNorm === qNorm) {
        bestFaq   = faq;
        bestScore = 1;
        break;
      }

      // ② One is a substring of the other (handles short queries like "apply", "enroll")
      if (qNorm.includes(userNorm) || userNorm.includes(qNorm)) {
        const score = Math.min(userNorm.length, qNorm.length) /
                      Math.max(userNorm.length, qNorm.length);
        if (score > bestScore && score >= 0.55) {
          bestScore = score;
          bestFaq   = faq;
        }
        continue;
      }

      // ③ Keyword overlap (Jaccard + containment) — handles paraphrases
      const qWords       = new Set(getFaqKeywords(rawQ));
      const intersection = [...userWords].filter((w) => qWords.has(w)).length;
      if (!intersection) continue;
      const union        = new Set([...userWords, ...qWords]).size;
      const jaccard      = intersection / union;
      const containment  = intersection / Math.min(userWords.size || 1, qWords.size || 1);
      const score        = Math.max(jaccard, containment * 0.85);

      if (score > bestScore && score >= 0.55) {
        bestScore = score;
        bestFaq   = faq;
      }
    }

    if (!bestFaq) return null;

    const answer = String(bestFaq.answer || "").trim();
    if (!answer) return null;

    // Use admin-set buttons if present; otherwise auto-generate from other FAQs
    const adminButtons = Array.isArray(bestFaq.buttons) && bestFaq.buttons.length
      ? bestFaq.buttons
      : null;

    const buttons = adminButtons || buildFaqSuggestions(faqs, bestFaq, 5);

    return {
      role: "bot",
      type: "bot_bundle",
      text: answer,
      buttons,
      sourceQuestion: text
    };
  } catch (err) {
    console.error("FAQ lookup failed:", err);
    return null;
  }
}

const FALLBACK_FAQS = [
  "Latest Announcement",
  "Enrollment Requirements",
  "Contact Info",
  "About the School"
];

async function renderWelcomeScreen() {
  if (!chatArea) return;

  const wrap = document.createElement("div");
  wrap.className = "welcome-screen";

  wrap.innerHTML = `
    <div class="welcome-hero">
      <div class="welcome-wave">👋</div>
      <h2 class="welcome-title">Hi Camper!</h2>
      <p class="welcome-subtitle">How May I Help You?</p>
    </div>
    <div class="welcome-faq-section">
      <p class="welcome-faq-label">Frequently Asked Questions</p>
      <div class="welcome-faq-grid" id="welcomeFaqGrid">
        <div class="welcome-faq-loading">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;

  chatArea.appendChild(wrap);

  const faqs = await fetchFaqs();
  const grid = document.getElementById("welcomeFaqGrid");
  if (!grid) return;

  grid.innerHTML = "";

  const questions = faqs.length
    ? faqs.slice(0, 8).map((item) => String(item.question || item.normalized_question || "").trim()).filter(Boolean)
    : FALLBACK_FAQS;

  questions.forEach((q) => {
    const btn = document.createElement("button");
    btn.className = "welcome-faq-btn";
    btn.type = "button";
    btn.textContent = q;
    btn.addEventListener("click", () => {
      if (userInput) {
        userInput.value = q;
        autoResizeComposer();
        userInput.focus();
      }
      sendMessage(q, q);
    });
    grid.appendChild(btn);
  });
}

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
  localStorage.removeItem(FAQ_SYNC_KEY);
  renderHistory();
  renderChat();

  setHint(type === "image" ? `Image added: ${file.name}` : `File attached: ${file.name}`);
}

// ── Job-based chat: kick off generation on the server, then poll for it.
// The server keeps generating the reply in a background thread regardless
// of whether this tab is open, navigated away, or reloaded -- so as long as
// we remember the job id (in localStorage, which survives page navigation),
// we can always come back and pick up the finished reply instead of losing
// it and making the user ask again.
function savePendingJob(job) {
  try { localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(job)); } catch (err) { /* ignore */ }
}

function loadPendingJob() {
  try {
    const raw = localStorage.getItem(PENDING_JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearPendingJob() {
  try { localStorage.removeItem(PENDING_JOB_KEY); } catch (err) { /* ignore */ }
}

async function startChatJob(message) {
  const res = await fetch("/api/chat/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Chat API HTTP ${res.status} ${t}`);
  }

  const data = await res.json();
  if (!data.success || !data.job_id) {
    throw new Error(data.error || "Failed to start the chat request");
  }

  return data.job_id;
}

async function pollChatJob(jobId, { intervalMs = 1000, timeoutMs = 300000, checkStop = false } = {}) {
  const start = Date.now();

  while (true) {
    if (checkStop && stopGenerationRequested) {
      const err = new Error("Generation stopped by user.");
      err.stopped = true;
      throw err;
    }

    if (Date.now() - start > timeoutMs) {
      // Important: this is just "stop watching for now", not "the job failed" --
      // the server keeps generating regardless. The caller must NOT clear the
      // saved pending job on this error, so a later page load (or a manual
      // resume) can still pick up the answer once it actually finishes.
      const err = new Error("Still working on it -- this is taking longer than usual.");
      err.timedOut = true;
      throw err;
    }

    const res = await fetch(`/api/chat/status/${jobId}`);

    if (res.status === 404) {
      throw new Error("That reply is no longer available (it may have already been delivered).");
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Chat API HTTP ${res.status} ${t}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "Chat API returned an error");
    }

    if (data.status === "done") {
      return { success: true, reply: data.reply, image_url: data.image_url };
    }
    if (data.status === "error") {
      throw new Error(data.error || "The AI backend failed to generate a reply.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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

function normalizeChatReply(data, sourceQuestion = "") {
  const out = [];
  const text = (data?.reply || "").trim() || "…";

  out.push({
    role: "bot",
    type: "bot_bundle",
    text: cleanBotReplyText(text, sourceQuestion),
    buttons: [],
    sourceQuestion
  });

  if (data?.image_url) {
    out.push({
      role: "bot",
      type: "image",
      url: data.image_url,
      fileName: "Bot image",
      sourceQuestion
    });
  }

  return out;
}

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
      headers: { "Content-Type": "application/json" },
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

// ── ANNOUNCEMENT DETECTION & REPLY ───────────────────────
const ANNOUNCEMENT_TRIGGERS = [
  "latest announcement", "latest announcements",
  "announcement", "announcements",
  "anunsiyo", "pinakabagong anunsiyo", "may anunsiyo",
  "latest news", "latest update", "latest updates",
  "school update", "school news", "bagong balita",
  "new announcement", "recent announcement",
  "whats new", "what's new", "ano ang bago",
  "any announcement", "may announcement",
  "may balita", "balita", "anong bago",
  "recent news", "recent update", "any update",
  "any news", "news today", "update today"
];

function isAnnouncementQuery(text) {
  const norm = normalizeCompareText(text);
  return ANNOUNCEMENT_TRIGGERS.some((kw) =>
    norm.includes(normalizeCompareText(kw))
  );
}

async function tryAnnouncementReply(text) {
  if (!isAnnouncementQuery(text)) return null;

  try {
    const res  = await fetch("/api/announcement/latest");
    if (!res.ok) return null;
    const json = await res.json();

    // No announcement posted yet
    if (!json.success || !json.data) {
      const faqs    = await fetchFaqs();
      const buttons = buildFaqSuggestions(faqs, null, 5);
      return {
        role: "bot", type: "bot_bundle",
        text: "There are no announcements posted yet. Please check back later or visit the school for updates.",
        buttons,
        sourceQuestion: text
      };
    }

    const post  = json.data;
    const parts = [];

    parts.push("📢 **Latest Announcement**");
    parts.push("");

    if (post.title) parts.push(`**${post.title}**`);
    if (post.body)  parts.push(post.body);
    if (post.extra) { parts.push(""); parts.push(post.extra); }

    // Attachment hint
    const attachments = Array.isArray(post.attachments) ? post.attachments : [];
    const imgs  = attachments.filter((a) => a.type === "image").length;
    const files = attachments.filter((a) => a.type === "file").length;
    const vids  = attachments.filter((a) => a.type === "video").length;
    const hints = [];
    if (imgs)  hints.push(`${imgs} image${imgs  > 1 ? "s" : ""}`);
    if (vids)  hints.push(`${vids} video${vids  > 1 ? "s" : ""}`);
    if (files) hints.push(`${files} file${files > 1 ? "s" : ""}`);
    if (hints.length) {
      parts.push("");
      parts.push(`📎 *Includes ${hints.join(", ")} — visit the Resources page for details.*`);
    }

    // Footer
    const footer = [];
    if (post.posted_by)  footer.push(`Posted by **${post.posted_by}**`);
    if (post.created_at) footer.push(post.created_at);
    if (footer.length) { parts.push(""); parts.push(`*${footer.join(" · ")}*`); }

    // Suggestion chips from other FAQs
    const faqs    = await fetchFaqs();
    const buttons = buildFaqSuggestions(faqs, null, 5);

    return {
      role: "bot", type: "bot_bundle",
      text: parts.join("\n"),
      buttons,
      sourceQuestion: text
    };

  } catch (err) {
    console.error("Announcement fetch failed:", err);
    return null;
  }
}

// Called once on every chat-page load. If a reply was still generating when
// the user navigated to another page (Resources, Settings, History, Admin)
// or reloaded, this picks it back up instead of making them ask again --
// the server never stopped working on it in the background.
async function resumePendingJobIfAny() {
  const job = loadPendingJob();
  if (!job || !job.jobId || !job.conversationId) return;

  const conv = conversations.find((c) => c.id === job.conversationId);
  if (!conv) {
    clearPendingJob();
    return;
  }

  const isActive = conv.id === activeConvId;
  let loaderRow = null;

  if (isActive) {
    setGeneratingState(true);
    loaderRow = createAiLoader();
    chatArea.appendChild(loaderRow);
    scrollChatToBottom(true);
  }

  try {
    const chatData = await pollChatJob(job.jobId);
    clearPendingJob();

    const normalized = normalizeChatReply(chatData, job.actualText || "");
    if (!normalized.length) {
      normalized.push({
        role: "bot",
        type: "bot_bundle",
        text: "No reply received from UniWise AI.",
        buttons: [],
        sourceQuestion: job.actualText || ""
      });
    }

    const faqs = await fetchFaqs();
    for (const msg of normalized) {
      if (msg.type === "bot_bundle" && (!msg.buttons || !msg.buttons.length)) {
        msg.buttons = buildFaqSuggestions(faqs, null, 5);
      }
    }

    conv.messages.push(...normalized);
    saveConversations(conversations);
    renderHistory();
    if (isActive) renderChat();
  } catch (err) {
    if (err?.timedOut) {
      // Still generating -- leave the pending job in place (the `finally`
      // block below still cleans up the loader/generating state) so it can
      // be picked up again on the next page load instead of losing it.
      return;
    }

    clearPendingJob();
    conv.messages.push({
      role: "bot",
      type: "bot_bundle",
      text: "⚠️ Lost track of that reply while you were away. Please ask again.",
      buttons: [],
      sourceQuestion: job.actualText || ""
    });
    saveConversations(conversations);
    renderHistory();
    if (isActive) renderChat();
    console.error("Resuming pending chat job failed:", err);
  } finally {
    if (isActive) {
      if (loaderRow) loaderRow.remove();
      setGeneratingState(false);
    }
  }
}

function createAiLoader() {
  const row = document.createElement("div");
  row.className = "msg-row bot typing-row";

  row.innerHTML = `
    <div class="avatar assistant-avatar"><i class="bi bi-robot"></i></div>
    <div class="bubble">
      <div class="message-stack">
        <div class="assistant-meta">UniWise</div>
        <div class="ai-loader" aria-label="UniWise is thinking">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;

  return row;
}

async function sendMessage(messageOverride = null, displayOverride = null, isRegenerate = false) {
  if (isGenerating) return;

  const actualText = String(messageOverride ?? userInput?.value ?? "").trim();
  if (!actualText) return;

  const visibleText = String(displayOverride ?? actualText).trim();
  const conv = getActiveConv();
  if (!conv) return;

  stopGenerationRequested = false;
  currentAbortController = null;
  setGeneratingState(true);

  if (!isRegenerate) {
    conv.messages.push({ role: "user", type: "text", text: visibleText });

    fetch("/api/chatbot/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: visibleText })
    }).catch((err) => console.error("Question log failed:", err));

    if (!conv.title || conv.title === "New chat") {
      conv.title = makeTitleFromText(visibleText);
    }

    lastSubmittedUserText = actualText;
    lastSubmittedVisibleText = visibleText;
  }

  saveConversations(conversations);
  localStorage.removeItem(FAQ_SYNC_KEY);

  if (userInput) {
    userInput.value = "";
    autoResizeComposer();
  }

  setHint("");
  renderHistory();
  renderChat();

  const dictReply = await tryDictionaryReply(actualText);
  if (dictReply) {
    conv.messages.push(dictReply);
    saveConversations(conversations);
    renderHistory();
    renderChat();
    setGeneratingState(false);
    return;
  }

  // ── Priority 2: Live announcement ─────────────────────────────────
  const announcementReply = await tryAnnouncementReply(actualText);
  if (announcementReply) {
    conv.messages.push(announcementReply);
    saveConversations(conversations);
    renderHistory();
    renderChat();
    const annRows = Array.from(chatArea.querySelectorAll(".msg-row.bot"));
    const annRow  = annRows[annRows.length - 1];
    if (annRow) {
      const annContent = annRow.querySelector(".bot-text-content");
      if (annContent) {
        const cleaned = cleanBotReplyText(announcementReply.text || "", announcementReply.sourceQuestion || "");
        const { mainText, suggestions } = splitTextAndSuggestions(cleaned);
        annContent.innerHTML = "";
        const streamed         = await streamTextIntoElement(annContent, mainText, 9, conv.id);
        announcementReply.text = rebuildTextWithSuggestions(streamed, suggestions);
        saveConversations(conversations);
        annRow.replaceWith(buildBotBundle(announcementReply));
        renderHistory();
      }
    }
    setGeneratingState(false);
    return;
  }

  // ── Priority 3: Approved FAQ match (bypasses the AI call, always fresh) ──
  const faqReply = await tryFaqReply(actualText);
  if (faqReply) {
    conv.messages.push(faqReply);
    saveConversations(conversations);
    renderHistory();
    renderChat();

    // Stream text then rebuild the full row so chips + toolbar appear
    const faqBotRows = Array.from(chatArea.querySelectorAll(".msg-row.bot"));
    const faqBotRow  = faqBotRows[faqBotRows.length - 1];
    if (faqBotRow) {
      const faqContent = faqBotRow.querySelector(".bot-text-content");
      if (faqContent) {
        const cleaned = cleanBotReplyText(faqReply.text || "", faqReply.sourceQuestion || "");
        const { mainText, suggestions } = splitTextAndSuggestions(cleaned);
        faqContent.innerHTML = "";
        const streamed  = await streamTextIntoElement(faqContent, mainText, 9, conv.id);
        faqReply.text   = rebuildTextWithSuggestions(streamed, suggestions);
        saveConversations(conversations);
        faqBotRow.replaceWith(buildBotBundle(faqReply));  // chips now visible
        renderHistory();
      }
    }
    setGeneratingState(false);
    return;
  }

  // ── Priority 3: llama3 AI (via /api/chat) ────────────────────────────
  let loaderRow = createAiLoader();
  chatArea.appendChild(loaderRow);
  scrollChatToBottom(true);

  try {
    const jobId = await startChatJob(actualText);
    savePendingJob({
      conversationId: conv.id,
      jobId,
      actualText,
      startedAt: Date.now()
    });

    const chatData = await pollChatJob(jobId, { checkStop: true });
    clearPendingJob();

    if (loaderRow) {
      loaderRow.remove();
      loaderRow = null;
    }

    const normalized = normalizeChatReply(chatData, actualText);

    if (!normalized.length) {
      normalized.push({
        role: "bot",
        type: "bot_bundle",
        text: "No reply received from UniWise AI.",
        buttons: [],
        sourceQuestion: actualText
      });
    }

    // Inject FAQ suggestion chips into AI replies that have no buttons
    const faqs = await fetchFaqs();
    for (const msg of normalized) {
      if (msg.type === "bot_bundle" && (!msg.buttons || !msg.buttons.length)) {
        msg.buttons = buildFaqSuggestions(faqs, null, 5);
      }
    }

    conv.messages.push(...normalized);
    saveConversations(conversations);
    renderHistory();
    renderChat();

    const botRows    = Array.from(chatArea.querySelectorAll(".msg-row.bot"));
    const lastBotRow = botRows[botRows.length - 1];
    const lastBotMsg = normalized[normalized.length - 1];

    if (lastBotRow && lastBotMsg?.type === "bot_bundle") {
      const content = lastBotRow.querySelector(".bot-text-content");
      if (content) {
        const cleanedText = cleanBotReplyText(lastBotMsg.text || "", lastBotMsg.sourceQuestion || "");
        const { mainText, suggestions } = splitTextAndSuggestions(cleanedText);

        content.innerHTML = "";
        const streamed    = await streamTextIntoElement(content, mainText, 9, conv.id);

        lastBotMsg.text   = rebuildTextWithSuggestions(streamed, suggestions);
        saveConversations(conversations);
        lastBotRow.replaceWith(buildBotBundle(lastBotMsg));  // chips now visible
        renderHistory();
      }
    }
  } catch (err) {
    if (loaderRow) {
      loaderRow.remove();
      loaderRow = null;
    }

    if (stopGenerationRequested || err?.stopped) {
      clearPendingJob();
      conv.messages.push({
        role: "bot",
        type: "bot_bundle",
        text: "Generation stopped.",
        buttons: [],
        sourceQuestion: actualText
      });
      setHint("Generation stopped.");
    } else if (err?.timedOut) {
      // Do NOT clear the pending job -- the server is still generating it.
      // resumePendingJobIfAny() will pick it up next time this page loads.
      conv.messages.push({
        role: "bot",
        type: "bot_bundle",
        text: "⏳ Still generating your answer -- this is taking longer than usual. It'll appear automatically once it's ready, even if you leave this page.",
        buttons: [],
        sourceQuestion: actualText
      });
    } else {
      clearPendingJob();
      const detail = (err && err.message) ? err.message : "Unknown error";
      conv.messages.push({
        role: "bot",
        type: "bot_bundle",
        text: `⚠️ Couldn't get a reply: ${detail}\n\nCheck that the Flask app (app.py) is running and that Ollama has \`llama3\` and \`nomic-embed-text\` pulled.`,
        buttons: [],
        sourceQuestion: actualText
      });
      console.error(err);
    }

    saveConversations(conversations);
    renderHistory();
    renderChat();
  } finally {
    currentAbortController = null;
    setGeneratingState(false);
    stopGenerationRequested = false;
  }
}

// ── ATTACH MENU ──────────────────────────────────────────
attachBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!attachMenu) return;
  attachMenu.hidden = !attachMenu.hidden;
  attachBtn.classList.toggle("is-open", !attachMenu.hidden);
});

document.addEventListener("click", (e) => {
  if (attachMenu && !attachMenu.hidden && !attachBtn?.contains(e.target) && !attachMenu.contains(e.target)) {
    attachMenu.hidden = true;
    attachBtn.classList.remove("is-open");
  }
});

attachFileBtn?.addEventListener("click", () => {
  if (attachMenu) {
    attachMenu.hidden = true;
    attachBtn.classList.remove("is-open");
  }
  fileInput?.click();
});

attachImageBtn?.addEventListener("click", () => {
  if (attachMenu) {
    attachMenu.hidden = true;
    attachBtn.classList.remove("is-open");
  }
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

// ── SEND / STOP (merged button) ───────────────────────────
sendBtn?.addEventListener("click", () => {
  if (isGenerating) {
    stopGenerationRequested = true;
    if (currentAbortController) {
      try { currentAbortController.abort(); } catch (err) { console.error("Abort failed:", err); }
    }
    setHint("Generation stopped.");
  } else {
    sendMessage();
  }
});

userInput?.addEventListener("input", autoResizeComposer);

userInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatArea?.addEventListener("scroll", () => {
  autoScrollLocked = !isNearBottom();
});

historySearchInput?.addEventListener("input", renderHistory);

// Initialize app
(async function init() {
  try {
    if (handlePrivacyConsentForChatPage()) return;

    applySavedAppearance();

    const openConversationId = localStorage.getItem(OPEN_CONV_KEY);
    if (openConversationId && conversations.some((c) => c.id === openConversationId)) {
      activeConvId = openConversationId;
    }

    loadHistoryTabVisibility();
    renderHistory();
    renderChat();
    autoResizeComposer();

    await resumePendingJobIfAny();
    await syncSavedChatsToFaqInsights();

    window.addEventListener("storage", watchAppearanceKeys);
    window.addEventListener("focus", applySavedAppearance);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) applySavedAppearance();
    });

    console.log("UniWise chat initialized");
  } catch (err) {
    console.error("Chat init failed:", err);

    if (chatArea) {
      chatArea.innerHTML = `
        <div class="msg-row bot">
          <div class="avatar assistant-avatar"><i class="bi bi-robot"></i></div>
          <div class="bubble">
            <div class="message-stack">
              <div class="assistant-meta">UniWise</div>
              <div class="bot-text-content">⚠️ Chat failed to initialize. Check browser console for details.</div>
            </div>
          </div>
        </div>
      `;
    }
  }
})();

/* POV Toggle — Phone Frame Preview */
(function () {
  "use strict";

  const POV_DEVICE_KEY = "uniwisePOV_v1";
  const POV_ORIENT_KEY = "uniwisePOVOrient_v1";

  function getPOV() {
    return localStorage.getItem(POV_DEVICE_KEY) || "auto";
  }

  function applyPhoneFrame(isMobilePreview) {
    document.body.classList.toggle("pov-phone-frame", isMobilePreview);
  }

  function syncIcon(btn, icon) {
    const pov = getPOV();
    if (pov === "mobile") {
      icon.className = "bi bi-phone";
      btn.title = "Switch to Desktop view";
      btn.setAttribute("aria-label", "Switch to Desktop view");
      btn.classList.add("is-mobile");
    } else {
      icon.className = "bi bi-laptop";
      btn.title = "Switch to Mobile view";
      btn.setAttribute("aria-label", "Switch to Mobile view");
      btn.classList.remove("is-mobile");
    }
    applyPhoneFrame(getPOV() === "mobile");
  }

  function initPovToggle() {
    const btn = document.getElementById("povToggleBtn");
    const icon = document.getElementById("povToggleIcon");
    if (!btn || !icon) return;

    btn.addEventListener("click", () => {
      const next = getPOV() === "mobile" ? "auto" : "mobile";
      localStorage.setItem(POV_DEVICE_KEY, next);
      localStorage.setItem(POV_ORIENT_KEY, next === "mobile" ? "portrait" : "auto");

      syncIcon(btn, icon);
      window.dispatchEvent(new CustomEvent("povchange"));
    });

    window.addEventListener("storage", (e) => {
      if (e.key === POV_DEVICE_KEY || e.key === POV_ORIENT_KEY) {
        syncIcon(btn, icon);
      }
    });

    window.addEventListener("povchange", () => syncIcon(btn, icon));

    syncIcon(btn, icon);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPovToggle);
  } else {
    initPovToggle();
  }


})();