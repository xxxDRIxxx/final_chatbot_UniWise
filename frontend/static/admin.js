(function () {
"use strict";

/* ═══════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════ */
function esc(v) {
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function fmtDate(v) {
  if (!v) return "Just now";
  const d = new Date(v);
  return isNaN(d) ? "Just now" : d.toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
function arr(v) { return Array.isArray(v) ? v : []; }
function $(id) { return document.getElementById(id); }
function setStatus(id, msg, isErr=false) {
  const el = $(id); if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("error", isErr);
}

/* ═══════════════════════════════════════════════════
   MODAL SYSTEM
═══════════════════════════════════════════════════ */
function openModal(id) {
  const el = $(id); if (!el) return;
  el.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  const el = $(id); if (!el) return;
  el.classList.remove("open");
  document.body.style.overflow = "";
}
function initModals() {
  document.querySelectorAll("[data-modal-close]").forEach(btn =>
    btn.addEventListener("click", () => closeModal(btn.dataset.modalClose))
  );
  document.querySelectorAll(".modal-overlay").forEach(ov =>
    ov.addEventListener("click", e => { if (e.target === ov) closeModal(ov.id); })
  );
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal-overlay.open");
    if (open) closeModal(open.id);
  });
}

/* ═══════════════════════════════════════════════════
   AUTO-LOGOUT — 15 min inactivity, 1 min warning
═══════════════════════════════════════════════════ */
const INACTIVE_MS = 15 * 60 * 1000;
const WARNING_MS  =  1 * 60 * 1000;
let inactiveTimer, warnTimer, cdInterval;
let warningActive = false;

function resetInactivity() {
  clearTimeout(inactiveTimer);
  clearTimeout(warnTimer);
  clearInterval(cdInterval);
  if (warningActive) {
    warningActive = false;
    closeModal("modalInactivity");
  }
  warnTimer = setTimeout(showInactivityWarning, INACTIVE_MS - WARNING_MS);
  inactiveTimer = setTimeout(() => { window.location.href = "/logout"; }, INACTIVE_MS);
}

function showInactivityWarning() {
  warningActive = true;
  let remaining = Math.floor(WARNING_MS / 1000);
  function tick() {
    const m = String(Math.floor(remaining / 60)).padStart(1,"0");
    const s = String(remaining % 60).padStart(2,"0");
    const el = $("inactivityCountdown");
    if (el) el.textContent = m + ":" + s;
    if (remaining <= 0) { clearInterval(cdInterval); window.location.href = "/logout"; return; }
    remaining--;
  }
  tick();
  cdInterval = setInterval(tick, 1000);
  openModal("modalInactivity");
}

function initInactivity() {
  ["mousemove","keydown","click","scroll","touchstart"].forEach(ev =>
    document.addEventListener(ev, resetInactivity, { passive: true })
  );
  $("stayLoggedInBtn")?.addEventListener("click", resetInactivity);
  resetInactivity();
}

/* ═══════════════════════════════════════════════════
   HEADER SCROLL HIDE/SHOW
═══════════════════════════════════════════════════ */
function initHeaderScroll() {
  const h = $("adminHeader"); if (!h) return;
  let last = window.scrollY;
  window.addEventListener("scroll", () => {
    const cur = window.scrollY;
    if (cur <= 10)             h.classList.remove("hide");
    else if (cur > last)       h.classList.add("hide");
    else                       h.classList.remove("hide");
    last = cur;
  }, { passive:true });
}

/* ═══════════════════════════════════════════════════
   SETTINGS HAMBURGER DROPDOWN
═══════════════════════════════════════════════════ */
function initSettingsDropdown() {
  const trigger  = $("settingsTrigger");
  const dropdown = $("settingsDropdown");
  if (!trigger || !dropdown) return;

  function close() {
    dropdown.classList.remove("open");
    trigger.classList.remove("open");
  }
  function toggle() {
    const isOpen = dropdown.classList.toggle("open");
    trigger.classList.toggle("open", isOpen);
  }

  trigger.addEventListener("click", e => { e.stopPropagation(); toggle(); });
  document.addEventListener("click", e => {
    if (!dropdown.contains(e.target) && !trigger.contains(e.target)) close();
  });

  // Privacy sub-expand
  const privToggle  = $("settPrivacyToggle");
  const privSub     = $("privacySub");
  const privChevron = $("privacyChevron");
  privToggle?.addEventListener("click", () => {
    const open = privSub.classList.toggle("open");
    if (privChevron) privChevron.classList.toggle("open", open);
  });

  // Sub-item actions
  $("settAccessLogBtn")?.addEventListener("click", () => {
    close(); loadAndShowAccessLog();
  });
  $("settBackupBtn")?.addEventListener("click", () => {
    close();
    const p = $("backupConfirmPassword"); if (p) p.value = "";
    setStatus("backupStatus","");
    openModal("modalBackupConfirm");
  });
  $("settChangePasswordBtn")?.addEventListener("click", () => {
    close();
    ["currentPassword","newPassword","confirmPassword"].forEach(id => { const e=$( id); if(e) e.value=""; });
    setStatus("changePasswordStatus","");
    openModal("modalChangePassword");
  });

  // FAQ Records — smooth scroll + close dropdown
  $("settFaqLink")?.addEventListener("click", () => {
    close();
    const section = $("faq-records-section");
    if (section) section.scrollIntoView({ behavior:"smooth", block:"start" });
  });
}

/* exported so HTML onclick can use it */
window.closeSettingsDropdown = function() {
  $("settingsDropdown")?.classList.remove("open");
  $("settingsTrigger")?.classList.remove("open");
};

/* ═══════════════════════════════════════════════════
   ACCESS LOG
═══════════════════════════════════════════════════ */
async function loadAndShowAccessLog() {
  openModal("modalAccessLog");
  const list = $("accessLogList");
  if (!list) return;
  list.innerHTML = `<div class="empty-box"><i class="bi bi-arrow-repeat"></i><span>Loading…</span></div>`;
  try {
    const res    = await fetch("/api/admin/access-log", { cache:"no-store" });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) throw new Error(result.error || "Failed to load.");
    const logs = arr(result.data?.logs || result.data);
    if (!logs.length) { list.innerHTML = `<div class="empty-box"><i class="bi bi-clock-history"></i><span>No login records found.</span></div>`; return; }
    list.innerHTML = logs.map((e,i) => {
      const cur  = e.is_current || i === 0;
      const icon = e.device_type === "mobile" ? "bi-phone" : "bi-laptop";
      return `<div class="access-log-item">
        <div class="access-log-icon"><i class="bi ${icon}"></i></div>
        <div class="access-log-meta">
          <div class="access-log-device">${esc(e.device || e.user_agent || "Unknown Device")}</div>
          <div class="access-log-time">${esc(e.ip||"—")} · ${esc(fmtDate(e.login_at||e.created_at))}</div>
        </div>
        <span class="access-log-status ${cur?"current":"past"}">${cur?"Current":"Past"}</span>
      </div>`;
    }).join("");
  } catch {
    list.innerHTML = `
      <div class="access-log-item">
        <div class="access-log-icon"><i class="bi bi-laptop"></i></div>
        <div class="access-log-meta">
          <div class="access-log-device">Current Browser — ${esc(navigator.platform||"Unknown")}</div>
          <div class="access-log-time">${fmtDate(new Date().toISOString())}</div>
        </div>
        <span class="access-log-status current">Current</span>
      </div>
      <div class="empty-box" style="margin-top:10px;font-size:12px;">
        <i class="bi bi-info-circle"></i>
        <span>Full log available once /api/admin/access-log is set up.</span>
      </div>`;
  }
}
$("revokeAllSessionsBtn")?.addEventListener("click", async () => {
  if (!confirm("Revoke all other sessions? You will stay logged in here.")) return;
  const btn = $("revokeAllSessionsBtn");
  btn.disabled = true; btn.textContent = "Revoking…";
  try {
    const res = await fetch("/api/admin/revoke-sessions",{method:"POST"});
    const r   = await res.json().catch(()=>({}));
    if (!res.ok || !r.success) throw new Error(r.error||"Failed");
    alert("Other sessions revoked."); loadAndShowAccessLog();
  } catch(e) { alert(e.message||"Failed."); }
  finally { btn.disabled=false; btn.innerHTML=`<i class="bi bi-shield-x"></i> Revoke Other Sessions`; }
});

/* ═══════════════════════════════════════════════════
   CHANGE PASSWORD
═══════════════════════════════════════════════════ */
$("submitChangePasswordBtn")?.addEventListener("click", async () => {
  const cur  = $("currentPassword")?.value  || "";
  const nw   = $("newPassword")?.value      || "";
  const conf = $("confirmPassword")?.value  || "";
  const sid  = "changePasswordStatus";
  if (!cur)          { setStatus(sid,"Enter your current password.",true); return; }
  if (nw.length < 8) { setStatus(sid,"New password must be at least 8 characters.",true); return; }
  if (nw !== conf)   { setStatus(sid,"New passwords do not match.",true); return; }
  if (nw === cur)    { setStatus(sid,"New password must differ from current.",true); return; }
  setStatus(sid,"Updating password…");
  try {
    const res = await fetch("/api/admin/change-password",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({current_password:cur,new_password:nw})
    });
    const r = await res.json().catch(()=>({}));
    if (!res.ok||!r.success) throw new Error(r.error||"Failed.");
    setStatus(sid,"Password updated successfully!");
    ["currentPassword","newPassword","confirmPassword"].forEach(id=>{const e=$(id);if(e)e.value="";});
    setTimeout(()=>closeModal("modalChangePassword"),1600);
  } catch(e) { setStatus(sid,e.message||"Failed.",true); }
});

