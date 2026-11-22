"""
SQLite database layer with portable ANSI-friendly schema and transaction support.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator


SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('passenger', 'driver', 'admin')) DEFAULT 'passenger',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
    location_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    zone TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS routes (
    route_id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_location_id INTEGER NOT NULL,
    end_location_id INTEGER NOT NULL,
    distance_km REAL NOT NULL CHECK (distance_km >= 0),
    time_min REAL NOT NULL CHECK (time_min >= 0),
    cost REAL CHECK (cost IS NULL OR cost >= 0),
    road_name TEXT NOT NULL DEFAULT '',
    road_type TEXT NOT NULL DEFAULT 'arterial',
    FOREIGN KEY (start_location_id) REFERENCES locations(location_id) ON DELETE CASCADE,
    FOREIGN KEY (end_location_id) REFERENCES locations(location_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drivers (
    driver_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    vehicle_number TEXT NOT NULL,
    availability TEXT NOT NULL CHECK (availability IN ('available', 'on_trip', 'offline')) DEFAULT 'available',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trips (
    trip_id INTEGER PRIMARY KEY AUTOINCREMENT,
    passenger_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    destination_id INTEGER NOT NULL,
    preference TEXT NOT NULL CHECK (preference IN ('shortest', 'fastest', 'cheapest')),
    status TEXT NOT NULL CHECK (status IN ('saved', 'assigned', 'in_progress', 'completed', 'cancelled')) DEFAULT 'saved',
    assigned_driver_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (passenger_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES locations(location_id),
    FOREIGN KEY (destination_id) REFERENCES locations(location_id),
    FOREIGN KEY (assigned_driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS route_results (
    result_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    route_id INTEGER,
    rank_number INTEGER NOT NULL,
    score REAL,
    path_json TEXT NOT NULL,
    total_distance_km REAL NOT NULL,
    total_time_min REAL NOT NULL,
    total_cost REAL,
    data_source TEXT NOT NULL DEFAULT 'sample',
    is_selected INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(route_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS trip_status_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    remarks TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'info',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_connection(db_path: str) -> sqlite3.Connection:
    parent = os.path.dirname(os.path.abspath(db_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(db_path: str) -> None:
    conn = get_connection(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()


@contextmanager
def db_transaction(db_path: str) -> Iterator[sqlite3.Connection]:
    """Context manager guaranteeing atomic commit or rollback on failure."""
    conn = get_connection(db_path)
    try:
        conn.execute("BEGIN;")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
