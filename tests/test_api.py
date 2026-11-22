"""API integration tests covering TC03, TC05, TC06, TC08, TC09, TC11, auth, and trips."""

from __future__ import annotations

import os
import tempfile
import unittest

from backend.app import create_app
from backend.config import Config
from backend.routing_service import fetch_live_traffic_adjustments


class TestTransportAPI(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmpdir.name, "test_transport.db")
        self.cfg = Config(
            db_path=self.db_path,
            jwt_secret="test-secret-key",
            jwt_expiry_hours=1,
            port=5099,
            enable_driver_role=True,
            routing_api_url="",  # Simulates unconfigured traffic API
            routing_api_key="",
            routing_api_timeout_sec=0.5,
        )
        self.app = create_app(self.cfg)
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def _login(self, email: str, password: str) -> str:
        resp = self.client.post("/api/auth/login", json={"email": email, "password": password})
        self.assertEqual(resp.status_code, 200)
        return resp.get_json()["token"]

    def _location_id(self, name: str) -> int:
        resp = self.client.get("/api/locations")
        self.assertEqual(resp.status_code, 200)
        for loc in resp.get_json()["locations"]:
            if loc["name"] == name:
                return loc["location_id"]
        raise AssertionError(f"Location '{name}' not found")

    def test_tc03_blank_source_or_destination_validation(self) -> None:
        dest_id = self._location_id("Civic Center Plaza")
        resp1 = self.client.post(
            "/api/search",
            json={"source_id": "", "destination_id": dest_id, "preference": "shortest"},
        )
        self.assertEqual(resp1.status_code, 400)
        self.assertIn("required", resp1.get_json()["error"].lower())

        resp2 = self.client.post(
            "/api/search",
            json={"source_id": dest_id, "destination_id": None, "preference": "fastest"},
        )
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("required", resp2.get_json()["error"].lower())

    def test_source_equals_destination_and_unknown_location(self) -> None:
        loc_id = self._location_id("Central Railway Terminal")
        same_resp = self.client.post(
            "/api/search",
            json={"source_id": loc_id, "destination_id": loc_id, "preference": "shortest"},
        )
        self.assertEqual(same_resp.status_code, 400)

        unknown_resp = self.client.post(
            "/api/search",
            json={"source_id": loc_id, "destination_id": 99999, "preference": "shortest"},
        )
        self.assertEqual(unknown_resp.status_code, 404)

    def test_tc05_and_tc06_shortest_vs_fastest_ranking(self) -> None:
        src_id = self._location_id("Central Railway Terminal")
        dst_id = self._location_id("International Airport Gate")

        shortest_resp = self.client.post(
            "/api/search",
            json={"source_id": src_id, "destination_id": dst_id, "preference": "shortest"},
        )
        self.assertEqual(shortest_resp.status_code, 200)
        s_data = shortest_resp.get_json()
        self.assertTrue(s_data["found"])
        s_routes = s_data["routes"]
        self.assertEqual(s_routes[0]["rank_number"], 1)
        self.assertTrue(s_routes[0]["recommended"])
        self.assertEqual(
            s_routes[0]["total_distance_km"],
            min(r["total_distance_km"] for r in s_routes),
        )
        self.assertEqual(s_routes[0]["data_source"], "sample")

        fastest_resp = self.client.post(
            "/api/search",
            json={"source_id": src_id, "destination_id": dst_id, "preference": "fastest"},
        )
        self.assertEqual(fastest_resp.status_code, 200)
        f_routes = fastest_resp.get_json()["routes"]
        self.assertEqual(
            f_routes[0]["total_time_min"],
            min(r["total_time_min"] for r in f_routes),
        )

    def test_tc08_no_route_between_locations(self) -> None:
        src_id = self._location_id("Central Railway Terminal")
        isolated_id = self._location_id("Hilltop Relay Station")
        resp = self.client.post(
            "/api/search",
            json={"source_id": src_id, "destination_id": isolated_id, "preference": "shortest"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertFalse(data["found"])
        self.assertEqual(data["routes"], [])
        self.assertIn("No route found", data["message"])

    def test_tc09_traffic_api_unavailable_fallback(self) -> None:
        # 1. Unconfigured API via search endpoint
        src_id = self._location_id("Central Railway Terminal")
        dst_id = self._location_id("Civic Center Plaza")
        resp = self.client.post(
            "/api/search",
            json={"source_id": src_id, "destination_id": dst_id, "preference": "shortest"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["data_source"], "sample")
        self.assertTrue(data["traffic_api"]["fallback_used"])
        self.assertFalse(data["traffic_api"]["live_available"])
        self.assertIn("not live traffic", data["traffic_api"]["message"].lower())

        # 2. Configured but unreachable URL
        unreachable_cfg = Config(
            db_path=self.db_path,
            jwt_secret="x",
            jwt_expiry_hours=1,
            port=5099,
            enable_driver_role=True,
            routing_api_url="http://127.0.0.1:59999/unavailable",
            routing_api_key="dummy-key",
            routing_api_timeout_sec=0.2,
        )
        status, payload = fetch_live_traffic_adjustments(unreachable_cfg, (12.9, 77.5), (13.0, 77.6))
        self.assertFalse(status.live_available)
        self.assertTrue(status.fallback_used)
        self.assertEqual(status.data_source, "sample")
        self.assertIsNone(payload)
        self.assertIn("unavailable", status.message.lower())

    def test_tc11_non_admin_access_denied_403(self) -> None:
        passenger_token = self._login("passenger@demo.local", "pass1234")
        headers = {"Authorization": f"Bearer {passenger_token}"}

        for path in ("/api/admin/users", "/api/admin/reports", "/api/admin/settings"):
            resp = self.client.get(path, headers=headers)
            self.assertEqual(resp.status_code, 403, f"Expected 403 for {path}")
            self.assertIn("access denied", resp.get_json()["error"].lower())

        create_loc = self.client.post(
            "/api/locations",
            json={"name": "Unauthorized Node", "latitude": 12.9, "longitude": 77.6},
            headers=headers,
        )
        self.assertEqual(create_loc.status_code, 403)

        admin_token = self._login("admin@demo.local", "admin1234")
        admin_resp = self.client.get("/api/admin/reports", headers={"Authorization": f"Bearer {admin_token}"})
        self.assertEqual(admin_resp.status_code, 200)
        self.assertIn("totals", admin_resp.get_json())

    def test_auth_registration_duplicate_email_wrong_password_and_save_trip(self) -> None:
        reg = self.client.post(
            "/api/auth/register",
            json={"name": "New Student", "email": "student@uni.edu", "password": "secret123"},
        )
        self.assertEqual(reg.status_code, 201)
        token = reg.get_json()["token"]

        dup = self.client.post(
            "/api/auth/register",
            json={"name": "Dup Student", "email": "student@uni.edu", "password": "secret123"},
        )
        self.assertEqual(dup.status_code, 409)

        wrong_pw = self.client.post(
            "/api/auth/login",
            json={"email": "student@uni.edu", "password": "wrongpassword"},
        )
        self.assertEqual(wrong_pw.status_code, 401)

        src_id = self._location_id("Central Railway Terminal")
        dst_id = self._location_id("East IT Corridor")
        search = self.client.post(
            "/api/search",
            json={"source_id": src_id, "destination_id": dst_id, "preference": "shortest"},
            headers={"Authorization": f"Bearer {token}"},
        )
        routes = search.get_json()["routes"]

        save = self.client.post(
            "/api/trips",
            json={
                "source_id": src_id,
                "destination_id": dst_id,
                "preference": "shortest",
                "selected_rank": 1,
                "routes": routes,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(save.status_code, 201)

        history = self.client.get("/api/trips", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(history.status_code, 200)
        trips = history.get_json()["trips"]
        self.assertEqual(len(trips), 1)
        self.assertGreaterEqual(len(trips[0]["results"]), 1)

    def test_intercity_distances_hyderabad_vijayawada_visakhapatnam_bengaluru(self) -> None:
        hyd = self._location_id("Hyderabad")
        vja = self._location_id("Vijayawada")
        vsk = self._location_id("Visakhapatnam")
        blr = self._location_id("Bengaluru")

        # Hyderabad -> Vijayawada: shortest = 275.0 km
        res_hv = self.client.post(
            "/api/search",
            json={"source_id": hyd, "destination_id": vja, "preference": "shortest"},
        )
        self.assertEqual(res_hv.status_code, 200)
        self.assertEqual(res_hv.get_json()["routes"][0]["total_distance_km"], 275.0)

        # Vijayawada -> Visakhapatnam: shortest = 350.0 km
        res_vv = self.client.post(
            "/api/search",
            json={"source_id": vja, "destination_id": vsk, "preference": "shortest"},
        )
        self.assertEqual(res_vv.status_code, 200)
        self.assertEqual(res_vv.get_json()["routes"][0]["total_distance_km"], 350.0)

        # Hyderabad -> Bengaluru: shortest = 575.0 km
        res_hb = self.client.post(
            "/api/search",
            json={"source_id": hyd, "destination_id": blr, "preference": "shortest"},
        )
        self.assertEqual(res_hb.status_code, 200)
        self.assertEqual(res_hb.get_json()["routes"][0]["total_distance_km"], 575.0)

        # Hyderabad -> Visakhapatnam: shortest = 590.0 km, fastest = 605 min (via Vijayawada)
        res_hs = self.client.post(
            "/api/search",
            json={"source_id": hyd, "destination_id": vsk, "preference": "shortest"},
        )
        self.assertEqual(res_hs.status_code, 200)
        self.assertEqual(res_hs.get_json()["routes"][0]["total_distance_km"], 590.0)

        res_hf = self.client.post(
            "/api/search",
            json={"source_id": hyd, "destination_id": vsk, "preference": "fastest"},
        )
        self.assertEqual(res_hf.status_code, 200)
        self.assertEqual(res_hf.get_json()["routes"][0]["total_time_min"], 605.0)


if __name__ == "__main__":
    unittest.main()

