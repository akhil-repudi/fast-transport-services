# Transport Route Optimization System

A Software Engineering Project-Based Learning (PBL) prototype that computes, compares, and ranks route options between a source and destination by **Shortest** distance (`km`), **Fastest** travel duration (`min`), or **Lowest cost** (`$`) using **Dijkstra's algorithm** over a seeded sample road network.

> **Prototype Honesty Notice:** All route metrics (`distance_km`, `time_min`, `cost`) are **seeded sample data**, not live traffic. When no external map/traffic API is configured or reachable, the system explicitly falls back to sample data and displays a `"Sample data · Not live traffic"` notice.

---

## Folder Structure

```text
├── .env.example              # Environment variable template (never commit real secrets)
├── index.html                # HTML entry point & typography
├── metadata.json             # App metadata
├── package.json              # Frontend + port 3000 Node/Vite wrapper scripts
├── requirements.txt          # Python backend dependencies (Flask, Werkzeug, PyJWT, pytest)
├── server.ts                 # Port 3000 Express dev/prod server spawning Python API & proxying /api/*
├── backend/
│   ├── __init__.py
│   ├── app.py                # Flask REST API (auth, locations, routes, search, trips, notifications, driver, admin)
│   ├── auth.py               # PBKDF2-SHA256 password hashing, HS256 JWT tokens, RBAC helpers
│   ├── config.py             # Environment configuration & feature flags
│   ├── db.py                 # Portable SQLite schema & atomic DB transaction context manager
│   ├── dijkstra.py           # Standalone unit-testable Dijkstra & edge-penalized alternative route engine
│   ├── routing_service.py    # Optional external map/traffic API adapter with explicit sample-data fallback
│   ├── seed.py               # Idempotent seed script (14 locations, 48 directional edges, demo accounts)
│   └── wsgi_compat.py        # Zero-dependency stdlib WSGI fallback when Flask is not installed
├── tests/
│   ├── __init__.py
│   ├── test_dijkstra.py      # Unit tests for Dijkstra algorithm, ranking, negative weights, cost-unavailable
│   └── test_api.py           # API integration tests (TC03, TC05, TC06, TC08, TC09, TC11, auth, trips)
└── src/
    ├── main.tsx
    ├── index.css
    ├── App.tsx               # Top bar, screen router, session restore, toast alerts
    ├── types.ts              # Shared TypeScript interfaces
    ├── api/
    │   └── client.ts         # Typed REST client
    └── components/
        ├── AuthView.tsx      # Landing / Login / Register with demo quick-fill
        ├── RoutePlanner.tsx  # Source/Destination autocomplete, preference selector, ranked cards & table
        ├── RouteMap.tsx      # Leaflet + OpenStreetMap interactive map & polylines
        ├── TripHistory.tsx   # Saved trips, route options, and status timeline
        ├── NotificationsView.tsx
        ├── DriverView.tsx    # Feature-flagged Driver assigned trips & status updates
        └── AdminDashboard.tsx # Admin reports, Locations/Routes CRUD, user roles, feature flags
```

---

## Architecture Overview

1. **Frontend (React + Vite + Tailwind + Leaflet):**
   - Renders an interactive OpenStreetMap canvas via `leaflet` (no API key required).
   - Provides location autocomplete, preference switching (`shortest`, `fastest`, `cheapest`), ranked route cards, side-by-side comparison table, trip history, notifications, optional Driver dispatch view, and Admin management console.
2. **Backend (Python Flask REST API + SQLite):**
   - `backend/dijkstra.py` models stored `locations` as graph nodes and `routes` as non-negative weighted directed edges. For every search, it runs Dijkstra once per criterion (`distance_km`, `time_min`, `cost`) plus edge-penalized passes to discover distinct alternatives, computes totals (`total_cost = None` if any segment lacks cost), and ranks strictly by user preference.
   - `backend/routing_service.py` checks `ROUTING_API_URL` / `ROUTING_API_KEY` from server environment variables; if absent or unreachable, it safely falls back to `data_source = "sample"` with an explicit fallback message.
   - `backend/db.py` uses ANSI-portable SQL (`users`, `locations`, `routes`, `drivers`, `trips`, `route_results`, `trip_status_logs`, `notifications`, `system_settings`) with explicit transaction rollbacks when saving trips.
