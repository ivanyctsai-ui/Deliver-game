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
const resultsPagination = document.getElementById("results-pagination");
const resultsPrev     = document.getElementById("results-prev");
const resultsNext     = document.getElementById("results-next");
const resultsPageInfo = document.getElementById("results-page-info");
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
const btnQuitGame     = document.getElementById("btn-quit-game");
const btnSearchAnother = document.getElementById("btn-search-another");
const survivalStats   = document.getElementById("survival-stats");
const hpDisplay       = document.getElementById("hp-display");
const levelDisplay    = document.getElementById("level-display");
const nextLevelBtn    = document.getElementById("next-level-btn");
const gameOverPanel   = document.getElementById("game-over-panel");
const gameOverMessage = document.getElementById("game-over-message");
const restartGameBtn  = document.getElementById("restart-game-btn");
const btnSearchBack   = document.getElementById("btn-search-back");
const toastStack      = document.getElementById("toast-stack");
const btnFoliumReport = document.getElementById("btn-folium-report");

// ── Constants ───────────────────────────────────────────────────────────────

const RANDOM_CITIES = [
  "Taipei",
  "Shinjuku, Tokyo",      // 指定新宿區，避開大公園與海灣
  "Seoul",
  "Downtown Core, Singapore", // 指定新加坡市中心，完美避開蓄水池
  "Hong Kong",
  "Bangkok",
  "Sydney",
  "London",
  "Paris",
  "Berlin",
  "Manhattan, New York",  // 指定曼哈頓，完美的棋盤格街道
  "Los Angeles",
  "Chicago",
  "Toronto",
  "São Paulo",
  "Mexico City",
  "Dubai",
  "Nagoya",               // 替換掉伊斯坦堡，擁有極佳的都市路網
];

const START_OFFSET_DEG = 0.004;

const SEARCH_FETCH_LIMIT = 15;
const SEARCH_PAGE_SIZE   = 5;

/** @type {Array<{name: string, lat: number, lon: number}>} */
let cachedSearchResults = [];
let searchResultsPage = 0;

/** Immersive map marker labels */
const LABEL_DISPATCH = "[DISPATCH]";
const LABEL_CLIENT   = "[CLIENT]";
const LABEL_PICKUP_A = "[PICKUP A]";
const LABEL_PICKUP_B = "[PICKUP B]";
const LABEL_DROP_OFF = "[DROP-OFF]";

/** Route polyline styling (see style.css for flowing-route animation) */
const ROUTE_USER_COLOR     = "#ec4899";
const ROUTE_USER_WEIGHT    = 7;
const ROUTE_USER_OPACITY   = 0.8;
const ROUTE_USER_CLASS     = "flowing-route";
const ROUTE_OPTIMAL_COLOR    = "#10b981";
const ROUTE_OPTIMAL_WEIGHT   = 4;
const ROUTE_OPTIMAL_OPACITY  = 0.85;
const ROUTE_OPTIMAL_CLASS    = "optimal-flowing-route";

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

/** Endless Survival (Random Mode) */
let isSurvivalMode = false;
let playerHP = 100;
let currentLevel = 1;

/** True after a successful route evaluation — locks undo until a new run. */
let routeEvaluated = false;

// ── Lobby ───────────────────────────────────────────────────────────────────

function initLobby() {
  currentGameMode = null;
  isSurvivalMode = false;
  showLobby();
  hideGameplayUi();
  hideSurvivalOverlays();
  headerSubtitle.textContent = "Choose a game mode to begin";
}

function resetSurvivalProgress() {
  playerHP = 100;
  currentLevel = 1;
  updateSurvivalHud();
}

function updateSurvivalHud() {
  hpDisplay.textContent = `HP: ${Math.max(0, Math.round(playerHP))}`;
  levelDisplay.textContent = `Level: ${currentLevel}`;
  hpDisplay.classList.toggle("low-hp", playerHP <= 25);
}

function showSurvivalHud(visible) {
  survivalStats.classList.toggle("hidden", !visible);
  if (visible) {
    updateSurvivalHud();
  }
}

function hideSurvivalOverlays() {
  nextLevelBtn.classList.add("hidden");
  nextLevelBtn.disabled = true;
  gameOverPanel.classList.add("hidden");
}

