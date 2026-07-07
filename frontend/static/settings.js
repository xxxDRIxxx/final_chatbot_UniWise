const THEME_KEY = "uniwiseTheme_v4";
const FONT_KEY = "uniwiseFontStyle_v1";
const SIZE_KEY = "uniwiseFontSize_v1";
const BUBBLE_KEY = "uniwiseBubbleTheme_v1";

const themeSwitch = document.getElementById("themeSwitch");
const blueGoldSwitch = document.getElementById("blueGoldSwitch");
const greenGoldSwitch = document.getElementById("greenGoldSwitch");

const fontButtons = document.querySelectorAll("#fontStyleSegment .segment-btn");
const sizeButtons = document.querySelectorAll("#fontSizeSegment .segment-btn");

function getSavedTheme() {
  return localStorage.getItem(THEME_KEY) || "night";
}

function getSavedFont() {
  return localStorage.getItem(FONT_KEY) || "inter";
}

function getSavedSize() {
  return localStorage.getItem(SIZE_KEY) || "medium";
}

function getSavedSchoolTheme() {
  return localStorage.getItem(BUBBLE_KEY) || "default";
}

function syncSegment(buttons, key, value) {
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset[key] === value);
  });
}

function applyTheme(theme) {
  document.body.classList.remove("day", "night");
  document.body.classList.add(theme);
  localStorage.setItem(THEME_KEY, theme);
}

function applySchoolTheme(themeValue) {
  document.body.classList.remove(
    "bubble-default",
    "bubble-solid-bluegold",
    "bubble-solid-greengold"
  );
  document.body.classList.add(`bubble-${themeValue}`);
  localStorage.setItem(BUBBLE_KEY, themeValue);
}

function applyFontStyle(font) {
  document.body.classList.remove("font-inter", "font-poppins", "font-roboto");
  document.body.classList.add(`font-${font}`);
  localStorage.setItem(FONT_KEY, font);
  syncSegment(fontButtons, "font", font);
}

function applyFontSize(size) {
  document.body.classList.remove("size-small", "size-medium", "size-large");
  document.body.classList.add(`size-${size}`);
  localStorage.setItem(SIZE_KEY, size);
  syncSegment(sizeButtons, "size", size);
}

function syncToggles() {
  const theme = getSavedTheme();
  const schoolTheme = getSavedSchoolTheme();

  if (themeSwitch) {
    themeSwitch.checked = theme === "night";
  }

  if (blueGoldSwitch) {
    blueGoldSwitch.checked = schoolTheme === "solid-bluegold";
  }

  if (greenGoldSwitch) {
    greenGoldSwitch.checked = schoolTheme === "solid-greengold";
  }
}

function initAppearance() {
  applyTheme(getSavedTheme());
  applySchoolTheme(getSavedSchoolTheme());
  applyFontStyle(getSavedFont());
  applyFontSize(getSavedSize());
  syncToggles();
}

document.addEventListener("DOMContentLoaded", () => {
  initAppearance();

  themeSwitch?.addEventListener("change", () => {
    if (blueGoldSwitch) blueGoldSwitch.checked = false;
    if (greenGoldSwitch) greenGoldSwitch.checked = false;

    applySchoolTheme("default");
    applyTheme(themeSwitch.checked ? "night" : "day");
    syncToggles();
  });

  blueGoldSwitch?.addEventListener("change", () => {
    if (blueGoldSwitch.checked) {
      if (greenGoldSwitch) greenGoldSwitch.checked = false;
      if (themeSwitch) themeSwitch.checked = false;

      applyTheme("day");
      applySchoolTheme("solid-bluegold");
    } else {
      applySchoolTheme("default");
    }

    syncToggles();
  });

  greenGoldSwitch?.addEventListener("change", () => {
    if (greenGoldSwitch.checked) {
      if (blueGoldSwitch) blueGoldSwitch.checked = false;
      if (themeSwitch) themeSwitch.checked = false;

      applyTheme("day");
      applySchoolTheme("solid-greengold");
    } else {
      applySchoolTheme("default");
    }

    syncToggles();
  });

  fontButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyFontStyle(btn.dataset.font);
    });
  });

  sizeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyFontSize(btn.dataset.size);
    });
  });
});