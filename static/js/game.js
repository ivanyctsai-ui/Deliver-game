/**
 * game.js — Delivery Game Frontend (Playable Parallel Mode)
 *
 * ARCHITECTURAL RULE (see CLAUDE.md §6):
 *   All JavaScript lives here. Guard coordinates with ?? fallback.
 */

"use strict";

// ── DOM References ─────────────────────────────────────────────────────────

const container        = document.querySelector(".container");
const searchInput      = document.getElementById("search-input");
const searchBtn        = document.getElementById("search-btn");
const statusMsg        = document.getElementById("search-status");
const resultsPanel     = document.querySelector(".results-panel");
const resultsList      = document.getElementById("results-list");
const selectedPanel    = document.getElementById("selected-panel");
const selectedName     = document.getElementById("selected-name");
const selectedCoords   = document.getElementById("selected-coords");
const mapSection       = document.getElementById("map-section");
const mapEl            = document.getElementById("map");
const gameStageLabel   = document.getElementById("game-stage-label");
const gameTimeLabel    = document.getElementById("game-time-label");
const scorePanel       = document.getElementById("score-panel");
const undoBtn          = document.getElementById("undo-btn");
const evaluateBtn      = document.getElementById("evaluate-btn");

// ── Game State ─────────────────────────────────────────────────────────────

/** @type {{ start: object, stage1: object[], stage2: object[], end: object } | null} */
let levelData = null;

/** 1 = pick stage1, 2 = pick stage2, 3 = pick end, 4 = finished */
let currentStage = 1;

/** @type {Array<{stage: number, poi: object, durationSec: number, polyline: L.Polyline, from: object, to: object}>} */
let pathHistory = [];

/** @type {{ lat: number, lon: number }} */
let lastPoint = null;

let totalTimeSec = 0;
let gameBusy = false;

/** @type {L.Map | null} */
let mapInstance = null;

/** @type {L.LayerGroup | null} */
let markerLayer = null;

/** @type {L.LayerGroup | null} */
let userRouteLayerGroup = null;

/** @type {L.Polyline | null} */
let optimalRouteLayer = null;

// ── Search ─────────────────────────────────────────────────────────────────

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    setStatus("Please enter a location to search.", "");
    return;
  }

  setLoading(true);
  clearResults();
  hideMap();
  selectedPanel.classList.add("hidden");
  setStatus("Searching…", "");

  try {
    const url = `${API_BASE}/api/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const results = await response.json();

    if (!Array.isArray(results)) {
      throw new Error("Unexpected response format from server.");
    }

    resultsPanel.classList.remove("hidden");
    renderResults(results);

    if (results.length === 0) {
      setStatus("No locations found. Try a different search.", "");
    } else {
      setStatus(`Found ${results.length} result${results.length !== 1 ? "s" : ""}.`, "success");
    }
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, "error");
    clearResults();
  } finally {
    setLoading(false);
  }
}

function renderResults(results) {
  clearResults();

  results.forEach((poi, index) => {
    const lat = poi.lat ?? poi.latitude;
    const lon = poi.lon ?? poi.longitude ?? poi.lng;

    if (lat == null || lon == null) {
      console.warn(`[game.js] Skipping result #${index} — missing coordinates:`, poi);
      return;
    }

    const li = document.createElement("li");
    li.className = "result-item";
    li.setAttribute("role", "listitem");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-label", poi.name);

    li.innerHTML = `
      <span class="result-name">${escapeHtml(poi.name)}</span>
      <span class="result-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>
    `;

    li.addEventListener("click", () => selectLocation({ name: poi.name, lat, lon }));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectLocation({ name: poi.name, lat, lon });
      }
    });

    resultsList.appendChild(li);
  });
}

// ── Level Load ──────────────────────────────────────────────────────────────

