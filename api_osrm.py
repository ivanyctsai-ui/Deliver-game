"""
api_osrm.py — OSRM Routing Worker

ARCHITECTURAL RULE (see CLAUDE.md §3):
  This file handles ALL OSRM HTTP communication.
  It must never import Flask. It must never contain game logic or math.
"""

import requests

# ── Constants (frozen — see CLAUDE.md §4) ─────────────────────────────────────
_BASE_URL = "https://router.project-osrm.org"
_HEADERS   = {"User-Agent": "DeliveryGame/1.0 (Contact: ivan.yc.tsai@gmail.com)"}
_TIMEOUT   = 3  # seconds — hard limit, never increase

def _coords_path(coords: list[tuple[float, float]]) -> str:
    """Format [(lon, lat), ...] for OSRM path segment."""
    return ";".join(f"{lon},{lat}" for lon, lat in coords)


def get_distance_matrix(coords: list[tuple[float, float]]) -> list[list[float]] | None:
    """
    Call OSRM Table API and return the durations matrix (seconds).

    Args:
        coords: list of (lon, lat) tuples in matrix order.

    Returns:
        2D list of travel times in seconds, or None on failure.
    """
    if not coords or len(coords) < 2:
        return None

    url = f"{_BASE_URL}/table/v1/driving/{_coords_path(coords)}"
    params = {"annotations": "duration"}

    try:
        response = requests.get(
            url,
            params=params,
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.Timeout:
        return None
    except requests.exceptions.RequestException:
        return None
    except ValueError:
        return None

    if payload.get("code") != "Ok":
        return None

    durations = payload.get("durations")
    if not isinstance(durations, list):
        return None

    return durations


def get_route_geometry(
    coords: list[tuple[float, float]],
) -> dict | None:
    """
    Call OSRM Route API for waypoint sequence *coords*.

    Args:
        coords: ordered (lon, lat) waypoints along the trip.

    Returns:
        {
            "geometry": [[lat, lon], ...],  # Leaflet-ready
            "duration_sec": float,
        }
        or None on failure.
    """
    if not coords or len(coords) < 2:
        return None

    url = f"{_BASE_URL}/route/v1/driving/{_coords_path(coords)}"
    params = {
        "overview":   "full",
        "geometries": "geojson",
    }

    try:
        response = requests.get(
            url,
            params=params,
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.Timeout:
        return None
    except requests.exceptions.RequestException:
        return None
    except ValueError:
        return None

    if payload.get("code") != "Ok":
        return None

    routes = payload.get("routes")
    if not routes:
        return None

    route = routes[0]
    geometry = route.get("geometry", {})
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return None

    # OSRM GeoJSON uses [lon, lat]; Leaflet expects [lat, lon].
    leaflet_coords = [
        [float(lat), float(lon)]
        for lon, lat in coordinates
    ]

    duration = route.get("duration")
    try:
        duration_sec = float(duration) if duration is not None else 0.0
    except (TypeError, ValueError):
        duration_sec = 0.0

    return {
        "geometry":     leaflet_coords,
        "duration_sec": duration_sec,
    }
