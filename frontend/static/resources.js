/* resources.js */

let resourcesCache = window.resourcesBootstrap || {};
let heroLedTimer   = null;
let heroLedIndex   = 0;

// ── ANNOUNCEMENT LIVE-SYNC ────────
const ANNOUNCEMENT_NOTIFY_KEY = "uniwiseNewAnnouncement_v1";
let _lastAnnouncementSignature = null;   // null = first load, don't broadcast yet
let _lastPostsSignature        = null;   // skip re-render if posts unchanged

function _getPostsSignature(posts = []) {
  if (!Array.isArray(posts)) return "";
  return posts.map(p => [
    p.title, p.body || p.content || p.text,
    p.date || p.created_at || p.timestamp,
    p.poster_role || p.author,
    (p.attachments || []).map(a => a.url).join(",")
  ].join("|")).join("||");
}

function _getAnnouncementSignature(d = {}) {
  const a = d.announcement || {};
  return `${a.title || ""}|||${a.body || ""}|||${a.extra || ""}`;
}

function _broadcastNewAnnouncement(announcement = {}) {
  const payload = JSON.stringify({ ts: Date.now(), announcement });
  try { localStorage.setItem(ANNOUNCEMENT_NOTIFY_KEY, payload); } catch (e) {}
  try {
    const ch = new BroadcastChannel("uniwise_announcements");
    ch.postMessage({ type: "new_announcement", announcement });
    ch.close();
  } catch (e) {}
}
// ────────────────────────────────────────────────────────────────────────

/* Lightbox carousel state */
let lbItems = [];
let lbIndex = 0;

function $(id){ return document.getElementById(id); }

