const THEME_KEY = "uniwiseTheme_v4";
const COLOR_KEY = "uniwiseColorTheme_v1";
const FONT_KEY = "uniwiseFontStyle_v1";
const SIZE_KEY = "uniwiseFontSize_v1";
const BUBBLE_KEY = "uniwiseBubbleTheme_v1";

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

  document.body.classList.remove("font-inter", "font-poppins", "font-roboto");
  document.body.classList.add(`font-${font}`);

  document.body.classList.remove("size-small", "size-medium", "size-large");
  document.body.classList.add(`size-${size}`);

  document.body.classList.remove("bubble-default", "bubble-solid-bluegold", "bubble-solid-greengold");
  document.body.classList.add(`bubble-${bubble}`);
}

document.addEventListener("DOMContentLoaded", () => {
  applySavedAppearance();

  const detectLocationBtn = document.getElementById("detectLocationBtn");
  const routeBtn = document.getElementById("routeBtn");
  const userLocationInput = document.getElementById("userLocation");
  const travelStatus = document.getElementById("travelStatus");

  const travelDistance = document.getElementById("travelDistance");
  const travelDuration = document.getElementById("travelDuration");
  const travelMode = document.getElementById("travelMode");

  const config = window.resourcesConfig || {};

  const schoolName = config.schoolName || "Senior Highschool within Bacoor Elementary School";
  const schoolDestination = config.schoolDestination || "Senior Highschool within Bacoor Elementary School, Bacoor, Cavite";

  const schoolCoords = config.schoolCoords || {
    lat: 14.4589,
    lon: 120.9418
  };

  function setStatus(message) {
    if (travelStatus) {
      travelStatus.textContent = message;
    }
  }

  function setTravelDetails(distance = "--", duration = "--", mode = "Driving estimate") {
    if (travelDistance) travelDistance.textContent = distance;
    if (travelDuration) travelDuration.textContent = duration;
    if (travelMode) travelMode.textContent = mode;
  }

  function setLoadingState(isLoading) {
    if (detectLocationBtn) detectLocationBtn.disabled = isLoading;
    if (routeBtn) routeBtn.disabled = isLoading;

    if (isLoading) {
      detectLocationBtn?.classList.add("is-loading");
      routeBtn?.classList.add("is-loading");
    } else {
      detectLocationBtn?.classList.remove("is-loading");
      routeBtn?.classList.remove("is-loading");
    }
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "--";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "--";

    const mins = Math.round(seconds / 60);

    if (mins < 60) return `${mins} min`;

    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;

    if (rem === 0) return `${hrs} hr`;
    return `${hrs} hr ${rem} min`;
  }

  async function reverseGeocode(lat, lon) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
        {
          headers: {
            "Accept": "application/json"
          }
        }
      );

      if (!res.ok) throw new Error("Reverse geocoding failed");

      const data = await res.json();
      return data.display_name || `${lat}, ${lon}`;
    } catch (error) {
      return `${lat}, ${lon}`;
    }
  }

  async function geocodeLocation(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) throw new Error("Location search failed");

    const data = await res.json();
    if (!data.length) throw new Error("No location found");

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      label: data[0].display_name
    };
  }

  async function getRoute(origin, destination) {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) throw new Error("Route service unavailable");

    const data = await res.json();

    if (!data.routes || !data.routes.length) {
      throw new Error("No route found");
    }

    return data.routes[0];
  }

  async function calculateTravelFromText() {
    const originText = userLocationInput?.value.trim() || "";

    if (!originText) {
      setStatus("Please enter your location first or use Detect.");
      userLocationInput?.focus();
      return;
    }

    try {
      setLoadingState(true);
      setStatus("Finding your location...");
      setTravelDetails("...", "...", "Driving estimate");

      const origin = await geocodeLocation(originText);

      setStatus("Calculating travel time...");
      const route = await getRoute(origin, schoolCoords);

      setTravelDetails(
        formatDistance(route.distance),
        formatDuration(route.duration),
        "Driving estimate"
      );

      setStatus(`Route ready from ${origin.label}`);
    } catch (error) {
      console.error(error);
      setStatus("Could not calculate travel time. Try a more specific location.");
      setTravelDetails("--", "--", "Driving estimate");
    } finally {
      setLoadingState(false);
    }
  }

  async function calculateTravelFromCoords(lat, lon) {
    try {
      setLoadingState(true);
      setStatus("Reading your location...");
      setTravelDetails("...", "...", "Driving estimate");

      const readableLocation = await reverseGeocode(lat, lon);
      if (userLocationInput) userLocationInput.value = readableLocation;

      setStatus("Calculating travel time...");
      const route = await getRoute({ lat, lon }, schoolCoords);

      setTravelDetails(
        formatDistance(route.distance),
        formatDuration(route.duration),
        "Driving estimate"
      );

      setStatus("Location detected and travel time calculated.");
    } catch (error) {
      console.error(error);
      setStatus("Location detected, but travel time could not be calculated.");
      setTravelDetails("--", "--", "Driving estimate");
    } finally {
      setLoadingState(false);
    }
  }

  if (detectLocationBtn) {
    detectLocationBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setStatus("Geolocation is not supported by this browser.");
        return;
      }

      setLoadingState(true);
      setStatus("Detecting your current location...");
      setTravelDetails("...", "...", "Driving estimate");

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          await calculateTravelFromCoords(latitude, longitude);
        },
        () => {
          setLoadingState(false);
          setStatus("Unable to detect your location. Please enter it manually.");
          setTravelDetails("--", "--", "Driving estimate");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  if (routeBtn) {
    routeBtn.addEventListener("click", () => {
      const origin = userLocationInput?.value.trim() || "";

      if (!origin) {
        setStatus("Please enter your location first or use Detect.");
        userLocationInput?.focus();
        return;
      }

      const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(schoolDestination)}&travelmode=driving`;

      setStatus("Opening route in Google Maps...");
      window.open(mapsUrl, "_blank");
    });
  }

  if (userLocationInput) {
    let blurTimeout;

    userLocationInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        calculateTravelFromText();
      }
    });

    userLocationInput.addEventListener("blur", () => {
      const value = userLocationInput.value.trim();

      clearTimeout(blurTimeout);
      blurTimeout = setTimeout(() => {
        if (value) {
          calculateTravelFromText();
        }
      }, 200);
    });
  }

  window.addEventListener("storage", (event) => {
    if ([THEME_KEY, COLOR_KEY, FONT_KEY, SIZE_KEY, BUBBLE_KEY].includes(event.key)) {
      applySavedAppearance();
    }
  });

  setStatus("Waiting for your location input");
  setTravelDetails("--", "--", "Driving estimate");
});

function goHome() {
  window.location.href = "/";
}

function goSettings() {
  window.location.href = "/settings";
}