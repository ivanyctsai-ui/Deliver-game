"""
game_logic.py — Pure calculations (no HTTP, no Flask)

ARCHITECTURAL RULE (see CLAUDE.md §3):
  Math and procedural game data only. No requests, no I/O.
  OSRM matrices are fetched in app.py via api_osrm, then passed here.
"""

import math

# Parallel route matrix layout (8 nodes): start + 3 stage1 + 3 stage2 + end
_IDX_START = 0
_IDX_STAGE1 = (1, 2, 3)
_IDX_STAGE2 = (4, 5, 6)
_IDX_END = 7


def synthetic_poi_near(
    center_lat: float,
    center_lon: float,
    index: int,
    radius_m: float = 800.0,
) -> dict:
    """
    Build one procedural POI on a ring around (center_lat, center_lon).

    Uses golden-angle spacing so padded points do not stack on top of each other.
    """
    golden_angle_rad = math.radians(137.508)
    angle_rad = (index + 1) * golden_angle_rad
    # Spread distances between 25% and 95% of radius_m.
    fraction = 0.25 + 0.7 * ((index % 5) / 4.0)
    distance_m = radius_m * fraction

    meters_per_deg_lat = 111_320.0
    lat_rad = math.radians(center_lat)
    meters_per_deg_lon = meters_per_deg_lat * max(math.cos(lat_rad), 0.01)

    dlat = (distance_m * math.cos(angle_rad)) / meters_per_deg_lat
    dlon = (distance_m * math.sin(angle_rad)) / meters_per_deg_lon

    return {
        "id":   f"synthetic-{index + 1}",
        "name": f"Delivery Stop {index + 1}",
        "lat":  round(center_lat + dlat, 6),
        "lon":  round(center_lon + dlon, 6),
    }


def synthetic_end_point(
    center_lat: float,
    center_lon: float,
    radius_m: float = 1200.0,
) -> dict:
    """Procedural delivery end point placed farther from the cluster."""
    point = synthetic_poi_near(center_lat, center_lon, 99, radius_m=radius_m)
    return {
        "id":   "synthetic-end",
        "name": "Delivery End",
        "lat":  point["lat"],
        "lon":  point["lon"],
    }


def _to_lon_lat(coord: dict) -> tuple[float, float]:
    """Normalise {lat, lon} dict to OSRM (lon, lat) tuple."""
    return (float(coord["lon"]), float(coord["lat"]))


def build_parallel_coord_order(
    start_coord: dict,
    stage1_pois: list[dict],
    stage2_pois: list[dict],
    end_coord: dict,
) -> list[tuple[float, float]]:
    """
    Build OSRM coordinate list: [start] + stage1 (3) + stage2 (3) + [end].
    """
    ordered = [_to_lon_lat(start_coord)]
    for poi in stage1_pois[:3]:
        ordered.append(_to_lon_lat(poi))
    for poi in stage2_pois[:3]:
        ordered.append(_to_lon_lat(poi))
    ordered.append(_to_lon_lat(end_coord))
    return ordered


def _matrix_duration(
    matrix: list[list],
    from_idx: int,
    to_idx: int,
) -> float | None:
    """Safe lookup of matrix[from][to] in seconds."""
    try:
        value = matrix[from_idx][to_idx]
        if value is None:
            return None
        return float(value)
    except (IndexError, TypeError, ValueError):
        return None


def calculate_best_parallel_route(
    start_coord: dict,
    stage1_pois: list[dict],
    stage2_pois: list[dict],
    duration_matrix: list[list],
    end_coord: dict,
) -> dict | None:
    """
    Pick the fastest parallel path: start -> (one of stage1) -> (one of stage2) -> end.

    Evaluates all 9 valid combinations using the precomputed OSRM duration matrix.

    Returns:
        {
            "path_indices": [0, stage1_idx, stage2_idx, 7],
            "stage1_poi_index": int,   # 0-2
            "stage2_poi_index": int,   # 0-2
            "total_duration_sec": float,
            "waypoints": [(lon, lat), ...],
        }
        or None if inputs/matrix are invalid.
    """
    if len(stage1_pois) < 3 or len(stage2_pois) < 3 or not end_coord:
        return None

    coord_order = build_parallel_coord_order(
        start_coord, stage1_pois, stage2_pois, end_coord,
    )

    if not duration_matrix or len(duration_matrix) < len(coord_order):
        return None

    best_total = None
    best_s1 = None
    best_s2 = None

    for s1_idx in _IDX_STAGE1:
        leg1 = _matrix_duration(duration_matrix, _IDX_START, s1_idx)
        if leg1 is None:
            continue
        for s2_idx in _IDX_STAGE2:
            leg2 = _matrix_duration(duration_matrix, s1_idx, s2_idx)
            leg3 = _matrix_duration(duration_matrix, s2_idx, _IDX_END)
            if leg2 is None or leg3 is None:
                continue
            total = leg1 + leg2 + leg3
            if best_total is None or total < best_total:
                best_total = total
                best_s1 = s1_idx
                best_s2 = s2_idx

    if best_total is None or best_s1 is None or best_s2 is None:
        return None

    waypoints = [
        coord_order[_IDX_START],
        coord_order[best_s1],
        coord_order[best_s2],
        coord_order[_IDX_END],
    ]

    return {
        "path_indices":       [_IDX_START, best_s1, best_s2, _IDX_END],
        "stage1_poi_index":   best_s1 - _IDX_STAGE1[0],
        "stage2_poi_index":   best_s2 - _IDX_STAGE2[0],
        "total_duration_sec": best_total,
        "waypoints":          waypoints,
    }
