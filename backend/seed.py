"""
Idempotent database seed script for the Transport Route Optimization System.

Creates:
- 14 sample locations (13 connected metro hubs + 1 intentionally unlinked outpost)
- Bidirectional road segments with distinct distance_km, time_min, and cost profiles
- 3 demo users (passenger, driver, admin)
- 1 driver profile
- 2 initial sample saved trips + notifications + system settings
"""

from __future__ import annotations

import json
import os
import sys

# Ensure project root is importable when run directly as `python3 backend/seed.py`
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.auth import hash_password
from backend.config import load_config
from backend.db import db_transaction, init_db, utc_now_iso


DEMO_USERS = [
    ("Aarav Mehta", "passenger@demo.local", "pass1234", "passenger"),
    ("Rohan Kulkarni", "driver@demo.local", "driver1234", "driver"),
    ("Meera Nair", "admin@demo.local", "admin1234", "admin"),
]

# 14 Sample Metro Hubs (coords around a compact regional grid)
SAMPLE_LOCATIONS = [
    ("Central Railway Terminal", 12.9784, 77.5715, "Central"),
    ("Civic Center Plaza", 12.9767, 77.5923, "Central"),
    ("Old Town Market", 12.9634, 77.5855, "South Central"),
    ("Greenbelt Botanical Gate", 12.9507, 77.5848, "South"),
    ("Southern Ring Junction", 12.9166, 77.6101, "South Ring"),
    ("Lakeside Medical Center", 12.9352, 77.6245, "South East"),
    ("Harbor Freight Depot", 12.9569, 77.7011, "East"),
    ("East IT Corridor", 12.9850, 77.7367, "Far East"),
    ("North Tech Campus", 13.0358, 77.5970, "North"),
    ("Expressway Toll Plaza", 13.0827, 77.6380, "North East"),
    ("International Airport Gate", 13.1986, 77.7066, "Airport"),
    ("University Science Hub", 13.0219, 77.5671, "North West"),
    ("West Industrial Park", 12.9915, 77.5177, "West"),
    ("Hilltop Relay Station", 13.0620, 77.4820, "Isolated Outpost"),  # Unlinked node for testing no-route cases
    # Inter-city major hubs (accurate coordinates)
    ("Hyderabad", 17.3850, 78.4867, "Inter-City · Telangana"),
    ("Vijayawada", 16.5062, 80.6480, "Inter-City · Andhra Pradesh"),
    ("Visakhapatnam", 17.6868, 83.2185, "Inter-City · Andhra Pradesh"),
    ("Bengaluru", 12.9716, 77.5946, "Inter-City · Karnataka"),
]

