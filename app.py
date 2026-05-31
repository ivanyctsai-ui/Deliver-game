"""
app.py — Flask Router (Thin Dispatcher)

ARCHITECTURAL RULE (see CLAUDE.md §3):
  This file contains routes ONLY.
  No requests imports. No math. No business logic.
  Each route validates input, delegates to one api_*.py or game_logic.py
  function, and returns its result as JSON.
"""

from flask import Flask, jsonify, render_template, request

from api_nominatim import search_locations
from api_osrm import get_distance_matrix, get_route_geometry
from api_overpass import generate_level_pois, generate_linear_level_pois
from game_logic import (
    apply_coordinate_jitter,
    build_linear_coord_order,
    build_parallel_coord_order,
    calculate_best_linear_route,
    calculate_best_parallel_route,
)

# ── App Configuration (see CLAUDE.md §7) ──────────────────────────────────────
app = Flask(__name__)
DEBUG = True
PORT  = 5000


# ── Page Routes ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


def _survival_response_meta() -> dict:
    """Optional survival-mode fields when client passes ?survival=1&level=N."""
    flag = request.args.get("survival", "").strip().lower()
    if flag not in ("1", "true", "yes"):
        return {}
    try:
        level_num = max(1, int(request.args.get("level", "1")))
    except ValueError:
        level_num = 1
    return {"survival": True, "survival_level": level_num}


def _jitter_level_split(
    start: dict,
    poi_groups: list[list[dict]],
    end: dict,
) -> tuple[dict, list[list[dict]], dict]:
    """
    Combine start + POI groups + end, jitter collisions, then split again.

    Start (index 0) stays fixed; overlapping middle/end points are nudged.
    """
    sizes = [len(group) for group in poi_groups]
    middle: list[dict] = []
    for group in poi_groups:
        middle.extend(group)

    combined = [start, *middle, end]
    jittered = apply_coordinate_jitter(combined)

    start_j = jittered[0]
    end_j = jittered[-1]
    middle_j = jittered[1:-1]

    groups_j: list[list[dict]] = []
    offset = 0
    for size in sizes:
        groups_j.append(middle_j[offset : offset + size])
        offset += size

    return start_j, groups_j, end_j


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/api/search")
def api_search():
    """
    GET /api/search?q=<query>[&limit=<n>]

    Delegates to api_nominatim.search_locations() and returns the standard
    contract shape (see CLAUDE.md §5).

    Query params:
        q     (str, required): free-text location query
        limit (int, optional): max results, default 5, clamped to [1, 10]

    Returns:
        200 + JSON list on success (may be empty list).
        400 + JSON error if `q` is missing or blank.
    """
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Missing required parameter: q"}), 400

    try:
        limit = int(request.args.get("limit", 5))
        limit = max(1, min(limit, 10))  # clamp to safe range
    except ValueError:
        limit = 5

    results = search_locations(query, limit=limit)
    return jsonify(results)


@app.route("/api/generate_level", methods=["GET"])
def api_generate_level():
    """
    GET /api/generate_level?lat=<float>&lon=<float>&name=<start name>

    Query params:
        mode     — "parallel" (default) or "linear"
        survival — "1" for endless survival (echoes survival_level in JSON)
        level    — survival level number (default 1)
    """
    lat_raw = request.args.get("lat", "").strip()
    lon_raw = request.args.get("lon", "").strip()
    start_name = request.args.get("name", "Start").strip() or "Start"
    mode = request.args.get("mode", "parallel").strip().lower()

    if not lat_raw or not lon_raw:
        return jsonify({"error": "Missing required parameters: lat and lon"}), 400

    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except ValueError:
        return jsonify({"error": "lat and lon must be valid numbers"}), 400

    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return jsonify({"error": "lat/lon out of valid range"}), 400

    start = {
        "id":   "start",
        "name": start_name,
        "lat":  lat,
        "lon":  lon,
        "role": "start",
    }

    if mode == "linear":
        linear_pois = generate_linear_level_pois(lat, lon)
        start_j, linear_groups_j, end_j = _jitter_level_split(
            start,
            [linear_pois["pois"]],
            linear_pois["end"],
        )
        payload = {
            "mode":  "linear",
            "start": start_j,
            "pois":  linear_groups_j[0],
            "end":   end_j,
        }
        payload.update(_survival_response_meta())
        return jsonify(payload)

    level_pois = generate_level_pois(lat, lon)
    start_j, groups_j, end_j = _jitter_level_split(
        start,
        [level_pois["stage1"], level_pois["stage2"]],
        level_pois["end"],
    )
    payload = {
        "mode":   "parallel",
        "start":  start_j,
        "stage1": groups_j[0],
        "stage2": groups_j[1],
        "end":    end_j,
    }
    payload.update(_survival_response_meta())
    return jsonify(payload)


