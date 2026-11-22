"""
External Map / Traffic API adapter with honest fallback to sample data.

Reads ROUTING_API_URL and ROUTING_API_KEY from environment variables on the server.
API keys are never returned to the client.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from backend.config import Config


@dataclass(frozen=True)
class TrafficAdapterStatus:
    live_available: bool
    fallback_used: bool
    data_source: str  # "sample" or "live"
    message: str


def fetch_live_traffic_adjustments(
    config: Config,
    source_coords: tuple[float, float],
    destination_coords: tuple[float, float],
    external_enabled: bool = True,
) -> tuple[TrafficAdapterStatus, dict[str, Any] | None]:
    """
    Attempt to query an optional external routing/traffic API.

    If disabled, unconfigured, or unreachable, returns a clear fallback status
    and data_source="sample" without ever claiming live data.
    """
    if not external_enabled:
        return (
            TrafficAdapterStatus(
                live_available=False,
                fallback_used=True,
                data_source="sample",
                message="External traffic adapter is disabled in system settings. Using sample route data (not live traffic).",
            ),
            None,
        )

    if not config.routing_api_url or not config.routing_api_key:
        return (
            TrafficAdapterStatus(
                live_available=False,
                fallback_used=True,
                data_source="sample",
                message="Live traffic API is not configured. Using sample route data (not live traffic).",
            ),
            None,
        )

    payload = json.dumps(
        {
            "source": {"lat": source_coords[0], "lng": source_coords[1]},
            "destination": {"lat": destination_coords[0], "lng": destination_coords[1]},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        config.routing_api_url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.routing_api_key}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=config.routing_api_timeout_sec) as resp:
            if resp.status != 200:
                return (
                    TrafficAdapterStatus(
                        live_available=False,
                        fallback_used=True,
                        data_source="sample",
                        message=f"Live traffic API returned status {resp.status}. Falling back to sample route data (not live traffic).",
                    ),
                    None,
                )
            data = json.loads(resp.read().decode("utf-8"))
            if not isinstance(data, dict) or not data.get("ok"):
                return (
                    TrafficAdapterStatus(
                        live_available=False,
                        fallback_used=True,
                        data_source="sample",
                        message="Live traffic API returned an invalid response. Falling back to sample route data (not live traffic).",
                    ),
                    None,
                )
            return (
                TrafficAdapterStatus(
                    live_available=True,
                    fallback_used=False,
                    data_source="live",
                    message="Live traffic adjustments applied from external routing API.",
                ),
                data,
            )
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return (
            TrafficAdapterStatus(
                live_available=False,
                fallback_used=True,
                data_source="sample",
                message="External map/traffic API is currently unavailable. Falling back to sample route data (not live traffic).",
            ),
            None,
        )
