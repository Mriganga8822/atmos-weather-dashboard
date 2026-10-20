/*
 * ATMOS WEATHER DASHBOARD
 * Fixed city search, selected-location display, and request handling.
 * Cloudflare Worker URL unchanged.
 */

"use strict";

const PROXY_BASE =
  "https://atmos-weather-proxy.gamingmriganga.workers.dev";

const state = {
  unit: "C",
  weather: null,
  forecast: null,
  cityTimezoneOffset: 0,
  cityName: "",
  cityCountry: "",
  selectedLocation: null,
  requestId: 0,
  refreshTimer: null
};

const $ = id => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? "";
}

function setStatus(message, kind = "") {
  const element = $("status-message");
  if (!element) return;

  element.textContent = message;
  element.className = `status-message ${kind}`.trim();
}

async function proxyRequest(path, params = {}) {
  // Correctly remove any leading slash from the endpoint.
  const endpoint = path.replace(/^\/+/, "");

  const base = PROXY_BASE.endsWith("/")
    ? PROXY_BASE
    : `${PROXY_BASE}/`;

  const url = new URL(endpoint, base);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.message ||
      payload?.error ||
      `Weather request failed (${response.status}).`
    );
  }

  return payload;
}

function celsiusToFahrenheit(value) {
  return value * 9 / 5 + 32;
}

function temperatureValue(value) {
  const converted = state.unit === "C"
    ? value
    : celsiusToFahrenheit(value);

  return `${Math.round(converted)}°${state.unit}`;
}

function temperatureNumber(value) {
  const converted = state.unit === "C"
    ? value
    : celsiusToFahrenheit(value);

  return `${Math.round(converted)}°`;
}

function windValue(metersPerSecond) {
  const speed = state.unit === "C"
    ? metersPerSecond * 3.6
    : metersPerSecond * 2.236936;

  return `${Math.round(speed)} ${state.unit === "C" ? "km/h" : "mph"}`;
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

function formatCityTime(timestamp, options = {}) {
  const date = new Date((timestamp + state.cityTimezoneOffset) * 1000);

  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: "UTC"
  }).format(date);
}

function updateClocks() {
  const now = new Date();

  setText(
    "device-clock",
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(now)
  );

  setText(
    "device-clock-date",
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(now)
  );

  setText(
    "today-date",
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(now)
  );

  if (state.cityName) {
    const shifted = new Date(
      now.getTime() + state.cityTimezoneOffset * 1000
    );

    setText(
      "city-clock",
      new Intl.DateTimeFormat(undefined, {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }).format(shifted)
    );

    setText(
      "city-clock-date",
      new Intl.DateTimeFormat(undefined, {
        timeZone: "UTC",
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric"
      }).format(shifted)
    );
  }
}

/*
 * Render weather data while preserving the user's selected city name.
 * The displayed name does not depend on the API's nearby station name.
 */
function renderCurrent(data, selectedPlace = null) {
  state.weather = data;
  state.cityTimezoneOffset = Number(data.timezone || 0);

  state.cityName = selectedPlace?.name || data.name || "Selected city";
  state.cityCountry =
    selectedPlace?.country || data.sys?.country || "";

  const condition = data.weather?.[0] || {};
  const main = data.main || {};

  setText("location-name", state.cityName);

  setText(
    "location-meta",
    [
      selectedPlace?.state,
      state.cityCountry,
      `Updated ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })}`
    ].filter(Boolean).join(" · ")
  );

  setText("condition-pill", condition.main || "Weather");

  if (main.temp !== undefined) {
    setText(
      "temperature",
      Math.round(
        state.unit === "C"
          ? main.temp
          : celsiusToFahrenheit(main.temp)
      )
    );
  }

  setText(
    "description",
    condition.description || condition.main || "Current conditions"
  );

  if (main.feels_like !== undefined) {
    setText("feels-like", temperatureValue(main.feels_like));
  }

  setText("weather-art", weatherEmoji(condition.id));
  setText("humidity", main.humidity != null ? `${main.humidity}%` : "—");

  setText(
    "wind",
    data.wind?.speed != null ? windValue(data.wind.speed) : "—"
  );

  setText(
    "pressure",
    main.pressure != null ? `${main.pressure} hPa` : "—"
  );

  setText(
    "sunrise",
    data.sys?.sunrise
      ? formatCityTime(data.sys.sunrise, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        })
      : "—"
  );

  setText("city-clock-label", `${state.cityName.toUpperCase()} TIME`);

  updateClocks();
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function forecastBuckets(data) {
  const days = new Map();
  const offset = Number(data.city?.timezone || 0);

  for (const item of data.list || []) {
    const date = new Date((item.dt + offset) * 1000);

    const key = [
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    ].join("-");

    if (!days.has(key)) days.set(key, []);
    days.get(key).push({ ...item, localDate: date });
  }

  return [...days.values()].map(items => {
    const chosen = items.reduce((best, item) => {
      const currentDistance = Math.abs(
        item.localDate.getUTCHours() - 12
      );

      const bestDistance = Math.abs(
        best.localDate.getUTCHours() - 12
      );

      return currentDistance < bestDistance ? item : best;
    }, items[0]);

    return {
      date: chosen.localDate,
      min: Math.min(...items.map(item => item.main.temp_min)),
      max: Math.max(...items.map(item => item.main.temp_max)),
      weather: chosen.weather?.[0] || {}
    };
  }).slice(0, 5);
}