/* ═══════════════════════════════════════════════════
   BACKUP DOWNLOAD
═══════════════════════════════════════════════════ */
$("submitBackupBtn")?.addEventListener("click", async () => {
  const pwd = $("backupConfirmPassword")?.value || "";
  const sid = "backupStatus";
  if (!pwd) { setStatus(sid,"Enter your password to confirm.",true); return; }
  setStatus(sid,"Verifying…");
  try {
    const res = await fetch("/api/admin/backup",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({password:pwd})
    });
    if (!res.ok) { const r=await res.json().catch(()=>({})); throw new Error(r.error||"Wrong password."); }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `admin-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus(sid,"Backup downloaded.");
    if ($("backupConfirmPassword")) $("backupConfirmPassword").value = "";
    setTimeout(()=>closeModal("modalBackupConfirm"),1800);
  } catch(e) { setStatus(sid,e.message||"Failed.",true); }
});

/* ═══════════════════════════════════════════════════
   EDITOR TABS
═══════════════════════════════════════════════════ */
function initEditorTabs() {
  document.querySelectorAll(".editor-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".editor-tab").forEach(t=>t.classList.remove("active"));
      document.querySelectorAll(".editor-panel").forEach(p=>p.classList.remove("active"));
      tab.classList.add("active");
      $(tab.dataset.editorTab)?.classList.add("active");
    });
  });
}

/* ═══════════════════════════════════════════════════
   POSTER ROLE
═══════════════════════════════════════════════════ */
function initRoleSegment() {
  $("posterRoleSegment")?.addEventListener("click", e => {
    const btn = e.target.closest(".segment-btn"); if (!btn) return;
    $("posterRoleSegment").querySelectorAll(".segment-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const role = btn.dataset.role || "Campers' Admin";
    const mr = $("metaPosterRole"); if(mr) mr.textContent = role;
    const pa = $("previewUploadAuthor"); if(pa) pa.textContent = role;
  });
}

/* ═══════════════════════════════════════════════════
   POST TYPE
═══════════════════════════════════════════════════ */
function setPostType(type) {
  const pt = $("postType"); if(pt) pt.value = type;
  document.querySelectorAll(".type-btn").forEach(b=>b.classList.toggle("active",b.dataset.type===type));
  const af=$("announcementFields"); if(af) af.style.display = "";
  const pc=$("previewUploadTypeChip"); if(pc) pc.textContent = "Announcement";
}
function initPostType() {
  document.querySelectorAll(".type-btn").forEach(btn=>btn.addEventListener("click",()=>setPostType(btn.dataset.type)));
  setPostType("announcement");
}

/* ═══════════════════════════════════════════════════
   ATTACHMENTS
═══════════════════════════════════════════════════ */
const uploads = { images:[], videos:[], files:[] };
const galleries = {};      // keyed by galleryId → [{url,isVideo}]
let _lbGallery = [];
let _lbIndex   = 0;

function updateAttachMeta() {
  const count = uploads.images.length + uploads.videos.length + uploads.files.length;
  const el = $("metaAttachmentCount"); if(el) el.textContent = `${count} attachment${count===1?"":"s"}`;
}

function mergeFiles(type, fileList) {
  Array.from(fileList||[]).forEach(f => {
    if (!uploads[type].some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))
      uploads[type].push(f);
  });
  renderSelectedFiles(); renderPreviewMedia(); updateAttachMeta();
}

window.removeSelectedFile = function(type, idx) {
  uploads[type].splice(idx,1);
  renderSelectedFiles(); renderPreviewMedia(); updateAttachMeta();
};

function renderSelectedFiles() {
  const wrap = $("selectedFilesPreview"); if (!wrap) return;
  const mediaParts=[], fileParts=[];
  uploads.images.forEach((f,i)=>{
    const url=URL.createObjectURL(f);
    mediaParts.push(`<div class="media-thumb"><img src="${url}" alt="${esc(f.name)}">
      <button type="button" class="thumb-remove-btn" onclick="removeSelectedFile('images',${i})"><i class="bi bi-x-lg"></i></button></div>`);
  });
  uploads.videos.forEach((f,i)=>{
    const url=URL.createObjectURL(f);
    mediaParts.push(`<div class="media-thumb"><video src="${url}" controls></video>
      <button type="button" class="thumb-remove-btn" onclick="removeSelectedFile('videos',${i})"><i class="bi bi-x-lg"></i></button></div>`);
  });
  uploads.files.forEach((f,i)=>{
    fileParts.push(`<div class="file-row">
      <div class="file-meta"><i class="bi bi-file-earmark"></i><span class="file-name">${esc(f.name)}</span></div>
      <button type="button" class="small-btn" onclick="removeSelectedFile('files',${i})">Remove</button></div>`);
  });
  if (!mediaParts.length && !fileParts.length) {
    wrap.innerHTML=`<div class="empty-box"><i class="bi bi-paperclip"></i><span>No attachments yet</span></div>`; return;
  }
  wrap.innerHTML = (mediaParts.length?`<div class="media-grid">${mediaParts.join("")}</div>`:"") +
                   (fileParts.length ?`<div class="file-stack">${fileParts.join("")}</div>`:"");
}

function renderPreviewMedia() {
  const wrap = $("previewUploadMedia"); if (!wrap) return;
  const parts=[];
  uploads.images.forEach(f=>{ const u=URL.createObjectURL(f); parts.push(`<div class="media-thumb"><img src="${u}" alt="${esc(f.name)}"></div>`); });
  uploads.videos.forEach(f=>{ const u=URL.createObjectURL(f); parts.push(`<div class="media-thumb"><video src="${u}" controls></video></div>`); });
  uploads.files.forEach(f=>parts.push(`<div class="file-row"><div class="file-meta"><i class="bi bi-file-earmark"></i><span class="file-name">${esc(f.name)}</span></div></div>`));
  wrap.innerHTML = parts.length ? parts.join("") : `<div class="empty-box"><i class="bi bi-image"></i><span>No media</span></div>`;
}

function initAttachments() {
  const btn  = $("attachMenuBtn");
  const menu = $("attachMenu");
  btn?.addEventListener("click", ()=>menu?.classList.toggle("open"));
  document.addEventListener("click", e=>{ if(btn&&menu&&!menu.contains(e.target)&&!btn.contains(e.target)) menu.classList.remove("open"); });
  $("chooseImagesBtn")?.addEventListener("click",()=>$("uploadImages")?.click());
  $("chooseVideosBtn")?.addEventListener("click",()=>$("uploadVideos")?.click());
  $("chooseFilesBtn") ?.addEventListener("click",()=>$("uploadFiles")?.click());
  $("uploadImages")?.addEventListener("change",e=>{mergeFiles("images",e.target.files);e.target.value="";});
  $("uploadVideos")?.addEventListener("change",e=>{mergeFiles("videos",e.target.files);e.target.value="";});
  $("uploadFiles") ?.addEventListener("change",e=>{mergeFiles("files", e.target.files);e.target.value="";});
}

/* ═══════════════════════════════════════════════════
   PREVIEW INPUTS
═══════════════════════════════════════════════════ */
function initPreview() {
  function sync() {
    const pt=$("previewAnnouncementTitle"); if(pt) pt.textContent=$("announcementTitle")?.value||"No announcement title yet";
    const pb=$("previewAnnouncementBody");  if(pb) pb.textContent=$("announcementBody")?.value||"Your announcement preview will appear here.";
    const pe=$("previewAnnouncementExtra"); if(pe) pe.textContent=$("announcementExtra")?.value||"";
  }
  ["announcementTitle","announcementBody","announcementExtra"]
    .forEach(id=>$(id)?.addEventListener("input",sync));
  sync();
}

/* ═══════════════════════════════════════════════════
   PUBLISHED POSTS — RENDER
═══════════════════════════════════════════════════ */
function renderPostMedia(post) {
  const images = arr(post.images);
  const videos = arr(post.videos);
  const files  = arr(post.files);
  const parts  = [];

  if (images.length) {
    const postId    = String(post.id || post._id || Math.random());
    const galleryId = `post-${postId}`;
    galleries[galleryId] = images.map(x => ({ url: x.url||x.path||x.src||"", isVideo: false }));

    const MAX_SHOW = 4;
    const shown    = images.slice(0, MAX_SHOW);
    const extra    = images.length - MAX_SHOW;
    const single   = images.length === 1;

    const thumbs = shown.map((x, i) => {
      const url      = esc(x.url || x.path || x.src || "");
      const isLast   = !single && i === MAX_SHOW - 1 && extra > 0;
      const overlay  = isLast ? `<div class="post-img-more">+${extra + 1}</div>` : "";
      return `<div class="post-img-item" onclick="openLightbox('${esc(galleryId)}',${i})">
        <img src="${url}" alt="${esc(x.name||"")}">
        ${overlay}
      </div>`;
    }).join("");

    parts.push(`<div class="post-img-gallery${single?" single":" multi"}">${thumbs}</div>`);
  }

  if (videos.length) {
    parts.push(`<div class="media-grid">${videos.map(x =>
      `<div class="media-thumb"><video src="${esc(x.url||x.path||x.src||"")}" controls></video></div>`
    ).join("")}</div>`);
  }

  if (files.length) {
    parts.push(`<div class="file-stack">${files.map(x =>
      `<a class="file-row" href="${esc(x.url||x.path||"#")}" target="_blank" rel="noopener">
        <div class="file-meta"><i class="bi bi-file-earmark"></i><span class="file-name">${esc(x.name||"Attachment")}</span></div>
      </a>`
    ).join("")}</div>`);
  }

  return parts.length ? `<div class="published-post-media">${parts.join("")}</div>` : "";
}

function renderPublishedPosts(posts) {
  const wrap = $("publishedPostsList"); if (!wrap) return;
  const tm = $("metricTotalPosts"); if(tm) tm.textContent = String(posts.length);
  if (!posts.length) { wrap.innerHTML=`<div class="empty-box large-empty"><i class="bi bi-stickies"></i><span>No published posts yet.</span></div>`; return; }
  wrap.innerHTML = posts.map(post => {
    const id    = esc(String(post.id||post._id||""));
    const type  = post.post_type||post.type||"announcement";
    const role  = post.poster_role||post.author||"Campers' Admin";
    const title = post.title||"Untitled Post";
    const body  = post.body||"";
    const extra = post.extra||"";
    const date  = post.created_at||"";
    return `
    <article class="post-card" data-post-id="${id}">
      <div class="post-head">
        <div class="post-meta">
          <div class="post-title-row">
            <span class="post-author">${esc(role)}</span>
            <span class="pill">${type==="announcement"?"Announcement":"Upload"}</span>
          </div>
          <div class="post-time">${esc(fmtDate(date))}</div>
        </div>
        <div class="post-actions">
          <button type="button" class="small-btn" onclick="openPostEditor('${id}')"><i class="bi bi-pencil-fill"></i> Edit</button>
          <button type="button" class="small-btn danger-btn" onclick="confirmDeletePost('${id}')"><i class="bi bi-trash-fill"></i> Delete</button>
        </div>
      </div>
      <div class="post-body">
        <h3>${esc(title)}</h3>
        <p>${esc(body)}</p>
        ${extra?`<p>${esc(extra)}</p>`:""}
      </div>
      ${renderPostMedia(post)}
      <!-- Inline edit form -->
      <div class="post-edit-form" id="postEditor-${id}" style="display:none;">
        <div class="edit-section-label"><i class="bi bi-pencil-square"></i> Editing Post</div>
        <div class="compact-form-grid" style="margin-bottom:14px;">
          <div class="field-block full-span"><label class="field-label">Title</label><input class="field-input" id="editTitle-${id}" type="text" value="${esc(title)}"/></div>
          <div class="field-block full-span"><label class="field-label">Message</label><textarea class="field-textarea" id="editBody-${id}">${esc(body)}</textarea></div>
          ${type==="announcement"?`<div class="field-block full-span"><label class="field-label">Extra</label><input class="field-input" id="editExtra-${id}" type="text" value="${esc(extra)}"/></div>`:""}
          <div class="field-block"><label class="field-label">Add Images</label><input class="field-input" type="file" id="editImages-${id}" accept="image/*" multiple/></div>
          <div class="field-block"><label class="field-label">Add Videos</label><input class="field-input" type="file" id="editVideos-${id}" accept="video/*" multiple/></div>
          <div class="field-block full-span"><label class="field-label">Add Files</label><input class="field-input" type="file" id="editFiles-${id}" multiple/></div>
        </div>
        <div class="action-row">
          <button type="button" class="primary-btn" onclick="savePostEdit('${id}')"><i class="bi bi-save2-fill"></i> Save Changes</button>
          <button type="button" class="ghost-btn"   onclick="openPostEditor('${id}')"><i class="bi bi-x-lg"></i> Cancel</button>
        </div>
        <div class="status-line" id="editStatus-${id}"></div>
      </div>
    </article>`;
  }).join("");
}

window.openPostEditor = function(id) {
  const form = $(`postEditor-${id}`); if (!form) return;
  form.style.display = form.style.display === "none" ? "block" : "none";
};

window.savePostEdit = async function(id) {
  const sid = `editStatus-${id}`;
  setStatus(sid,"Saving…");
  try {
    const fd = new FormData();
    fd.append("title", $(`editTitle-${id}`)?.value||"");
    fd.append("body",  $(`editBody-${id}`) ?.value||"");
    const ex = $(`editExtra-${id}`); if(ex) fd.append("extra",ex.value||"");
    Array.from($(`editImages-${id}`)?.files||[]).forEach(f=>fd.append("images",f));
    Array.from($(`editVideos-${id}`)?.files||[]).forEach(f=>fd.append("videos",f));
    Array.from($(`editFiles-${id}`) ?.files||[]).forEach(f=>fd.append("files", f));
    const res = await fetch(`/api/admin/posts/${encodeURIComponent(id)}`,{method:"PUT",body:fd});
    const r   = await res.json().catch(()=>({}));
    if (!res.ok||!r.success) throw new Error(r.error||"Failed to save changes.");
    setStatus(sid,"Saved!"); await loadPublishedPosts();
  } catch(e) { setStatus(sid,e.message||"Error.",true); }
};

/* ── DELETE POSTS (fixed — tries two endpoint patterns) ── */
let pendingDeleteId = null;

window.confirmDeletePost = function(id) {
  pendingDeleteId = id;
  const card  = document.querySelector(`.post-card[data-post-id="${CSS.escape(id)}"]`);
  const title = card?.querySelector(".post-body h3")?.textContent || id;
  const prev  = $("deletePostPreview");
  if (prev) prev.textContent = title;
  setStatus("deletePostStatus","");
  openModal("modalDeletePost");
};

function initDeletePost() {
  $("confirmDeletePostBtn")?.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    const btn = $("confirmDeletePostBtn");
    btn.disabled = true;
    btn.innerHTML = `<i class="bi bi-hourglass-split"></i> Deleting…`;
    setStatus("deletePostStatus","Deleting…");
    try {
      const res = await fetch(`/api/admin/posts/${encodeURIComponent(pendingDeleteId)}`,{method:"DELETE"});
      const r = await res.json().catch(()=>({}));
      if (!res.ok||!r.success) throw new Error(r.error||`Server returned ${res.status}`);
      closeModal("modalDeletePost");
      pendingDeleteId = null;
      await loadPublishedPosts();
    } catch(e) {
      setStatus("deletePostStatus",`Delete failed: ${e.message}`,true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="bi bi-trash-fill"></i> Yes, Delete`;
    }
  });
}

