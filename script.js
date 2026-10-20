
/*
 * ATMOS WEATHER DASHBOARD — FIXED CITY SEARCH
 * Cloudflare Worker remains unchanged.
 */
const PROXY_BASE = "https://atmos-weather-proxy.gamingmriganga.workers.dev";

const state = {
  unit: "C",
  weather: null,
  forecast: null,
  cityTimezoneOffset: null,
  cityName: "",
  cityCountry: "",
  refreshTimer: null,
  requestId: 0,
  selectedLocation: null
};

const $ = id => document.getElementById(id);
const statusEl = $("status-message");

function setStatus(message, kind = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-message ${kind}`.trim();
}

async function proxyRequest(path, params = {}) {
  const url = new URL(
    path.replace(/^\//, ""),
    PROXY_BASE.endsWith("/") ? PROXY_BASE : `${PROXY_BASE}/`
  );

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Weather service error (${response.status}).`);
  }

  return payload;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function celsiusToFahrenheit(c) {
  return c * 9 / 5 + 32;
}

function temperatureValue(c) {
  const value = state.unit === "C" ? c : celsiusToFahrenheit(c);
  return `${Math.round(value)}°${state.unit}`;
}

function temperatureNumber(c) {
  return Math.round(
    state.unit === "C" ? c : celsiusToFahrenheit(c)
  ) + "°";
}

function windValue(mps) {
  const value = state.unit === "C" ? mps * 3.6 : mps * 2.236936;
  return `${Math.round(value)} ${state.unit === "C" ? "km/h" : "mph"}`;
}

function weatherEmoji(id, isDay = true) {
  if (id >= 200 && id < 300) return "⛈️";
  if (id >= 300 && id < 600) return "🌧️";
  if (id >= 600 && id < 700) return "🌨️";
  if (id >= 700 && id < 800) return "🌫️";
  if (id === 800) return isDay ? "☀️" : "🌙";
  if (id === 801) return "🌤️";
  if (id === 802) return "⛅";
  if (id >= 803) return "☁️";
  return "🌡️";
}

function formatCityTime(unixSeconds, offsetSeconds, options = {}) {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: "UTC"
  }).format(shifted);
}

function localCityTime(date = new Date()) {
  if (state.cityTimezoneOffset === null) return null;

  const shifted = new Date(
    date.getTime() + state.cityTimezoneOffset * 1000
  );

  return {
    time: new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(shifted),

    date: new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(shifted)
  };
}

function formatClock() {
  const now = new Date();

  $("device-clock").textContent =
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(now);

  $("device-clock-date").textContent =
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(now);

  $("today-date").textContent =
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(now);

  const city = localCityTime(now);

  if (city) {
    $("city-clock").textContent = city.time;
    $("city-clock-date").textContent = city.date;
  }
}

