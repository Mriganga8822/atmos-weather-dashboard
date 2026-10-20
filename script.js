
/*
 * Atmos Weather Dashboard
 * Worldwide city search with selectable locations.
 * Keep OPENWEATHER_API_KEY in Cloudflare Worker secrets.
 */

const PROXY_BASE = "https://atmos-weather-proxy.gamingmriganga.workers.dev";

const state = {
  unit: "C",
  weather: null,
  forecast: null,
  cityTimezoneOffset: null,
  cityName: "",
  cityCountry: "",
  refreshTimer: null
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status-message");
let activeRequestId = 0;

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status-message ${kind}`.trim();
}

function proxyIsConfigured() {
  return PROXY_BASE.startsWith("https://") &&
    !PROXY_BASE.includes("PASTE_YOUR");
}

async function proxyRequest(path, params = {}) {
  if (!proxyIsConfigured()) {
    throw new Error("Configure your Cloudflare Worker URL in PROXY_BASE.");
  }

  const base = PROXY_BASE.endsWith("/") ? PROXY_BASE : `${PROXY_BASE}/`;
  const url = new URL(path.replace(/^\//, ""), base);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Weather service error (${response.status}).`);
  }

  return payload;
}

/* Temperature and weather helpers */

function celsiusToFahrenheit(c) {
  return c * 9 / 5 + 32;
}

function temperatureValue(celsius) {
  const value = state.unit === "C" ? celsius : celsiusToFahrenheit(celsius);
  return `${Math.round(value)}°${state.unit}`;
}

function temperatureNumber(celsius) {
  const value = state.unit === "C" ? celsius : celsiusToFahrenheit(celsius);
  return `${Math.round(value)}°`;
}

function windValue(mps) {
  const value = state.unit === "C" ? mps * 3.6 : mps * 2.236936;
  return `${Math.round(value)} ${state.unit === "C" ? "km/h" : "mph"}`;
}

function weatherEmoji(code, isDay = true) {
  if (code === 0) return isDay ? "☀️" : "🌙";
  if ([1, 2].includes(code)) return isDay ? "🌤️" : "☁️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
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

function weatherDescription(main, description) {
  return description || main || "Current conditions";
}

/* Current weather display */

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
    state.unit === "C" ? data.main.temp : celsiusToFahrenheit(data.main.temp)
  );

  $("description").textContent =
    weatherDescription(main.main, main.description);

  $("feels-like").textContent = temperatureValue(data.main.feels_like);
  $("weather-art").textContent = weatherEmoji(main.id, true);
  $("humidity").textContent = `${data.main.humidity}%`;
  $("wind").textContent = windValue(data.wind?.speed || 0);
  $("pressure").textContent = `${data.main.pressure} hPa`;

  $("sunrise").textContent = data.sys?.sunrise
    ? formatCityTime(
        data.sys.sunrise,
        state.cityTimezoneOffset,
        { hour: "2-digit", minute: "2-digit", hour12: true }
      )
    : "—";

  $("city-clock-label").textContent = `${state.cityName.toUpperCase()} TIME`;
  formatClock();
}

/* Five-day forecast */