/* ═══════════════════════════════════════════════════
   LOAD PUBLISHED POSTS
═══════════════════════════════════════════════════ */
async function loadPublishedPosts() {
  const wrap = $("publishedPostsList"); if (!wrap) return;
  wrap.innerHTML = `<div class="empty-box large-empty"><i class="bi bi-arrow-repeat"></i><span>Loading…</span></div>`;
  try {
    const res    = await fetch(`/api/resources?t=${Date.now()}`,{cache:"no-store"});
    const result = await res.json().catch(()=>({}));
    if (!res.ok||!result.success) throw new Error(result.error||"Failed to load.");
    const posts = arr(result.data?.posts);
    renderPublishedPosts(posts);
  } catch(e) {
    wrap.innerHTML=`<div class="empty-box large-empty"><i class="bi bi-exclamation-circle"></i><span>${esc(e.message||"Failed to load posts.")}</span></div>`;
    const tm=$("metricTotalPosts"); if(tm) tm.textContent="0";
  }
}

/* ═══════════════════════════════════════════════════
   PUBLISH POST
═══════════════════════════════════════════════════ */
async function publishPost() {
  setStatus("uploadStatus","Publishing…");
  try {
    const fd = new FormData();
    fd.append("post_type",          $("postType")?.value||"announcement");
    fd.append("poster_role",        $("metaPosterRole")?.textContent||"Campers' Admin");
    fd.append("announcement_title", $("announcementTitle")?.value||"");
    fd.append("announcement_body",  $("announcementBody")?.value||"");
    fd.append("announcement_extra", $("announcementExtra")?.value||"");
    uploads.images.forEach(f=>fd.append("images",f));
    uploads.videos.forEach(f=>fd.append("videos",f));
    uploads.files .forEach(f=>fd.append("files", f));
    const res = await fetch("/admin/publish",{method:"POST",body:fd});
    const r   = await res.json().catch(()=>({}));
    if (!res.ok||!r.success) throw new Error(r.error||"Upload failed.");
    setStatus("uploadStatus","Published successfully!");
    $("clearComposerBtn")?.click();
    await loadPublishedPosts();
  } catch(e) { setStatus("uploadStatus",e.message||"Error.",true); }
}

