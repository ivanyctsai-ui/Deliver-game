/**
 * game.js — Delivery Game (Lobby + Parallel + Linear modes)
 *
 * ARCHITECTURAL RULE (see CLAUDE.md §6):
 *   All JavaScript lives here. Guard coordinates with ?? fallback.
 */

"use strict";

// ── DOM References ─────────────────────────────────────────────────────────

const container       = document.querySelector(".container");
const headerSubtitle  = document.getElementById("header-subtitle");
const lobbySection    = document.getElementById("lobby-section");
const menuMain        = document.getElementById("menu-main");
const menuSub         = document.getElementById("menu-sub");
const menuSubTitle    = document.getElementById("menu-sub-title");
const btnParallelMode = document.getElementById("btn-parallel-mode");
const btnLinearMode   = document.getElementById("btn-linear-mode");
const btnPractice     = document.getElementById("btn-practice");
const btnRandom       = document.getElementById("btn-random");
const btnBackMenu     = document.getElementById("btn-back-menu");
const searchSection   = document.getElementById("search-section");
const searchInput     = document.getElementById("search-input");
const searchBtn       = document.getElementById("search-btn");
const statusMsg       = document.getElementById("search-status");
const resultsPanel    = document.getElementById("results-panel");
const resultsList     = document.getElementById("results-list");
const selectedPanel   = document.getElementById("selected-panel");
const selectedName    = document.getElementById("selected-name");
const selectedCoords  = document.getElementById("selected-coords");
const mapSection      = document.getElementById("map-section");
const mapEl           = document.getElementById("map");
const gameStageLabel  = document.getElementById("game-stage-label");
const gameTimeLabel   = document.getElementById("game-time-label");
const scorePanel      = document.getElementById("score-panel");
const undoBtn         = document.getElementById("undo-btn");
const evaluateBtn     = document.getElementById("evaluate-btn");

// ── Constants ───────────────────────────────────────────────────────────────

const RANDOM_CITIES = ["Taipei", "Tokyo", "New York", "London"];

// ── Game State ─────────────────────────────────────────────────────────────

/** @type {null | 'parallel' | 'linear'} */
let currentGameMode = null;

/** Parallel: {start, stage1, stage2, end}. Linear: {start, pois, end}. */
let levelData = null;

/** Parallel: 1 = Stage1, 2 = Stage2, 3 = End, 4 = finished */
let currentStage = 1;

/** Linear: stops visited in any order (max 5) */
/** @type {Array<object>} */
let visitedStops = [];

/** Linear: true after the End point is clicked */
let linearGameComplete = false;

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

// ── Lobby ───────────────────────────────────────────────────────────────────

function initLobby() {
  currentGameMode = null;
  showLobby();
  hideGameplayUi();
  headerSubtitle.textContent = "Choose a game mode to begin";
}

function showLobby() {
  lobbySection.classList.remove("hidden");
  menuMain.classList.remove("hidden");
  menuSub.classList.add("hidden");
}

function showSubMenu() {
  lobbySection.classList.remove("hidden");
  menuMain.classList.add("hidden");
  menuSub.classList.remove("hidden");
  const modeLabel = currentGameMode === "linear" ? "Linear" : "Parallel";
  menuSubTitle.textContent = `${modeLabel} Mode — Choose Setup`;
}

function hideLobby() {
  lobbySection.classList.add("hidden");
}

function hideGameplayUi() {
  searchSection.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  selectedPanel.classList.add("hidden");
  mapSection.classList.add("hidden");
  container.classList.remove("has-map");
  clearResults();
  showGameControls(false);
}

function showPracticeSearch() {
  hideLobby();
  searchSection.classList.remove("hidden");
  searchInput.value = "";
  clearResults();
  setStatus("Search for your practice start location.", "");
  headerSubtitle.textContent =
    `${currentGameMode === "linear" ? "Linear" : "Parallel"} — Practice Mode`;
}

function selectGameMode(mode) {
  currentGameMode = mode;
  showSubMenu();
}