async function selectLocation(location) {
  resetGameState();

  selectedPanel.classList.remove("hidden");
  selectedName.textContent = location.name;
  selectedCoords.textContent = `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`;

  clearResults();
  resultsPanel.classList.add("hidden");

  setStatus("Generating delivery level…", "");
  mapSection.classList.remove("hidden");
  container.classList.add("has-map");
  showGameControls(false);

  try {
    const params = new URLSearchParams({
      lat:  String(location.lat),
      lon:  String(location.lon),
      name: location.name,
    });
    const response = await fetch(`${API_BASE}/api/generate_level?${params}`);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error: ${response.status}`);
    }

    const level = await response.json();

    if (!level.start || !level.stage1 || !level.stage2 || !level.end) {
      throw new Error("Invalid level data from server.");
    }

    levelData = {
      start:  normalisePoint(level.start, "start"),
      stage1: level.stage1.map((p, i) => normalisePoint(p, "stage1", i)),
      stage2: level.stage2.map((p, i) => normalisePoint(p, "stage2", i)),
      end:    normalisePoint(level.end, "end"),
    };

    lastPoint = { lat: levelData.start.lat, lon: levelData.start.lon };
    currentStage = 1;

    renderMap(levelData);
    showGameControls(true);
    updateGameHud();
    setStatus("Click an orange Stage 1 stop to begin your route.", "success");
  } catch (err) {
    setStatus(`Failed to load level: ${err.message}`, "error");
    hideMap();
  }
}

/**
 * @param {object} poi
 * @param {string} role
 * @param {number} [index]
 */
function normalisePoint(poi, role, index = 0) {
  const lat = poi.lat ?? poi.latitude;
  const lon = poi.lon ?? poi.longitude ?? poi.lng;
  if (lat == null || lon == null) {
    throw new Error(`Missing coordinates for ${role}`);
  }
  return {
    id:   poi.id || `${role}-${index}`,
    name: poi.name || role,
    lat:  Number(lat),
    lon:  Number(lon),
    role: poi.role || role,
  };
}

function resetGameState() {
  levelData = null;
  currentStage = 1;
  pathHistory = [];
  lastPoint = null;
  totalTimeSec = 0;
  gameBusy = false;
  scorePanel.classList.add("hidden");
  scorePanel.textContent = "";
  scorePanel.classList.remove("success");
}

// ── Playable Game Loop ──────────────────────────────────────────────────────

/**
 * @param {object} poi
 * @param {"stage1" | "stage2" | "end"} role
 */
async function handlePoiClick(poi, role) {
  if (!levelData || gameBusy || currentStage > 3) {
    return;
  }

  if (role === "stage2" && currentStage === 1) {
    alert("You must select a Stage 1 location first!");
    return;
  }
  if (role === "stage1" && currentStage !== 1) {
    alert("You already selected Stage 1. Pick a purple Stage 2 stop next.");
    return;
  }
  if (role === "stage2" && currentStage !== 2) {
    if (currentStage === 1) {
      alert("You must select a Stage 1 location first!");
    } else {
      alert("Pick the black End point to finish your route.");
    }
    return;
  }
  if (role === "end" && currentStage !== 3) {
    if (currentStage === 1) {
      alert("You must select a Stage 1 location first!");
    } else if (currentStage === 2) {
      alert("You must select a Stage 2 location before the End!");
    }
    return;
  }

  gameBusy = true;
  setStatus("Calculating route…", "");

  try {
    const leg = await fetchRouteLeg(lastPoint, poi);
    addRouteLeg(leg.geometry, leg.duration_sec, currentStage, poi);

    totalTimeSec += leg.duration_sec;
    lastPoint = { lat: poi.lat, lon: poi.lon };

    if (currentStage === 3) {
      currentStage = 4;
      evaluateBtn.disabled = false;
      setStatus("Route complete! Click Evaluate Route to compare with optimal.", "success");
    } else {
      currentStage += 1;
      setStatus(getStageHint(), "success");
    }

    updateGameHud();
  } catch (err) {
    setStatus(`Route failed: ${err.message}`, "error");
  } finally {
    gameBusy = false;
  }
}

/**
 * @param {{ lat: number, lon: number }} from
 * @param {{ lat: number, lon: number }} to
 */
async function fetchRouteLeg(from, to) {
  const response = await fetch(`${API_BASE}/api/route_leg`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ from, to }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Server error: ${response.status}`);
  }

  if (!Array.isArray(data.geometry) || data.geometry.length === 0) {
    throw new Error("No route geometry returned.");
  }

  return {
    geometry:     data.geometry,
    duration_sec: Number(data.duration_sec) || 0,
  };
}

/**
 * @param {Array<[number, number]>} geometry
 * @param {number} durationSec
 * @param {number} stage
 * @param {object} poi
 */
