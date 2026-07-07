const PRIVACY_SESSION_KEY = "uniwisePrivacyAccepted";

const readToggle = document.getElementById("readToggle");
const agreeToggle = document.getElementById("agreeToggle");
const continueBtn = document.getElementById("continueBtn");

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

function updateState() {
  const allowed = !!readToggle?.checked && !!agreeToggle?.checked;
  if (continueBtn) {
    continueBtn.disabled = !allowed;
  }
}

function handleConsentPageNavigation() {
  const navType = getNavigationType();
  const alreadyAccepted = sessionStorage.getItem(PRIVACY_SESSION_KEY) === "true";

  if (navType === "back_forward" && alreadyAccepted) {
    window.location.replace("/");
    return true;
  }

  return false;
}

readToggle?.addEventListener("change", updateState);
agreeToggle?.addEventListener("change", updateState);

continueBtn?.addEventListener("click", async () => {
  const allowed = !!readToggle?.checked && !!agreeToggle?.checked;
  if (!allowed) return;

  continueBtn.disabled = true;

  try {
    const res = await fetch("/accept-consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        read: readToggle.checked,
        agree: agreeToggle.checked
      })
    });

    const data = await res.json();

    if (data.success) {
      sessionStorage.setItem(PRIVACY_SESSION_KEY, "true");
      window.location.replace(data.redirect || "/");
      return;
    }

    continueBtn.disabled = false;
  } catch (error) {
    console.error("Consent submission failed:", error);
    continueBtn.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const redirected = handleConsentPageNavigation();
  if (redirected) return;
  updateState();
});