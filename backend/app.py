"""
Transport Route Optimization System — REST API Server.

Implements authentication, role-based access control, location & route management,
Dijkstra-based route search & ranking, trip persistence, notifications, driver
dispatch (feature-flagged), and admin analytics.
"""

from __future__ import annotations

import json
import os
import sys
from functools import wraps
from typing import Any, Callable

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from flask import Flask, g, jsonify, make_response, request
except ImportError:
    from backend.wsgi_compat import Flask, g, jsonify, make_response, request

from backend.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from backend.config import Config, load_config
from backend.db import db_transaction, get_connection, init_db, utc_now_iso
from backend.dijkstra import Edge, LocationNode, VALID_PREFERENCES, optimize_routes
from backend.routing_service import fetch_live_traffic_adjustments
from backend.seed import seed_database


def create_app(config_override: Config | None = None) -> Flask:
    app = Flask(__name__)
    cfg = config_override or load_config()
    app.config["APP_CONFIG"] = cfg

    init_db(cfg.db_path)
    seed_database(cfg.db_path)

    def _get_cfg() -> Config:
        return app.config["APP_CONFIG"]

    def _get_setting(conn: Any, key: str, default: str = "") -> str:
        row = conn.execute(
            "SELECT setting_value FROM system_settings WHERE setting_key = ?", (key,)
        ).fetchone()
        return row["setting_value"] if row else default

    def _driver_feature_enabled(conn: Any) -> bool:
        val = _get_setting(conn, "enable_driver_role", "true" if _get_cfg().enable_driver_role else "false")
        return val.strip().lower() in {"1", "true", "yes", "on"}

    def _extract_user() -> dict[str, Any] | None:
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif "access_token" in request.cookies:
            token = request.cookies.get("access_token")
        if not token:
            return None
        payload = decode_access_token(token, _get_cfg().jwt_secret)
        if not payload:
            return None
        conn = get_connection(_get_cfg().db_path)
        try:
            row = conn.execute(
                "SELECT user_id, name, email, role, created_at FROM users WHERE user_id = ?",
                (int(payload["user_id"]),),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def require_auth(roles: tuple[str, ...] | None = None) -> Callable[..., Any]:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            @wraps(fn)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                user = _extract_user()
                if not user:
                    return jsonify({"error": "Authentication required. Please log in."}), 401
                if roles and user["role"] not in roles:
                    return (
                        jsonify({"error": "Access denied: insufficient permissions for this resource."}),
                        403,
                    )
                g.current_user = user
                return fn(*args, **kwargs)

            return wrapper

        return decorator

    # ------------------------------------------------------------------
    # Health & Public Config
    # ------------------------------------------------------------------
    @app.route("/api/health", methods=["GET"])
    def health() -> Any:
        return jsonify({"status": "ok"})

    @app.route("/api/settings/public", methods=["GET"])
    def public_settings() -> Any:
        conn = get_connection(_get_cfg().db_path)
        try:
            return jsonify(
                {
                    "enable_driver_role": _driver_feature_enabled(conn),
                    "default_preference": _get_setting(conn, "default_preference", "shortest"),
                    "system_notice": _get_setting(
                        conn,
                        "system_notice",
                        "Prototype network using seeded sample route metrics (not live traffic).",
                    ),
                }
            )
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    @app.route("/api/auth/register", methods=["POST"])
    def register() -> Any:
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        requested_role = str(data.get("role", "passenger")).strip().lower()

        if not name or not email or not password:
            return jsonify({"error": "Name, email, and password are required."}), 400
        if "@" not in email:
            return jsonify({"error": "Please enter a valid email address."}), 400
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters long."}), 400

        # Public registration allows passenger or (if feature-enabled) driver; never self-serve admin
        conn = get_connection(_get_cfg().db_path)
        try:
            driver_enabled = _driver_feature_enabled(conn)
        finally:
            conn.close()

        role = "passenger"
        if requested_role == "driver":
            if not driver_enabled:
                return jsonify({"error": "Driver registration is currently disabled."}), 400
            role = "driver"

        now = utc_now_iso()
        try:
            pw_hash = hash_password(password)
            with db_transaction(_get_cfg().db_path) as conn:
                existing = conn.execute(
                    "SELECT user_id FROM users WHERE email = ?", (email,)
                ).fetchone()
                if existing:
                    return jsonify({"error": "An account with this email already exists."}), 409

                cur = conn.execute(
                    """
                    INSERT INTO users (name, email, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (name, email, pw_hash, role, now),
                )
                user_id = int(cur.lastrowid)

                if role == "driver":
                    vehicle = str(data.get("vehicle_number", "")).strip() or f"VEH-{user_id:04d}"
                    conn.execute(
                        "INSERT INTO drivers (user_id, vehicle_number, availability) VALUES (?, ?, 'available')",
                        (user_id, vehicle),
                    )

                conn.execute(
                    """
                    INSERT INTO notifications (user_id, title, message, category, is_read, created_at)
                    VALUES (?, ?, ?, 'info', 0, ?)
                    """,
                    (
                        user_id,
                        "Account created",
                        f"Welcome {name}. Your {role} account is ready.",
                        now,
                    ),
                )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        token = create_access_token(user_id, email, role, _get_cfg().jwt_secret, _get_cfg().jwt_expiry_hours)
        resp = make_response(
            {
                "token": token,
                "user": {"user_id": user_id, "name": name, "email": email, "role": role},
            },
            201,
        )
        resp.set_cookie("access_token", token, httponly=True, samesite="Lax")
        return resp

    @app.route("/api/auth/login", methods=["POST"])
    def login() -> Any:
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))

        if not email or not password:
            return jsonify({"error": "Email and password are required."}), 400

        conn = get_connection(_get_cfg().db_path)
        try:
            row = conn.execute(
                "SELECT user_id, name, email, password_hash, role FROM users WHERE email = ?",
                (email,),
            ).fetchone()
        finally:
            conn.close()

        if not row or not verify_password(password, row["password_hash"]):
            return jsonify({"error": "Invalid email or password."}), 401

        token = create_access_token(
            row["user_id"], row["email"], row["role"], _get_cfg().jwt_secret, _get_cfg().jwt_expiry_hours
        )
        resp = make_response(
            {
                "token": token,
                "user": {
                    "user_id": row["user_id"],
                    "name": row["name"],
                    "email": row["email"],
                    "role": row["role"],
                },
            },
            200,
        )
        resp.set_cookie("access_token", token, httponly=True, samesite="Lax")
        return resp

    @app.route("/api/auth/logout", methods=["POST"])
    def logout() -> Any:
        resp = make_response({"message": "Logged out successfully."}, 200)
        resp.delete_cookie("access_token")
        return resp

    @app.route("/api/auth/me", methods=["GET"])
    @require_auth()
    def me() -> Any:
        return jsonify({"user": g.current_user})

    # ------------------------------------------------------------------
    # Locations
    # ------------------------------------------------------------------
    @app.route("/api/locations", methods=["GET"])
    def list_locations() -> Any:
        query = str(request.args.get("q", "")).strip().lower()
        conn = get_connection(_get_cfg().db_path)
        try:
            if query:
                rows = conn.execute(
                    """
                    SELECT location_id, name, latitude, longitude, zone
                    FROM locations
                    WHERE LOWER(name) LIKE ? OR LOWER(zone) LIKE ?
                    ORDER BY name ASC
                    """,
                    (f"%{query}%", f"%{query}%"),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT location_id, name, latitude, longitude, zone FROM locations ORDER BY name ASC"
                ).fetchall()
            return jsonify({"locations": [dict(r) for r in rows]})
        finally:
            conn.close()

    @app.route("/api/locations", methods=["POST"])
    @require_auth(roles=("admin",))
    def create_location() -> Any:
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        zone = str(data.get("zone", "")).strip()
        try:
            lat = float(data.get("latitude"))
            lng = float(data.get("longitude"))
        except (TypeError, ValueError):
            return jsonify({"error": "Valid latitude and longitude numbers are required."}), 400
        if not name:
            return jsonify({"error": "Location name is required."}), 400
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return jsonify({"error": "Coordinates out of valid latitude/longitude bounds."}), 400

        with db_transaction(_get_cfg().db_path) as conn:
            dup = conn.execute("SELECT location_id FROM locations WHERE LOWER(name) = LOWER(?)", (name,)).fetchone()
            if dup:
                return jsonify({"error": "A location with this name already exists."}), 409
            cur = conn.execute(
                "INSERT INTO locations (name, latitude, longitude, zone) VALUES (?, ?, ?, ?)",
                (name, lat, lng, zone),
            )
            loc_id = cur.lastrowid
            row = conn.execute(
                "SELECT location_id, name, latitude, longitude, zone FROM locations WHERE location_id = ?",
                (loc_id,),
            ).fetchone()
        return jsonify({"location": dict(row)}), 201

    @app.route("/api/locations/<int:location_id>", methods=["PUT"])
    @require_auth(roles=("admin",))
    def update_location(location_id: int) -> Any:
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        zone = str(data.get("zone", "")).strip()
        try:
            lat = float(data.get("latitude"))
            lng = float(data.get("longitude"))
        except (TypeError, ValueError):
            return jsonify({"error": "Valid latitude and longitude numbers are required."}), 400
        if not name:
            return jsonify({"error": "Location name is required."}), 400

        with db_transaction(_get_cfg().db_path) as conn:
            existing = conn.execute(
                "SELECT location_id FROM locations WHERE location_id = ?", (location_id,)
            ).fetchone()
            if not existing:
                return jsonify({"error": "Location not found."}), 404
            conn.execute(
                "UPDATE locations SET name = ?, latitude = ?, longitude = ?, zone = ? WHERE location_id = ?",
                (name, lat, lng, zone, location_id),
            )
            row = conn.execute(
                "SELECT location_id, name, latitude, longitude, zone FROM locations WHERE location_id = ?",
                (location_id,),
            ).fetchone()
        return jsonify({"location": dict(row)})

    @app.route("/api/locations/<int:location_id>", methods=["DELETE"])
    @require_auth(roles=("admin",))
    def delete_location(location_id: int) -> Any:
        with db_transaction(_get_cfg().db_path) as conn:
            existing = conn.execute(
                "SELECT location_id FROM locations WHERE location_id = ?", (location_id,)
            ).fetchone()
            if not existing:
                return jsonify({"error": "Location not found."}), 404
            in_trips = conn.execute(
                "SELECT trip_id FROM trips WHERE source_id = ? OR destination_id = ? LIMIT 1",
                (location_id, location_id),
            ).fetchone()
            if in_trips:
                return (
                    jsonify({"error": "Cannot delete location because existing trips reference it."}),
                    409,
                )
            conn.execute("DELETE FROM locations WHERE location_id = ?", (location_id,))
        return jsonify({"deleted": True})

    # ------------------------------------------------------------------
    # Routes (Road Network)
    # ------------------------------------------------------------------
    @app.route("/api/routes", methods=["GET"])
    def list_routes() -> Any:
        conn = get_connection(_get_cfg().db_path)
        try:
            rows = conn.execute(
                """
                SELECT
                    r.route_id, r.start_location_id, r.end_location_id,
                    s.name AS start_name, e.name AS end_name,
                    r.distance_km, r.time_min, r.cost, r.road_name, r.road_type
                FROM routes r
                JOIN locations s ON s.location_id = r.start_location_id
                JOIN locations e ON e.location_id = r.end_location_id
                ORDER BY r.route_id ASC
                """
            ).fetchall()
            return jsonify({"routes": [dict(r) for r in rows]})
        finally:
            conn.close()

    @app.route("/api/routes", methods=["POST"])
    @require_auth(roles=("admin",))
    def create_route() -> Any:
        data = request.get_json(silent=True) or {}
        try:
            start_id = int(data.get("start_location_id"))
            end_id = int(data.get("end_location_id"))
            distance_km = float(data.get("distance_km"))
            time_min = float(data.get("time_min"))
        except (TypeError, ValueError):
            return jsonify({"error": "Valid start/end locations, distance_km, and time_min are required."}), 400

        raw_cost = data.get("cost")
        cost = None if raw_cost in (None, "") else float(raw_cost)
        if start_id == end_id:
            return jsonify({"error": "Start and end locations must differ."}), 400
        if distance_km < 0 or time_min < 0 or (cost is not None and cost < 0):
            return jsonify({"error": "Distance, time, and cost must be non-negative."}), 400

        road_name = str(data.get("road_name", "")).strip()
        road_type = str(data.get("road_type", "arterial")).strip() or "arterial"
        bidirectional = bool(data.get("bidirectional", True))

        with db_transaction(_get_cfg().db_path) as conn:
            s_row = conn.execute("SELECT location_id FROM locations WHERE location_id = ?", (start_id,)).fetchone()
            e_row = conn.execute("SELECT location_id FROM locations WHERE location_id = ?", (end_id,)).fetchone()
            if not s_row or not e_row:
                return jsonify({"error": "Start or end location does not exist."}), 404

            cur = conn.execute(
                """
                INSERT INTO routes (start_location_id, end_location_id, distance_km, time_min, cost, road_name, road_type)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (start_id, end_id, distance_km, time_min, cost, road_name, road_type),
            )
            route_id = cur.lastrowid
            if bidirectional:
                conn.execute(
                    """
                    INSERT INTO routes (start_location_id, end_location_id, distance_km, time_min, cost, road_name, road_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (end_id, start_id, distance_km, time_min, cost, road_name, road_type),
                )
            row = conn.execute(
                """
                SELECT r.route_id, r.start_location_id, r.end_location_id,
                       s.name AS start_name, e.name AS end_name,
                       r.distance_km, r.time_min, r.cost, r.road_name, r.road_type
                FROM routes r
                JOIN locations s ON s.location_id = r.start_location_id
                JOIN locations e ON e.location_id = r.end_location_id
                WHERE r.route_id = ?
                """,
                (route_id,),
            ).fetchone()
        return jsonify({"route": dict(row)}), 201

    @app.route("/api/routes/<int:route_id>", methods=["PUT"])
    @require_auth(roles=("admin",))
    def update_route(route_id: int) -> Any:
        data = request.get_json(silent=True) or {}
        try:
            distance_km = float(data.get("distance_km"))
            time_min = float(data.get("time_min"))
        except (TypeError, ValueError):
            return jsonify({"error": "Valid distance_km and time_min are required."}), 400

        raw_cost = data.get("cost")
        cost = None if raw_cost in (None, "") else float(raw_cost)
        if distance_km < 0 or time_min < 0 or (cost is not None and cost < 0):
            return jsonify({"error": "Distance, time, and cost must be non-negative."}), 400

        road_name = str(data.get("road_name", "")).strip()
        road_type = str(data.get("road_type", "arterial")).strip() or "arterial"

        with db_transaction(_get_cfg().db_path) as conn:
            existing = conn.execute("SELECT route_id FROM routes WHERE route_id = ?", (route_id,)).fetchone()
            if not existing:
                return jsonify({"error": "Route segment not found."}), 404
            conn.execute(
                """
                UPDATE routes
                SET distance_km = ?, time_min = ?, cost = ?, road_name = ?, road_type = ?
                WHERE route_id = ?
                """,
                (distance_km, time_min, cost, road_name, road_type, route_id),
            )
            row = conn.execute(
                """
                SELECT r.route_id, r.start_location_id, r.end_location_id,
                       s.name AS start_name, e.name AS end_name,
                       r.distance_km, r.time_min, r.cost, r.road_name, r.road_type
                FROM routes r
                JOIN locations s ON s.location_id = r.start_location_id
                JOIN locations e ON e.location_id = r.end_location_id
                WHERE r.route_id = ?
                """,
                (route_id,),
            ).fetchone()
        return jsonify({"route": dict(row)})

    @app.route("/api/routes/<int:route_id>", methods=["DELETE"])
    @require_auth(roles=("admin",))
    def delete_route(route_id: int) -> Any:
        with db_transaction(_get_cfg().db_path) as conn:
            existing = conn.execute("SELECT route_id FROM routes WHERE route_id = ?", (route_id,)).fetchone()
            if not existing:
                return jsonify({"error": "Route segment not found."}), 404
            conn.execute("DELETE FROM routes WHERE route_id = ?", (route_id,))
        return jsonify({"deleted": True})

    # ------------------------------------------------------------------
    # Route Search & Optimization
    # ------------------------------------------------------------------
    @app.route("/api/search", methods=["POST"])
    def search_routes() -> Any:
        data = request.get_json(silent=True) or {}
        raw_source = data.get("source_id")
        raw_dest = data.get("destination_id")
        preference = str(data.get("preference", "shortest")).strip().lower()

        if raw_source in (None, "") or raw_dest in (None, ""):
            return jsonify({"error": "Both source and destination locations are required."}), 400

        try:
            source_id = int(raw_source)
            destination_id = int(raw_dest)
        except (TypeError, ValueError):
            return jsonify({"error": "Source and destination must be valid location IDs."}), 400

        if source_id == destination_id:
            return jsonify({"error": "Source and destination cannot be the same location."}), 400

        if preference not in VALID_PREFERENCES:
            return (
                jsonify({"error": f"Invalid preference '{preference}'. Choose shortest, fastest, or cheapest."}),
                400,
            )

        conn = get_connection(_get_cfg().db_path)
        try:
            loc_rows = conn.execute(
                "SELECT location_id, name, latitude, longitude, zone FROM locations"
            ).fetchall()
            route_rows = conn.execute(
                """
                SELECT route_id, start_location_id, end_location_id,
                       distance_km, time_min, cost, road_name, road_type
                FROM routes
                """
            ).fetchall()
            external_enabled = _get_setting(conn, "external_routing_enabled", "true").lower() == "true"
        finally:
            conn.close()

        locations_by_id = {r["location_id"]: r for r in loc_rows}
        if source_id not in locations_by_id or destination_id not in locations_by_id:
            return jsonify({"error": "Selected source or destination location was not found."}), 404

        src_row = locations_by_id[source_id]
        dst_row = locations_by_id[destination_id]

        adapter_status, _live_payload = fetch_live_traffic_adjustments(
            _get_cfg(),
            (src_row["latitude"], src_row["longitude"]),
            (dst_row["latitude"], dst_row["longitude"]),
            external_enabled=external_enabled,
        )

        nodes = [
            LocationNode(
                location_id=r["location_id"],
                name=r["name"],
                latitude=r["latitude"],
                longitude=r["longitude"],
                zone=r["zone"],
            )
            for r in loc_rows
        ]
        edges = [
            Edge(
                route_id=r["route_id"],
                start_location_id=r["start_location_id"],
                end_location_id=r["end_location_id"],
                distance_km=r["distance_km"],
                time_min=r["time_min"],
                cost=r["cost"],
                road_name=r["road_name"],
                road_type=r["road_type"],
            )
            for r in route_rows
        ]

        result = optimize_routes(
            locations=nodes,
            edges=edges,
            source_id=source_id,
            destination_id=destination_id,
            preference=preference,
            data_source=adapter_status.data_source,
        )

        result["traffic_api"] = {
            "live_available": adapter_status.live_available,
            "fallback_used": adapter_status.fallback_used,
            "data_source": adapter_status.data_source,
            "message": adapter_status.message,
        }

        # Create in-app notification for logged-in user when search succeeds
        current_user = _extract_user()
        if current_user and result["found"] and result["routes"]:
            top = result["routes"][0]
            now = utc_now_iso()
            try:
                with db_transaction(_get_cfg().db_path) as conn:
                    conn.execute(
                        """
                        INSERT INTO notifications (user_id, title, message, category, is_read, created_at)
                        VALUES (?, ?, ?, 'route', 0, ?)
                        """,
                        (
                            current_user["user_id"],
                            f"Route found: {src_row['name']} to {dst_row['name']}",
                            f"Best {preference} route: {top['total_distance_km']} km, {top['total_time_min']} min ({adapter_status.data_source} data).",
                            now,
                        ),
                    )
            except Exception:
                pass

        return jsonify(result)

    # ------------------------------------------------------------------
    # Trip Management & History
    # ------------------------------------------------------------------
    @app.route("/api/trips", methods=["POST"])
    @require_auth()
    def save_trip() -> Any:
        data = request.get_json(silent=True) or {}
        try:
            source_id = int(data.get("source_id"))
            destination_id = int(data.get("destination_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "Valid source_id and destination_id are required."}), 400

        preference = str(data.get("preference", "shortest")).strip().lower()
        routes_payload = data.get("routes")
        selected_rank = int(data.get("selected_rank", 1))

        if preference not in VALID_PREFERENCES:
            return jsonify({"error": "Invalid preference."}), 400
        if not isinstance(routes_payload, list) or len(routes_payload) == 0:
            return jsonify({"error": "At least one route result is required to save a trip."}), 400

        now = utc_now_iso()
        user_id = g.current_user["user_id"]

        with db_transaction(_get_cfg().db_path) as conn:
            src_row = conn.execute("SELECT name FROM locations WHERE location_id = ?", (source_id,)).fetchone()
            dst_row = conn.execute("SELECT name FROM locations WHERE location_id = ?", (destination_id,)).fetchone()
            if not src_row or not dst_row:
                return jsonify({"error": "Source or destination location not found."}), 404

            cur = conn.execute(
                """
                INSERT INTO trips (passenger_id, source_id, destination_id, preference, status, created_at)
                VALUES (?, ?, ?, ?, 'saved', ?)
                """,
                (user_id, source_id, destination_id, preference, now),
            )
            trip_id = int(cur.lastrowid)

            for r in routes_payload:
                rank_no = int(r.get("rank_number", 1))
                primary_route_id = r.get("primary_route_id")
                if primary_route_id is not None:
                    exists = conn.execute(
                        "SELECT route_id FROM routes WHERE route_id = ?", (int(primary_route_id),)
                    ).fetchone()
                    if not exists:
                        primary_route_id = None

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
                        primary_route_id,
                        rank_no,
                        r.get("score"),
                        json.dumps(r.get("path", [])),
                        float(r.get("total_distance_km", 0.0)),
                        float(r.get("total_time_min", 0.0)),
                        r.get("total_cost"),
                        str(r.get("data_source", "sample")),
                        1 if rank_no == selected_rank else 0,
                    ),
                )

            conn.execute(
                """
                INSERT INTO trip_status_logs (trip_id, status, updated_at, remarks)
                VALUES (?, 'saved', ?, ?)
                """,
                (trip_id, now, f"Trip saved with {preference} preference (option #{selected_rank} selected)."),
            )
            conn.execute(
                """
                INSERT INTO notifications (user_id, title, message, category, is_read, created_at)
                VALUES (?, ?, ?, 'trip', 0, ?)
                """,
                (
                    user_id,
                    "Trip saved",
                    f"Saved trip #{trip_id}: {src_row['name']} to {dst_row['name']} ({preference}).",
                    now,
                ),
            )

        return jsonify({"trip_id": trip_id, "status": "saved"}), 201

    def _hydrate_trips(conn: Any, trip_rows: list[Any]) -> list[dict[str, Any]]:
        trips: list[dict[str, Any]] = []
        for row in trip_rows:
            t = dict(row)
            res_rows = conn.execute(
                """
                SELECT result_id, route_id, rank_number, score, path_json,
                       total_distance_km, total_time_min, total_cost, data_source, is_selected
                FROM route_results
                WHERE trip_id = ?
                ORDER BY rank_number ASC
                """,
                (t["trip_id"],),
            ).fetchall()
            results = []
            for rr in res_rows:
                item = dict(rr)
                try:
                    item["path"] = json.loads(item.pop("path_json"))
                except Exception:
                    item["path"] = []
                results.append(item)
            t["results"] = results

            log_rows = conn.execute(
                """
                SELECT log_id, status, updated_at, remarks
                FROM trip_status_logs
                WHERE trip_id = ?
                ORDER BY log_id DESC
                """,
                (t["trip_id"],),
            ).fetchall()
            t["status_logs"] = [dict(lr) for lr in log_rows]
            trips.append(t)
        return trips

    @app.route("/api/trips", methods=["GET"])
    @require_auth()
    def list_trips() -> Any:
        user = g.current_user
        conn = get_connection(_get_cfg().db_path)
        try:
            base_query = """
                SELECT
                    t.trip_id, t.passenger_id, u.name AS passenger_name,
                    t.source_id, s.name AS source_name,
                    t.destination_id, d.name AS destination_name,
                    t.preference, t.status, t.assigned_driver_id, t.created_at,
                    du.name AS driver_name, dr.vehicle_number AS driver_vehicle
                FROM trips t
                JOIN users u ON u.user_id = t.passenger_id
                JOIN locations s ON s.location_id = t.source_id
                JOIN locations d ON d.location_id = t.destination_id
                LEFT JOIN drivers dr ON dr.driver_id = t.assigned_driver_id
                LEFT JOIN users du ON du.user_id = dr.user_id
            """
            if user["role"] == "admin":
                rows = conn.execute(base_query + " ORDER BY t.trip_id DESC").fetchall()
            else:
                rows = conn.execute(
                    base_query + " WHERE t.passenger_id = ? ORDER BY t.trip_id DESC",
                    (user["user_id"],),
                ).fetchall()
            return jsonify({"trips": _hydrate_trips(conn, rows)})
        finally:
            conn.close()

    @app.route("/api/trips/<int:trip_id>/status", methods=["PATCH"])
    @require_auth()
    def update_trip_status(trip_id: int) -> Any:
        data = request.get_json(silent=True) or {}
        new_status = str(data.get("status", "")).strip().lower()
        remarks = str(data.get("remarks", "")).strip()
        allowed_statuses = {"saved", "assigned", "in_progress", "completed", "cancelled"}
        if new_status not in allowed_statuses:
            return jsonify({"error": f"Invalid status. Allowed: {sorted(allowed_statuses)}"}), 400

        user = g.current_user
        now = utc_now_iso()

        with db_transaction(_get_cfg().db_path) as conn:
            trip = conn.execute("SELECT * FROM trips WHERE trip_id = ?", (trip_id,)).fetchone()
            if not trip:
                return jsonify({"error": "Trip not found."}), 404

            # Authorization checks
            if user["role"] == "passenger":
                if trip["passenger_id"] != user["user_id"]:
                    return jsonify({"error": "Access denied."}), 403
                if new_status != "cancelled":
                    return jsonify({"error": "Passengers can only cancel their own trips."}), 403
            elif user["role"] == "driver":
                if not _driver_feature_enabled(conn):
                    return jsonify({"error": "Driver feature is currently disabled."}), 403
                driver = conn.execute(
                    "SELECT driver_id FROM drivers WHERE user_id = ?", (user["user_id"],)
                ).fetchone()
                if not driver or trip["assigned_driver_id"] != driver["driver_id"]:
                    return jsonify({"error": "Access denied: trip is not assigned to you."}), 403

            conn.execute("UPDATE trips SET status = ? WHERE trip_id = ?", (new_status, trip_id))
            conn.execute(
                """
                INSERT INTO trip_status_logs (trip_id, status, updated_at, remarks)
                VALUES (?, ?, ?, ?)
                """,
                (trip_id, new_status, now, remarks or f"Status updated to {new_status} by {user['name']}."),
            )
            conn.execute(
                """
                INSERT INTO notifications (user_id, title, message, category, is_read, created_at)
                VALUES (?, ?, ?, 'status', 0, ?)
                """,
                (
                    trip["passenger_id"],
                    f"Trip #{trip_id} status updated",
                    f"Your trip status is now '{new_status.replace('_', ' ')}'.",
                    now,
                ),
            )
        return jsonify({"trip_id": trip_id, "status": new_status})

    # ------------------------------------------------------------------
    # Driver View (Optional, Feature-Flagged)
    # ------------------------------------------------------------------
    @app.route("/api/driver/trips", methods=["GET"])
    @require_auth(roles=("driver", "admin"))
    def driver_trips() -> Any:
        user = g.current_user
        conn = get_connection(_get_cfg().db_path)
        try:
            if not _driver_feature_enabled(conn):
                return jsonify({"error": "Driver module is disabled via feature flag."}), 403

            base_query = """
                SELECT
                    t.trip_id, t.passenger_id, u.name AS passenger_name,
                    t.source_id, s.name AS source_name,
                    t.destination_id, d.name AS destination_name,
                    t.preference, t.status, t.assigned_driver_id, t.created_at,
                    du.name AS driver_name, dr.vehicle_number AS driver_vehicle
                FROM trips t
                JOIN users u ON u.user_id = t.passenger_id
                JOIN locations s ON s.location_id = t.source_id
                JOIN locations d ON d.location_id = t.destination_id
                LEFT JOIN drivers dr ON dr.driver_id = t.assigned_driver_id
                LEFT JOIN users du ON du.user_id = dr.user_id
            """
            if user["role"] == "admin":
                rows = conn.execute(
                    base_query + " WHERE t.assigned_driver_id IS NOT NULL ORDER BY t.trip_id DESC"
                ).fetchall()
            else:
                driver = conn.execute(
                    "SELECT driver_id, vehicle_number, availability FROM drivers WHERE user_id = ?",
                    (user["user_id"],),
                ).fetchone()
                if not driver:
                    return jsonify({"driver": None, "trips": []})
                rows = conn.execute(
                    base_query + " WHERE t.assigned_driver_id = ? ORDER BY t.trip_id DESC",
                    (driver["driver_id"],),
                ).fetchall()
            return jsonify({"trips": _hydrate_trips(conn, rows)})
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    @app.route("/api/notifications", methods=["GET"])
    @require_auth()
    def list_notifications() -> Any:
        user = g.current_user
        conn = get_connection(_get_cfg().db_path)
        try:
            rows = conn.execute(
                """
                SELECT notification_id, title, message, category, is_read, created_at
                FROM notifications
                WHERE user_id = ?
                ORDER BY notification_id DESC
                LIMIT 50
                """,
                (user["user_id"],),
            ).fetchall()
            unread = sum(1 for r in rows if not r["is_read"])
            return jsonify({"notifications": [dict(r) for r in rows], "unread_count": unread})
        finally:
            conn.close()

    @app.route("/api/notifications/<int:notification_id>/read", methods=["PATCH"])
    @require_auth()
    def mark_notification_read(notification_id: int) -> Any:
        user = g.current_user
        with db_transaction(_get_cfg().db_path) as conn:
            conn.execute(
                "UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?",
                (notification_id, user["user_id"]),
            )
        return jsonify({"updated": True})

    @app.route("/api/notifications/read-all", methods=["POST"])
    @require_auth()
    def mark_all_notifications_read() -> Any:
        user = g.current_user
        with db_transaction(_get_cfg().db_path) as conn:
            conn.execute(
                "UPDATE notifications SET is_read = 1 WHERE user_id = ?",
                (user["user_id"],),
            )
        return jsonify({"updated": True})

    # ------------------------------------------------------------------
    # Admin Dashboard (Strictly role == 'admin')
    # ------------------------------------------------------------------
    @app.route("/api/admin/users", methods=["GET"])
    @require_auth(roles=("admin",))
    def admin_users() -> Any:
        conn = get_connection(_get_cfg().db_path)
        try:
            rows = conn.execute(
                """
                SELECT u.user_id, u.name, u.email, u.role, u.created_at,
                       d.driver_id, d.vehicle_number, d.availability
                FROM users u
                LEFT JOIN drivers d ON d.user_id = u.user_id
                ORDER BY u.user_id ASC
                """
            ).fetchall()
            return jsonify({"users": [dict(r) for r in rows]})
        finally:
            conn.close()

    @app.route("/api/admin/users/<int:target_user_id>/role", methods=["PATCH"])
    @require_auth(roles=("admin",))
    def admin_update_user_role(target_user_id: int) -> Any:
        data = request.get_json(silent=True) or {}
        new_role = str(data.get("role", "")).strip().lower()
        if new_role not in ("passenger", "driver", "admin"):
            return jsonify({"error": "Invalid role."}), 400
        with db_transaction(_get_cfg().db_path) as conn:
            row = conn.execute("SELECT user_id FROM users WHERE user_id = ?", (target_user_id,)).fetchone()
            if not row:
                return jsonify({"error": "User not found."}), 404
            conn.execute("UPDATE users SET role = ? WHERE user_id = ?", (new_role, target_user_id))
            if new_role == "driver":
                existing_d = conn.execute(
                    "SELECT driver_id FROM drivers WHERE user_id = ?", (target_user_id,)
                ).fetchone()
                if not existing_d:
                    conn.execute(
                        "INSERT INTO drivers (user_id, vehicle_number, availability) VALUES (?, ?, 'available')",
                        (target_user_id, f"VEH-{target_user_id:04d}"),
                    )
        return jsonify({"user_id": target_user_id, "role": new_role})

    @app.route("/api/admin/drivers", methods=["GET"])
    @require_auth(roles=("admin",))
    def admin_drivers() -> Any:
        conn = get_connection(_get_cfg().db_path)
        try:
            rows = conn.execute(
                """
                SELECT d.driver_id, d.user_id, u.name, u.email, d.vehicle_number, d.availability
                FROM drivers d
                JOIN users u ON u.user_id = d.user_id
                ORDER BY d.driver_id ASC
                """
            ).fetchall()
            return jsonify({"drivers": [dict(r) for r in rows]})
        finally:
            conn.close()

    @app.route("/api/admin/trips/<int:trip_id>/assign", methods=["PATCH"])
    @require_auth(roles=("admin",))
    def admin_assign_driver(trip_id: int) -> Any:
        data = request.get_json(silent=True) or {}
        try:
            driver_id = int(data.get("driver_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "Valid driver_id is required."}), 400
        now = utc_now_iso()
        with db_transaction(_get_cfg().db_path) as conn:
            trip = conn.execute("SELECT * FROM trips WHERE trip_id = ?", (trip_id,)).fetchone()
            driver = conn.execute(
                "SELECT d.driver_id, d.user_id, u.name FROM drivers d JOIN users u ON u.user_id = d.user_id WHERE d.driver_id = ?",
                (driver_id,),
            ).fetchone()
            if not trip or not driver:
                return jsonify({"error": "Trip or driver not found."}), 404
            conn.execute(
                "UPDATE trips SET assigned_driver_id = ?, status = 'assigned' WHERE trip_id = ?",
                (driver_id, trip_id),
            )
            conn.execute(
                "INSERT INTO trip_status_logs (trip_id, status, updated_at, remarks) VALUES (?, 'assigned', ?, ?)",
                (trip_id, now, f"Assigned to driver {driver['name']}."),
            )
            conn.execute(
                "INSERT INTO notifications (user_id, title, message, category, is_read, created_at) VALUES (?, ?, ?, 'trip', 0, ?)",
                (
                    driver["user_id"],
                    f"New trip assigned (#{trip_id})",
                    f"You have been assigned trip #{trip_id}. Check Driver view for route details.",
                    now,
                ),
            )
        return jsonify({"trip_id": trip_id, "assigned_driver_id": driver_id, "status": "assigned"})

    @app.route("/api/admin/reports", methods=["GET"])
    @require_auth(roles=("admin",))
    def admin_reports() -> Any:
        conn = get_connection(_get_cfg().db_path)
        try:
            totals = {
                "users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                "locations": conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0],
                "routes": conn.execute("SELECT COUNT(*) FROM routes").fetchone()[0],
                "trips": conn.execute("SELECT COUNT(*) FROM trips").fetchone()[0],
            }
            by_preference = [
                dict(r)
                for r in conn.execute(
                    "SELECT preference, COUNT(*) AS count FROM trips GROUP BY preference ORDER BY count DESC"
                ).fetchall()
            ]
            by_status = [
                dict(r)
                for r in conn.execute(
                    "SELECT status, COUNT(*) AS count FROM trips GROUP BY status ORDER BY count DESC"
                ).fetchall()
            ]
            popular_corridors = [
                dict(r)
                for r in conn.execute(
                    """
                    SELECT s.name AS source_name, d.name AS destination_name, COUNT(*) AS trip_count
                    FROM trips t
                    JOIN locations s ON s.location_id = t.source_id
                    JOIN locations d ON d.location_id = t.destination_id
                    GROUP BY t.source_id, t.destination_id
                    ORDER BY trip_count DESC
                    LIMIT 6
                    """
                ).fetchall()
            ]
            return jsonify(
                {
                    "totals": totals,
                    "trips_by_preference": by_preference,
                    "trips_by_status": by_status,
                    "popular_corridors": popular_corridors,
                }
            )
        finally:
            conn.close()

    @app.route("/api/admin/settings", methods=["GET", "PUT"])
    @require_auth(roles=("admin",))
    def admin_settings() -> Any:
        if request.method == "GET":
            conn = get_connection(_get_cfg().db_path)
            try:
                rows = conn.execute("SELECT setting_key, setting_value, updated_at FROM system_settings").fetchall()
                settings = {r["setting_key"]: r["setting_value"] for r in rows}
                settings["routing_api_configured"] = bool(
                    _get_cfg().routing_api_url and _get_cfg().routing_api_key
                )
                return jsonify({"settings": settings})
            finally:
                conn.close()

        data = request.get_json(silent=True) or {}
        now = utc_now_iso()
        allowed_keys = {
            "enable_driver_role",
            "external_routing_enabled",
            "default_preference",
            "system_notice",
        }
        with db_transaction(_get_cfg().db_path) as conn:
            for key, value in data.items():
                if key not in allowed_keys:
                    continue
                if key == "default_preference" and str(value) not in VALID_PREFERENCES:
                    return jsonify({"error": "Invalid default_preference."}), 400
                str_val = str(value).lower() if key in ("enable_driver_role", "external_routing_enabled") else str(value)
                conn.execute(
                    """
                    INSERT INTO system_settings (setting_key, setting_value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
                    """,
                    (key, str_val, now),
                )
        return jsonify({"updated": True})

    return app


if __name__ == "__main__":
    config = load_config()
    flask_app = create_app(config)
    flask_app.run(host="127.0.0.1", port=config.port, debug=False)