function addRouteLeg(geometry, durationSec, stage, poi) {
  if (!mapInstance || !userRouteLayerGroup) {
    return;
  }

  const from = { ...lastPoint };
  const to = { lat: poi.lat, lon: poi.lon };

  const polyline = L.polyline(geometry, {
    color:    "#3b82f6",
    weight:   5,
    opacity:  0.9,
    lineJoin: "round",
  }).addTo(userRouteLayerGroup);

  pathHistory.push({
    stage,
    poi,
    durationSec,
    polyline,
    from,
    to,
  });

  undoBtn.disabled = false;
}

function undoLastStep() {
  if (pathHistory.length === 0 || gameBusy) {
    return;
  }

  const last = pathHistory.pop();
  userRouteLayerGroup.removeLayer(last.polyline);
  totalTimeSec = Math.max(0, totalTimeSec - last.durationSec);

  if (pathHistory.length === 0) {
    lastPoint = {
      lat: levelData.start.lat,
      lon: levelData.start.lon,
    };
    currentStage = 1;
    evaluateBtn.disabled = true;
  } else {
    const prev = pathHistory[pathHistory.length - 1];
    lastPoint = { lat: prev.to.lat, lon: prev.to.lon };
    currentStage = last.stage + 1;
    evaluateBtn.disabled = true;
  }

  scorePanel.classList.add("hidden");
  clearOptimalRoute();
  undoBtn.disabled = pathHistory.length === 0;
  updateGameHud();
  setStatus(getStageHint(), "");
}

function getStageHint() {
  if (currentStage === 1) {
    return "Click an orange Stage 1 stop.";
  }
  if (currentStage === 2) {
    return "Click a purple Stage 2 stop.";
  }
  if (currentStage === 3) {
    return "Click the black End point.";
  }
  return "Route complete — evaluate when ready.";
}

function updateGameHud() {
  gameStageLabel.textContent = getStageHint();
  const mins = (totalTimeSec / 60).toFixed(1);
  gameTimeLabel.textContent =
    pathHistory.length > 0
      ? `Your route time so far: ${mins} min`
      : "No route legs yet.";
}