function clearComposer() {
  ["announcementTitle","announcementBody","announcementExtra"]
    .forEach(id=>{const e=$(id);if(e)e.value="";});
  uploads.images=[]; uploads.videos=[]; uploads.files=[];
  renderSelectedFiles(); renderPreviewMedia(); updateAttachMeta();
  setStatus("uploadStatus","Composer cleared.");
}

/* ═══════════════════════════════════════════════════
   ABOUT & CONTACT
═══════════════════════════════════════════════════ */
async function loadAboutContact() {
  try {
    const res    = await fetch(`/api/resources?t=${Date.now()}`,{cache:"no-store"});
    const result = await res.json();
    if (!result.success) return;
    const ab=$("aboutTitle");     if(ab) ab.value=result.data?.about?.title||"";
    const a1=$("aboutText1");     if(a1) a1.value=result.data?.about?.text1||"";
    const a2=$("aboutText2");     if(a2) a2.value=result.data?.about?.text2||"";
    const cp=$("contactPhone");   if(cp) cp.value=result.data?.contact?.phone||"";
    const ce=$("contactEmail");   if(ce) ce.value=result.data?.contact?.email||"";
    const cl=$("contactLocation");if(cl) cl.value=result.data?.contact?.location||"";
  } catch {}
}
async function saveAbout() {
  setStatus("aboutStatus","Saving…");
  try {
    const res = await fetch("/api/resources/about",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({about:{title:$("aboutTitle")?.value||"",text1:$("aboutText1")?.value||"",text2:$("aboutText2")?.value||""}})});
    const r=await res.json().catch(()=>({}));
    if(!res.ok||!r.success) throw new Error(r.error||"Failed.");
    setStatus("aboutStatus","About saved.");
  } catch(e){setStatus("aboutStatus",e.message||"Error.",true);}
}
async function saveContact() {
  setStatus("contactStatus","Saving…");
  try {
    const res = await fetch("/api/resources/contact",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contact:{phone:$("contactPhone")?.value||"",email:$("contactEmail")?.value||"",location:$("contactLocation")?.value||""}})});
    const r=await res.json().catch(()=>({}));
    if(!res.ok||!r.success) throw new Error(r.error||"Failed.");
    setStatus("contactStatus","Contact saved.");
  } catch(e){setStatus("contactStatus",e.message||"Error.",true);}
}

