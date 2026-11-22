import { useEffect, useState, type FormEvent } from 'react';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type {
  AdminDriver,
  AdminReports,
  LocationItem,
  OptimizationPreference,
  RoadSegment,
  TripRecord,
  User,
  UserRole,
} from '../types';

interface AdminDashboardProps {
  user: User | null;
  onSettingsChanged: () => void;
  onRequireAuth: () => void;
  onNotify: (title: string, message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

type AdminTab = 'reports' | 'locations' | 'routes' | 'users' | 'settings';

export function AdminDashboard({
  user,
  onSettingsChanged,
  onRequireAuth,
  onNotify,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('reports');
  const [loading, setLoading] = useState(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('');

  const [reports, setReports] = useState<AdminReports | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [routes, setRoutes] = useState<RoadSegment[]>([]);
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});

  // Location form
  const [locName, setLocName] = useState('');
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locZone, setLocZone] = useState('');

  // Route form
  const [startLocId, setStartLocId] = useState<number | ''>('');
  const [endLocId, setEndLocId] = useState<number | ''>('');
  const [distKm, setDistKm] = useState('');
  const [timeMin, setTimeMin] = useState('');
  const [costVal, setCostVal] = useState('');
  const [roadName, setRoadName] = useState('');
  const [roadType, setRoadType] = useState('arterial');
  const [bidirectional, setBidirectional] = useState(true);

  async function loadAdminData() {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setAccessDeniedMessage('');
    try {
      const [repRes, usersRes, drvRes, tripsRes, locRes, rteRes, setRes] = await Promise.all([
        api.getAdminReports(),
        api.getAdminUsers(),
        api.getAdminDrivers(),
        api.getTrips(),
        api.getLocations(),
        api.getRoutes(),
        api.getAdminSettings(),
      ]);
      setReports(repRes);
      setUsers(usersRes.users);
      setDrivers(drvRes.drivers);
      setTrips(tripsRes.trips);
      setLocations(locRes.locations);
      setRoutes(rteRes.routes);
      setSettings(setRes.settings);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
        setAccessDeniedMessage(
          `Access Denied (${err.status}): ${err.message} Administrator role is required to view this console.`
        );
      } else {
        const msg = err instanceof ApiError ? err.message : 'Failed to load admin console.';
        onNotify('Admin Error', msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminData();
  }, [user]);

  // TC11: Clear UI Access Denied message for non-admins or unauthenticated users
  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-4">
        <ShieldAlert className="w-8 h-8 text-red-600 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">Administrator Authentication Required</h1>
        <p className="text-sm text-slate-600">
          Please sign in with an administrator account to manage locations, routes, users, and reports.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="px-4 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 cursor-pointer"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (accessDeniedMessage) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14">
        <div role="alert" className="bg-white border border-red-300 rounded-xl p-6 space-y-2">
          <div className="flex items-center gap-2 text-red-800 font-semibold text-base">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            <span>Access Denied (403 Forbidden)</span>
          </div>
          <p className="text-sm text-slate-700">{accessDeniedMessage}</p>
          <p className="text-xs text-slate-500">
            Signed in as <span className="font-medium">{user.email}</span> (role:{' '}
            <span className="font-mono">{user.role}</span>).
          </p>
        </div>
      </div>
    );
  }

