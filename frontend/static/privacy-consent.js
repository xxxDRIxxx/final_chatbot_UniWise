const PRIVACY_SESSION_KEY = "uniwisePrivacyAccepted";

const readToggle  = document.getElementById("readToggle");
const agreeToggle = document.getElementById("agreeToggle");
const continueBtn = document.getElementById("continueBtn");
const readRow     = document.getElementById("readRow");
const agreeRow    = document.getElementById("agreeRow");

/* ── Navigation type helper ── */
function getNavigationType() {
  const navEntries = performance.getEntriesByType("navigation");
  if (navEntries && navEntries.length > 0) return navEntries[0].type;
  if (performance.navigation) {
    switch (performance.navigation.type) {
      case 1:  return "reload";
      case 2:  return "back_forward";
      default: return "navigate";
    }
  }
  return "navigate";
}

/* ── Sync visual state of rows + button ── */
function updateState() {
  const bothChecked = !!readToggle?.checked && !!agreeToggle?.checked;

  if (continueBtn) continueBtn.disabled = !bothChecked;

  if (readRow)  readRow.classList.toggle("is-checked",  !!readToggle?.checked);
  if (agreeRow) agreeRow.classList.toggle("is-checked", !!agreeToggle?.checked);
}

/* ── Back/forward nav guard ── */
function handleConsentPageNavigation() {
  const navType        = getNavigationType();
  const alreadyAccepted = sessionStorage.getItem(PRIVACY_SESSION_KEY) === "true";

  if (navType === "back_forward" && alreadyAccepted) {
    window.location.replace("/");
    return true;
  }
  return false;
}

/* ── Listeners ── */
readToggle?.addEventListener("change",  updateState);
agreeToggle?.addEventListener("change", updateState);

continueBtn?.addEventListener("click", async () => {
  const allowed = !!readToggle?.checked && !!agreeToggle?.checked;
  if (!allowed) return;

  continueBtn.disabled = true;
  continueBtn.innerHTML = `<span class="bi bi-arrow-repeat" style="animation:spin .8s linear infinite;display:inline-block;"></span><span>Submitting…</span>`;

  try {
    const res  = await fetch("/accept-consent", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ read: readToggle.checked, agree: agreeToggle.checked }),
    });
    const data = await res.json();

    if (data.success) {
      sessionStorage.setItem(PRIVACY_SESSION_KEY, "true");
      window.location.replace(data.redirect || "/");
      return;
    }

    // reset button on failure
    continueBtn.disabled = false;
    continueBtn.innerHTML = `<i class="bi bi-check-circle-fill"></i><span>Agree &amp; Continue</span>`;
  } catch (err) {
    console.error("Consent submission failed:", err);
    continueBtn.disabled = false;
    continueBtn.innerHTML = `<i class="bi bi-check-circle-fill"></i><span>Agree &amp; Continue</span>`;
  }
});

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
  const redirected = handleConsentPageNavigation();
  if (redirected) return;
  updateState();
});