function renderCurrent(data) {
  state.weather = data;
  state.cityTimezoneOffset = Number(data.timezone || 0);
  state.cityName = data.name || "Selected city";
  state.cityCountry = data.sys?.country || "";

  const main = data.weather?.[0] || {};

  $("location-name").textContent = state.cityName;
  $("location-meta").textContent = [
    state.cityCountry,
    `Updated ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`
  ].filter(Boolean).join(" · ");

  $("condition-pill").textContent = main.main || "Weather";
  $("temperature").textContent = Math.round(
    state.unit === "C"
      ? data.main.temp
      : celsiusToFahrenheit(data.main.temp)
  );

  $("description").textContent = main.description || main.main || "Current conditions";
  $("feels-like").textContent = temperatureValue(data.main.feels_like);
  $("weather-art").textContent = weatherEmoji(main.id);
  $("humidity").textContent = `${data.main.humidity}%`;
  $("wind").textContent = windValue(data.wind?.speed || 0);
  $("pressure").textContent = `${data.main.pressure} hPa`;

  $("sunrise").textContent = data.sys?.sunrise
    ? formatCityTime(data.sys.sunrise, state.cityTimezoneOffset, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "—";

  $("city-clock-label").textContent =
    `${state.cityName.toUpperCase()} TIME`;

  formatClock();
}

function forecastBuckets(data) {
  const days = new Map();

  for (const item of data.list || []) {
    const localDate = new Date(
      (item.dt + (data.city?.timezone || 0)) * 1000
    );

    const key = [
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate()
    ].join("-");

    if (!days.has(key)) days.set(key, []);
    days.get(key).push({ ...item, localDate });
  }

  return [...days.values()].map(items => {
    const chosen = items.reduce((best, item) => {
      return Math.abs(item.localDate.getUTCHours() - 12) <
        Math.abs(best.localDate.getUTCHours() - 12)
        ? item
        : best;
    }, items[0]);

    return {
      date: chosen.localDate,
      min: Math.min(...items.map(item => item.main.temp_min)),
      max: Math.max(...items.map(item => item.main.temp_max)),
      weather: chosen.weather?.[0] || {},
      pop: Math.max(...items.map(item => item.pop || 0))
    };
  }).slice(0, 5);
}

function renderForecast(data) {
  state.forecast = data;

  const host = $("forecast-list");
  host.innerHTML = "";

  const buckets = forecastBuckets(data);

  if (!buckets.length) {
    host.innerHTML =
      '<div class="forecast-empty">No forecast data returned.</div>';
    return;
  }

  buckets.forEach((day, index) => {
    const card = document.createElement("article");
    card.className = `forecast-day${index === 0 ? " today" : ""}`;

    const weekday = index === 0
      ? "Today"
      : new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          timeZone: "UTC"
        }).format(day.date);

    const date = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(day.date);

    card.innerHTML = `
      <div class="forecast-name">${weekday}</div>
      <div class="forecast-date">${date}</div>
      <div class="forecast-icon">${weatherEmoji(day.weather.id)}</div>
      <div class="forecast-description">${escapeHTML(
        day.weather.description || day.weather.main || "Conditions"
      )}</div>
      <div class="forecast-temps">
        <span>${temperatureNumber(day.max)}</span>
        <span class="forecast-low">${temperatureNumber(day.min)}</span>
      </div>
    `;

    host.appendChild(card);
  });
}

/* Add a city dropdown without editing index.html or style.css. */
function setupCityResults() {
  const form = $("search-form");
  if (!form) return null;

  let panel = $("city-results");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "city-results";
    panel.hidden = true;

    Object.assign(panel.style, {
      position: "absolute",
      zIndex: "9999",
      top: "calc(100% + 8px)",
      left: "0",
      right: "0",
      maxHeight: "280px",
      overflowY: "auto",
      padding: "8px",
      borderRadius: "14px",
      background: "#151b31",
      border: "1px solid rgba(255,255,255,.18)",
      boxShadow: "0 16px 40px rgba(0,0,0,.4)"
    });

    const parent = form.parentElement;
    if (getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    parent.appendChild(panel);
  }

  return panel;
}

const cityResults = setupCityResults();

function closeCityResults() {
  if (cityResults) {
    cityResults.hidden = true;
    cityResults.innerHTML = "";
  }
}

function showCityResults(results, requestId) {
  if (!cityResults) return;

  cityResults.innerHTML = "";

  if (!results.length) {
    cityResults.innerHTML =
      '<div style="padding:12px;color:#fff">No matching cities found.</div>';
    cityResults.hidden = false;
    return;
  }

  results.forEach(place => {
    const button = document.createElement("button");
    button.type = "button";

    const parts = [
      place.name,
      place.state,
      place.country
    ].filter(Boolean);

    button.textContent = parts.join(", ");
    button.setAttribute("aria-label", `Select ${button.textContent}`);

    Object.assign(button.style, {
      display: "block",
      width: "100%",
      padding: "12px",
      margin: "3px 0",
      border: "0",
      borderRadius: "9px",
      background: "transparent",
      color: "#fff",
      textAlign: "left",
      fontSize: "14px",
      cursor: "pointer"
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(255,255,255,.12)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });

    button.addEventListener("click", () => {
      if (requestId !== state.requestId) return;

      // Keep the exact selected geocoding result.
      state.selectedLocation = {
        name: place.name,
        state: place.state || "",
        country: place.country || "",
        lat: Number(place.lat),
        lon: Number(place.lon)
      };

      closeCityResults();

      // Pass these exact coordinates to the weather endpoints.
      loadByCoordinates(
        state.selectedLocation.lat,
        state.selectedLocation.lon,
        "selected city",
        requestId,
        state.selectedLocation
      );
    });

    cityResults.appendChild(button);
  });

  cityResults.hidden = false;
}