function escapeHtml(v=""){
  return String(v)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function goHome()    { window.location.href = "/" }
function goSettings(){ window.location.href = "/settings" }
function goAdmin()    { window.location.href = "/login" }
function goLogout()   { window.location.href = "/logout" }
function goAbout()    { window.location.href = "/about" }
function goContact()  { window.location.href = "/contact" }
function goHelp()     { window.location.href = "/help" }
function goPrivacy()  { window.location.href = "/privacy" }
function goTerms()    { window.location.href = "/terms" }
function goHelpTopic(t){ window.location.href = "/help?topic="+encodeURIComponent(t) }
function goHelpSearch(q){ window.location.href = "/help?q="+encodeURIComponent(q) }
function goHelpSearchTopic(t,q){ window.location.href = "/help?topic="+encodeURIComponent(t)+"&q="+encodeURIComponent(q) }
function openFullMap(){
  const url = window.resourcesConfig?.schoolGoogleMapsSearch;
  if(url) window.open(url,"_blank","noopener,noreferrer");
}

/* ──────── Attachment helpers ──────── */
function isImage(it){ const t=(it?.type||it?.name||it?.url||"").toLowerCase(); return t.includes("image")||/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(t) }
function isVideo(it){ const t=(it?.type||it?.name||it?.url||"").toLowerCase(); return t.includes("video")||/\.(mp4|webm|mov|m4v)$/i.test(t) }
function attType(it){ if(isImage(it))return"image"; if(isVideo(it))return"video"; return"file" }
function attsOf(p)  { return Array.isArray(p?.attachments)?p.attachments:[] }
function fmtDate(d) { return d || "Recently posted" }
function postLabel(t){
  const c=String(t||"upload").toLowerCase();
  return c.charAt(0).toUpperCase()+c.slice(1);
}

/* ──────── media block ──────── */
function buildFbMedia(attachments=[], postKey=""){
  if(!attachments.length) return "";
  const images = attachments.filter(a=>attType(a)==="image");
  const videos = attachments.filter(a=>attType(a)==="video");
  const files  = attachments.filter(a=>attType(a)==="file");
  let html = "";

  if(images.length){
    const n = images.length;
    let cls = "imgs-1";
    if(n===2) cls="imgs-2";
    else if(n===3) cls="imgs-3";
    else if(n===4) cls="imgs-4";
    else if(n>=5) cls="imgs-5plus";

    const visible  = n>5 ? images.slice(0,5) : images;
    const overflow = n>5 ? n-5 : 0;
    const galleryKey = postKey+"::imgs";

    html += `<div class="fb-images ${cls}" data-gallery="${escapeHtml(galleryKey)}">`;
    visible.forEach((it,i)=>{
      const url  = escapeHtml(it.url||"");
      const name = escapeHtml(it.name||"image");
      const showMore = (overflow>0 && i===visible.length-1);
      html += `
        <div class="fb-img" data-index="${i}">
          <img src="${url}" alt="${name}" loading="lazy" decoding="async">
          ${showMore?`<div class="fb-img-more">+${overflow}</div>`:""}
        </div>`;
    });
    html += `</div>`;

    window.__fbGalleries = window.__fbGalleries || {};
    window.__fbGalleries[galleryKey] = images.map(it=>({
      type:"image", url:it.url||"", name:it.name||"image"
    }));
  }

  if(videos.length){
    videos.forEach(it=>{
      html += `<div class="fb-video"><video src="${escapeHtml(it.url||"")}" controls preload="metadata"></video></div>`;
    });
  }

  if(files.length){
    html += `<div class="fb-files">`;
    files.forEach(it=>{
      html += `
        <a href="${escapeHtml(it.url||"#")}" class="fb-file" target="_blank" rel="noopener noreferrer">
          <div class="fb-file-left">
            <div class="fb-file-icon"><i class="bi bi-file-earmark-text-fill"></i></div>
            <div>
              <div class="fb-file-name">${escapeHtml(it.name||"Attachment")}</div>
              <div class="fb-file-sub">Open attached file</div>
            </div>
          </div>
          <i class="bi bi-arrow-up-right fb-file-go"></i>
        </a>`;
    });
    html += `</div>`;
  }
  return html;
}

/* ──────── Hero LED slider ──────── */
function getLedItems(d={}){
  const s = d.hero_slider || {};
  const items = Array.isArray(s.items)?s.items:[];
  return items.filter(i=>i&&i.url&&i.active!==false);
}
function buildLedSlides(items=[]){
  const el = $("heroLedBg"); if(!el) return;
  if(!items.length){
    el.innerHTML = `<div class="hero-led-empty"><i class="bi bi-image-alt"></i><span>No LED media yet.</span></div>`;
    buildLedDots(items);
    return;
  }
  el.innerHTML = items.map((it,i)=>{
    const t = String(it.type||"").toLowerCase();
    if(t==="video"){
      return `<div class="hero-led-slide ${i===0?"active":""}"><video src="${escapeHtml(it.url)}" autoplay muted loop playsinline preload="metadata"></video></div>`;
    }
    return `<div class="hero-led-slide ${i===0?"active":""}"><img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.name||"LED media")}"></div>`;
  }).join("");
  buildLedDots(items);
}
function buildLedDots(items){
  const dotsEl = $("ledDots");
  if(!dotsEl) return;
  if(!items.length){ dotsEl.innerHTML = ""; return; }
  dotsEl.innerHTML = items.map((_,i)=>
    `<span class="led-dot ${i===0?'active':''}" data-index="${i}"></span>`
  ).join("");
  // Bind click handlers
  dotsEl.querySelectorAll(".led-dot").forEach(dot=>{
    dot.addEventListener("click", ()=>{
      const idx = parseInt(dot.dataset.index, 10);
      goToLedSlide(idx);
    });
  });
}
function goToLedSlide(index){
  const slides = document.querySelectorAll(".hero-led-slide");
  const dots   = document.querySelectorAll(".led-dot");
  if(!slides.length) return;
  slides.forEach(s=>s.classList.remove("active"));
  dots.forEach(d=>d.classList.remove("active"));
  heroLedIndex = ((index % slides.length) + slides.length) % slides.length;
  slides[heroLedIndex]?.classList.add("active");
  dots[heroLedIndex]?.classList.add("active");
  // Reset timer
  if(heroLedTimer){ clearTimeout(heroLedTimer); heroLedTimer = null; }
  const items = getLedItems(resourcesCache);
  if(items.length > 1){
    const dur = Number(items[heroLedIndex]?.duration||7000);
    heroLedTimer = setTimeout(nextLedSlide, Math.max(5000, dur));
  }
}
function nextLedSlide(){
  const items = getLedItems(resourcesCache);
  if(items.length <= 1) return;
  goToLedSlide(heroLedIndex + 1);
}
function prevLedSlide(){
  const items = getLedItems(resourcesCache);
  if(items.length <= 1) return;
  goToLedSlide(heroLedIndex - 1);
}
function startLed(d={}){
  const items = getLedItems(d);
  buildLedSlides(items);
  if(heroLedTimer){ clearTimeout(heroLedTimer); heroLedTimer = null; }
  if(items.length<=1) return;
  heroLedIndex = 0;
  const dur = Number(items[0]?.duration||7000);
  heroLedTimer = setTimeout(nextLedSlide, Math.max(5000, dur));
}

/* ──────── Renderers ──────── */
function renderAnnouncement(a={}){
  const t=$("announcementTitle"), b=$("announcementBody"), e=$("announcementExtra"), au=$("announcementAuthor");
  if(t) t.textContent = a.title?.trim() || "No announcement title yet";
  if(b) b.textContent = a.body?.trim()  || "Your latest announcement will appear here.";
  if(au) au.textContent = a.poster_role?.trim() || a.author?.trim() || "Campers' Admin";
  if(e){
    const x = a.extra?.trim()||"";
    e.textContent = x;
    e.style.display = x?"block":"none";
  }
}
function renderAbout(ab={}){
  const t=$("aboutTitle"),a=$("aboutText1"),b=$("aboutText2");
  if(t) t.textContent = ab.title?.trim() || "Your AI School Assistant";
  if(a) a.textContent = ab.text1?.trim() || "UniWise is an AI-powered school assistant designed to help students get accurate answers quickly and conveniently.";
  if(b) b.textContent = ab.text2?.trim() || "It can assist with frequently asked questions about admission requirements, class schedules, office contacts, school announcements, campus updates, and location guidance around the school.";
}
function renderAboutSchool(s={}){
  const t=$("aboutSchoolTitle"),a=$("aboutSchoolText1"),b=$("aboutSchoolText2");
  if(t && s.title) t.innerHTML = s.title;
  if(a && s.text1) a.textContent = s.text1;
  if(b && s.text2) b.textContent = s.text2;

  const sd=$("schoolShortDesc"),sm=$("schoolMission"),sv=$("schoolVision"),sx=$("schoolExternalContext");
  if(sd && s.short_desc)        sd.textContent = s.short_desc;
  if(sm && s.mission)           sm.textContent = s.mission;
  if(sv && s.vision)            sv.textContent = s.vision;
  if(sx && s.external_context)  sx.textContent = s.external_context;
}
function renderContacts(c={}){
  const list=$("contactList"); if(!list) return;
  const rows=[];
  if(c.phone)    rows.push(`<div class="contact-row"><span class="contact-label">Phone</span><div class="contact-value">${escapeHtml(c.phone)}</div></div>`);
  if(c.email)    rows.push(`<div class="contact-row"><span class="contact-label">Email</span><div class="contact-value">${escapeHtml(c.email)}</div></div>`);
  if(c.location) rows.push(`<div class="contact-row"><span class="contact-label">Location</span><div class="contact-value">${escapeHtml(c.location)}</div></div>`);
  list.innerHTML = rows.length ? rows.join("") :
    `<div class="contact-row"><span class="contact-label">Phone</span><div class="contact-value">No contact information yet.</div></div>`;
}
function renderEmergency(list=[]){}
function renderLinks(l={}){
  const el=$("officialLinksList"); if(!el) return;
  const items=[];
  if(l.website){
    items.push(`<a href="${escapeHtml(l.website)}" class="official-link" target="_blank" rel="noopener noreferrer">
      <div class="official-link-left">
        <div class="official-link-icon"><i class="bi bi-globe2"></i></div>
        <div><strong>Main Website</strong><span>Visit the official school website</span></div>
      </div>
      <i class="bi bi-arrow-up-right"></i></a>`);
  }
  if(l.facebook){
    items.push(`<a href="${escapeHtml(l.facebook)}" class="official-link" target="_blank" rel="noopener noreferrer">
      <div class="official-link-left">
        <div class="official-link-icon"><i class="bi bi-facebook"></i></div>
        <div><strong>Facebook Page</strong><span>Latest public announcements and events</span></div>
      </div>
      <i class="bi bi-arrow-up-right"></i></a>`);
  }
  el.innerHTML = items.length ? items.join("") :
    `<div class="empty-box compact-empty"><i class="bi bi-link-45deg"></i><span>No official links yet.</span></div>`;
}
function renderPosts(posts=[]){
  const feed = $("publishedPostsList");
  if(!feed) return;

  // Skip full DOM rebuild if content hasn't actually changed
  const sig = _getPostsSignature(posts);
  if(sig === _lastPostsSignature) return;
  _lastPostsSignature = sig;

  const valid = Array.isArray(posts) ? posts.filter(p=>p) : [];
  if(!valid.length){
    feed.innerHTML = `
      <div class="empty-box large-empty">
        <i class="bi bi-stickies"></i>
        <span>No published posts yet.</span>
      </div>`;
    return;
  }
  feed.innerHTML = valid.map((p,i)=>{
    const key  = `post_${i}`;
    const atts = attsOf(p);
    const mediaHtml = buildFbMedia(atts, key);
    const dateStr   = fmtDate(p.date||p.created_at||p.timestamp||"");
    const label     = postLabel(p.type||p.category||"post");
    const title     = (p.title||"").trim();
    const body      = (p.body||p.content||p.text||"").trim();
    return `
      <article class="fb-post reveal">
        <header class="fb-post-head">
          <div class="fb-avatar">
            <img src="/static/uniwiselogo%26text.png" alt="UniWise" loading="lazy" decoding="async">
          </div>
          <div class="fb-meta">
            <div class="fb-author-row">
              <span class="fb-author">${escapeHtml(p.poster_role||p.author||"Campers' Admin")}</span>
              <span class="fb-verified" title="Verified"><i class="bi bi-patch-check-fill"></i></span>
            </div>
            <div class="fb-time">
              <i class="bi bi-clock"></i> ${escapeHtml(dateStr)}
            </div>
          </div>
          <span class="fb-chip"><i class="bi bi-file-text"></i> ${escapeHtml(label)}</span>
        </header>
        <div class="fb-body">
          ${title ? `<h3 class="fb-title">${escapeHtml(title)}</h3>` : ""}
          ${body  ? `<div class="fb-text">${escapeHtml(body)}</div>`  : ""}
        </div>
        ${mediaHtml}
      </article>`;
  }).join("");
  // Batch all stagger writes first (style), then a single rAF to flip visibility
  const postEls = Array.from(feed.querySelectorAll(".fb-post"));
  postEls.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i * 0.08, 0.4)}s`;
  });
  requestAnimationFrame(() => {
    postEls.forEach(el => el.classList.add("is-visible"));
  });
}function renderSchoolMap(s={}){
  const embed = s.map_embed || window.resourcesConfig?.schoolMapEmbed || "";
  const dest  = s.name     || window.resourcesConfig?.schoolName     || "";
  if(embed){ const m=$("miniMapFrame"); if(m) m.src = embed; }
  const d=$("travelDestination"); if(d) d.textContent = dest;
}

function renderResources(d={}){
  renderAnnouncement(d.announcement||{});
  renderAbout(d.about||{});
  renderAboutSchool(d.school_about||d.school||{});
  renderContacts(d.contact||{});
  renderLinks(d.links||{});
  renderPosts(d.posts||[]);
  startLed(d);
  renderSchoolMap(d.school||{});
}

async function loadResources(){
  try{
    const r = await fetch(`/api/resources?t=${Date.now()}`,{cache:"no-store"});
    const j = await r.json();
    if(!j.success) return;
    const newData = j.data || {};
    const newSig  = _getAnnouncementSignature(newData);

    if (_lastAnnouncementSignature !== null && _lastAnnouncementSignature !== newSig) {
      _broadcastNewAnnouncement(newData.announcement || {});
    }
    _lastAnnouncementSignature = newSig;

    resourcesCache = newData;
    renderResources(resourcesCache);
  }catch(e){ console.error("Failed to load resources:",e); }
}

// Poll every 30 s so the resources page itself stays fresh
// and the chat page receives the broadcast promptly.
setInterval(loadResources, 30_000);

/* ──────── Top nav smooth scroll + active spy ──────── */
function bindQuickNav(){
  document.querySelectorAll(".quick-nav-card").forEach(link=>{
    link.addEventListener("click",e=>{
      const href = link.getAttribute("href");
      if(!href||!href.startsWith("#")) return;
      const target = document.querySelector(href);
      if(!target) return;
      e.preventDefault();
      const h = $("resourcesHeader");
      const top = target.getBoundingClientRect().top + window.pageYOffset - (h?h.offsetHeight:0) - 20;
      window.scrollTo({top, behavior:"smooth"});
    });
  });
}

function bindSpy(){
  /* Sections in scroll order */
  const sections = [
    { id:"aboutUniwiseSection",   nav:`[data-nav="aboutUniwiseSection"]` },
    { id:"aboutSchoolSection",    nav:`[data-nav="aboutSchoolSection"]`  },
    { id:"announcementsSection",  nav:`[data-nav="announcementsSection"]` },
    { id:"mapsSection",           nav:`[data-nav="mapsSection"]`         },
    { id:"contactsLinksSection",  nav:`[data-nav="contactsLinksSection"]` },
  ];

  // Cache section tops once; rebuild only on resize (not every scroll frame)
  let cachedOffsets = [];
  function cacheOffsets(){
    const headerH = ($("resourcesHeader")||{}).offsetHeight || 0;
    cachedOffsets = sections.map(s=>{
      const el = $(s.id);
      return { ...s, top: el ? el.getBoundingClientRect().top + window.scrollY - headerH - 80 : Infinity };
    });
  }
  cacheOffsets();
  window.addEventListener("resize", cacheOffsets, { passive:true });

  function update(){
    const sy = window.scrollY;
    let cur = null;
    cachedOffsets.forEach(s=>{ if(s.top <= sy) cur = s; });
    document.querySelectorAll(".quick-nav-card").forEach(c=>c.classList.remove("active"));
    if(cur){ document.querySelectorAll(cur.nav).forEach(el=>el.classList.add("active")); }
  }
  window.addEventListener("scroll", update, { passive:true });
  update();
}

/* ──────── Travel tools ──────── */
function bindTravel(){
  const detect = $("detectLocationBtn");
  const route  = $("routeBtn");
  const input  = $("userLocation");
  const status = $("travelStatus");

  detect?.addEventListener("click",()=>{
    if(!navigator.geolocation){ if(status) status.textContent="Geolocation not supported."; return; }
    if(status) status.textContent="Detecting location…";
    navigator.geolocation.getCurrentPosition(
      pos=>{
        input.value=`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        if(status) status.textContent="Location detected.";
      },
      ()=>{ if(status) status.textContent="Unable to detect location."; }
    );
  });

  route?.addEventListener("click",()=>{
    const v = input.value.trim();
    if(!v){ if(status) status.textContent="Please enter a starting location first."; return; }
    const dest = window.resourcesConfig?.schoolDestination || "";
    const url  = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(v)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
    window.open(url,"_blank","noopener,noreferrer");
    if(status) status.textContent="Opening route in Google Maps.";
  });
}