async function startRandomMode() {
  if (!currentGameMode) {
    return;
  }

  hideLobby();
  hideGameplayUi();
  const city = RANDOM_CITIES[Math.floor(Math.random() * RANDOM_CITIES.length)];
  setStatus(`Loading random city: ${city}…`, "");

  try {
    const response = await fetch(
      `${API_BASE}/api/search?q=${encodeURIComponent(city)}&limit=1`,
    );

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const results = await response.json();

    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`No results for ${city}.`);
    }

    const lat = results[0].lat ?? results[0].latitude;
    const lon = results[0].lon ?? results[0].longitude ?? results[0].lng;

    if (lat == null || lon == null) {
      throw new Error("Random city result missing coordinates.");
    }

    await loadLevel({
      name: results[0].name || city,
      lat,
      lon,
    });
  } catch (err) {
    setStatus(`Random mode failed: ${err.message}`, "error");
    showSubMenu();
  }
}

// ── Search (Practice) ───────────────────────────────────────────────────────

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    setStatus("Please enter a location to search.", "");
    return;
  }

  setLoading(true);
  clearResults();
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

// ── Level Load ──────────────────────────────────────────────────────────────

async function loadLevel(location) {
  if (!currentGameMode) {
    return;
  }

  resetGameState();
  hideLobby();
  searchSection.classList.add("hidden");
  resultsPanel.classList.add("hidden");

  selectedPanel.classList.remove("hidden");
  selectedName.textContent = location.name;
  selectedCoords.textContent = `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`;

  setStatus("Generating delivery level…", "");
  mapSection.classList.remove("hidden");
  container.classList.add("has-map");
  showGameControls(false);

  try {
    const params = new URLSearchParams({
      lat:   String(location.lat),
      lon:   String(location.lon),
      name:  location.name,
      mode:  currentGameMode,
    });
    const response = await fetch(`${API_BASE}/api/generate_level?${params}`);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `Server error: ${response.status}`);
    }

    const level = await response.json();
    levelData = parseLevelResponse(level);

    lastPoint = coordPayload(levelData.start);
    currentStage = 1;
    visitedStops = [];
    linearGameComplete = false;

    renderMap(levelData);
    showGameControls(true);
    updateGameHud();
    setStatus(getStageHint(), "success");
    headerSubtitle.textContent =
      `${currentGameMode === "linear" ? "Linear" : "Parallel"} — ${location.name}`;
  } catch (err) {
    setStatus(`Failed to load level: ${err.message}`, "error");
    hideMap();
    showLobby();
  }
}

/**
 * @param {object} level
 */
function parseLevelResponse(level) {
  if (!level.start) {
    throw new Error("Invalid level data from server.");
  }

  const start = normalisePoint(level.start, "start");

  if (currentGameMode === "linear") {
    if (!Array.isArray(level.pois) || level.pois.length !== 5 || !level.end) {
      throw new Error("Invalid linear level data from server.");
    }
    return {
      start,
      pois: level.pois.map((p, i) => normalisePoint(p, "stop", i)),
      end:  normalisePoint(level.end, "end"),
    };
  }

  if (!level.stage1 || !level.stage2 || !level.end) {
    throw new Error("Invalid parallel level data from server.");
  }

  return {
    start:  start,
    stage1: level.stage1.map((p, i) => normalisePoint(p, "stage1", i)),
    stage2: level.stage2.map((p, i) => normalisePoint(p, "stage2", i)),
    end:    normalisePoint(level.end, "end"),
  };
}

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

/**
 * Plain {lat, lon} for API payloads — never pass Leaflet objects to JSON.stringify.
 * @param {object} point
 * @returns {{ lat: number, lon: number }}
 */
function coordPayload(point) {
  const lat = point?.lat ?? point?.latitude;
  const lon = point?.lon ?? point?.longitude ?? point?.lng;
  return { lat: Number(lat), lon: Number(lon) };
}

/**
 * Copy POI fields only (strips _marker and other Leaflet references).
 * @param {object} poi
 * @returns {{ id: string, name: string, lat: number, lon: number, role: string }}
 */
