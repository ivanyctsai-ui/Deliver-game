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
from api_overpass import generate_level_pois
from game_logic import (
    build_parallel_coord_order,
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

    Returns 8-point level JSON: start + 3 stage1 + 3 stage2 + end.
    """
    lat_raw = request.args.get("lat", "").strip()
    lon_raw = request.args.get("lon", "").strip()
    start_name = request.args.get("name", "Start").strip() or "Start"

    if not lat_raw or not lon_raw:
        return jsonify({"error": "Missing required parameters: lat and lon"}), 400

    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except ValueError:
        return jsonify({"error": "lat and lon must be valid numbers"}), 400

    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return jsonify({"error": "lat/lon out of valid range"}), 400

    level_pois = generate_level_pois(lat, lon)
    return jsonify({
        "start": {
            "id":   "start",
            "name": start_name,
            "lat":  lat,
            "lon":  lon,
            "role": "start",
        },
        "stage1": level_pois["stage1"],
        "stage2": level_pois["stage2"],
        "end":    level_pois["end"],
    })


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


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=DEBUG, port=PORT)
