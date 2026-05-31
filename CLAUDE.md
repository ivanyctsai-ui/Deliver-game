# CLAUDE.md — Delivery Game: Architectural Constitution

> **This file is the single source of truth.** Every AI model (strong or weak) working on
> this project MUST read this file before writing any code. Violating these rules will break
> the game's modular architecture and cause silent data bugs.

---

## 1. Project Overview

A browser-based delivery-route game that:
1. Lets the player search for a **start** and **end** location (Nominatim geocoding).
2. Builds a driving route between them (OSRM parallel solver — **implemented**).
3. Scatters Points of Interest around the selected start (Overpass API — **implemented**).
4. Runs the delivery mini-game in the browser using Leaflet.js.

---

## 2. Directory Structure (Canonical — Never Deviate)

```
Deliver game/
├── CLAUDE.md                 ← You are here. Read before touching anything.
├── requirements.txt
├── app.py                    ← Flask routes ONLY. No business logic. No API calls.
├── api_nominatim.py          ← All Nominatim (geocoding) HTTP calls live here.
├── api_osrm.py               ← All OSRM (routing) HTTP calls live here. (Phase 2)
├── api_overpass.py           ← All Overpass (POI) HTTP calls live here. (Phase 2)
├── game_logic.py             ← Pure math/game calculations. No HTTP. No Flask.
├── templates/
│   └── index.html            ← Single Jinja2 template. No inline JS beyond 5 lines.
└── static/
    ├── js/
    │   └── game.js           ← ALL frontend JavaScript. Single file. No inline scripts.
    └── css/
        └── style.css         ← All custom CSS.
```

---

## 3. Strict Separation of Concerns (THE MOST IMPORTANT RULE)

| File | Allowed | Forbidden |
|---|---|---|
| `app.py` | `@app.route`, `jsonify`, `render_template`, calling functions from `api_*.py` and `game_logic.py` | `requests`, `math`, any business logic |
| `api_nominatim.py` | `requests`, JSON parsing, error handling for HTTP | Flask imports, `math`, game state |
| `api_osrm.py` | `requests`, JSON parsing, error handling for HTTP | Flask imports, `math`, game state |
| `api_overpass.py` | `requests`, JSON parsing, error handling for HTTP | Flask imports, `math`, game state |
| `game_logic.py` | `math`, pure Python calculations | `requests`, Flask imports, any I/O |
| `game.js` | DOM manipulation, `fetch`, Leaflet rendering | Any server-side logic |

**Rule:** `app.py` acts as a thin dispatcher. It validates inputs, calls one function from one
module, and returns its result as JSON. That is its entire job.

---

## 4. All External HTTP Calls — Mandatory Rules

Every `requests` call across **all** `api_*.py` files MUST follow these rules without exception:

```python
HEADERS = {"User-Agent": "DeliveryGame/1.0 (Contact: ivan.yc.tsai@gmail.com)"}
TIMEOUT = 3  # seconds — hard limit on every single requests call

# Correct pattern:
response = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
```

- **Timeout:** Always `timeout=3`. Never omit it. Never use a higher value.
- **User-Agent:** Always the string above. Never omit it.
- **Error handling:** Always wrap in `try/except (requests.exceptions.RequestException, requests.exceptions.Timeout)`.
- **Retries:** NEVER use a `while` loop for retries. If the request fails, return an empty
  result or an error dict. Let the frontend handle retry UX.
- **Return shape:** Every `api_*.py` function MUST return a Python `list` or `dict`. Never
  return a `Response` object. Never return `None` — return `[]` or `{}` instead.

---

## 5. Standard Return Shapes (Contract Between Backend and Frontend)

These shapes are frozen. Do not change field names without updating both the backend function
AND `game.js` simultaneously.

### `/api/search` → `api_nominatim.search_locations()`
```json
[
  {"name": "Taipei 101, Xinyi District, Taipei, Taiwan", "lat": 25.0338, "lon": 121.5645},
  {"name": "Some Other Place, ...", "lat": 25.01, "lon": 121.52}
]
```
On error → `[]` (empty list, never null/None).