/* ──────── LED arrow controls ──────── */
function bindLedControls(){
  $("ledPrevBtn")?.addEventListener("click", prevLedSlide);
  $("ledNextBtn")?.addEventListener("click", nextLedSlide);
}

/* ──────── Lightbox carousel ──────── */
function ensureLightbox(){
  let lb = $("mediaLightbox");
  if(lb) return lb;
  lb = document.createElement("div");
  lb.id="mediaLightbox"; lb.className="media-lightbox";
  lb.innerHTML=`
    <div class="media-lightbox-backdrop" data-close="true"></div>
    <div class="lb-counter" id="lbCounter">1 / 1</div>
    <button class="lb-btn lb-close" type="button" aria-label="Close"><i class="bi bi-x-lg"></i></button>
    <button class="lb-btn lb-prev"  type="button" aria-label="Previous"><i class="bi bi-chevron-left"></i></button>
    <button class="lb-btn lb-next"  type="button" aria-label="Next"><i class="bi bi-chevron-right"></i></button>
    <div class="media-lightbox-stage" id="lbStage"></div>`;
  document.body.appendChild(lb);
  lb.addEventListener("click",e=>{
    if(e.target.dataset.close==="true") closeLb();
    else if(e.target.closest(".lb-close")) closeLb();
    else if(e.target.closest(".lb-prev"))  navLb(-1);
    else if(e.target.closest(".lb-next"))  navLb(1);
  });
  document.addEventListener("keydown",e=>{
    if(!lb.classList.contains("is-open")) return;
    if(e.key==="Escape")     closeLb();
    else if(e.key==="ArrowLeft")  navLb(-1);
    else if(e.key==="ArrowRight") navLb(1);
  });
  return lb;
}
function renderLb(){
  const stage   = $("lbStage");
  const counter = $("lbCounter");
  const it = lbItems[lbIndex];
  if(!stage||!it) return;
  if(it.type==="video"){
    stage.innerHTML = `<video src="${escapeHtml(it.url)}" controls autoplay></video>`;
  }else{
    stage.innerHTML = `<img src="${escapeHtml(it.url)}" alt="${escapeHtml(it.name||"Preview")}">`;
  }
  if(counter) counter.textContent=`${lbIndex+1} / ${lbItems.length}`;
  const showNav = lbItems.length>1;
  const prev = document.querySelector(".lb-prev");
  const next = document.querySelector(".lb-next");
  if(prev) prev.style.display = showNav?"flex":"none";
  if(next) next.style.display = showNav?"flex":"none";
}
function openLb(items, index=0){
  if(!items||!items.length) return;
  ensureLightbox();
  lbItems=[...items]; lbIndex=Math.max(0,Math.min(index,items.length-1));
  renderLb();
  $("mediaLightbox").classList.add("is-open");
  document.body.style.overflow="hidden";
}
function closeLb(){
  const lb=$("mediaLightbox"); if(!lb) return;
  lb.classList.remove("is-open");
  const s=$("lbStage"); if(s) s.innerHTML="";
  document.body.style.overflow="";
}
function navLb(dir){
  if(!lbItems.length) return;
  lbIndex=(lbIndex+dir+lbItems.length)%lbItems.length;
  renderLb();
}
function bindLightbox(){
  document.addEventListener("click",e=>{
    const cell = e.target.closest(".fb-img");
    if(!cell) return;
    const grid = cell.closest(".fb-images");
    if(!grid) return;
    const key   = grid.dataset.gallery;
    const items = (window.__fbGalleries||{})[key]||[];
    if(!items.length) return;
    openLb(items, parseInt(cell.dataset.index||"0",10));
  });
}