/* ═══════════════════════════════════════════════════
   LED MANAGER
═══════════════════════════════════════════════════ */
let existingLed=[], newLed=[];
function renderLed() {
  const wrap = $("ledMediaManager"); if (!wrap) return;

  // Cache blob URLs on item objects so they're stable across re-renders
  newLed.forEach(item => {
    if (!item._blobUrl) item._blobUrl = URL.createObjectURL(item.file);
  });

  // Build gallery for lightbox (images only)
  galleries["led"] = [
    ...existingLed.map(item => ({ url: item.url, isVideo: /\.(mp4|webm|ogg|mov)(\?|$)/i.test(item.url||"") })),
    ...newLed.map(item  => ({ url: item._blobUrl, isVideo: item.file.type.startsWith("video") }))
  ];

  let globalIdx = 0;

  const parts = [
    ...existingLed.map((item, i) => {
      const idx     = globalIdx++;
      const isVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(item.url || "");
      const media   = isVideo
        ? `<video src="${esc(item.url)}" controls></video>`
        : `<img src="${esc(item.url)}" alt="${esc(item.name||"")}" onclick="openLightbox('led',${idx})">`;
      return `<div class="led-item-card">
        <div class="led-preview-media">${media}</div>
        <div class="led-meta-row">
          <span class="led-name">${esc(item.name||"Bulletin media")}</span>
          <button type="button" class="small-btn danger-btn" onclick="existingLed.splice(${i},1);renderLed()"><i class="bi bi-trash"></i> Remove</button>
        </div>
      </div>`;
    }),
    ...newLed.map((item, i) => {
      const idx     = globalIdx++;
      const isVideo = item.file.type.startsWith("video");
      const media   = isVideo
        ? `<video src="${item._blobUrl}" controls></video>`
        : `<img src="${item._blobUrl}" alt="${esc(item.file.name)}" onclick="openLightbox('led',${idx})">`;
      return `<div class="led-item-card">
        <div class="led-preview-media">${media}</div>
        <div class="led-meta-row">
          <span class="led-name">${esc(item.file.name)}</span>
          <button type="button" class="small-btn danger-btn" onclick="newLed.splice(${i},1);renderLed()"><i class="bi bi-trash"></i> Remove</button>
        </div>
      </div>`;
    })
  ];

  wrap.innerHTML = parts.length
    ? parts.join("")
    : `<div class="empty-box"><i class="bi bi-display"></i><span>No bulletin media yet</span></div>`;
}
function initLed() {
  $("ledMediaInput")?.addEventListener("change",e=>{
    Array.from(e.target.files||[]).forEach(f=>newLed.push({file:f,duration:7000}));
    e.target.value=""; renderLed();
  });
  $("saveLedBtn")?.addEventListener("click", async ()=>{
    setStatus("ledStatus","Saving…");
    try {
      const fd=new FormData();
      fd.append("keep_existing_items",JSON.stringify(existingLed.map(x=>x.id)));
      const dur={}; existingLed.forEach(x=>{dur[x.id]=Math.max(5000,+(x.duration||7000));});
      fd.append("durations",JSON.stringify(dur));
      newLed.forEach(item=>{ fd.append("led_media",item.file); fd.append(`duration_new_${item.file.name}`,String(Math.max(5000,+(item.duration||7000)))); });
      const res=await fetch("/api/resources/hero-slider",{method:"POST",body:fd});
      const r=await res.json();
      if(!r.success) throw new Error(r.error||"Failed.");
      existingLed=arr(r.data?.items); newLed=[]; renderLed();
      setStatus("ledStatus","LED saved.");
    } catch(e){setStatus("ledStatus",e.message||"Error.",true);}
  });
}
async function loadLed() {
  try {
    const res=await fetch(`/api/resources?t=${Date.now()}`,{cache:"no-store"});
    const r=await res.json();
    if(!r.success) return;
    existingLed=arr(r.data?.hero_slider?.items); renderLed();
  } catch {}
}

/* ═══════════════════════════════════════════════════
   FAQ NOTIFICATION POLLING
═══════════════════════════════════════════════════ */
let lastFaqCount = 0;

async function pollFaqNotifications() {
  try {
    const res    = await fetch(`/api/faq-insights?t=${Date.now()}`,{cache:"no-store"});
    const result = await res.json().catch(()=>({}));
    if (!res.ok||!result.success) return;
    const pending = arr(result.data?.new_questions).length;
    updateFaqBadges(pending);
    if (pending > 0 && pending !== lastFaqCount) showFaqBanner(pending);
    lastFaqCount = pending;
  } catch {}
}

function updateFaqBadges(count) {
  const badge   = $("faqBadge");
  const mini    = $("faqMiniBadge");
  const title   = $("faqTitleBadge");
  const tabBadge= $("tabBadgePending");
  const pending  = $("metricFaqPending");

  if (badge)    { badge.hidden    = count===0; badge.textContent = count>99?"99+":String(count); }
  if (mini)     { mini.hidden     = count===0; mini.textContent  = count>99?"99+":String(count); }
  if (title)    { title.hidden    = count===0; title.textContent = `${count} new`; }
  if (tabBadge) { tabBadge.hidden = count===0; tabBadge.textContent = String(count); }
  if (pending)  pending.textContent = String(count);
}

function showFaqBanner(count) {
  const banner = $("faqNotifBanner"); if (!banner) return;
  const text   = $("faqNotifText");
  if (text) text.textContent = `${count} new question${count===1?"":"s"} waiting for review!`;
  banner.hidden = false;
}

