"""
api_nominatim.py — Nominatim Geocoding Worker

ARCHITECTURAL RULE (see CLAUDE.md §3):
  This file handles ALL Nominatim HTTP communication.
  It must never import Flask. It must never contain game logic or math.
  It is the canonical template for all future api_*.py files.
"""

import requests

# ── Constants (frozen — see CLAUDE.md §4) ─────────────────────────────────────
_BASE_URL = "https://nominatim.openstreetmap.org/search"
_HEADERS   = {"User-Agent": "DeliveryGame/1.0 (Contact: ivan.yc.tsai@gmail.com)"}
_TIMEOUT   = 3  # seconds — hard limit, never increase


def search_locations(query: str, limit: int = 5) -> list[dict]:
    """
    Search Nominatim for places matching *query*.

    Returns a list of dicts with guaranteed keys: name, lat, lon.
    On any error returns [] — never None, never raises.

    Contract (see CLAUDE.md §5):
        [{"name": str, "lat": float, "lon": float}, ...]
    """
    if not query or not query.strip():
        return []

    params = {
        "q":              query.strip(),
        "format":         "jsonv2",
        "limit":          limit,
        "addressdetails": 0,
    }

    try:
        response = requests.get(
            _BASE_URL,
            params=params,
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        raw_results = response.json()
    except requests.exceptions.Timeout:
        # Nominatim did not respond within 3 seconds — degrade gracefully.
        return []
    except requests.exceptions.RequestException:
        # Covers ConnectionError, HTTPError, and all other network failures.
        return []
    except ValueError:
        # Malformed JSON in response body.
        return []

    return _normalise(raw_results)


def _normalise(raw: list) -> list[dict]:
    """
    Convert Nominatim's raw JSON array into the standard contract shape.
    Skips any entry that is missing lat/lon to avoid feeding bad data upstream.
    """
    results = []
    for item in raw:
        try:
            results.append({
                "name": item.get("display_name", "Unknown location"),
                "lat":  float(item["lat"]),
                "lon":  float(item["lon"]),
            })
        except (KeyError, TypeError, ValueError):
            # Skip malformed entries rather than crashing the whole response.
            continue
    return results