async function searchCity(city) {
  const requestId = ++state.requestId;
  closeCityResults();

  setStatus(`Searching worldwide for ${city}…`);

  try {
    const results = await proxyRequest("geocode", {
      q: city,
      limit: 5
    });

    if (requestId !== state.requestId) return;

    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`Couldn't find "${city}". Check the spelling.`);
    }

    showCityResults(results, requestId);
    setStatus(
      `Found ${results.length} result(s). Select the correct city from the list.`
    );
  } catch (error) {
    if (requestId !== state.requestId) return;
    setStatus(error.message || "City search failed. Try again.", "error");
  }
}

async function loadByCoordinates(
  lat,
  lon,
  label = "location",
  requestId = ++state.requestId,
  selectedPlace = null
) {
  // Invalidate any older search or GPS request.
  state.requestId = Math.max(state.requestId, requestId);
  const thisRequest = requestId;

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    setStatus("Invalid city coordinates. Please search again.", "error");
    return;
  }

  setStatus(`Loading weather for ${selectedPlace?.name || label}…`);

  try {
    const [current, forecast] = await Promise.all([
      proxyRequest("weather", { lat, lon }),
      proxyRequest("forecast", { lat, lon })
    ]);

    // Ignore late responses from an earlier city or GPS request.
    if (thisRequest !== state.requestId) return;

    renderCurrent(current);
    renderForecast(forecast);

    // Show both the chosen search result and the weather API's location.
    if (selectedPlace) {
      const expected = selectedPlace.name;
      const returned = current.name || "Unknown location";

      $("location-meta").textContent = [
        selectedPlace.state,
        selectedPlace.country,
        `Weather result: ${returned}`
      ].filter(Boolean).join(" · ");

      setStatus(
        `Selected ${expected}. Weather service returned ${returned}.`,
        "success"
      );
    } else {
      setStatus(
        `Weather loaded for ${current.name || label}. Updates every 10 minutes.`,
        "success"
      );
    }

    state.selectedLocation = selectedPlace || { lat, lon, name: current.name };

    startAutoRefresh(() => {
      const selected = state.selectedLocation;
      if (selected) {
        loadByCoordinates(
          selected.lat,
          selected.lon,
          "selected city",
          ++state.requestId,
          selected
        );
      }
    }, 10 * 60 * 1000);
  } catch (error) {
    if (thisRequest !== state.requestId) return;
    setStatus(error.message || "Could not load weather.", "error");
  }
}

function useGPS() {
  const requestId = ++state.requestId;
  closeCityResults();

  if (!navigator.geolocation) {
    setStatus("Location isn't supported. Search for a city instead.", "error");
    return;
  }

  setStatus("Requesting your location…");

  navigator.geolocation.getCurrentPosition(
    position => {
      // Don't let a delayed GPS result replace a newer city search.
      if (requestId !== state.requestId) return;

      loadByCoordinates(
        position.coords.latitude,
        position.coords.longitude,
        "GPS",
        requestId
      );
    },
    error => {
      if (requestId !== state.requestId) return;

      const message = error.code === 1
        ? "Location permission denied. Search for a city instead."
        : error.code === 2
          ? "Your location couldn't be determined. Search for a city instead."
          : "Location request timed out. Search for a city instead.";

      setStatus(message, "error");
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
  );
}

function startAutoRefresh(callback, interval) {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(callback, interval);
}

/* Search form */
$("search-form").addEventListener("submit", event => {
  event.preventDefault();

  const city = $("city-input").value.trim();
  if (city) searchCity(city);
});

/* Close the city menu when tapping outside it. */
document.addEventListener("click", event => {
  if (
    cityResults &&
    !event.target.closest("#city-results") &&
    !event.target.closest("#search-form")
  ) {
    closeCityResults();
  }
});

$("gps-button").addEventListener("click", useGPS);

/* Temperature unit buttons */
document.querySelectorAll(".unit-button").forEach(button => {
  button.addEventListener("click", () => {
    state.unit = button.dataset.unit;

    document.querySelectorAll(".unit-button").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });

    if (state.weather) renderCurrent(state.weather);
    if (state.forecast) renderForecast(state.forecast);
  });
});

setInterval(formatClock, 1000);
formatClock();

/* Start with a neutral dashboard; don't automatically overwrite city searches with GPS. */
setStatus("Search for any city worldwide to see its weather.");
      