# Bidirectional road segments:
# (loc_a, loc_b, distance_km, time_min, cost, road_name, road_type)
# Designed so major pairs have competing Shortest / Fastest / Cheapest paths!
SAMPLE_ROADS = [
    # Core downtown & central links (short distance, slower city traffic, low cost)
    ("Central Railway Terminal", "Civic Center Plaza", 2.4, 9.0, 2.50, "Station Avenue", "city"),
    ("Central Railway Terminal", "Old Town Market", 2.1, 10.0, 1.80, "Bazaar Street", "city"),
    ("Civic Center Plaza", "Old Town Market", 1.8, 7.0, 1.50, "Heritage Cross", "city"),
    ("Old Town Market", "Greenbelt Botanical Gate", 1.9, 8.0, 1.60, "Park Perimeter Rd", "city"),
    ("Greenbelt Botanical Gate", "Southern Ring Junction", 5.2, 14.0, 3.20, "South Arterial", "arterial"),
    ("Greenbelt Botanical Gate", "Lakeside Medical Center", 4.9, 13.0, 3.00, "Lakeview Rd", "arterial"),
    ("Southern Ring Junction", "Lakeside Medical Center", 2.8, 7.0, 2.10, "Ring Connector", "arterial"),

    # West & North-West connections
    ("Central Railway Terminal", "West Industrial Park", 6.4, 18.0, 4.00, "West Freight Way", "arterial"),
    ("Central Railway Terminal", "University Science Hub", 5.1, 15.0, 3.40, "Campus Boulevard", "arterial"),
    ("West Industrial Park", "University Science Hub", 7.3, 19.0, None, "West Scenic Bypass", "bypass"),  # Cost unavailable intentionally!
    ("West Industrial Park", "Greenbelt Botanical Gate", 8.6, 22.0, 4.60, "Outer West Ring", "ring"),

    # North & Airport corridors (expressway is faster but higher toll cost)
    ("Civic Center Plaza", "North Tech Campus", 7.2, 17.0, 4.80, "North Metro Arterial", "arterial"),
    ("University Science Hub", "North Tech Campus", 4.1, 11.0, 2.90, "Tech Link Rd", "arterial"),
    ("North Tech Campus", "Expressway Toll Plaza", 7.4, 9.0, 8.50, "Airport Expressway", "expressway"),
    ("Expressway Toll Plaza", "International Airport Gate", 14.8, 15.0, 14.00, "Airport Tollway", "expressway"),
    ("North Tech Campus", "International Airport Gate", 21.0, 38.0, 9.20, "Old Airport Service Rd", "arterial"),

    # East & IT Corridor competing routes
    ("Civic Center Plaza", "Harbor Freight Depot", 12.2, 31.0, 6.20, "Old East Highway", "arterial"),
    ("Lakeside Medical Center", "Harbor Freight Depot", 8.9, 18.0, 5.40, "East Ring Link", "ring"),
    ("Southern Ring Junction", "Harbor Freight Depot", 11.5, 24.0, 5.80, "Outer Ring Express", "ring"),
    ("Harbor Freight Depot", "East IT Corridor", 5.1, 12.0, 3.50, "Corridor Main Rd", "arterial"),
    ("Expressway Toll Plaza", "East IT Corridor", 16.2, 19.0, 12.50, "Eastern Peripheral Toll", "expressway"),
    ("North Tech Campus", "East IT Corridor", 17.8, 34.0, 8.10, "Cross-Town Belt Rd", "arterial"),
    ("Expressway Toll Plaza", "Harbor Freight Depot", 18.5, 24.0, 11.00, "Northeast Freight Spur", "expressway"),
    ("Lakeside Medical Center", "East IT Corridor", 13.4, 28.0, 6.40, "Canal Sideway", "arterial"),

    # Inter-City Highway Corridors: Hyderabad, Vijayawada, Visakhapatnam, Bengaluru
    ("Hyderabad", "Vijayawada", 275.0, 270.0, 18.50, "NH-65 Express Highway (via Suryapet)", "expressway"),
    ("Hyderabad", "Vijayawada", 292.0, 315.0, 14.00, "SH-2 Toll-Free Route (via Nalgonda)", "arterial"),
    ("Vijayawada", "Visakhapatnam", 350.0, 335.0, 22.00, "NH-16 Coastal Expressway (via Rajahmundry)", "expressway"),
    ("Vijayawada", "Visakhapatnam", 372.0, 390.0, 16.50, "Coastal State Road (via Machilipatnam)", "arterial"),
    ("Hyderabad", "Visakhapatnam", 590.0, 615.0, 33.00, "NH-365BB Inland Corridor (via Khammam)", "arterial"),
    ("Hyderabad", "Bengaluru", 575.0, 500.0, 38.00, "NH-44 North-South Expressway (via Kurnool)", "expressway"),
    ("Hyderabad", "Bengaluru", 615.0, 620.0, 29.50, "Raichur-Ballari Highway", "arterial"),
    ("Bengaluru", "Vijayawada", 660.0, 595.0, 41.00, "NH-75 / NH-16 Corridor (via Tirupati - Nellore)", "expressway"),
    ("Bengaluru", "Vijayawada", 685.0, 655.0, 33.00, "Rayalaseema Highway (via Anantapur - Kadapa)", "arterial"),
    ("Bengaluru", "Visakhapatnam", 1005.0, 910.0, 64.00, "Southern Coastal Express (via Tirupati - Nellore)", "expressway"),
]