function renderForecast(data) {
  state.forecast = data;

  const host = $("forecast-list");
  if (!host) return;

  host.replaceChildren();

  const days = forecastBuckets(data);

  if (!days.length) {
    host.textContent = "No forecast data available.";
    return;
  }

  days.forEach((day, index) => {
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
      <div class="forecast-name">${escapeHTML(weekday)}</div>
      <div class="forecast-date">${escapeHTML(date)}</div>
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

/* City selection dropdown */
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

    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    (parent || form).appendChild(panel);
  }

  return panel;
}

const cityResults = setupCityResults();

function closeCityResults() {
  if (!cityResults) return;

  cityResults.hidden = true;
  cityResults.replaceChildren();
}

function showCityResults(results, requestId) {
  if (!cityResults) {
    setStatus(
      "City results panel is unavailable. Check search-form in index.html.",
      "error"
    );
    return;
  }

  cityResults.replaceChildren();

  if (!results.length) {
    const message = document.createElement("div");
    message.textContent = "No matching cities found.";
    message.style.padding = "12px";
    message.style.color = "#fff";

    cityResults.appendChild(message);
    cityResults.hidden = false;
    return;
  }

  results.forEach(place => {
    const button = document.createElement("button");
    button.type = "button";

    const label = [
      place.name,
      place.state,
      place.country
    ].filter(Boolean).join(", ");

    button.textContent = label;

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

    button.addEventListener("click", () => {
      if (requestId !== state.requestId) return;

      const lat = Number(place.lat);
      const lon = Number(place.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        setStatus("The selected city has invalid coordinates.", "error");
        return;
      }

      const selectedPlace = {
        name: place.name,
        state: place.state || "",
        country: place.country || "",
        lat,
        lon
      };

      state.selectedLocation = selectedPlace;
      closeCityResults();

      loadByCoordinates(
        lat,
        lon,
        "selected city",
        requestId,
        selectedPlace
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
      throw new Error(`No cities found for "${city}".`);
    }

    showCityResults(results, requestId);

    setStatus(
      `Found ${results.length} result(s). Select the correct city.`
    );
  } catch (error) {
    if (requestId !== state.requestId) return;

    setStatus(error.message || "City search failed.", "error");
  }
}

async function loadByCoordinates(
  lat,
  lon,
  label = "location",
  requestId = ++state.requestId,
  selectedPlace = null
) {
  const thisRequest = requestId;

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    setStatus("Invalid coordinates. Please search again.", "error");
    return;
  }

  setStatus(`Loading weather for ${selectedPlace?.name || label}…`);

  try {
    const [current, forecast] = await Promise.all([
      proxyRequest("weather", { lat, lon }),
      proxyRequest("forecast", { lat, lon })
    ]);

    // Ignore old responses after the user starts a newer search.
    if (thisRequest !== state.requestId) return;

    if (!current || !current.main || !Array.isArray(current.weather)) {
      throw new Error("The weather service returned invalid data.");
    }

    /*
     * Keep the selected city name for display.
     * Do not change the weather values or coordinates returned by the API.
     */
    renderCurrent(current, selectedPlace);
    renderForecast(forecast);

    if (selectedPlace) {
      setStatus(
        `Showing ${selectedPlace.name}, ${selectedPlace.country}.`,
        "success"
      );
    } else {
      setStatus(
        `Weather loaded for ${current.name || label}.`,
        "success"
      );
    }

    state.selectedLocation = selectedPlace || {
      lat: Number(lat),
      lon: Number(lon),
      name: current.name
    };

    if (state.refreshTimer) clearInterval(state.refreshTimer);

    state.refreshTimer = setInterval(() => {
      const location = state.selectedLocation;
      if (!location) return;

      const refreshRequestId = ++state.requestId;

      loadByCoordinates(
        location.lat,
        location.lon,
        "selected city",
        refreshRequestId,
        location.lat != null && location.lon != null &&
          location.country != null
          ? location
          : null
      );
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
    setStatus("Location is unavailable. Search for a city instead.", "error");
    return;
  }

  setStatus("Requesting your location…");

  navigator.geolocation.getCurrentPosition(
    position => {
      if (requestId !== state.requestId) return;

      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      loadByCoordinates(lat, lon, "GPS", requestId);
    },
    error => {
      if (requestId !== state.requestId) return;

      const message = error.code === 1
        ? "Location permission denied. Search for a city instead."
        : error.code === 2
          ? "Your location could not be determined. Search for a city instead."
          : "Location request timed out. Search for a city instead.";

      setStatus(message, "error");
    },
    {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 300000
    }
  );
}

/* Search form */
const searchForm = $("search-form");

if (searchForm) {
  searchForm.addEventListener("submit", event => {
    event.preventDefault();

    const input = $("city-input");
    const city = input?.value.trim();

    if (city) searchCity(city);
  });
}

/* Close dropdown when tapping outside it. */
document.addEventListener("click", event => {
  if (
    cityResults &&
    !event.target.closest("#city-results") &&
    !event.target.closest("#search-form")
  ) {
    closeCityResults();
  }
});

/* GPS button */
const gpsButton = $("gps-button");

if (gpsButton) {
  gpsButton.addEventListener("click", useGPS);
}

/* Celsius / Fahrenheit controls */
document.querySelectorAll(".unit-button").forEach(button => {
  button.addEventListener("click", () => {
    state.unit = button.dataset.unit === "F" ? "F" : "C";

    document.querySelectorAll(".unit-button").forEach(item => {
      const active = item === button;

      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });

    if (state.weather) {
      renderCurrent(state.weather, state.selectedLocation);
    }

    if (state.forecast) {
      renderForecast(state.forecast);
    }
  });
});

/* Live clocks */
updateClocks();
setInterval(updateClocks, 1000);

setStatus("Search for any city worldwide to see its weather.");