/** Reset evaluation / route summary UI so it does not leak onto the main menu. */
function clearEvaluationUi() {
  scorePanel.textContent = "";
  scorePanel.classList.add("hidden");
  scorePanel.classList.remove("success");
  gameStageLabel.textContent = "";
  gameStageLabel.style.color = "";
  gameTimeLabel.textContent = "";
}

function returnToMainMenu() {
  isSurvivalMode = false;
  currentGameMode = null;
  hideMap();
  clearEvaluationUi();
  hideGameplayUi();
  hideSurvivalOverlays();
  setStatus("", "");
  showLobby();
  headerSubtitle.textContent = "Choose a game mode to begin";
}

function showNextLevelButton() {
  nextLevelBtn.classList.remove("hidden");
  nextLevelBtn.disabled = false;
}

function showGameOverScreen(message) {
  gameOverMessage.textContent = message;
  gameOverPanel.classList.remove("hidden");
  mapSection.classList.add("hidden");
  nextLevelBtn.classList.add("hidden");
}

/**
 * Nudge start coordinates so the same city does not always spawn at its center.
 * @param {number} lat
 * @param {number} lon
 */
function applyRandomStartOffset(lat, lon) {
  const dLat = (Math.random() * 2 - 1) * START_OFFSET_DEG;
  const dLon = (Math.random() * 2 - 1) * START_OFFSET_DEG;
  return {
    lat: Math.max(-90, Math.min(90, lat + dLat)),
    lon: Math.max(-180, Math.min(180, lon + dLon)),
  };
}

function pickRandomCity() {
  return RANDOM_CITIES[Math.floor(Math.random() * RANDOM_CITIES.length)];
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
  gameOverPanel.classList.add("hidden");
  container.classList.remove("has-map");
  clearResults();
  clearEvaluationUi();
  showGameControls(false);
  showSurvivalHud(false);
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

/** Leave practice search and return to main mode selection without starting a game. */
function cancelPracticeSearch() {
  searchSection.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  selectedPanel.classList.add("hidden");
  searchInput.value = "";
  clearResults();
  setStatus("", "");
  showLobby();
  menuMain.classList.remove("hidden");
  menuSub.classList.add("hidden");
  headerSubtitle.textContent = "Choose a game mode to begin";
}

function selectGameMode(mode) {
  currentGameMode = mode;
  showSubMenu();
}

async function startSurvivalMode(continueRun = false) {
  if (!currentGameMode) {
    return;
  }

  isSurvivalMode = true;
  if (!continueRun) {
    resetSurvivalProgress();
  }

  hideLobby();
  hideGameplayUi();
  hideSurvivalOverlays();
  showSurvivalHud(true);

  headerSubtitle.textContent =
    `${currentGameMode === "linear" ? "Linear" : "Parallel"} — Endless Survival`;

  await loadRandomSurvivalLevel();
}

async function loadRandomSurvivalLevel() {
  const city = pickRandomCity();
  setStatus(`Level ${currentLevel} — loading ${city}…`, "");

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

    const baseLat = results[0].lat ?? results[0].latitude;
    const baseLon = results[0].lon ?? results[0].longitude ?? results[0].lng;

    if (baseLat == null || baseLon == null) {
      throw new Error("Random city result missing coordinates.");
    }

    const offset = applyRandomStartOffset(Number(baseLat), Number(baseLon));

    await loadLevel({
      name: `${results[0].name || city} (Survival Lv.${currentLevel})`,
      lat:  offset.lat,
      lon:  offset.lon,
    });
  } catch (err) {
    setStatus(`Survival load failed: ${err.message}`, "error");
    if (playerHP > 0 && currentLevel > 1) {
      showNextLevelButton();
    } else {
      showSubMenu();
    }
  }
}

async function advanceToNextLevel() {
  if (!isSurvivalMode || playerHP <= 0) {
    return;
  }

  currentLevel += 1;
  hideSurvivalOverlays();
  clearOptimalRoute();
  clearUserRoutes();
  destroyMap();
  resetGameState();
  updateSurvivalHud();

  await loadRandomSurvivalLevel();
}