$("closeFaqBannerBtn")?.addEventListener("click",()=>{ const b=$("faqNotifBanner"); if(b) b.hidden=true; });
$("viewPendingFaqsBtn")?.addEventListener("click",()=>{
  const b=$("faqNotifBanner"); if(b) b.hidden=true;
  document.querySelectorAll(".faq-rec-tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".faq-rec-panel").forEach(p=>p.classList.remove("active"));
  document.querySelector('[data-faq-tab="pending"]')?.classList.add("active");
  $("faq-rec-pending")?.classList.add("active");
  $("faqSortRow") && ($("faqSortRow").hidden=true);
});

/* ═══════════════════════════════════════════════════
   FAQ KEYWORD GROUPING (for Related Groups view)
═══════════════════════════════════════════════════ */
const STOP_WORDS = new Set(["the","a","an","is","are","was","were","do","does","did","can","could",
  "will","would","should","may","might","how","what","when","where","who","why","which","to","of",
  "in","on","at","for","with","about","and","or","but","if","i","you","my","your","we","our",
  "they","their","it","its","be","have","has","had","am","been","being","get","got","please",
  "tell","me","us","this","that","these","those","not","no","than","then","there","here"]);

function keywords(text) {
  return String(text||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/)
    .filter(w=>w.length>2&&!STOP_WORDS.has(w));
}

function groupByKeywords(faqs) {
  const groups=[], assigned=new Set();
  faqs.forEach((faq,i)=>{
    if(assigned.has(i)) return;
    const kw=new Set(keywords(faq.question));
    const grp={label:faq.question, members:[faq]};
    assigned.add(i);
    faqs.forEach((other,j)=>{
      if(i===j||assigned.has(j)) return;
      const shared=keywords(other.question).filter(k=>kw.has(k));
      if(shared.length>=2){ grp.members.push(other); assigned.add(j); }
    });
    groups.push(grp);
  });
  groups.sort((a,b)=>{
    const sa=a.members.reduce((s,m)=>s+(m.count||0),0);
    const sb=b.members.reduce((s,m)=>s+(m.count||0),0);
    return sb-sa;
  });
  return groups;
}

/* ═══════════════════════════════════════════════════
   FAQ RECORDS RENDERING
═══════════════════════════════════════════════════ */
let currentSort    = "count";
let faqSearchQuery = "";
let faqDataCache   = { pending:[], approved:[], all:[] };
let selectedPendingIds = new Set();
let pendingSelectMode  = false;

function faqCardHtml(item, opts={}) {
  const { showApproveBtn=false, showActions=true } = opts;
  const id       = esc(String(item.id||""));
  const question = item.question||"Untitled";
  const answer   = item.answer||"";
  const count    = Number(item.count||0);
  const status   = item.status||"approved";
  const date     = item.updated_at||item.created_at||"";
  const isSelected = pendingSelectMode && selectedPendingIds.has(String(item.id||""));
  const checkboxHtml = (showApproveBtn && pendingSelectMode)
    ? `<label class="faq-select-label" title="Select for deletion">
        <input type="checkbox" class="faq-select-cb" data-faq-id="${id}" ${isSelected?"checked":""}
          onchange="faqToggleSelect('${id}', this.checked)"/>
       </label>`
    : "";
  return `
  <article class="faq-card${isSelected?" faq-card-selected":""}" data-faq-id="${id}">
    <div class="faq-card-head">
      ${checkboxHtml}
      <h4 class="faq-question">${esc(question)}</h4>
    </div>
    ${answer?`<p class="faq-answer">${esc(answer)}</p>`:""}
    <div class="faq-meta">
      <span class="faq-count-badge"><i class="bi bi-chat-dots"></i> ${count} asked</span>
      <span class="faq-status-badge status-${esc(status)}">${esc(status)}</span>
      <span style="font-size:11px;color:var(--muted-2);">${esc(fmtDate(date))}</span>
    </div>
    ${showActions?`
    <div class="faq-card-actions">
      ${showApproveBtn?`<button type="button" class="small-btn primary-btn" onclick="faqApprove('${id}')"><i class="bi bi-check2-circle"></i> Approve</button>`:""}
      <button type="button" class="small-btn" onclick="faqToggleEdit('${id}')"><i class="bi bi-pencil-fill"></i> Edit</button>
      <button type="button" class="small-btn danger-btn" onclick="faqDelete('${id}')"><i class="bi bi-trash-fill"></i> Delete</button>
    </div>
    <div class="faq-inline-form" id="faqEditForm-${id}" style="display:none;">
      <div class="field-block"><label class="field-label">Question</label><input class="field-input" id="faqQ-${id}" type="text" value="${esc(question)}"/></div>
      <div class="field-block"><label class="field-label">Answer</label><textarea class="field-textarea" id="faqA-${id}">${esc(answer)}</textarea></div>
      <div class="action-row">
        <button type="button" class="primary-btn" onclick="faqSave('${id}')"><i class="bi bi-save2-fill"></i> Save</button>
        <button type="button" class="ghost-btn"   onclick="faqToggleEdit('${id}')">Cancel</button>
      </div>
      <div class="status-line" id="faqEditStatus-${id}"></div>
    </div>`:""}
  </article>`;
}

function applySearch(items) {
  if (!faqSearchQuery) return items;
  const q = faqSearchQuery.toLowerCase();
  return items.filter(item =>
    (item.question||"").toLowerCase().includes(q) ||
    (item.answer||"").toLowerCase().includes(q)
  );
}

function updatePendingToolbar(total) {
  const entryBtn  = $("pendingSelectEntry");
  const toolbar   = $("pendingSelectToolbar");
  const selectAll = $("pendingSelectAll");
  const info      = $("pendingSelectionInfo");
  const countEl   = $("pendingDeleteCount");
  const deleteBtn = $("pendingDeleteSelectedBtn");
  const n         = selectedPendingIds.size;

  // Entry button: show when there are items and NOT in select mode
  if (entryBtn) entryBtn.hidden = (total === 0 || pendingSelectMode);
  // Toolbar: show only in select mode with items
  if (toolbar)  toolbar.hidden  = (!pendingSelectMode || total === 0);

  if (info)    info.textContent = n === 0 ? "0 selected" : `${n} of ${total} selected`;
  if (countEl) countEl.textContent = String(n);
  if (deleteBtn) deleteBtn.disabled = (n === 0);
  if (selectAll) {
    selectAll.checked       = total > 0 && n === total;
    selectAll.indeterminate = n > 0 && n < total;
  }
}

function renderPending(items) {
  const wrap=$("pendingFaqList"); if(!wrap) return;
  const filtered=applySearch(items);

  // Clear stale selections that no longer exist in the filtered set
  const filteredIds = new Set(filtered.map(i=>String(i.id||"")));
  for (const id of [...selectedPendingIds]) {
    if (!filteredIds.has(id)) selectedPendingIds.delete(id);
  }

  if(!filtered.length){
    updatePendingToolbar(0);
    wrap.innerHTML=faqSearchQuery
      ? `<div class="empty-box large-empty"><i class="bi bi-search"></i><span>No pending questions match "<strong>${esc(faqSearchQuery)}</strong>"</span></div>`
      : `<div class="empty-box large-empty"><i class="bi bi-inbox"></i><span>No pending questions — great job!</span></div>`;
    return;
  }
  wrap.innerHTML=filtered.map(item=>faqCardHtml(item,{showApproveBtn:true,showActions:true})).join("");
  updatePendingToolbar(filtered.length);
}

function renderApproved(items) {
  const wrap=$("approvedFaqList"); if(!wrap) return;
  const filtered=applySearch(items);
  if(!filtered.length){
    wrap.innerHTML=faqSearchQuery
      ? `<div class="empty-box large-empty"><i class="bi bi-search"></i><span>No approved FAQs match "<strong>${esc(faqSearchQuery)}</strong>"</span></div>`
      : `<div class="empty-box large-empty"><i class="bi bi-check-circle"></i><span>No approved FAQs yet. Add one above!</span></div>`;
    return;
  }
  let sorted=[...filtered];
  if(currentSort==="count") sorted.sort((a,b)=>(b.count||0)-(a.count||0));
  else if(currentSort==="alpha") sorted.sort((a,b)=>(a.question||"").localeCompare(b.question||""));

  if(currentSort==="grouped") {
    const groups=groupByKeywords(sorted);
    wrap.innerHTML=groups.map(grp=>{
      const heading = grp.members.length>1
        ? `<div class="faq-group-heading"><i class="bi bi-collection"></i><span>${esc(keywords(grp.label).slice(0,3).join(", ")||"Related Questions")}</span><span class="faq-group-count">${grp.members.length}</span></div>`
        : "";
      return heading + grp.members.map(item=>faqCardHtml(item,{showApproveBtn:false,showActions:true})).join("");
    }).join("");
  } else {
    wrap.innerHTML=sorted.map(item=>faqCardHtml(item,{showApproveBtn:false,showActions:true})).join("");
  }
}

function renderAll(items) {
  const wrap=$("allFaqRecordsList"); if(!wrap) return;
  const filtered=applySearch(items);
  if(!filtered.length){
    wrap.innerHTML=faqSearchQuery
      ? `<div class="empty-box large-empty"><i class="bi bi-search"></i><span>No records match "<strong>${esc(faqSearchQuery)}</strong>"</span></div>`
      : `<div class="empty-box large-empty"><i class="bi bi-list-ul"></i><span>No records yet.</span></div>`;
    return;
  }
  const sorted=[...filtered].sort((a,b)=>(b.count||0)-(a.count||0));
  wrap.innerHTML=sorted.map(item=>faqCardHtml(item,{showApproveBtn:false,showActions:false})).join("");
}

/* ── FAQ ACTIONS ── */
window.faqToggleEdit = function(id) {
  const form=$(`faqEditForm-${id}`); if(!form) return;
  form.style.display = form.style.display==="none" ? "grid" : "none";
};

window.faqApprove = async function(id) {
  try {
    const res=await fetch(`/api/faq-insights/${encodeURIComponent(id)}/approve`,{method:"POST",headers:{"Content-Type":"application/json"}});
    const r=await res.json().catch(()=>({}));
    if(!res.ok||!r.success) throw new Error(r.error||"Failed to approve.");
    await loadFaqRecords();
  } catch(e){alert(e.message||"Failed.");}
};

window.faqSave = async function(id) {
  setStatus(`faqEditStatus-${id}`,"Saving…");
  try {
    const q=$(`faqQ-${id}`)?.value||"";
    const a=$(`faqA-${id}`)?.value||"";
    const res=await fetch(`/api/faq-insights/${encodeURIComponent(id)}`,{
      method:"PUT", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({question:q,answer:a,approve:true})
    });
    const r=await res.json().catch(()=>({}));
    if(!res.ok||!r.success) throw new Error(r.error||"Failed to save.");
    setStatus(`faqEditStatus-${id}`,"Saved!");
    await loadFaqRecords();
  } catch(e){setStatus(`faqEditStatus-${id}`,e.message||"Error.",true);}
};

window.faqDelete = async function(id) {
  if(!confirm("Delete this FAQ permanently?")) return;
  try {
    const res=await fetch(`/api/faq-insights/${encodeURIComponent(id)}`,{method:"DELETE"});
    const r=await res.json().catch(()=>({}));
    if(!res.ok||!r.success) throw new Error(r.error||"Failed.");
    selectedPendingIds.delete(String(id));
    await loadFaqRecords();
  } catch(e){alert(e.message||"Failed.");}
};

/* ── PENDING SELECTION ── */
window.faqToggleSelect = function(id, checked) {
  if (checked) selectedPendingIds.add(String(id));
  else         selectedPendingIds.delete(String(id));
  // Sync card highlight
  const card = document.querySelector(`.faq-card[data-faq-id="${CSS.escape(id)}"]`);
  if (card) card.classList.toggle("faq-card-selected", checked);
  // Count visible pending items for toolbar
  const total = document.querySelectorAll("#pendingFaqList .faq-card").length;
  updatePendingToolbar(total);
};

/* ── ADD NEW FAQ ── */
$("addNewFaqBtn")?.addEventListener("click",()=>{
  const card=$("addFaqFormCard"); if(!card) return;
  card.hidden=!card.hidden;
  if(!card.hidden) card.scrollIntoView({behavior:"smooth",block:"nearest"});
});
$("cancelAddFaqBtn")?.addEventListener("click",()=>{ const c=$("addFaqFormCard"); if(c) c.hidden=true; });
$("submitNewFaqBtn")?.addEventListener("click", async ()=>{
  const q=$("newFaqQuestion")?.value.trim()||"";
  const a=$("newFaqAnswer")?.value.trim()||"";
  const sid="newFaqStatus";
  if(!q){ setStatus(sid,"Please enter a question.",true); return; }
  if(!a){ setStatus(sid,"Please enter an answer.",true); return; }
  setStatus(sid,"Saving…");
  try {
    // Try creating via FAQ insights endpoint
    const res=await fetch("/api/faq-insights",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({question:q,answer:a,status:"approved"})
    });
    const r=await res.json().catch(()=>({}));
    if(!res.ok||!r.success) throw new Error(r.error||"Failed to create FAQ.");
    setStatus(sid,"FAQ saved and published to chatbot!");
    const nq=$("newFaqQuestion"); if(nq) nq.value="";
    const na=$("newFaqAnswer");   if(na) na.value="";
    const card=$("addFaqFormCard"); if(card) card.hidden=true;
    await loadFaqRecords();
  } catch(e){ setStatus(sid,e.message||"Error.",true); }
});

