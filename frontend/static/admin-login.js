document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".login-form");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const togglePassword = document.getElementById("togglePassword");
  const submitBtn = document.querySelector(".login-btn");
  const rememberDeviceInput = document.getElementById("rememberDevice");

  if (!form) return;

  const REMEMBERED_USERNAME_KEY = "uniwise_admin_username";

  function setPasswordVisibility(show) {
    if (!passwordInput || !togglePassword) return;

    passwordInput.type = show ? "text" : "password";
    togglePassword.innerHTML = show
      ? '<i class="bi bi-eye-slash"></i>'
      : '<i class="bi bi-eye"></i>';

    togglePassword.setAttribute(
      "aria-label",
      show ? "Hide password" : "Show password"
    );
  }

  function getOrCreateLiveErrorBox() {
    let liveErrorBox = form.querySelector(".error-box.live-error");

    if (!liveErrorBox) {
      liveErrorBox = document.createElement("div");
      liveErrorBox.className = "error-box live-error";
      liveErrorBox.innerHTML = `
        <i class="bi bi-exclamation-circle-fill"></i>
        <span></span>
      `;

      if (submitBtn) {
        form.insertBefore(liveErrorBox, submitBtn);
      } else {
        form.appendChild(liveErrorBox);
      }
    }

    return liveErrorBox;
  }

  function showInlineError(message) {
    if (!message) return;
    const box = getOrCreateLiveErrorBox();
    const text = box.querySelector("span");
    if (text) text.textContent = message;
  }

  function clearInlineError() {
    const liveErrorBox = form.querySelector(".error-box.live-error");
    if (liveErrorBox) liveErrorBox.remove();
  }

  function isLocked() {
    return Boolean(
      submitBtn &&
      submitBtn.disabled &&
      /locked/i.test(submitBtn.textContent)
    );
  }

  function setSubmittingState(isSubmitting) {
    if (!submitBtn || !isSubmitting) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <i class="bi bi-arrow-repeat"></i>
      <span>Signing in...</span>
    `;
  }

  function loadRememberedUsername() {
    const savedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY);
    if (savedUsername && usernameInput) {
      usernameInput.value = savedUsername;
      if (rememberDeviceInput) rememberDeviceInput.checked = true;
    }

    if (passwordInput) {
      passwordInput.value = "";
      passwordInput.type = "password";
    }

    setPasswordVisibility(false);
  }

  togglePassword?.addEventListener("click", () => {
    if (!passwordInput) return;
    setPasswordVisibility(passwordInput.type === "password");
  });

  usernameInput?.addEventListener("input", clearInlineError);
  passwordInput?.addEventListener("input", clearInlineError);

  form.addEventListener("submit", (e) => {
    clearInlineError();

    if (isLocked()) {
      e.preventDefault();
      showInlineError("Maximum login attempts reached.");
      return;
    }

    const username = (usernameInput?.value || "").trim();
    const password = passwordInput?.value || "";

    if (!username) {
      e.preventDefault();
      showInlineError("Please enter your username.");
      usernameInput?.focus();
      return;
    }

    if (!password) {
      e.preventDefault();
      showInlineError("Please enter your password.");
      passwordInput?.focus();
      return;
    }

    if (password.length < 8) {
      e.preventDefault();
      showInlineError("Password must be at least 8 characters.");
      passwordInput?.focus();
      return;
    }

    if (rememberDeviceInput?.checked) {
      localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
    } else {
      localStorage.removeItem(REMEMBERED_USERNAME_KEY);
    }

    setSubmittingState(true);
  });

  window.addEventListener("load", loadRememberedUsername);
  window.addEventListener("pageshow", loadRememberedUsername);

  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, "", window.location.href);
  }
});