function restartSurvivalGame() {
  resetSurvivalProgress();
  returnToMainMenu();
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
    const url =
      `${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${SEARCH_FETCH_LIMIT}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const results = await response.json();

    if (!Array.isArray(results)) {
      throw new Error("Unexpected response format from server.");
    }

    renderResults(results);

    if (cachedSearchResults.length === 0) {
      setStatus("No locations found. Try a different search.", "");
    } else {
      const pages = Math.ceil(cachedSearchResults.length / SEARCH_PAGE_SIZE);
      setStatus(
        `Found ${cachedSearchResults.length} result${cachedSearchResults.length !== 1 ? "s" : ""}` +
        (pages > 1 ? ` — showing page 1 of ${pages}.` : "."),
        "success",
      );
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
    if (isSurvivalMode) {
      params.set("survival", "1");
      params.set("level", String(currentLevel));
    }
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
    hideSurvivalOverlays();
    updateGameHud();
    if (isSurvivalMode) {
      showSurvivalHud(true);
      updateSurvivalHud();
    }
    setStatus(getStageHint(), "success");
    if (!isSurvivalMode) {
      headerSubtitle.textContent =
        `${currentGameMode === "linear" ? "Linear" : "Parallel"} — ${location.name}`;
    }
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
  routeEvaluated = false;
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
    showToast("Select a Pickup A location first!", "warning");
    return;
  }
  if (role === "stage1" && currentStage !== 1) {
    showToast("Pickup A is done. Head to a Pickup B location next.", "warning");
    return;
  }
  if (role === "stage2" && currentStage !== 2) {
    if (currentStage === 1) {
      showToast("Select a Pickup A location first!", "warning");
    } else {
      showToast(`Proceed to ${LABEL_CLIENT} to complete the delivery.`, "warning");
    }
    return;
  }
  if (role === "end" && currentStage !== 3) {
    if (currentStage === 1) {
      showToast("Select a Pickup A location first!", "warning");
    } else if (currentStage === 2) {
      showToast(`Select a Pickup B location before ${LABEL_CLIENT}.`, "warning");
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
      showToast(`All Drop-offs complete. Proceed to ${LABEL_CLIENT}.`, "warning");
      return;
    }
    if (isStopVisited(poi.id)) {
      showToast("You already delivered to this Drop-off.", "warning");
      return;
    }

    const poiData = cleanPoiData(poi);

    await commitRouteLeg(poiData, visitedStops.length + 1, () => {
      visitedStops.push(poiData);
      refreshStopMarkerStyle(poiData.id);
      if (visitedStops.length === 5) {
        setPlayStatus(`All Drop-offs complete! Proceed to ${LABEL_CLIENT}.`, "success");
      } else {
        setPlayStatus(getStageHint(), "success");
      }
    });
    return;
  }

  if (role === "end") {
    if (visitedStops.length < 5) {
      showToast(`Deliver to all 5 Drop-offs first! (${visitedStops.length}/5 done)`, "warning");
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
  syncUndoControl();
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
    syncUndoControl();
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
    color:     ROUTE_USER_COLOR,
    weight:    ROUTE_USER_WEIGHT,
    opacity:   ROUTE_USER_OPACITY,
    lineJoin:  "round",
    className: ROUTE_USER_CLASS,
  }).addTo(userRouteLayerGroup);

  pathHistory.push({
    stage,
    poi,
    durationSec,
    polyline,
    from: coordPayload(fromCoord),
    to:   coordPayload(toCoord),
  });

  syncUndoControl();
}

function undoLastStep() {
  if (routeEvaluated || pathHistory.length === 0 || gameBusy) {
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
  scorePanel.classList.remove("success");
  clearOptimalRoute();
  evaluateBtn.disabled = true;
  routeEvaluated = false;
  syncUndoControl();
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
  poi._marker.setIcon(createPinIcon("stop", LABEL_DROP_OFF, isStopVisited(poi.id)));
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
    if (currentStage === 1) return "Collect at any Pickup A (orange marker).";
    if (currentStage === 2) return "Collect at any Pickup B (purple marker).";
    if (currentStage === 3) return `Deliver to ${LABEL_CLIENT}.`;
    return "Route complete — evaluate when ready.";
  }

  if (visitedStops.length < 5) {
    return `Deliver to any Drop-off (${visitedStops.length}/5 done). Order is flexible.`;
  }
  if (!linearGameComplete) {
    return `Proceed to ${LABEL_CLIENT}.`;
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

function syncUndoControl() {
  if (routeEvaluated) {
    undoBtn.classList.add("hidden");
    undoBtn.disabled = true;
    return;
  }
  undoBtn.classList.remove("hidden");
  undoBtn.disabled = pathHistory.length === 0 || gameBusy;
}

function hidePracticePlayAgainButton() {
  btnSearchAnother.classList.add("hidden");
}

function showPracticePlayAgainButton() {
  btnSearchAnother.classList.remove("hidden");
}

/** After practice evaluation — return to Nominatim search without leaving the mode. */
function returnToPracticeSearch() {
  if (isSurvivalMode || !currentGameMode) {
    return;
  }

  hidePracticePlayAgainButton();
  hideMap();
  clearEvaluationUi();
  selectedPanel.classList.add("hidden");
  hideLobby();
  searchSection.classList.remove("hidden");
  searchInput.value = "";
  clearResults();
  setStatus("Search for your practice start location.", "");
  headerSubtitle.textContent =
    `${currentGameMode === "linear" ? "Linear" : "Parallel"} — Practice Mode`;
}

function lockUndoAfterEvaluation() {
  routeEvaluated = true;
  undoBtn.classList.add("hidden");
  undoBtn.disabled = true;
}

function showGameControls(visible) {
  evaluateBtn.classList.toggle("hidden", !visible);
  btnQuitGame.classList.toggle("hidden", !visible);
  evaluateBtn.disabled = true;
  if (!visible) {
    undoBtn.classList.add("hidden");
    undoBtn.disabled = true;
    nextLevelBtn.classList.add("hidden");
    hidePracticePlayAgainButton();
    return;
  }
  hidePracticePlayAgainButton();
  syncUndoControl();
}

// ── Evaluation ──────────────────────────────────────────────────────────────

async function evaluateRoute() {
  if (!levelData || !isGameFinished()) {
    showToast(`Finish your route at ${LABEL_CLIENT} first.`, "warning");
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

    const userSec = totalTimeSec;
    const optimalSec = data.matrix_duration_sec ?? data.duration_sec ?? 0;
    const userMin = userSec / 60;
    const optimalMin = optimalSec / 60;
    const deltaSec = Math.max(0, userSec - optimalSec);
    const deltaMin = deltaSec / 60;

    drawOptimalRoute(data.geometry);

    let hpLost = 0;
    if (isSurvivalMode) {
      hpLost = Math.ceil(deltaSec / 10);
      playerHP = Math.max(0, playerHP - hpLost);
      updateSurvivalHud();
    }

    let msg =
      `Your time: ${userMin.toFixed(1)} mins. ` +
      `Optimal time: ${optimalMin.toFixed(1)} mins. ` +
      `You were ${deltaSec.toFixed(0)} seconds slower.`;

    if (isSurvivalMode) {
      msg += ` HP lost: ${hpLost}. Remaining HP: ${Math.round(playerHP)}.`;
    }

    showToast(msg, "success", 9000);
    scorePanel.textContent = msg;
    scorePanel.classList.remove("hidden");
    scorePanel.classList.add("success");
    lockUndoAfterEvaluation();
    setPlayStatus("Evaluation complete — neon green line is the optimal courier path.", "success");

    if (!isSurvivalMode) {
      showPracticePlayAgainButton();
    }

    if (isSurvivalMode) {
      if (playerHP <= 0) {
        showGameOverScreen(
          `Game Over at Level ${currentLevel}. ` +
          `You were ${deltaSec.toFixed(0)}s slower (−${hpLost} HP). HP reached 0.`,
        );
      } else {
        showNextLevelButton();
        setPlayStatus(
          `Level ${currentLevel} complete! −${hpLost} HP. Click Next Level to continue.`,
          "success",
        );
      }
    }
  } catch (err) {
    setPlayStatus(`Evaluation failed: ${err.message}`, "error");
    if (isSurvivalMode && playerHP > 0) {
      evaluateBtn.disabled = false;
    } else if (!isSurvivalMode) {
      evaluateBtn.disabled = false;
    }
  } finally {
    gameBusy = false;
    if (!routeEvaluated) {
      syncUndoControl();
    }
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
    color:     ROUTE_OPTIMAL_COLOR,
    weight:    ROUTE_OPTIMAL_WEIGHT,
    opacity:   ROUTE_OPTIMAL_OPACITY,
    lineJoin:  "round",
    className: ROUTE_OPTIMAL_CLASS,
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

  addGameMarker(level.start, "start", LABEL_DISPATCH);
  bounds.extend([level.start.lat, level.start.lon]);

  if (isParallelMode()) {
    level.stage1.forEach((poi) => {
      addGameMarker(poi, "stage1", LABEL_PICKUP_A);
      bounds.extend([poi.lat, poi.lon]);
    });
    level.stage2.forEach((poi) => {
      addGameMarker(poi, "stage2", LABEL_PICKUP_B);
      bounds.extend([poi.lat, poi.lon]);
    });
  } else {
    level.pois.forEach((poi) => {
      addGameMarker(poi, "stop", LABEL_DROP_OFF);
      bounds.extend([poi.lat, poi.lon]);
    });
  }

  addGameMarker(level.end, "end", LABEL_CLIENT);
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
    direction:  "top",
    offset:     [0, -18],
    opacity:    1,
    className:  "cyber-tooltip",
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
  const roleClass = `marker-pin__node--${role}`;
  const visitedClass = visited ? " marker-pin--visited" : "";
  return L.divIcon({
    className: `marker-pin${visitedClass}`,
    html: `
      <div class="marker-pin__node ${roleClass}">
        <span class="marker-pin__ring" aria-hidden="true"></span>
        <span class="marker-pin__core" aria-hidden="true"></span>
      </div>
      <span class="marker-pin__label">${escapeHtml(shortLabel)}</span>
    `,
    iconSize:   [36, 42],
    iconAnchor: [18, 20],
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
  returnToMainMenu();
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
  cachedSearchResults = [];
  searchResultsPage = 0;
  hideResultsPagination();
}

function hideResultsPagination() {
  resultsPagination.classList.add("hidden");
}

function updateResultsPaginationUi() {
  const total = cachedSearchResults.length;
  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));

  if (total === 0 || totalPages <= 1) {
    hideResultsPagination();
    return;
  }

  resultsPagination.classList.remove("hidden");
  resultsPageInfo.textContent = `Page ${searchResultsPage + 1} of ${totalPages}`;
  resultsPrev.disabled = searchResultsPage <= 0;
  resultsNext.disabled = searchResultsPage >= totalPages - 1;
}

function appendResultItem(poi, lat, lon) {
  const li = document.createElement("li");
  li.className = "result-item";
  li.setAttribute("role", "listitem");
  li.setAttribute("tabindex", "0");
  li.setAttribute("aria-label", poi.name);

  li.innerHTML = `
    <span class="result-name">${escapeHtml(poi.name)}</span>
    <span class="result-coords">${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}</span>
  `;

  li.addEventListener("click", () => loadLevel({ name: poi.name, lat, lon }));
  li.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      loadLevel({ name: poi.name, lat, lon });
    }
  });

  resultsList.appendChild(li);
}

function renderResultsPage() {
  clearResultsList();

  const start = searchResultsPage * SEARCH_PAGE_SIZE;
  const pageItems = cachedSearchResults.slice(start, start + SEARCH_PAGE_SIZE);

  pageItems.forEach((poi) => {
    appendResultItem(poi, poi.lat, poi.lon);
  });

  if (cachedSearchResults.length > 0) {
    showResultsPanel();
  } else {
    hideResultsPanel();
  }

  updateResultsPaginationUi();
}

function renderResults(results) {
  cachedSearchResults = [];
  searchResultsPage = 0;

  if (!Array.isArray(results)) {
    renderResultsPage();
    return;
  }

  results.forEach((poi, index) => {
    const lat = poi.lat ?? poi.latitude;
    const lon = poi.lon ?? poi.longitude ?? poi.lng;

    if (lat == null || lon == null) {
      console.warn(`[game.js] Skipping result #${index} — missing coordinates:`, poi);
      return;
    }

    cachedSearchResults.push({
      name: poi.name,
      lat:  Number(lat),
      lon:  Number(lon),
    });
  });

  renderResultsPage();
}