function forecastBuckets(forecastData) {
  const days = new Map();

  for (const item of forecastData.list || []) {
    const localDate = new Date(
      (item.dt + (forecastData.city?.timezone || 0)) * 1000
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
      const distance = Math.abs(item.localDate.getUTCHours() - 12);
      const bestDistance = Math.abs(best.localDate.getUTCHours() - 12);
      return distance < bestDistance ? item : best;
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

  const buckets = forecastBuckets(data);
  const host = $("forecast-list");
  host.innerHTML = "";

  if (!buckets.length) {
    host.innerHTML =
      '<div class="forecast-empty">No forecast data returned. Try another city.</div>';
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

    const description = day.weather.description || day.weather.main || "Conditions";

    card.innerHTML = `
      <div class="forecast-name">${weekday}</div>
      <div class="forecast-date">${date}</div>
      <div class="forecast-icon" aria-hidden="true">${weatherEmoji(day.weather.id)}</div>
      <div class="forecast-description">${escapeHTML(description)}</div>
      <div class="forecast-temps">
        <span>${temperatureNumber(day.max)}</span>
        <span class="forecast-low">${temperatureNumber(day.min)}</span>
      </div>
    `;

    host.appendChild(card);
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

/* Worldwide city results menu */

function ensureCityResultsPanel() {
  let panel = $("city-results");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "city-results";
    panel.className = "city-results";
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "Matching cities");
    panel.hidden = true;

    $("search-form").insertAdjacentElement("afterend", panel);
  }

  return panel;
}

function hideCityResults() {
  const panel = $("city-results");
  if (!panel) return;

  panel.replaceChildren();
  panel.hidden = true;
}

function showCityResults(results, requestId) {
  const panel = ensureCityResultsPanel();
  panel.replaceChildren();
  panel.hidden = false;

  results.forEach(place => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "city-result";
    button.setAttribute("role", "option");

    const title = document.createElement("span");
    title.className = "city-result-name";
    title.textContent = place.name || "Unknown city";

    const details = document.createElement("span");
    details.className = "city-result-details";
    details.textContent = [
      place.state,
      place.country
    ].filter(Boolean).join(", ") ||
      `${Number(place.lat).toFixed(2)}, ${Number(place.lon).toFixed(2)}`;

    button.append(title, details);

    button.addEventListener("click", async () => {
      if (requestId !== activeRequestId) return;

      const selectionId = ++activeRequestId;
      hideCityResults();

      $("city-input").value = [
        place.name,
        place.state,
        place.country
      ].filter(Boolean).join(", ");

      await loadByCoordinates(
        place.lat,
        place.lon,
        "searched",
        selectionId
      );
    });

    panel.appendChild(button);
  });
}

/* Search cities worldwide */

async function searchCity(city) {
  const requestId = ++activeRequestId;

  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  hideCityResults();
  setStatus(`Searching worldwide for ${city}…`);

  try {
    const results = await proxyRequest("geocode", {
      q: city.trim(),
      limit: 5
    });

    if (requestId !== activeRequestId) return;

    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(
        `No locations found for "${city}". Try "City, Country".`
      );
    }

    showCityResults(results, requestId);

    setStatus(
      `Found ${results.length} matching location${results.length === 1 ? "" : "s"}. Select the correct city below.`,
      "success"
    );
  } catch (error) {
    if (requestId !== activeRequestId) return;

    hideCityResults();

    setStatus(
      error.message || "City search failed. Please try again.",
      "error"
    );
  }
}

/* Load weather for the selected coordinates */

async function loadByCoordinates(
  lat,
  lon,
  label = "location",
  requestId = ++activeRequestId
) {
  if (requestId !== activeRequestId) return;

  hideCityResults();
  setStatus(`Loading weather for your ${label}…`);

  try {
    const [current, forecast] = await Promise.all([
      proxyRequest("weather", { lat, lon }),
      proxyRequest("forecast", { lat, lon })
    ]);

    if (requestId !== activeRequestId) return;

    renderCurrent(current);
    renderForecast(forecast);

    setStatus(
      `Weather loaded for ${current.name || "your location"}. Updates automatically about every 10 minutes.`,
      "success"
    );

    startAutoRefresh(
      () => loadByCoordinates(lat, lon, label, requestId),
      10 * 60 * 1000
    );
  } catch (error) {
    if (requestId !== activeRequestId) return;

    setStatus(
      error.message || "Could not load weather. Please try again.",
      "error"
    );
  }
}

function startAutoRefresh(callback, interval) {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(callback, interval);
}

/* GPS location */

function useGPS() {
  const requestId = ++activeRequestId;

  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  hideCityResults();

  if (!navigator.geolocation) {
    setStatus("This browser does not support location. Search for a city instead.", "error");
    return;
  }

  setStatus("Requesting your location… allow location access in your browser.");

  navigator.geolocation.getCurrentPosition(
    position => {
      if (requestId !== activeRequestId) return;

      loadByCoordinates(
        position.coords.latitude,
        position.coords.longitude,
        "GPS",
        requestId
      );
    },
    error => {
      if (requestId !== activeRequestId) return;

      const message = error.code === 1
        ? "Location permission was denied. Search for a city instead."
        : error.code === 2
          ? "Your location couldn't be determined. Search for a city instead."
          : "Location request timed out. Try again or search for a city.";

      setStatus(message, "error");
    },
    {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 300000
    }
  );
}

/* Event handlers */

$("search-form").addEventListener("submit", event => {
  event.preventDefault();

  const city = $("city-input").value.trim();
  if (city) searchCity(city);
});

$("gps-button").addEventListener("click", useGPS);

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

// Close the city list when clicking outside it.
document.addEventListener("click", event => {
  const panel = $("city-results");
  if (!panel) return;

  if (
    !panel.contains(event.target) &&
    !$("search-form").contains(event.target)
  ) {
    hideCityResults();
  }
});

// Update clocks every second.
setInterval(formatClock, 1000);
formatClock();

// Initial location lookup.
if (!proxyIsConfigured()) {
  setStatus(
    "Setup needed: deploy the Cloudflare Worker, then paste its URL into PROXY_BASE in script.js."
  );
} else {
  useGPS();
        }
                          