function cleanPoiData(poi) {
  const { lat, lon } = coordPayload(poi);
  return {
    id:   poi.id,
    name: poi.name,
    lat,
    lon,
    role: poi.role,
  };
}

function resetGameState() {
  levelData = null;
  currentStage = 1;
  pathHistory = [];
  visitedStops = [];
  linearGameComplete = false;
  lastPoint = null;
  totalTimeSec = 0;
  gameBusy = false;
  scorePanel.classList.add("hidden");
  scorePanel.textContent = "";
  scorePanel.classList.remove("success");
}

function isParallelMode() {
  return currentGameMode === "parallel";
}

function isGameFinished() {
  return isParallelMode() ? currentStage === 4 : linearGameComplete;
}

function isStopVisited(poiId) {
  return visitedStops.some((s) => s.id === poiId);
}

// ── Playable Game Loop ──────────────────────────────────────────────────────

/**
 * @param {object} poi
 * @param {string} role
 */
async function handlePoiClick(poi, role) {
  if (!levelData || gameBusy || isGameFinished()) {
    return;
  }

  if (isParallelMode()) {
    await handleParallelPoiClick(poi, role);
    return;
  }

  await handleLinearPoiClick(poi, role);
}

/** @param {object} poi @param {"stage1" | "stage2" | "end"} role */
async function handleParallelPoiClick(poi, role) {
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

  const stageAtClick = currentStage;

  await commitRouteLeg(poi, stageAtClick, () => {
    if (stageAtClick === 3) {
      currentStage = 4;
      evaluateBtn.disabled = false;
      setPlayStatus("Route complete! Click Evaluate Route to compare with optimal.", "success");
    } else {
      currentStage = stageAtClick + 1;
      setPlayStatus(getStageHint(), "success");
    }
  });
}

/** @param {object} poi @param {"stop" | "end"} role */
async function handleLinearPoiClick(poi, role) {
  if (role === "stop") {
    if (visitedStops.length >= 5) {
      alert("You already visited all 5 stops. Click the End point!");
      return;
    }
    if (isStopVisited(poi.id)) {
      alert("You already visited this stop!");
      return;
    }

    const poiData = cleanPoiData(poi);

    await commitRouteLeg(poiData, visitedStops.length + 1, () => {
      visitedStops.push(poiData);
      refreshStopMarkerStyle(poiData.id);
      if (visitedStops.length === 5) {
        setPlayStatus("All stops visited! Click the black End point.", "success");
      } else {
        setPlayStatus(getStageHint(), "success");
      }
    });
    return;
  }

  if (role === "end") {
    if (visitedStops.length < 5) {
      alert(`Visit all 5 stops first! (${visitedStops.length}/5 done)`);
      return;
    }

    await commitRouteLeg(poi, 6, () => {
      linearGameComplete = true;
      evaluateBtn.disabled = false;
      setPlayStatus("Route complete! Click Evaluate Route to compare with optimal.", "success");
    });
  }
}

/**
 * @param {object} poi
 * @param {number} stage
 * @param {() => void} onSuccess
 */
async function commitRouteLeg(poi, stage, onSuccess) {
  if (!lastPoint) {
    setStatus("Route error: no active position.", "error");
    return;
  }

  gameBusy = true;
  setPlayStatus("Calculating route…", "");

  const fromCoord = coordPayload(lastPoint);
  const toCoord = coordPayload(poi);
  const poiRecord = cleanPoiData(poi);

  try {
    const leg = await fetchRouteLeg(fromCoord, toCoord);
    addRouteLeg(leg.geometry, leg.duration_sec, stage, poiRecord, fromCoord, toCoord);

    totalTimeSec += leg.duration_sec;
    lastPoint = toCoord;

    onSuccess();
    updateGameHud();
  } catch (err) {
    setPlayStatus(`Route failed: ${err.message}`, "error");
  } finally {
    gameBusy = false;
  }
}