function goToSearchResultsPage(delta) {
  const totalPages = Math.ceil(cachedSearchResults.length / SEARCH_PAGE_SIZE);
  const nextPage = searchResultsPage + delta;

  if (nextPage < 0 || nextPage >= totalPages) {
    return;
  }

  searchResultsPage = nextPage;
  renderResultsPage();
  setStatus(
    `Showing results ${searchResultsPage * SEARCH_PAGE_SIZE + 1}–` +
    `${Math.min((searchResultsPage + 1) * SEARCH_PAGE_SIZE, cachedSearchResults.length)} ` +
    `of ${cachedSearchResults.length}.`,
    "success",
  );
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

/** @param {string} message @param {"info" | "warning" | "success" | "error"} [type] */
function showToast(message, type = "warning", durationMs = 4200) {
  if (!toastStack || !message) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="toast__text">${escapeHtml(message)}</span>`;

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    toast.classList.remove("toast--visible");
    const remove = () => toast.remove();
    toast.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 450);
  };

  toast.addEventListener("click", dismiss);
  toastStack.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("toast--visible"));
  });

  timer = setTimeout(dismiss, durationMs);
}

function formatPoiForFoliumPts(poi, role) {
  const lat = poi?.lat ?? poi?.latitude;
  const lon = poi?.lon ?? poi?.longitude ?? poi?.lng;
  if (lat == null || lon == null) {
    return null;
  }
  const resolvedRole = role || poi?.role || "stop";
  return `${Number(lat)},${Number(lon)},${resolvedRole}`;
}

/** Build lat,lon,role|lat,lon,role|... for the current mission intel map. */
function buildFoliumPtsString() {
  const segments = [];

  const pushPoi = (poi, role) => {
    const segment = formatPoiForFoliumPts(poi, role);
    if (segment) {
      segments.push(segment);
    }
  };

  pushPoi(levelData.start, "start");

  if (Array.isArray(levelData.stage1)) {
    levelData.stage1.forEach((poi) => pushPoi(poi, "stage1"));
  }
  if (Array.isArray(levelData.stage2)) {
    levelData.stage2.forEach((poi) => pushPoi(poi, "stage2"));
  }
  if (Array.isArray(levelData.pois)) {
    levelData.pois.forEach((poi) => pushPoi(poi, "stop"));
  }

  pushPoi(levelData.end, "end");

  return segments.join("|");
}

function openFoliumReport() {
  if (!levelData) {
    showToast("Start a mission first to view Satellite Intel.", "warning");
    return;
  }

  const ptsString = buildFoliumPtsString();
  if (!ptsString) {
    showToast("No mission coordinates available for Satellite Intel.", "warning");
    return;
  }

  const modal = document.getElementById("folium-modal");
  document.getElementById("folium-iframe").src =
    `${API_BASE}/api/folium_report?pts=${encodeURIComponent(ptsString)}`;
  modal.showModal();
}

// ── Event Listeners ────────────────────────────────────────────────────────

btnFoliumReport.addEventListener("click", openFoliumReport);

btnParallelMode.addEventListener("click", () => selectGameMode("parallel"));
btnLinearMode.addEventListener("click", () => selectGameMode("linear"));
btnPractice.addEventListener("click", showPracticeSearch);
btnSearchBack.addEventListener("click", cancelPracticeSearch);
btnRandom.addEventListener("click", () => startSurvivalMode(false));
nextLevelBtn.addEventListener("click", advanceToNextLevel);
restartGameBtn.addEventListener("click", restartSurvivalGame);
btnBackMenu.addEventListener("click", returnToMainMenu);

searchBtn.addEventListener("click", performSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});
resultsPrev.addEventListener("click", () => goToSearchResultsPage(-1));
resultsNext.addEventListener("click", () => goToSearchResultsPage(1));

undoBtn.addEventListener("click", undoLastStep);
evaluateBtn.addEventListener("click", evaluateRoute);
btnQuitGame.addEventListener("click", returnToMainMenu);
btnSearchAnother.addEventListener("click", returnToPracticeSearch);

initLobby();

function getSelectedLocation() {
  return levelData ? levelData.start : null;
}
