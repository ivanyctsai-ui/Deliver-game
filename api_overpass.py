"""
api_overpass.py — Overpass POI Worker

ARCHITECTURAL RULE (see CLAUDE.md §3):
  This file handles ALL Overpass HTTP communication.
  It must never import Flask. Procedural padding delegates to game_logic.py.
"""

import random

import requests

from game_logic import synthetic_end_point, synthetic_poi_near

# ── Constants (frozen — see CLAUDE.md §4) ─────────────────────────────────────
_BASE_URL = "https://overpass-api.de/api/interpreter"
_HEADERS   = {"User-Agent": "DeliveryGame/1.0 (Contact: ivan.yc.tsai@gmail.com)"}
_TIMEOUT   = 3  # seconds — hard limit, never increase

_STAGE1_COUNT = 3
_STAGE2_COUNT = 3
_LINEAR_STOP_COUNT = 5


def fetch_random_pois(
    lat: float,
    lon: float,
    radius: int = 1000,
    count: int = 5,
) -> list[dict]:
    """
    Legacy helper — fetch exactly *count* flat POIs (Phase 2 compatibility).
    Prefer generate_level_pois() for the playable 8-point level.
    """
    try:
        center_lat = float(lat)
        center_lon = float(lon)
    except (TypeError, ValueError):
        return _pad_to_count([], 0.0, 0.0, count, radius)

    raw_elements = _query_overpass(center_lat, center_lon, radius)
    pois = _normalise(raw_elements)
    random.shuffle(pois)

    if len(pois) > count:
        pois = pois[:count]

    return _pad_to_count(pois, center_lat, center_lon, count, radius)


def generate_level_pois(
    lat: float,
    lon: float,
    radius: int = 1000,
) -> dict:
    """
    Build stage POIs for an 8-point level (start is supplied by the caller).

    Returns:
        {
            "stage1": [3 × {id, name, lat, lon, role: "stage1"}],
            "stage2": [3 × {id, name, lat, lon, role: "stage2"}],
            "end":    {id, name, lat, lon, role: "end"},
        }
    """
    try:
        center_lat = float(lat)
        center_lon = float(lon)
    except (TypeError, ValueError):
        return _empty_level_payload(0.0, 0.0, radius)

    raw_elements = _query_overpass(center_lat, center_lon, radius)
    pool = _normalise(raw_elements)
    random.shuffle(pool)

    needed = _STAGE1_COUNT + _STAGE2_COUNT + 1
    pool = _pad_to_count(pool, center_lat, center_lon, needed, radius)

    stage1 = [_tag_role(p, "stage1", i) for i, p in enumerate(pool[:_STAGE1_COUNT])]
    stage2 = [_tag_role(p, "stage2", i) for i, p in enumerate(pool[_STAGE1_COUNT:_STAGE1_COUNT + _STAGE2_COUNT])]

    end_candidate = pool[_STAGE1_COUNT + _STAGE2_COUNT]
    end_point = _tag_role(
        {
            **end_candidate,
            "name": end_candidate.get("name") or "Delivery End",
        },
        "end",
        0,
    )

    return {
        "stage1": stage1,
        "stage2": stage2,
        "end":    end_point,
    }


def generate_linear_level_pois(
    lat: float,
    lon: float,
    radius: int = 1000,
) -> dict:
    """
    Build POIs for a 7-point linear TSP level (start supplied by caller).

    Returns:
        {
            "pois": [5 × {id, name, lat, lon, role: "stop"}],
            "end":  {id, name, lat, lon, role: "end"},
        }
    """
    try:
        center_lat = float(lat)
        center_lon = float(lon)
    except (TypeError, ValueError):
        return _empty_linear_payload(0.0, 0.0, radius)

    raw_elements = _query_overpass(center_lat, center_lon, radius)
    pool = _normalise(raw_elements)
    random.shuffle(pool)

    needed = _LINEAR_STOP_COUNT + 1
    pool = _pad_to_count(pool, center_lat, center_lon, needed, radius)

    stops = [_tag_role(p, "stop", i) for i, p in enumerate(pool[:_LINEAR_STOP_COUNT])]
    end_point = _tag_role(
        {
            **pool[_LINEAR_STOP_COUNT],
            "name": pool[_LINEAR_STOP_COUNT].get("name") or "Delivery End",
        },
        "end",
        0,
    )

    return {"pois": stops, "end": end_point}