/* ──────── Scroll reveal ──────── */
function bindReveal(){
  const elements = document.querySelectorAll(
    ".dir-tile, .led-ctx-item, .fb-post, .school-track-card, .uw-cap, .content-card"
  );
  elements.forEach(el=>el.classList.add("reveal"));

  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      }
    });
  },{ threshold:0.08, rootMargin:"0px 0px -30px 0px" });

  elements.forEach(el=>io.observe(el));
}

/* ──────── Staggered dir-tile reveal ──────── */
function bindDirStagger(){
  const tiles = document.querySelectorAll(".dir-tile");
  tiles.forEach((t,i)=>{
    t.style.transitionDelay = `${i*0.07}s`;
  });
}

/* ──────── Staggered post reveal ──────── */
// Stagger is applied directly in renderPosts; no MutationObserver needed.
function bindPostStagger(){ /* no-op */ }

/* ──────── Nav Drawer ──────── */
function bindNavDrawer(){
  const trigger = document.getElementById("navDrawerTrigger");
  const menu    = document.getElementById("navDrawerMenu");
  if(!trigger || !menu) return;

  function openMenu(){
    menu.hidden = false;
    trigger.setAttribute("aria-expanded","true");
  }
  function closeMenu(){
    menu.hidden = true;
    trigger.setAttribute("aria-expanded","false");
  }
  trigger.addEventListener("click", e=>{
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });
  document.addEventListener("click", e=>{
    if(!document.getElementById("navDrawerWrap")?.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", e=>{
    if(e.key==="Escape") closeMenu();
  });
  // Close on item click
  menu.querySelectorAll(".nav-drawer-item").forEach(item=>{
    item.addEventListener("click", closeMenu);
  });
}

/* ──────── Strand Drawer ──────── */
function bindStrandDrawer(){
  const drawer  = $("strandDrawer");
  const overlay = $("strandOverlay");
  const closeBtn= $("strandDrawerClose");
  if(!drawer) return;

  function openDrawer(strand){
    $("strandPanelStem").hidden  = (strand !== "stem");
    $("strandPanelHumss").hidden = (strand !== "humss");
    drawer.hidden = false;
    requestAnimationFrame(()=>{
      drawer.classList.add("is-open");
      overlay.classList.add("is-open");
    });
    document.body.style.overflow = "hidden";
  }
  function closeDrawer(){
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    drawer.addEventListener("transitionend", ()=>{
      drawer.hidden = true;
      document.body.style.overflow = "";
    }, { once:true });
  }

  document.querySelectorAll(".strand-trigger").forEach(btn=>{
    btn.addEventListener("click", ()=> openDrawer(btn.dataset.strand));
  });
  closeBtn?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e=>{
    if(e.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer();
  });
}
document.addEventListener("DOMContentLoaded",()=>{
  bindNavDrawer();
  bindQuickNav();
  bindSpy();
  bindTravel();
  bindLedControls();
  bindLightbox();
  bindReveal();
  bindDirStagger();
  bindPostStagger();
  bindStrandDrawer();
  renderResources(resourcesCache);
  loadResources();
});

window.goHome     = goHome;
window.goSettings = goSettings;
window.openFullMap= openFullMap;