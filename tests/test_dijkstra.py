"""Unit tests for the Dijkstra route optimization engine."""

from __future__ import annotations

import unittest

from backend.dijkstra import Edge, LocationNode, dijkstra_shortest_path, optimize_routes


def _sample_network():
    locations = [
        LocationNode(1, "Alpha Hub", 12.97, 77.57),
        LocationNode(2, "Beta Inner", 12.98, 77.59),
        LocationNode(3, "Gamma Tollway", 13.02, 77.61),
        LocationNode(4, "Delta Bypass", 12.94, 77.63),
        LocationNode(5, "Epsilon Dest", 12.99, 77.68),
        LocationNode(6, "Isolated Ridge", 13.10, 77.45),
    ]
    edges = [
        # Path A (Shortest distance: 1 -> 2 -> 5 = 10 km, 35 min, $10)
        Edge(101, 1, 2, distance_km=4.0, time_min=15.0, cost=5.0, road_name="Inner St"),
        Edge(102, 2, 5, distance_km=6.0, time_min=20.0, cost=5.0, road_name="Market Rd"),
        # Path B (Fastest time: 1 -> 3 -> 5 = 14 km, 16 min, $22)
        Edge(103, 1, 3, distance_km=7.0, time_min=8.0, cost=11.0, road_name="North Expy"),
        Edge(104, 3, 5, distance_km=7.0, time_min=8.0, cost=11.0, road_name="East Expy"),
        # Path C (Lowest cost: 1 -> 4 -> 5 = 16 km, 28 min, $4)
        Edge(105, 1, 4, distance_km=8.0, time_min=14.0, cost=2.0, road_name="South Bypass"),
        Edge(106, 4, 5, distance_km=8.0, time_min=14.0, cost=2.0, road_name="Outer Belt"),
    ]
    return locations, edges


class TestDijkstraModule(unittest.TestCase):
    def test_tc05_preference_shortest_ranks_min_distance_first(self) -> None:
        locations, edges = _sample_network()
        res = optimize_routes(locations, edges, source_id=1, destination_id=5, preference="shortest")
        self.assertTrue(res["found"])
        self.assertGreaterEqual(len(res["routes"]), 3)
        top = res["routes"][0]
        self.assertEqual(top["rank_number"], 1)
        self.assertTrue(top["recommended"])
        self.assertEqual(top["node_ids"], [1, 2, 5])
        self.assertEqual(top["total_distance_km"], 10.0)
        self.assertEqual(top["data_source"], "sample")

    def test_tc06_preference_fastest_ranks_min_time_first(self) -> None:
        locations, edges = _sample_network()
        res = optimize_routes(locations, edges, source_id=1, destination_id=5, preference="fastest")
        self.assertTrue(res["found"])
        top = res["routes"][0]
        self.assertEqual(top["rank_number"], 1)
        self.assertTrue(top["recommended"])
        self.assertEqual(top["node_ids"], [1, 3, 5])
        self.assertEqual(top["total_time_min"], 16.0)

    def test_preference_cheapest_ranks_min_cost_first(self) -> None:
        locations, edges = _sample_network()
        res = optimize_routes(locations, edges, source_id=1, destination_id=5, preference="cheapest")
        self.assertTrue(res["found"])
        top = res["routes"][0]
        self.assertEqual(top["node_ids"], [1, 4, 5])
        self.assertEqual(top["total_cost"], 4.0)
        self.assertFalse(res["cost_unavailable"])

    def test_tc08_no_route_between_locations(self) -> None:
        locations, edges = _sample_network()
        res = optimize_routes(locations, edges, source_id=1, destination_id=6, preference="shortest")
        self.assertFalse(res["found"])
        self.assertEqual(res["routes"], [])
        self.assertIn("No route found", res["message"])

    def test_cost_unavailable_handling(self) -> None:
        locations = [
            LocationNode(1, "Start", 12.9, 77.5),
            LocationNode(2, "End", 12.95, 77.55),
        ]
        edges = [
            Edge(1, 1, 2, distance_km=5.0, time_min=12.0, cost=None, road_name="Unpriced Link")
        ]
        res = optimize_routes(locations, edges, source_id=1, destination_id=2, preference="cheapest")
        self.assertTrue(res["found"])
        self.assertTrue(res["cost_unavailable"])
        self.assertIsNone(res["routes"][0]["total_cost"])
        self.assertIn("Cost data is unavailable", res["message"])

    def test_negative_weight_rejected(self) -> None:
        locations = [LocationNode(1, "A", 0.0, 0.0), LocationNode(2, "B", 0.1, 0.1)]
        edges = [Edge(1, 1, 2, distance_km=-2.0, time_min=5.0, cost=1.0)]
        with self.assertRaises(ValueError):
            optimize_routes(locations, edges, 1, 2, "shortest")

    def test_same_source_and_destination_raises(self) -> None:
        locations, edges = _sample_network()
        with self.assertRaises(ValueError):
            optimize_routes(locations, edges, 1, 1, "shortest")

    def test_direct_dijkstra_returns_none_when_unreachable(self) -> None:
        adj = {1: [Edge(1, 1, 2, 3.0, 5.0, 2.0)], 2: [], 3: []}
        self.assertIsNone(dijkstra_shortest_path(adj, 1, 3, lambda e: e.distance_km))


if __name__ == "__main__":
    unittest.main()