@app.route("/api/route_leg", methods=["POST"])
def api_route_leg():
    """
    POST /api/route_leg
    JSON: {"from": {"lat", "lon"}, "to": {"lat", "lon"}}

    Returns OSRM driving geometry and duration for one leg.
    """
    data = request.get_json(silent=True) or {}
    from_pt = data.get("from")
    to_pt = data.get("to")

    if not from_pt or not to_pt:
        return jsonify({"error": "Body must include from and to coordinates"}), 400

    try:
        from_coord = {"lat": float(from_pt["lat"]), "lon": float(from_pt["lon"])}
        to_coord = {"lat": float(to_pt["lat"]), "lon": float(to_pt["lon"])}
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "from and to require numeric lat/lon"}), 400

    waypoints = [
        (from_coord["lon"], from_coord["lat"]),
        (to_coord["lon"], to_coord["lat"]),
    ]
    route_data = get_route_geometry(waypoints)
    if route_data is None:
        return jsonify({"error": "OSRM route leg unavailable"}), 502

    return jsonify({
        "geometry":       route_data["geometry"],
        "duration_sec":   route_data["duration_sec"],
        "duration_min":   round(route_data["duration_sec"] / 60.0, 1),
    })


@app.route("/api/solve_parallel", methods=["POST"])
def api_solve_parallel():
    """
    POST /api/solve_parallel
    JSON: {"start", "stage1": [3], "stage2": [3], "end"}

    Optimal parallel path over 9 combinations; returns full route geometry.
    """
    data = request.get_json(silent=True) or {}
    start = data.get("start")
    stage1 = data.get("stage1")
    stage2 = data.get("stage2")
    end = data.get("end")

    if not start or not end:
        return jsonify({"error": "Body must include start and end"}), 400
    if not isinstance(stage1, list) or len(stage1) != 3:
        return jsonify({"error": "stage1 must contain exactly 3 POIs"}), 400
    if not isinstance(stage2, list) or len(stage2) != 3:
        return jsonify({"error": "stage2 must contain exactly 3 POIs"}), 400

    try:
        start_coord = {"lat": float(start["lat"]), "lon": float(start["lon"])}
        end_coord = {"lat": float(end["lat"]), "lon": float(end["lon"])}
        stage1_coords = [
            {"lat": float(p["lat"]), "lon": float(p["lon"])} for p in stage1
        ]
        stage2_coords = [
            {"lat": float(p["lat"]), "lon": float(p["lon"])} for p in stage2
        ]
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "All points require numeric lat/lon"}), 400

    matrix_coords = build_parallel_coord_order(
        start_coord, stage1_coords, stage2_coords, end_coord,
    )
    duration_matrix = get_distance_matrix(matrix_coords)
    if duration_matrix is None:
        return jsonify({"error": "OSRM distance matrix unavailable"}), 502

    best = calculate_best_parallel_route(
        start_coord,
        stage1_coords,
        stage2_coords,
        duration_matrix,
        end_coord,
    )
    if best is None:
        return jsonify({"error": "Could not compute best parallel route"}), 502

    route_data = get_route_geometry(best["waypoints"])
    if route_data is None:
        return jsonify({"error": "OSRM route geometry unavailable"}), 502

    return jsonify({
        "geometry":              route_data["geometry"],
        "duration_sec":          route_data["duration_sec"],
        "duration_min":          round(route_data["duration_sec"] / 60.0, 1),
        "path_indices":          best["path_indices"],
        "stage1_poi_index":      best["stage1_poi_index"],
        "stage2_poi_index":      best["stage2_poi_index"],
        "matrix_duration_sec":   best["total_duration_sec"],
        "optimal_duration_min":  round(best["total_duration_sec"] / 60.0, 1),
    })


@app.route("/api/solve_linear", methods=["POST"])
def api_solve_linear():
    """
    POST /api/solve_linear
    JSON: {"start", "pois": [5], "end"}

    Optimal linear TSP (120 permutations); returns full route geometry.
    """
    data = request.get_json(silent=True) or {}
    start = data.get("start")
    pois = data.get("pois")
    end = data.get("end")

    if not start or not end:
        return jsonify({"error": "Body must include start and end"}), 400
    if not isinstance(pois, list) or len(pois) != 5:
        return jsonify({"error": "pois must contain exactly 5 POIs"}), 400

    try:
        start_coord = {"lat": float(start["lat"]), "lon": float(start["lon"])}
        end_coord = {"lat": float(end["lat"]), "lon": float(end["lon"])}
        poi_coords = [
            {"lat": float(p["lat"]), "lon": float(p["lon"])} for p in pois
        ]
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "All points require numeric lat/lon"}), 400

    matrix_coords = build_linear_coord_order(start_coord, poi_coords, end_coord)
    duration_matrix = get_distance_matrix(matrix_coords)
    if duration_matrix is None:
        return jsonify({"error": "OSRM distance matrix unavailable"}), 502

    best = calculate_best_linear_route(
        start_coord,
        poi_coords,
        duration_matrix,
        end_coord,
    )
    if best is None:
        return jsonify({"error": "Could not compute best linear route"}), 502

    route_data = get_route_geometry(best["waypoints"])
    if route_data is None:
        return jsonify({"error": "OSRM route geometry unavailable"}), 502

    return jsonify({
        "geometry":              route_data["geometry"],
        "duration_sec":          route_data["duration_sec"],
        "duration_min":          round(route_data["duration_sec"] / 60.0, 1),
        "path_indices":          best["path_indices"],
        "poi_order":             best["poi_order"],
        "matrix_duration_sec":   best["total_duration_sec"],
        "optimal_duration_min":  round(best["total_duration_sec"] / 60.0, 1),
    })


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=DEBUG, port=PORT)