### `/api/solve_parallel` → `game_logic.calculate_best_parallel_route()` + OSRM
POST body: `{"start", "stage1": [3], "stage2": [3], "end"}`
```json
{
  "geometry": [[lat, lon], ...],
  "duration_sec": 1234.5,
  "duration_min": 20.6,
  "path_indices": [0, 2, 5, 6],
  "stage1_poi_index": 1,
  "stage2_poi_index": 1,
  "matrix_duration_sec": 980.0
}
```
On error → `{"error": "message"}` with 4xx/502.

### `/api/route` → legacy single A→B route (not wired)
Use `/api/solve_parallel` for parallel multi-choice routing.

### `/api/generate_level` → `api_overpass.generate_level_pois()` + start from query
```json
{
  "start":  {"id", "name", "lat", "lon", "role": "start"},
  "stage1": [3 × {id, name, lat, lon, role: "stage1"}],
  "stage2": [3 × {id, name, lat, lon, role: "stage2"}],
  "end":    {id, name, lat, lon, "role": "end"}
}
```

### `/api/route_leg` → `api_osrm.get_route_geometry()` (one leg)
POST `{"from": {lat, lon}, "to": {lat, lon}}` → `{geometry, duration_sec, duration_min}`.

### `/api/pois` → `api_overpass.get_pois()` (optional alias — not wired)
Legacy name in docs; use `/api/generate_level` instead.

---

## 6. Frontend Safety Rules (`game.js`)

- **Always guard coordinate access:** POI objects from different APIs may use `lat`/`lon` OR
  `latitude`/`longitude`. ALWAYS use the safe pattern:
  ```javascript
  const lat = poi.lat ?? poi.latitude;
  const lon = poi.lon ?? poi.longitude ?? poi.lng;
  ```
- **Always check array length** before accessing `results[0]`.
- **Never assume** a fetch response is non-empty. Always handle `[]`.
- **Always use `.catch()`** on every `fetch()` chain.
- **No inline `<script>` tags** in `index.html` beyond bootstrap/config constants (max 5 lines).
  All logic goes in `game.js`.

---

## 7. Flask App Configuration

```python
# app.py top-of-file constants — do not change without updating this doc
DEBUG = True   # Set to False before any production deployment
PORT  = 5000
```

All `/api/*` routes return `Content-Type: application/json`. Use `jsonify()` — never
`json.dumps()` with a manual header.

---

## 8. Phase Implementation Status

| Phase | Feature | Status |
|---|---|---|
| 1 | Project skeleton + Nominatim search UI | ✅ Complete |
| 2 | Overpass POI fetching + `/api/generate_level` | ✅ Complete |
| 3-A | OSRM matrix + parallel route solver (9 paths) | ✅ Complete |
| 3-B | Playable click loop + undo + evaluate | ✅ Complete |
| 3-A | Leaflet map + POI markers + route polylines | ✅ Complete |
| 2 | OSRM simple A→B `/api/route` | ⏳ Not started |
| 4 | Delivery mini-game logic | ⏳ Not started |

---

## 9. How to Continue This Project (Instructions for the Next AI)

1. **Read this entire file first.** Do not skip sections.
2. Check the Phase Implementation Status table (Section 8) to know what is done.
3. Before adding a new API source, create a new `api_<name>.py` file. Do not add calls inside
   `app.py` or `game_logic.py`.
4. OSRM is done: `api_osrm.get_distance_matrix`, `get_route_geometry`, `/api/solve_parallel`.
   - Matrix + path math: `game_logic.build_parallel_coord_order`, `calculate_best_parallel_route`.
   - app.py orchestrates OSRM calls; game_logic must never import `api_*` modules.
5. Do not add any new npm/node dependencies. This is a pure Python + vanilla JS project.
6. When in doubt, look at `api_nominatim.py` as the canonical example for all `api_*.py` files.

---

## 10. Running the Project

```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:5000
```