def seed_database(db_path: str | None = None, reset: bool = False) -> dict[str, int]:
    config = load_config()
    target_db = db_path or config.db_path
    init_db(target_db)

    now = utc_now_iso()
    created_counts = {"users": 0, "locations": 0, "routes": 0, "trips": 0}

    with db_transaction(target_db) as conn:
        if reset:
            conn.execute("DELETE FROM trip_status_logs;")
            conn.execute("DELETE FROM route_results;")
            conn.execute("DELETE FROM trips;")
            conn.execute("DELETE FROM notifications;")
            conn.execute("DELETE FROM drivers;")
            conn.execute("DELETE FROM routes;")
            conn.execute("DELETE FROM locations;")
            conn.execute("DELETE FROM users;")
            conn.execute("DELETE FROM system_settings;")

        # 1. System settings
        default_settings = {
            "enable_driver_role": "true" if config.enable_driver_role else "false",
            "external_routing_enabled": "true",
            "default_preference": "shortest",
            "system_notice": "Prototype network using seeded sample route metrics (not live traffic).",
        }
        for key, val in default_settings.items():
            conn.execute(
                """
                INSERT OR IGNORE INTO system_settings (setting_key, setting_value, updated_at)
                VALUES (?, ?, ?)
                """,
                (key, val, now),
            )

        # 2. Users
        for name, email, pw, role in DEMO_USERS:
            existing = conn.execute("SELECT user_id FROM users WHERE email = ?", (email,)).fetchone()
            if not existing:
                conn.execute(
                    """
                    INSERT INTO users (name, email, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (name, email, hash_password(pw), role, now),
                )
                created_counts["users"] += 1

        # Ensure driver record exists for demo driver
        driver_user = conn.execute(
            "SELECT user_id FROM users WHERE email = ?", ("driver@demo.local",)
        ).fetchone()
        if driver_user:
            existing_driver = conn.execute(
                "SELECT driver_id FROM drivers WHERE user_id = ?", (driver_user["user_id"],)
            ).fetchone()
            if not existing_driver:
                conn.execute(
                    """
                    INSERT INTO drivers (user_id, vehicle_number, availability)
                    VALUES (?, ?, ?)
                    """,
                    (driver_user["user_id"], "KA-01-TR-4028", "available"),
                )

        # 3. Locations
        for name, lat, lng, zone in SAMPLE_LOCATIONS:
            existing = conn.execute("SELECT location_id FROM locations WHERE name = ?", (name,)).fetchone()
            if not existing:
                conn.execute(
                    """
                    INSERT INTO locations (name, latitude, longitude, zone)
                    VALUES (?, ?, ?, ?)
                    """,
                    (name, lat, lng, zone),
                )
                created_counts["locations"] += 1

        loc_rows = conn.execute("SELECT location_id, name FROM locations").fetchall()
        loc_map = {r["name"]: r["location_id"] for r in loc_rows}

        # 4. Routes (idempotent bidirectional insertion per segment)
        existing_routes = {
            (r["start_location_id"], r["end_location_id"], r["road_name"])
            for r in conn.execute("SELECT start_location_id, end_location_id, road_name FROM routes").fetchall()
        }
        for a, b, dist_km, time_min, cost, road_name, road_type in SAMPLE_ROADS:
            a_id = loc_map[a]
            b_id = loc_map[b]
            if (a_id, b_id, road_name) not in existing_routes:
                conn.execute(
                    """
                    INSERT INTO routes (start_location_id, end_location_id, distance_km, time_min, cost, road_name, road_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (a_id, b_id, dist_km, time_min, cost, road_name, road_type),
                )
                existing_routes.add((a_id, b_id, road_name))
                created_counts["routes"] += 1
            if (b_id, a_id, road_name) not in existing_routes:
                conn.execute(
                    """
                    INSERT INTO routes (start_location_id, end_location_id, distance_km, time_min, cost, road_name, road_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (b_id, a_id, dist_km, time_min, cost, road_name, road_type),
                )
                existing_routes.add((b_id, a_id, road_name))
                created_counts["routes"] += 1

        # 5. Initial sample trip & notifications for demo passenger
        passenger_row = conn.execute(
            "SELECT user_id FROM users WHERE email = ?", ("passenger@demo.local",)
        ).fetchone()
        driver_row = conn.execute("SELECT driver_id FROM drivers LIMIT 1").fetchone()
        trip_count = conn.execute("SELECT COUNT(*) AS cnt FROM trips").fetchone()["cnt"]

        if passenger_row and trip_count == 0:
            src_id = loc_map["Central Railway Terminal"]
            dst_id = loc_map["East IT Corridor"]
            first_route = conn.execute(
                "SELECT route_id FROM routes WHERE start_location_id = ? LIMIT 1", (src_id,)
            ).fetchone()
            driver_id = driver_row["driver_id"] if driver_row else None

            cur = conn.execute(
                """
                INSERT INTO trips (passenger_id, source_id, destination_id, preference, status, assigned_driver_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (passenger_row["user_id"], src_id, dst_id, "fastest", "assigned", driver_id, now),
            )
            trip_id = cur.lastrowid
            sample_path = [
                {"location_id": loc_map["Central Railway Terminal"], "name": "Central Railway Terminal"},
                {"location_id": loc_map["Civic Center Plaza"], "name": "Civic Center Plaza"},
                {"location_id": loc_map["North Tech Campus"], "name": "North Tech Campus"},
                {"location_id": loc_map["Expressway Toll Plaza"], "name": "Expressway Toll Plaza"},
                {"location_id": loc_map["East IT Corridor"], "name": "East IT Corridor"},
            ]
            conn.execute(
                """
                INSERT INTO route_results (
                    trip_id, route_id, rank_number, score, path_json,
                    total_distance_km, total_time_min, total_cost, data_source, is_selected
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trip_id,
                    first_route["route_id"] if first_route else None,
                    1,
                    54.0,
                    json.dumps(sample_path),
                    33.2,
                    54.0,
                    28.3,
                    "sample",
                    1,
                ),
            )
            conn.execute(
                """
                INSERT INTO trip_status_logs (trip_id, status, updated_at, remarks)
                VALUES (?, ?, ?, ?)
                """,
                (trip_id, "assigned", now, "Sample trip seeded and assigned to demo driver."),
            )
            conn.execute(
                """
                INSERT INTO notifications (user_id, title, message, category, is_read, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    passenger_row["user_id"],
                    "Welcome to Transport Route Optimizer",
                    "Sample road network loaded (14 hubs, 48 directional segments). Search any pair to compare Shortest, Fastest, and Lowest cost routes.",
                    "info",
                    0,
                    now,
                ),
            )
            created_counts["trips"] += 1

    return created_counts


if __name__ == "__main__":
    summary = seed_database()
    print(f"Seed complete: {summary}")