/* ── LOAD FAQ RECORDS ── */
async function loadFaqRecords() {
  // Show loading in active panel
  ["pendingFaqList","approvedFaqList","allFaqRecordsList"].forEach(id=>{
    const el=$(id); if(el) el.innerHTML=`<div class="empty-box"><i class="bi bi-arrow-repeat"></i><span>Loading…</span></div>`;
  });
  try {
    const res    = await fetch(`/api/faq-insights?t=${Date.now()}`,{cache:"no-store"});
    const result = await res.json().catch(()=>({}));
    if (!res.ok||!result.success) throw new Error(result.error||"Failed to load FAQs.");

    const data = result.data || {};
    const pending  = arr(data.new_questions);
    const approved = arr(data.top_faqs);
    const all      = arr(data.all_questions);

    faqDataCache = { pending, approved, all };

    // Stats
    const sa=$("faqStatApproved"); if(sa) sa.textContent=String(approved.length);
    const sn=$("faqStatNew");      if(sn) sn.textContent=String(pending.length);
    const st=$("faqStatTotal");    if(st) st.textContent=String(all.length);
    const ma=$("metricFaqApproved"); if(ma) ma.textContent=String(approved.length);

    updateFaqBadges(pending.length);
    if(pending.length>0&&pending.length!==lastFaqCount) showFaqBanner(pending.length);
    lastFaqCount=pending.length;

    renderPending(pending);
    renderApproved(approved);
    renderAll(all);
  } catch(e) {
    const msg=`<div class="empty-box large-empty"><i class="bi bi-exclamation-circle"></i><span>${esc(e.message||"Failed to load.")}</span></div>`;
    const pl=$("pendingFaqList");  if(pl) pl.innerHTML=msg;
    const al=$("approvedFaqList"); if(al) al.innerHTML=msg;
    const rll=$("allFaqRecordsList"); if(rll) rll.innerHTML=msg;
  }
}