  async function handleAddLocation(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createLocation({
        name: locName,
        latitude: Number(locLat),
        longitude: Number(locLng),
        zone: locZone,
      });
      setLocName('');
      setLocLat('');
      setLocLng('');
      setLocZone('');
      onNotify('Location added', 'New hub added to the network.', 'success');
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to create location.', 'error');
    }
  }

  async function handleDeleteLocation(id: number) {
    try {
      await api.deleteLocation(id);
      onNotify('Location removed', `Location #${id} deleted.`, 'info');
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to delete location.', 'error');
    }
  }

  async function handleAddRoute(e: FormEvent) {
    e.preventDefault();
    if (startLocId === '' || endLocId === '') {
      onNotify('Validation', 'Select both start and end locations.', 'warning');
      return;
    }
    try {
      await api.createRoute({
        start_location_id: Number(startLocId),
        end_location_id: Number(endLocId),
        distance_km: Number(distKm),
        time_min: Number(timeMin),
        cost: costVal.trim() === '' ? null : Number(costVal),
        road_name: roadName,
        road_type: roadType,
        bidirectional,
      });
      setDistKm('');
      setTimeMin('');
      setCostVal('');
      setRoadName('');
      onNotify('Road segment added', 'Route record saved to database.', 'success');
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to create route.', 'error');
    }
  }

  async function handleDeleteRoute(id: number) {
    try {
      await api.deleteRoute(id);
      onNotify('Segment deleted', `Route #${id} removed.`, 'info');
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to delete route.', 'error');
    }
  }

  async function handleRoleChange(targetUserId: number, role: UserRole) {
    try {
      await api.updateAdminUserRole(targetUserId, role);
      onNotify('Role updated', `User #${targetUserId} role changed to ${role}.`, 'success');
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to update role.', 'error');
    }
  }

  async function handleAssignDriver(tripId: number, driverId: number) {
    if (!driverId) return;
    try {
      await api.assignTripDriver(tripId, driverId);
      onNotify('Driver assigned', `Trip #${tripId} assigned to driver #${driverId}.`, 'success');
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to assign driver.', 'error');
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    try {
      await api.updateAdminSettings({
        enable_driver_role: String(settings.enable_driver_role ?? 'true'),
        external_routing_enabled: String(settings.external_routing_enabled ?? 'true'),
        default_preference: String(settings.default_preference ?? 'shortest'),
        system_notice: String(settings.system_notice ?? ''),
      });
      onNotify('Settings saved', 'System configuration updated.', 'success');
      onSettingsChanged();
      await loadAdminData();
    } catch (err) {
      onNotify('Error', err instanceof ApiError ? err.message : 'Failed to update settings.', 'error');
    }
  }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Dashboard</h1>
          <p className="text-sm text-slate-600">
            Manage road network data, user roles, system settings, and trip reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
          {(
            [
              ['reports', 'Reports & Trips'],
              ['locations', 'Locations'],
              ['routes', 'Road Network'],
              ['users', 'Users'],
              ['settings', 'Settings'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                tab === key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Summary Strip */}
      {reports && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ['Registered Users', reports.totals.users],
            ['Network Locations', reports.totals.locations],
            ['Directional Road Links', reports.totals.routes],
            ['Total Saved Trips', reports.totals.trips],
          ].map(([label, val]) => (
            <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-2xl font-mono font-bold text-slate-900 mt-1">{val}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 animate-pulse h-48" />
      ) : (
        <>
          {tab === 'reports' && reports && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="text-sm font-semibold text-slate-900">Trips by Preference</div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {reports.trips_by_preference.length === 0 ? (
                      <div className="py-2 text-slate-500">No trip data yet.</div>
                    ) : (
                      reports.trips_by_preference.map((row) => (
                        <div key={row.preference} className="py-2 flex justify-between">
                          <span className="capitalize text-slate-700">{row.preference}</span>
                          <span className="font-mono font-semibold text-slate-900">{row.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="text-sm font-semibold text-slate-900">Trips by Status</div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {reports.trips_by_status.length === 0 ? (
                      <div className="py-2 text-slate-500">No trip data yet.</div>
                    ) : (
                      reports.trips_by_status.map((row) => (
                        <div key={row.status} className="py-2 flex justify-between">
                          <span className="capitalize text-slate-700">
                            {row.status.replace('_', ' ')}
                          </span>
                          <span className="font-mono font-semibold text-slate-900">{row.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="text-sm font-semibold text-slate-900">Popular Corridors</div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {reports.popular_corridors.length === 0 ? (
                      <div className="py-2 text-slate-500">No trips saved yet.</div>
                    ) : (
                      reports.popular_corridors.map((row, idx) => (
                        <div key={idx} className="py-2 flex justify-between gap-2">
                          <span className="text-slate-700 truncate">
                            {row.source_name} → {row.destination_name}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 shrink-0">
                            {row.trip_count}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* All Trips + Driver Assignment */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-900">
                  All Trips &amp; Driver Dispatch Assignment
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4 text-left font-medium">Trip</th>
                        <th className="py-2.5 px-4 text-left font-medium">Passenger</th>
                        <th className="py-2.5 px-4 text-left font-medium">Corridor</th>
                        <th className="py-2.5 px-4 text-left font-medium">Preference</th>
                        <th className="py-2.5 px-4 text-left font-medium">Status</th>
                        <th className="py-2.5 px-4 text-left font-medium">Assign Driver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {trips.map((t) => (
                        <tr key={t.trip_id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono font-semibold">#{t.trip_id}</td>
                          <td className="py-2.5 px-4">{t.passenger_name}</td>
                          <td className="py-2.5 px-4">
                            {t.source_name} → {t.destination_name}
                          </td>
                          <td className="py-2.5 px-4 capitalize">{t.preference}</td>
                          <td className="py-2.5 px-4 capitalize">{t.status.replace('_', ' ')}</td>
                          <td className="py-2.5 px-4">
                            <select
                              aria-label={`Assign driver for trip ${t.trip_id}`}
                              value={t.assigned_driver_id || ''}
                              onChange={(e) =>
                                handleAssignDriver(t.trip_id, Number(e.target.value))
                              }
                              className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                            >
                              <option value="">Unassigned</option>
                              {drivers.map((d) => (
                                <option key={d.driver_id} value={d.driver_id}>
                                  {d.name} ({d.vehicle_number})
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'locations' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleAddLocation}
                className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <div className="text-sm font-semibold text-slate-900">Add Network Location</div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
                  <input
                    required
                    value={locName}
                    onChange={(e) => setLocName(e.target.value)}
                    placeholder="e.g. South Metro Terminal"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Latitude</label>
                    <input
                      required
                      type="number"
                      step="any"
                      value={locLat}
                      onChange={(e) => setLocLat(e.target.value)}
                      placeholder="12.95"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Longitude
                    </label>
                    <input
                      required
                      type="number"
                      step="any"
                      value={locLng}
                      onChange={(e) => setLocLng(e.target.value)}
                      placeholder="77.60"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Zone</label>
                  <input
                    value={locZone}
                    onChange={(e) => setLocZone(e.target.value)}
                    placeholder="e.g. South District"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Location
                </button>
              </form>

              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4 text-left font-medium">ID</th>
                        <th className="py-2.5 px-4 text-left font-medium">Name</th>
                        <th className="py-2.5 px-4 text-left font-medium">Zone</th>
                        <th className="py-2.5 px-4 text-right font-medium">Coordinates</th>
                        <th className="py-2.5 px-4 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {locations.map((loc) => (
                        <tr key={loc.location_id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono">{loc.location_id}</td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{loc.name}</td>
                          <td className="py-2.5 px-4 text-slate-600">{loc.zone || '—'}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteLocation(loc.location_id)}
                              aria-label={`Delete ${loc.name}`}
                              className="text-red-600 hover:text-red-800 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'routes' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleAddRoute}
                className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <div className="text-sm font-semibold text-slate-900">Add Road Segment</div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Start Location
                  </label>
                  <select
                    required
                    value={startLocId}
                    onChange={(e) => setStartLocId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select start...</option>
                    {locations.map((l) => (
                      <option key={l.location_id} value={l.location_id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    End Location
                  </label>
                  <select
                    required
                    value={endLocId}
                    onChange={(e) => setEndLocId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select end...</option>
                    {locations.map((l) => (
                      <option key={l.location_id} value={l.location_id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Dist (km)
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.1"
                      value={distKm}
                      onChange={(e) => setDistKm(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Time (min)
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.5"
                      value={timeMin}
                      onChange={(e) => setTimeMin(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Cost ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={costVal}
                      onChange={(e) => setCostVal(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Road Name
                    </label>
                    <input
                      value={roadName}
                      onChange={(e) => setRoadName(e.target.value)}
                      placeholder="Ring Connector"
                      className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                    <select
                      value={roadType}
                      onChange={(e) => setRoadType(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="city">City</option>
                      <option value="arterial">Arterial</option>
                      <option value="ring">Ring</option>
                      <option value="expressway">Expressway</option>
                      <option value="bypass">Bypass</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={bidirectional}
                    onChange={(e) => setBidirectional(e.target.checked)}
                  />
                  Create reverse direction edge as well
                </label>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Road Segment
                </button>
              </form>

              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[540px]">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3 text-left font-medium">Segment</th>
                        <th className="py-2.5 px-3 text-left font-medium">Road</th>
                        <th className="py-2.5 px-3 text-right font-medium">Dist</th>
                        <th className="py-2.5 px-3 text-right font-medium">Time</th>
                        <th className="py-2.5 px-3 text-right font-medium">Cost</th>
                        <th className="py-2.5 px-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {routes.map((r) => (
                        <tr key={r.route_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3">
                            <span className="font-medium text-slate-900">{r.start_name}</span> →{' '}
                            <span className="text-slate-700">{r.end_name}</span>
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {r.road_name || '—'} ({r.road_type})
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{r.distance_km} km</td>
                          <td className="py-2 px-3 text-right font-mono">{r.time_min} m</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {r.cost !== null ? `$${r.cost.toFixed(2)}` : 'Unavailable'}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteRoute(r.route_id)}
                              aria-label={`Delete route ${r.route_id}`}
                              className="text-red-600 hover:text-red-800 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'users' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-left font-medium">ID</th>
                      <th className="py-2.5 px-4 text-left font-medium">Name</th>
                      <th className="py-2.5 px-4 text-left font-medium">Email</th>
                      <th className="py-2.5 px-4 text-left font-medium">Role</th>
                      <th className="py-2.5 px-4 text-left font-medium">Vehicle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {users.map((u) => (
                      <tr key={u.user_id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono">{u.user_id}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{u.name}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{u.email}</td>
                        <td className="py-2.5 px-4">
                          <select
                            aria-label={`Role for ${u.email}`}
                            value={u.role}
                            onChange={(e) =>
                              handleRoleChange(u.user_id, e.target.value as UserRole)
                            }
                            className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                          >
                            <option value="passenger">passenger</option>
                            <option value="driver">driver</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-500">
                          {u.vehicle_number || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <form
              onSubmit={handleSaveSettings}
              className="max-w-2xl bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div className="text-base font-semibold text-slate-900">
                System Configuration &amp; Feature Flags
              </div>

              <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Enable Driver Role &amp; Dispatch Module
                  </div>
                  <div className="text-xs text-slate-500">
                    Feature flag controlling Driver view, driver registration, and dispatch APIs.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={String(settings.enable_driver_role) === 'true'}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      enable_driver_role: e.target.checked ? 'true' : 'false',
                    }))
                  }
                  className="w-4 h-4"
                />
              </div>

              <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Enable External Map / Traffic API Adapter
                  </div>
                  <div className="text-xs text-slate-500">
                    Server status:{' '}
                    {settings.routing_api_configured
                      ? 'ROUTING_API_URL configured'
                      : 'Not configured (sample data fallback active)'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={String(settings.external_routing_enabled) === 'true'}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      external_routing_enabled: e.target.checked ? 'true' : 'false',
                    }))
                  }
                  className="w-4 h-4"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Default Optimization Preference
                </label>
                <select
                  value={String(settings.default_preference || 'shortest')}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      default_preference: e.target.value as OptimizationPreference,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="shortest">Shortest (minimum distance km)</option>
                  <option value="fastest">Fastest (minimum time min)</option>
                  <option value="cheapest">Lowest cost (minimum cost)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  System Prototype Notice
                </label>
                <input
                  type="text"
                  value={String(settings.system_notice || '')}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, system_notice: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <button
                type="submit"
                className="px-4 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 cursor-pointer"
              >
                Save System Settings
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
