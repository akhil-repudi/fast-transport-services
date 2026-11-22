"""
Route Optimization Engine using Dijkstra's Shortest-Path Algorithm.

Models locations as graph nodes and road segments as weighted directed edges.
Supports three optimization criteria:
  - shortest: minimize total distance_km
  - fastest: minimize total time_min
  - cheapest: minimize total cost (excluding paths with unavailable cost)
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import Any, Callable, Iterable


VALID_PREFERENCES = ("shortest", "fastest", "cheapest")


@dataclass(frozen=True)
class Edge:
    route_id: int
    start_location_id: int
    end_location_id: int
    distance_km: float
    time_min: float
    cost: float | None
    road_name: str = ""
    road_type: str = "arterial"


@dataclass(frozen=True)
class LocationNode:
    location_id: int
    name: str
    latitude: float
    longitude: float
    zone: str = ""


def _validate_non_negative_edge(edge: Edge) -> None:
    if edge.distance_km < 0:
        raise ValueError(f"Negative distance_km ({edge.distance_km}) on route {edge.route_id}")
    if edge.time_min < 0:
        raise ValueError(f"Negative time_min ({edge.time_min}) on route {edge.route_id}")
    if edge.cost is not None and edge.cost < 0:
        raise ValueError(f"Negative cost ({edge.cost}) on route {edge.route_id}")


def dijkstra_shortest_path(
    adjacency: dict[int, list[Edge]],
    source_id: int,
    destination_id: int,
    weight_fn: Callable[[Edge], float | None],
    penalties: dict[int, float] | None = None,
) -> tuple[float, list[Edge]] | None:
    """
    Find the minimum-weight path from source_id to destination_id using Dijkstra's algorithm.

    Returns (total_weighted_score, ordered_edges) or None if unreachable.
    Edges where weight_fn(edge) returns None are skipped.
    Raises ValueError if any traversed edge produces a negative weight.
    """
    if source_id == destination_id:
        return (0.0, [])

    penalties = penalties or {}
    dist: dict[int, float] = {source_id: 0.0}
    prev_edge: dict[int, Edge] = {}
    heap: list[tuple[float, int]] = [(0.0, source_id)]
    visited: set[int] = set()

    while heap:
        current_cost, u = heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)

        if u == destination_id:
            break

        for edge in adjacency.get(u, []):
            _validate_non_negative_edge(edge)
            base_w = weight_fn(edge)
            if base_w is None:
                continue
            if base_w < 0:
                raise ValueError(f"Dijkstra requires non-negative edge weights (got {base_w})")

            multiplier = penalties.get(edge.route_id, 1.0)
            if multiplier < 1.0:
                multiplier = 1.0
            step_weight = base_w * multiplier
            v = edge.end_location_id
            candidate = current_cost + step_weight

            if candidate < dist.get(v, float("inf")):
                dist[v] = candidate
                prev_edge[v] = edge
                heapq.heappush(heap, (candidate, v))

    if destination_id not in dist:
        return None

    edges: list[Edge] = []
    curr = destination_id
    while curr != source_id:
        edge = prev_edge[curr]
        edges.append(edge)
        curr = edge.start_location_id
    edges.reverse()
    return (dist[destination_id], edges)


def _summarize_path(
    edges: list[Edge],
    locations_by_id: dict[int, LocationNode],
    source_id: int,
    data_source: str = "sample",
) -> dict[str, Any]:
    if not edges:
        node = locations_by_id[source_id]
        return {
            "node_ids": [source_id],
            "path": [
                {
                    "location_id": node.location_id,
                    "name": node.name,
                    "latitude": node.latitude,
                    "longitude": node.longitude,
                }
            ],
            "segments": [],
            "primary_route_id": None,
            "total_distance_km": 0.0,
            "total_time_min": 0.0,
            "total_cost": 0.0,
            "cost_available": True,
            "data_source": data_source,
        }

    node_ids = [edges[0].start_location_id] + [e.end_location_id for e in edges]
    path_nodes = []
    for nid in node_ids:
        loc = locations_by_id.get(nid)
        if loc:
            path_nodes.append(
                {
                    "location_id": loc.location_id,
                    "name": loc.name,
                    "latitude": loc.latitude,
                    "longitude": loc.longitude,
                }
            )
        else:
            path_nodes.append({"location_id": nid, "name": f"Location {nid}", "latitude": 0.0, "longitude": 0.0})

    total_distance = round(sum(e.distance_km for e in edges), 2)
    total_time = round(sum(e.time_min for e in edges), 2)
    cost_available = all(e.cost is not None for e in edges)
    total_cost = round(sum(float(e.cost) for e in edges), 2) if cost_available else None

    segments = [
        {
            "route_id": e.route_id,
            "start_location_id": e.start_location_id,
            "end_location_id": e.end_location_id,
            "distance_km": round(e.distance_km, 2),
            "time_min": round(e.time_min, 2),
            "cost": round(e.cost, 2) if e.cost is not None else None,
            "road_name": e.road_name,
            "road_type": e.road_type,
        }
        for e in edges
    ]

    return {
        "node_ids": node_ids,
        "path": path_nodes,
        "segments": segments,
        "primary_route_id": edges[0].route_id,
        "total_distance_km": total_distance,
        "total_time_min": total_time,
        "total_cost": total_cost,
        "cost_available": cost_available,
        "data_source": data_source,
    }


def _weight_distance(edge: Edge) -> float:
    return edge.distance_km


def _weight_time(edge: Edge) -> float:
    return edge.time_min


def _weight_cost(edge: Edge) -> float | None:
    return edge.cost


def optimize_routes(
    locations: Iterable[LocationNode],
    edges: Iterable[Edge],
    source_id: int,
    destination_id: int,
    preference: str = "shortest",
    max_alternatives: int = 4,
    data_source: str = "sample",
) -> dict[str, Any]:
    """
    Compute optimal and alternative routes between source_id and destination_id.

    Runs Dijkstra once per criterion (distance, time, cost) plus iterative edge
    penalization on the selected preference criterion to surface distinct route
    alternatives, then ranks them strictly by preference.
    """
    pref = preference.strip().lower()
    if pref not in VALID_PREFERENCES:
        raise ValueError(f"Unsupported preference '{preference}'. Choose from {VALID_PREFERENCES}.")

    locations_by_id = {loc.location_id: loc for loc in locations}
    if source_id not in locations_by_id:
        raise ValueError(f"Unknown source location_id: {source_id}")
    if destination_id not in locations_by_id:
        raise ValueError(f"Unknown destination location_id: {destination_id}")
    if source_id == destination_id:
        raise ValueError("Source and destination must be different locations.")

    adjacency: dict[int, list[Edge]] = {lid: [] for lid in locations_by_id}
    for edge in edges:
        _validate_non_negative_edge(edge)
        adjacency.setdefault(edge.start_location_id, []).append(edge)

    candidate_paths: dict[tuple[int, ...], list[Edge]] = {}

    def _register(res: tuple[float, list[Edge]] | None) -> None:
        if res is None:
            return
        _, path_edges = res
        if not path_edges:
            return
        sig = tuple(e.route_id for e in path_edges)
        if sig not in candidate_paths:
            candidate_paths[sig] = path_edges

    # 1. Run Dijkstra once per criterion (shortest, fastest, cheapest)
    _register(dijkstra_shortest_path(adjacency, source_id, destination_id, _weight_distance))
    _register(dijkstra_shortest_path(adjacency, source_id, destination_id, _weight_time))
    _register(dijkstra_shortest_path(adjacency, source_id, destination_id, _weight_cost))

    # 2. Discover additional distinct paths by penalizing edges on existing paths
    pref_weight_fn = {
        "shortest": _weight_distance,
        "fastest": _weight_time,
        "cheapest": _weight_cost,
    }[pref]

    penalties: dict[int, float] = {}
    for _ in range(6):
        res = dijkstra_shortest_path(adjacency, source_id, destination_id, pref_weight_fn, penalties=penalties)
        if res is None:
            break
        _, found_edges = res
        _register(res)
        for edge in found_edges:
            penalties[edge.route_id] = penalties.get(edge.route_id, 1.0) * 1.75
        if len(candidate_paths) >= max_alternatives + 2:
            break

    # Also try a mild distance penalty pass if preferred wasn't distance (surfaces scenic/local options)
    if pref != "shortest":
        dist_penalties: dict[int, float] = {}
        for _ in range(3):
            res = dijkstra_shortest_path(adjacency, source_id, destination_id, _weight_distance, penalties=dist_penalties)
            if res is None:
                break
            _, found_edges = res
            _register(res)
            for edge in found_edges:
                dist_penalties[edge.route_id] = dist_penalties.get(edge.route_id, 1.0) * 1.8

    if not candidate_paths:
        return {
            "found": False,
            "preference": pref,
            "source": {
                "location_id": source_id,
                "name": locations_by_id[source_id].name,
            },
            "destination": {
                "location_id": destination_id,
                "name": locations_by_id[destination_id].name,
            },
            "routes": [],
            "cost_unavailable": False,
            "data_source": data_source,
            "message": f"No route found between {locations_by_id[source_id].name} and {locations_by_id[destination_id].name}.",
        }

    # Deduplicate by node sequence (keep best scoring segment combination for identical node paths)
    summaries_by_nodes: dict[tuple[int, ...], dict[str, Any]] = {}
    for path_edges in candidate_paths.values():
        summary = _summarize_path(path_edges, locations_by_id, source_id, data_source=data_source)
        node_sig = tuple(summary["node_ids"])
        existing = summaries_by_nodes.get(node_sig)
        if existing is None:
            summaries_by_nodes[node_sig] = summary
        else:
            # Prefer complete cost, then better criterion metric
            if pref == "cheapest":
                old_key = (0 if existing["cost_available"] else 1, existing["total_cost"] or float("inf"), existing["total_time_min"])
                new_key = (0 if summary["cost_available"] else 1, summary["total_cost"] or float("inf"), summary["total_time_min"])
            elif pref == "fastest":
                old_key = (0, existing["total_time_min"], existing["total_distance_km"])
                new_key = (0, summary["total_time_min"], summary["total_distance_km"])
            else:
                old_key = (0, existing["total_distance_km"], existing["total_time_min"])
                new_key = (0, summary["total_distance_km"], summary["total_time_min"])
            if new_key < old_key:
                summaries_by_nodes[node_sig] = summary

    all_summaries = list(summaries_by_nodes.values())

    cost_unavailable = False
    message = ""

    if pref == "shortest":
        all_summaries.sort(key=lambda r: (r["total_distance_km"], r["total_time_min"]))
        for r in all_summaries:
            r["score"] = r["total_distance_km"]
    elif pref == "fastest":
        all_summaries.sort(key=lambda r: (r["total_time_min"], r["total_distance_km"]))
        for r in all_summaries:
            r["score"] = r["total_time_min"]
    else:  # cheapest
        with_cost = [r for r in all_summaries if r["cost_available"]]
        without_cost = [r for r in all_summaries if not r["cost_available"]]
        with_cost.sort(key=lambda r: (float(r["total_cost"]), r["total_time_min"], r["total_distance_km"]))
        without_cost.sort(key=lambda r: (r["total_distance_km"], r["total_time_min"]))
        if not with_cost:
            cost_unavailable = True
            message = (
                "Cost data is unavailable for routes between these locations. "
                "Showing available paths by distance instead."
            )
            all_summaries = without_cost
            for r in all_summaries:
                r["score"] = None
        else:
            for r in with_cost:
                r["score"] = r["total_cost"]
            for r in without_cost:
                r["score"] = None
            all_summaries = with_cost + without_cost

    # Limit results and assign rank_number & Recommended flag
    limited = all_summaries[:max_alternatives]
    for idx, r in enumerate(limited, start=1):
        r["rank_number"] = idx
        if pref == "cheapest" and cost_unavailable:
            r["recommended"] = False
            r["label"] = "Cost unavailable"
        else:
            r["recommended"] = idx == 1
            r["label"] = "Recommended" if idx == 1 else f"Alternative {idx - 1}"

    # Tag best-in-category badges/flags cleanly for comparison display
    if limited:
        min_dist = min(r["total_distance_km"] for r in limited)
        min_time = min(r["total_time_min"] for r in limited)
        priced = [r for r in limited if r["total_cost"] is not None]
        min_cost = min(float(r["total_cost"]) for r in priced) if priced else None
        for r in limited:
            tags = []
            if r["total_distance_km"] == min_dist:
                tags.append("Shortest")
            if r["total_time_min"] == min_time:
                tags.append("Fastest")
            if min_cost is not None and r["total_cost"] == min_cost:
                tags.append("Lowest cost")
            r["highlights"] = tags

    return {
        "found": True,
        "preference": pref,
        "source": {
            "location_id": source_id,
            "name": locations_by_id[source_id].name,
        },
        "destination": {
            "location_id": destination_id,
            "name": locations_by_id[destination_id].name,
        },
        "routes": limited,
        "cost_unavailable": cost_unavailable,
        "data_source": data_source,
        "message": message,
    }