function showGameControls(visible) {
  undoBtn.classList.toggle("hidden", !visible);
  evaluateBtn.classList.toggle("hidden", !visible);
  undoBtn.disabled = true;
  evaluateBtn.disabled = true;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

async function evaluateRoute() {
  if (!levelData || currentStage !== 4) {
    alert("Finish your route by clicking the End point first.");
    return;
  }

  gameBusy = true;
  evaluateBtn.disabled = true;
  setStatus("Computing optimal route…", "");

  try {
    const response = await fetch(`${API_BASE}/api/solve_parallel`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        start:  { lat: levelData.start.lat, lon: levelData.start.lon },
        stage1: levelData.stage1.map((p) => ({ lat: p.lat, lon: p.lon })),
        stage2: levelData.stage2.map((p) => ({ lat: p.lat, lon: p.lon })),
        end:    { lat: levelData.end.lat, lon: levelData.end.lon },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Server error: ${response.status}`);
    }

    const userMin = totalTimeSec / 60;
    const optimalSec = data.matrix_duration_sec ?? data.duration_sec ?? 0;
    const optimalMin = optimalSec / 60;
    const deltaMin = Math.max(0, userMin - optimalMin);

    drawOptimalRoute(data.geometry);

    const msg =
      `Your time: ${userMin.toFixed(1)} mins. ` +
      `Optimal time: ${optimalMin.toFixed(1)} mins. ` +
      `You were ${deltaMin.toFixed(1)} mins slower!`;

    alert(msg);
    scorePanel.textContent = msg;
    scorePanel.classList.remove("hidden");
    scorePanel.classList.add("success");
    setStatus("Evaluation complete — green line is the optimal route.", "success");
  } catch (err) {
    setStatus(`Evaluation failed: ${err.message}`, "error");
    evaluateBtn.disabled = false;
  } finally {
    gameBusy = false;
  }
}

/**
 * @param {Array<[number, number]>} geometry
 */
function drawOptimalRoute(geometry) {
  if (!mapInstance || !Array.isArray(geometry) || geometry.length === 0) {
    return;
  }

  clearOptimalRoute();

  optimalRouteLayer = L.polyline(geometry, {
    color:    "#22c55e",
    weight:   8,
    opacity:  0.75,
    lineJoin: "round",
  }).addTo(mapInstance);

  const allBounds = L.latLngBounds(geometry);
  if (userRouteLayerGroup) {
    userRouteLayerGroup.eachLayer((layer) => {
      if (layer.getBounds) {
        allBounds.extend(layer.getBounds());
      }
    });
  }
  mapInstance.fitBounds(allBounds.pad(0.12));
}

function clearOptimalRoute() {
  if (optimalRouteLayer && mapInstance) {
    mapInstance.removeLayer(optimalRouteLayer);
    optimalRouteLayer = null;
  }
}

function clearUserRoutes() {
  if (userRouteLayerGroup) {
    userRouteLayerGroup.clearLayers();
  }
}

// ── Leaflet Map ─────────────────────────────────────────────────────────────

function renderMap(level) {
  if (typeof L === "undefined") {
    setStatus("Map library failed to load.", "error");
    return;
  }

  destroyMap();

  mapInstance = L.map(mapEl, { scrollWheelZoom: true }).setView(
    [level.start.lat, level.start.lon],
    15,
  );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInstance);

  markerLayer = L.layerGroup().addTo(mapInstance);
  userRouteLayerGroup = L.layerGroup().addTo(mapInstance);

  const bounds = L.latLngBounds([[level.start.lat, level.start.lon]]);

  addGameMarker(level.start, "start", "START");
  bounds.extend([level.start.lat, level.start.lon]);

  level.stage1.forEach((poi, i) => {
    addGameMarker(poi, "stage1", `S1-${i + 1}`);
    bounds.extend([poi.lat, poi.lon]);
  });

  level.stage2.forEach((poi, i) => {
    addGameMarker(poi, "stage2", `S2-${i + 1}`);
    bounds.extend([poi.lat, poi.lon]);
  });

  addGameMarker(level.end, "end", "END");
  bounds.extend([level.end.lat, level.end.lon]);

  if (bounds.isValid()) {
    mapInstance.fitBounds(bounds.pad(0.12));
  }

  requestAnimationFrame(() => {
    mapInstance.invalidateSize();
  });
}

/**
 * @param {object} poi
 * @param {"start" | "stage1" | "stage2" | "end"} role
 * @param {string} shortLabel
 */
function addGameMarker(poi, role, shortLabel) {
  const marker = L.marker([poi.lat, poi.lon], {
    icon: createPinIcon(role, shortLabel),
  });

  marker.bindTooltip(escapeHtml(poi.name), {
    direction: "top",
    offset:    [0, -14],
    opacity:   0.95,
  });

  if (role !== "start") {
    marker.on("click", () => handlePoiClick(poi, role));
  }

  markerLayer.addLayer(marker);
}

/**
 * @param {"start" | "stage1" | "stage2" | "end"} role
 * @param {string} shortLabel
 * @returns {L.DivIcon}
 */
function createPinIcon(role, shortLabel) {
  const colorClass = `marker-pin__dot--${role}`;
  return L.divIcon({
    className: "marker-pin",
    html: `
      <div class="marker-pin__dot ${colorClass}"></div>
      <span class="marker-pin__label">${escapeHtml(shortLabel)}</span>
    `,
    iconSize:   [32, 38],
    iconAnchor: [16, 18],
  });
}

function destroyMap() {
  clearOptimalRoute();
  clearUserRoutes();
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
    markerLayer = null;
    userRouteLayerGroup = null;
  }
}

function hideMap() {
  mapSection.classList.add("hidden");
  container.classList.remove("has-map");
  resetGameState();
  showGameControls(false);
  destroyMap();
}

// ── UI Helpers ─────────────────────────────────────────────────────────────

function clearResults() {
  resultsList.innerHTML = "";
}

function setStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg ${type}`.trim();
}

function setLoading(loading) {
  searchBtn.disabled = loading;
  searchBtn.textContent = loading ? "Searching…" : "Search";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Event Listeners ────────────────────────────────────────────────────────

searchBtn.addEventListener("click", performSearch);

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});

undoBtn.addEventListener("click", undoLastStep);
evaluateBtn.addEventListener("click", evaluateRoute);

function getSelectedLocation() {
  return levelData ? levelData.start : null;
}