/* ── FAQ TABS ── */
function initFaqRecTabs() {
  document.querySelectorAll(".faq-rec-tab").forEach(tab=>{
    tab.addEventListener("click",()=>{
      document.querySelectorAll(".faq-rec-tab").forEach(t=>t.classList.remove("active"));
      document.querySelectorAll(".faq-rec-panel").forEach(p=>p.classList.remove("active"));
      tab.classList.add("active");
      const key=tab.dataset.faqTab;
      $(`faq-rec-${key}`)?.classList.add("active");
      const sortRow=$("faqSortRow");
      if(sortRow) sortRow.hidden = (key!=="approved");
    });
  });

  // Sort chips
  document.querySelectorAll(".faq-sort-chip").forEach(chip=>{
    chip.addEventListener("click",()=>{
      document.querySelectorAll(".faq-sort-chip").forEach(c=>c.classList.remove("active"));
      chip.classList.add("active");
      currentSort=chip.dataset.sort;
      renderApproved(faqDataCache.approved);
    });
  });

  $("refreshFaqRecordsBtn")?.addEventListener("click", loadFaqRecords);

  // ── Enter / Exit Selection Mode ──
  function exitSelectMode() {
    pendingSelectMode = false;
    selectedPendingIds.clear();
    renderPending(faqDataCache.pending);
  }

  $("pendingEnterSelectBtn")?.addEventListener("click", () => {
    pendingSelectMode = true;
    renderPending(faqDataCache.pending);
  });

  $("pendingCancelSelectBtn")?.addEventListener("click", exitSelectMode);

  // ── Select All ──
  $("pendingSelectAll")?.addEventListener("change", function() {
    const cards = document.querySelectorAll("#pendingFaqList .faq-select-cb");
    cards.forEach(cb => {
      cb.checked = this.checked;
      const id = cb.dataset.faqId;
      if (this.checked) selectedPendingIds.add(id);
      else              selectedPendingIds.delete(id);
      const card = cb.closest(".faq-card");
      if (card) card.classList.toggle("faq-card-selected", this.checked);
    });
    updatePendingToolbar(cards.length);
  });

  // ── Delete Selected (open modal) ──
  $("pendingDeleteSelectedBtn")?.addEventListener("click", () => {
    const n = selectedPendingIds.size; if (!n) return;
    const countEl = $("deleteSelectedCount"); if(countEl) countEl.textContent = String(n);
    const plural  = $("deleteSelectedPlural"); if(plural) plural.textContent = n===1?"":"s";
    setStatus("deleteSelectedStatus","");
    openModal("modalDeleteSelected");
  });

  // Also exit select mode if the confirm modal is dismissed without deleting
  document.querySelectorAll('[data-modal-close="modalDeleteSelected"], #modalDeleteSelected').forEach(el => {
    el.addEventListener("click", e => {
      // only on the overlay click or close-btn, not bubbled from inside
      if (e.target === el || el.hasAttribute("data-modal-close")) {
        // don't exit select mode — let them pick more or cancel via toolbar
      }
    });
  });
  $("confirmDeleteSelectedBtn")?.addEventListener("click", async () => {
    const ids = [...selectedPendingIds]; if (!ids.length) return;
    const btn = $("confirmDeleteSelectedBtn");
    btn.disabled = true;
    btn.innerHTML = `<i class="bi bi-hourglass-split"></i> Deleting…`;
    setStatus("deleteSelectedStatus","Deleting…");
    try {
      const results = await Promise.allSettled(
        ids.map(id => fetch(`/api/faq-insights/${encodeURIComponent(id)}`,{method:"DELETE"})
          .then(r=>r.json().catch(()=>({success:false}))))
      );
      const failed = results.filter(r=>r.status==="rejected"||!r.value?.success).length;
      closeModal("modalDeleteSelected");
      exitSelectMode();
      await loadFaqRecords();
      if (failed) alert(`${failed} deletion(s) failed.`);
    } catch(e) {
      setStatus("deleteSelectedStatus","Bulk delete failed: "+e.message,true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="bi bi-trash-fill"></i> Yes, Delete All`;
    }
  });

  // ── FAQ Search ──
  const searchInput = $("faqSearchInput");
  const searchClear = $("faqSearchClear");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      faqSearchQuery = searchInput.value.trim();
      if (searchClear) searchClear.hidden = !faqSearchQuery;
      renderPending(faqDataCache.pending);
      renderApproved(faqDataCache.approved);
      renderAll(faqDataCache.all);
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      faqSearchQuery = "";
      searchClear.hidden = true;
      renderPending(faqDataCache.pending);
      renderApproved(faqDataCache.approved);
      renderAll(faqDataCache.all);
      searchInput?.focus();
    });
  }
}

/* ═══════════════════════════════════════════════════
   LIGHTBOX
═══════════════════════════════════════════════════ */
window.openLightbox = function(galleryId, index) {
  const items = galleries[galleryId];
  if (!items || !items.length) return;
  _lbGallery = items;
  _lbIndex   = Math.max(0, Math.min(index, items.length - 1));
  _renderLightbox();
  openModal("modalLightbox");
};

window.closeLightbox = function() {
  closeModal("modalLightbox");
};

window.lightboxNav = function(dir) {
  if (_lbGallery.length < 2) return;
  _lbIndex = (_lbIndex + dir + _lbGallery.length) % _lbGallery.length;
  _renderLightbox();
};

function _renderLightbox() {
  const mediaEl   = $("lightboxMedia");
  const counterEl = $("lightboxCounter");
  const prevBtn   = $("lightboxPrev");
  const nextBtn   = $("lightboxNext");
  if (!mediaEl) return;

  const item    = _lbGallery[_lbIndex] || {};
  const url     = item.url     || "";
  const isVideo = item.isVideo || false;

  mediaEl.innerHTML = isVideo
    ? `<video src="${esc(url)}" controls autoplay></video>`
    : `<img src="${esc(url)}" alt="">`;

  const multi = _lbGallery.length > 1;
  if (prevBtn)   prevBtn.hidden   = !multi;
  if (nextBtn)   nextBtn.hidden   = !multi;
  if (counterEl) counterEl.textContent = multi ? `${_lbIndex + 1} / ${_lbGallery.length}` : "";
}

function initLightbox() {
  // Arrow-key navigation when lightbox is open
  document.addEventListener("keydown", e => {
    if (!$("modalLightbox")?.classList.contains("open")) return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); lightboxNav(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); lightboxNav(1);  }
  });
}

/* ═══════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════ */
function boot() {
  initModals();
  initInactivity();
  initHeaderScroll();
  initSettingsDropdown();
  initEditorTabs();
  initRoleSegment();
  initPostType();
  initAttachments();
  initPreview();
  initLed();
  initFaqRecTabs();
  initDeletePost();
  initLightbox();

  // Action buttons
  $("publishPostBtn")    ?.addEventListener("click",publishPost);
  $("clearComposerBtn")  ?.addEventListener("click",clearComposer);
  $("saveAboutBtn")      ?.addEventListener("click",saveAbout);
  $("saveContactBtn")    ?.addEventListener("click",saveContact);
  $("refreshAdminBtn")   ?.addEventListener("click",async()=>{ await loadPublishedPosts(); await loadLed(); await loadFaqRecords(); });

  // Initial data load
  loadPublishedPosts();
  loadLed();
  loadAboutContact();
  loadFaqRecords();

  // Poll FAQ notifications every 60 seconds
  setInterval(pollFaqNotifications, 60_000);

  // Initial renders
  renderSelectedFiles();
  renderPreviewMedia();
  updateAttachMeta();
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", boot)
  : boot();

})();