def _empty_linear_payload(center_lat: float, center_lon: float, radius: int) -> dict:
    pool = _pad_to_count([], center_lat, center_lon, _LINEAR_STOP_COUNT + 1, radius)
    stops = [_tag_role(p, "stop", i) for i, p in enumerate(pool[:_LINEAR_STOP_COUNT])]
    end_point = _tag_role(synthetic_end_point(center_lat, center_lon, float(radius)), "end", 0)
    return {"pois": stops, "end": end_point}


def _empty_level_payload(center_lat: float, center_lon: float, radius: int) -> dict:
    """Fallback when coordinates are invalid — still returns the correct shape."""
    pool = _pad_to_count([], center_lat, center_lon, _STAGE1_COUNT + _STAGE2_COUNT + 1, radius)
    stage1 = [_tag_role(p, "stage1", i) for i, p in enumerate(pool[:_STAGE1_COUNT])]
    stage2 = [_tag_role(p, "stage2", i) for i, p in enumerate(pool[_STAGE1_COUNT:_STAGE1_COUNT + _STAGE2_COUNT])]
    end_point = _tag_role(synthetic_end_point(center_lat, center_lon, float(radius)), "end", 0)
    return {"stage1": stage1, "stage2": stage2, "end": end_point}


def _tag_role(poi: dict, role: str, index: int) -> dict:
    """Attach role label; ensure unique id per slot."""
    name = poi.get("name", "Unknown")
    if role == "stage1":
        label = f"Stage 1 — {name}"
    elif role == "stage2":
        label = f"Stage 2 — {name}"
    elif role == "stop":
        label = f"Stop {index + 1} — {name}"
    else:
        label = name if "end" in name.lower() or "delivery" in name.lower() else f"Delivery End — {name}"

    return {
        "id":   str(poi.get("id", f"{role}-{index}")),
        "name": label,
        "lat":  float(poi["lat"]),
        "lon":  float(poi["lon"]),
        "role": role,
    }


def _query_overpass(lat: float, lon: float, radius: int) -> list:
    """Run Overpass QL and return raw 'elements' list (may be empty)."""
    query = f"""
[out:json][timeout:25];
node["name"](around:{radius},{lat},{lon});
out body 40;
""".strip()

    try:
        response = requests.post(
            _BASE_URL,
            data={"data": query},
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.Timeout:
        return []
    except requests.exceptions.RequestException:
        return []
    except ValueError:
        return []

    elements = payload.get("elements")
    return elements if isinstance(elements, list) else []


def _normalise(raw: list) -> list[dict]:
    """Convert Overpass elements into standard POI dicts."""
    results = []
    for item in raw:
        if item.get("type") != "node":
            continue
        tags = item.get("tags") or {}
        name = tags.get("name")
        if not name:
            continue
        try:
            results.append({
                "id":   str(item.get("id", f"node-{len(results)}")),
                "name": name,
                "lat":  float(item["lat"]),
                "lon":  float(item["lon"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return results


def _pad_to_count(
    pois: list[dict],
    center_lat: float,
    center_lon: float,
    count: int,
    radius_m: int,
) -> list[dict]:
    """Ensure the list has exactly *count* POIs using procedural fillers."""
    result = list(pois)
    synthetic_index = 0
    while len(result) < count:
        if len(result) == count - 1 and count >= 7:
            filler = synthetic_end_point(center_lat, center_lon, float(radius_m) * 1.2)
        else:
            filler = synthetic_poi_near(
                center_lat,
                center_lon,
                synthetic_index,
                radius_m=float(radius_m) * 0.8,
            )
        synthetic_index += 1
        if not any(p["id"] == filler["id"] for p in result):
            result.append(filler)
    return result[:count]