3. **Authentication & RBAC:**
   - Passwords are salted and hashed with PBKDF2-SHA256 (`werkzeug.security` / `hashlib.pbkdf2_hmac`).
   - Stateless HS256 JWT tokens are issued in both JSON responses and `HttpOnly` cookies.
   - Admin endpoints strictly verify `role == 'admin'` and return `403 Forbidden` otherwise.

---

## Demo Credentials

The database is automatically seeded on startup (`backend/seed.py`):

| Role | Email | Password | Capabilities |
| :--- | :--- | :--- | :--- |
| **Passenger** | `passenger@demo.local` | `pass1234` | Search & compare routes, save trips, view trip history & notifications |
| **Driver** | `driver@demo.local` | `driver1234` | View assigned trips and update status (`in_progress` / `completed`) |
| **Administrator** | `admin@demo.local` | `admin1234` | Manage users, locations, road segments, driver assignments, settings, reports |

---

## Environment Variables

Copy `.env.example` to `.env` if customizing settings:

- `DATABASE_PATH`: Path to SQLite file (default: `./data/transport.db`)
- `BACKEND_PORT`: Internal Python API port (default: `5001`)
- `JWT_SECRET`: Secret key used to sign HS256 JWT tokens
- `JWT_EXPIRY_HOURS`: Token lifetime in hours (default: `24`)
- `ENABLE_DRIVER_ROLE`: Feature flag (`true` / `false`) enabling Driver registration & view
- `ROUTING_API_URL` / `ROUTING_API_KEY`: Optional server-side external routing/traffic API credentials (never exposed to browser)

---

## Setup & Run Instructions

### 1. Run the Full Application (Port 3000)

```bash
npm install
npm run dev
```

This starts the Express/Vite server on `http://localhost:3000`, launches the Python backend on port `5001`, seeds SQLite automatically, and proxies `/api/*` requests.

### 2. Optional: Run Python Backend Standalone in a Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 backend/seed.py
python3 backend/app.py
```

### 3. Run Unit & API Tests

```bash
python3 -m unittest discover -s tests -v
```

Covered test cases include:
- **TC03:** Blank source or destination returns HTTP `400` validation error without running search.
- **TC05:** Preference `shortest` ranks the minimum-distance route first.
- **TC06:** Preference `fastest` ranks the minimum-duration route first.
- **TC08:** Disconnected locations (`Hilltop Relay Station`) return a clear `"No route found"` response.
- **TC09:** Unconfigured or unreachable external traffic API falls back to `data_source: "sample"` with an explicit non-live-traffic message.
- **TC11:** Non-admin access to `/api/admin/*` and mutation endpoints returns HTTP `403 Forbidden` (and displays an Access Denied screen in the UI).

---

## Assumptions & Limitations

1. **Sample Data Only:** Distances, durations, and costs are static seeded figures in SQLite, not live GPS or real-time congestion feeds.
2. **Out of Scope:** Turn-by-turn voice navigation, live vehicle GPS tracking, public-transport schedules, and dynamic fare billing are intentionally excluded.
3. **Graph Topology:** Road links are stored as directed edges (seeded symmetrically for two-way streets). Straight polylines between hub coordinates are drawn on the OpenStreetMap layer rather than road-snapped geometries.
4. **Database Portability:** Standard SQL types and foreign keys are used so schemas can be migrated to PostgreSQL or MySQL with minimal adjustments (`AUTOINCREMENT` → `SERIAL`/`AUTO_INCREMENT`).
