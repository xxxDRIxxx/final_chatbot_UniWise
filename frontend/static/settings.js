// =========================================================
// UniWise Settings — settings.js
// =========================================================

const THEME_KEY  = "uniwiseTheme_v5";       // "light" | "night"
const FONT_KEY   = "uniwiseFontStyle_v1";   // "inter" | "poppins" | "roboto"
const SIZE_KEY   = "uniwiseFontSize_v1";    // "small" | "medium" | "large" | "xl"
const BUBBLE_KEY = "uniwiseBubbleTheme_v1"; // "default" | "solid-bluegold" | "solid-greengold"

const SIZE_TO_PX = { small: 14, medium: 18, large: 22, xl: 26 };
const PX_TO_SIZE = { 14: "small", 18: "medium", 22: "large", 26: "xl" };

const getTheme  = () => localStorage.getItem(THEME_KEY)  || "light";
const getFont   = () => localStorage.getItem(FONT_KEY)   || "inter";
const getSize   = () => localStorage.getItem(SIZE_KEY)   || "medium";
const getBubble = () => localStorage.getItem(BUBBLE_KEY) || "default";

function applyAll() {
  const theme  = getTheme();
  const font   = getFont();
  const size   = getSize();
  const bubble = getBubble();

  document.body.classList.remove("light", "night");
  document.body.classList.add(theme);

  document.body.classList.remove("font-inter", "font-poppins", "font-roboto");
  document.body.classList.add(`font-${font}`);

  document.body.classList.remove("size-small", "size-medium", "size-large", "size-xl");
  document.body.classList.add(`size-${size}`);

  document.body.classList.remove("bubble-default", "bubble-solid-bluegold", "bubble-solid-greengold");
  if (bubble !== "default") document.body.classList.add(`bubble-${bubble}`);

  syncSliderFill();
}

function syncSliderFill() {
  const slider = document.getElementById("fontSizeSlider");
  if (!slider) return;
  const min = +slider.min, max = +slider.max, val = +slider.value;
  slider.style.setProperty("--range-progress", `${((val - min) / (max - min)) * 100}%`);
}

document.addEventListener("DOMContentLoaded", () => {
  applyAll();

  const themeSwitch = document.getElementById("themeSwitch");
  const blueSwitch  = document.getElementById("blueGoldSwitch");
  const greenSwitch = document.getElementById("greenGoldSwitch");

  // Dark mode
  if (themeSwitch) {
    themeSwitch.checked = getTheme() === "night";
    themeSwitch.addEventListener("change", () => {
      localStorage.setItem(THEME_KEY, themeSwitch.checked ? "night" : "light");
      if (themeSwitch.checked) {
        localStorage.setItem(BUBBLE_KEY, "default");
        if (blueSwitch)  blueSwitch.checked  = false;
        if (greenSwitch) greenSwitch.checked = false;
      }
      applyAll();
    });
  }

  // School themes
  const syncSchool = (bubble) => {
    if (blueSwitch)  blueSwitch.checked  = bubble === "solid-bluegold";
    if (greenSwitch) greenSwitch.checked = bubble === "solid-greengold";
  };
  syncSchool(getBubble());

  blueSwitch?.addEventListener("change", () => {
    if (greenSwitch && blueSwitch.checked) greenSwitch.checked = false;
    localStorage.setItem(BUBBLE_KEY, blueSwitch.checked ? "solid-bluegold" : "default");
    if (blueSwitch.checked) {
      localStorage.setItem(THEME_KEY, "light");
      if (themeSwitch) themeSwitch.checked = false;
    }
    applyAll();
  });

  greenSwitch?.addEventListener("change", () => {
    if (blueSwitch && greenSwitch.checked) blueSwitch.checked = false;
    localStorage.setItem(BUBBLE_KEY, greenSwitch.checked ? "solid-greengold" : "default");
    if (greenSwitch.checked) {
      localStorage.setItem(THEME_KEY, "light");
      if (themeSwitch) themeSwitch.checked = false;
    }
    applyAll();
  });

  // Font Style
  const fontSegment = document.getElementById("fontStyleSegment");
  if (fontSegment) {
    const segBtns = fontSegment.querySelectorAll(".segment-btn");
    segBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.font === getFont());
      btn.addEventListener("click", () => {
        segBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        localStorage.setItem(FONT_KEY, btn.dataset.font);
        applyAll();
      });
    });
  }

  // Font Size Slider
  const slider    = document.getElementById("fontSizeSlider");
  const sizeLabel = document.getElementById("fontSizeValue");
  if (slider) {
    slider.value = SIZE_TO_PX[getSize()] || 18;
    if (sizeLabel) sizeLabel.textContent = `${slider.value}px`;
    syncSliderFill();
    slider.addEventListener("input", () => {
      const px = +slider.value;
      if (sizeLabel) sizeLabel.textContent = `${px}px`;
      localStorage.setItem(SIZE_KEY, PX_TO_SIZE[px] || "medium");
      applyAll();
    });
  }

  // Cross-tab sync
  window.addEventListener("storage", (e) => {
    if ([THEME_KEY, FONT_KEY, SIZE_KEY, BUBBLE_KEY].includes(e.key)) applyAll();
  });
});