async function fetchRouteLeg(from, to) {
  const payload = {
    from: coordPayload(from),
    to:   coordPayload(to),
  };

  const response = await fetch(`${API_BASE}/api/route_leg`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
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

function addRouteLeg(geometry, durationSec, stage, poi, fromCoord, toCoord) {
  if (!mapInstance || !userRouteLayerGroup) {
    return;
  }

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
    from: coordPayload(fromCoord),
    to:   coordPayload(toCoord),
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

  if (isParallelMode()) {
    undoParallelStep(last);
  } else {
    undoLinearStep(last);
  }

  scorePanel.classList.add("hidden");
  clearOptimalRoute();
  evaluateBtn.disabled = true;
  undoBtn.disabled = pathHistory.length === 0;
  updateGameHud();
  setStatus(getStageHint(), "");
}

function undoParallelStep(last) {
  if (pathHistory.length === 0) {
    lastPoint = coordPayload(levelData.start);
    currentStage = 1;
  } else {
    const prev = pathHistory[pathHistory.length - 1];
    lastPoint = coordPayload(prev.to);
    currentStage = prev.stage + 1;
  }
}

/**
 * Resolve the map POI (with Leaflet marker ref) by id — never use API payload objects.
 * @param {object|string} poiOrId
 */
function findMapPoi(poiOrId) {
  if (!levelData) {
    return null;
  }
  const id = typeof poiOrId === "string" ? poiOrId : poiOrId.id;
  if (levelData.pois) {
    return levelData.pois.find((p) => p.id === id) || null;
  }
  const all = [
    ...(levelData.stage1 || []),
    ...(levelData.stage2 || []),
    levelData.end,
  ].filter(Boolean);
  return all.find((p) => p.id === id) || null;
}

function refreshStopMarkerStyle(poiRef) {
  const poi = findMapPoi(poiRef);
  if (!poi?._marker || !levelData?.pois) {
    return;
  }
  const idx = levelData.pois.findIndex((p) => p.id === poi.id);
  const label = idx >= 0 ? `P${idx + 1}` : "P";
  poi._marker.setIcon(createPinIcon("stop", label, isStopVisited(poi.id)));
}

function undoLinearStep(last) {
  linearGameComplete = false;

  if (last.poi.role === "stop") {
    visitedStops = visitedStops.filter((s) => s.id !== last.poi.id);
    refreshStopMarkerStyle(last.poi);
  }

  if (pathHistory.length === 0) {
    lastPoint = coordPayload(levelData.start);
    visitedStops = [];
  } else {
    const prev = pathHistory[pathHistory.length - 1];
    lastPoint = coordPayload(prev.to);
  }
}

function getStageHint() {
  if (isParallelMode()) {
    if (currentStage === 1) return "Click an orange Stage 1 stop.";
    if (currentStage === 2) return "Click a purple Stage 2 stop.";
    if (currentStage === 3) return "Click the black End point.";
    return "Route complete — evaluate when ready.";
  }

  if (visitedStops.length < 5) {
    return `Click a teal stop (${visitedStops.length}/5 visited). Any order is fine.`;
  }
  if (!linearGameComplete) {
    return "Click the black End point.";
  }
  return "Route complete — evaluate when ready.";
}

function updateGameHud() {
  if (!gameBusy) {
    gameStageLabel.textContent = getStageHint();
    gameStageLabel.style.color = "";
  }
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
  if (!levelData || !isGameFinished()) {
    alert("Finish your route by clicking the End point first.");
    return;
  }

  gameBusy = true;
  evaluateBtn.disabled = true;
  setStatus("Computing optimal route…", "");

  try {
    const endpoint =
      currentGameMode === "linear" ? "/api/solve_linear" : "/api/solve_parallel";
    const body = buildEvaluatePayload();

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
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

function buildEvaluatePayload() {
  if (isParallelMode()) {
    return {
      start:  coordPayload(levelData.start),
      stage1: levelData.stage1.map((p) => coordPayload(p)),
      stage2: levelData.stage2.map((p) => coordPayload(p)),
      end:    coordPayload(levelData.end),
    };
  }

  return {
    start: coordPayload(levelData.start),
    pois:  levelData.pois.map((p) => coordPayload(p)),
    end:   coordPayload(levelData.end),
  };
}

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

  if (isParallelMode()) {
    level.stage1.forEach((poi, i) => {
      addGameMarker(poi, "stage1", `S1-${i + 1}`);
      bounds.extend([poi.lat, poi.lon]);
    });
    level.stage2.forEach((poi, i) => {
      addGameMarker(poi, "stage2", `S2-${i + 1}`);
      bounds.extend([poi.lat, poi.lon]);
    });
  } else {
    level.pois.forEach((poi, i) => {
      addGameMarker(poi, "stop", `P${i + 1}`);
      bounds.extend([poi.lat, poi.lon]);
    });
  }

  addGameMarker(level.end, "end", "END");
  bounds.extend([level.end.lat, level.end.lon]);

  if (bounds.isValid()) {
    mapInstance.fitBounds(bounds.pad(0.12));
  }

  requestAnimationFrame(() => {
    mapInstance.invalidateSize();
  });
}

function addGameMarker(poi, role, shortLabel) {
  const visited = role === "stop" && isStopVisited(poi.id);
  const marker = L.marker([poi.lat, poi.lon], {
    icon: createPinIcon(role, shortLabel, visited),
  });

  marker.bindTooltip(escapeHtml(poi.name), {
    direction: "top",
    offset:    [0, -14],
    opacity:   0.95,
  });

  if (role !== "start") {
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      const poiData = cleanPoiData(poi);
      if (isParallelMode()) {
        handleParallelPoiClick(poiData, role);
      } else {
        handleLinearPoiClick(poiData, role);
      }
    });
  }

  markerLayer.addLayer(marker);
  poi._marker = marker;
}

function createPinIcon(role, shortLabel, visited = false) {
  const colorClass = `marker-pin__dot--${role}`;
  const visitedClass = visited ? " marker-pin--visited" : "";
  return L.divIcon({
    className: `marker-pin${visitedClass}`,
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

function returnToLobby() {
  hideMap();
  hideGameplayUi();
  currentGameMode = null;
  initLobby();
}

// ── UI Helpers ─────────────────────────────────────────────────────────────

function clearResultsList() {
  resultsList.innerHTML = "";
}

function showResultsPanel() {
  resultsPanel.classList.remove("hidden");
}

function hideResultsPanel() {
  resultsPanel.classList.add("hidden");
}

function clearResults() {
  clearResultsList();
  hideResultsPanel();
}

function renderResults(results) {
  clearResultsList();

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

    li.addEventListener("click", () => loadLevel({ name: poi.name, lat, lon }));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        loadLevel({ name: poi.name, lat, lon });
      }
    });

    resultsList.appendChild(li);
  });

  if (results.length > 0) {
    showResultsPanel();
  } else {
    hideResultsPanel();
  }
}

function setStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg ${type}`.trim();
}

/** Update HUD during gameplay (search panel may be hidden). */
function setPlayStatus(message, type) {
  setStatus(message, type);
  gameStageLabel.textContent = message;
  if (type === "error") {
    gameStageLabel.style.color = "var(--error)";
  } else if (type === "success") {
    gameStageLabel.style.color = "var(--success)";
  } else {
    gameStageLabel.style.color = "";
  }
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

btnParallelMode.addEventListener("click", () => selectGameMode("parallel"));
btnLinearMode.addEventListener("click", () => selectGameMode("linear"));
btnPractice.addEventListener("click", showPracticeSearch);
btnRandom.addEventListener("click", startRandomMode);
btnBackMenu.addEventListener("click", () => {
  currentGameMode = null;
  hideGameplayUi();
  showLobby();
  headerSubtitle.textContent = "Choose a game mode to begin";
});

searchBtn.addEventListener("click", performSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});

undoBtn.addEventListener("click", undoLastStep);
evaluateBtn.addEventListener("click", evaluateRoute);

initLobby();

function getSelectedLocation() {
  return levelData ? levelData.start : null;
}
