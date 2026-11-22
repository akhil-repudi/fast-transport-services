import { useEffect, useState } from 'react';
import { CheckCircle2, Play, ShieldAlert, Truck } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { TripRecord, User } from '../types';

interface DriverViewProps {
  user: User | null;
  enableDriverRole: boolean;
  onRequireAuth: () => void;
  onNotify: (title: string, message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function DriverView({
  user,
  enableDriverRole,
  onRequireAuth,
  onNotify,
}: DriverViewProps) {
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [remarksMap, setRemarksMap] = useState<Record<number, string>>({});

  async function loadDriverTrips() {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.getDriverTrips();
      setTrips(res.trips);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.status === 403 ? 'Access Denied (403): ' : ''}${err.message}`);
      } else {
        setError('Unable to load driver dispatch trips.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDriverTrips();
  }, [user, enableDriverRole]);

  async function updateStatus(tripId: number, status: 'in_progress' | 'completed') {
    try {
      const remarks = remarksMap[tripId] || '';
      await api.updateTripStatus(tripId, status, remarks);
      onNotify('Status updated', `Trip #${tripId} marked as ${status.replace('_', ' ')}.`, 'success');
      await loadDriverTrips();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to update trip status.';
      onNotify('Update failed', msg, 'error');
    }
  }

  if (!enableDriverRole) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-3">
        <Truck className="w-8 h-8 text-slate-400 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">Driver Module Disabled</h1>
        <p className="text-sm text-slate-600">
          The optional driver feature flag is currently turned off in Admin Settings.
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-4">
        <Truck className="w-8 h-8 text-slate-400 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">Driver Dispatch</h1>
        <p className="text-sm text-slate-600">Sign in with a driver or admin account to view assigned trips.</p>
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

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-white border border-red-200 rounded-xl p-6 space-y-2">
          <div className="flex items-center gap-2 text-red-800 font-semibold">
            <ShieldAlert className="w-5 h-5" />
            <span>{error}</span>
          </div>
          <p className="text-xs text-slate-600">
            Driver endpoints require a Driver or Administrator account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Driver Dispatch</h1>
        <p className="text-sm text-slate-600">
          Optional feature-flagged module: inspect assigned routes and update trip progress.
        </p>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 animate-pulse h-32" />
      ) : trips.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Truck className="w-7 h-7 text-slate-400 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900">No assigned trips</h2>
          <p className="text-sm text-slate-600">
            Administrators can assign saved passenger trips to drivers from the Admin Dashboard.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {trips.map((trip) => {
            const selected =
              trip.results.find((r) => r.is_selected === 1) || trip.results[0];

            return (
              <div
                key={trip.trip_id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-900">
                        Trip #{trip.trip_id}
                      </span>
                      <span>·</span>
                      <span className="capitalize font-medium text-blue-700">
                        {trip.status.replace('_', ' ')}
                      </span>
                      <span>·</span>
                      <span>Passenger: {trip.passenger_name}</span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {trip.source_name} → {trip.destination_name}
                    </h2>
                    {selected && (
                      <p className="text-xs text-slate-600">
                        Assigned route: {selected.path.map((p) => p.name).join(' → ')}
                      </p>
                    )}
                  </div>

                  {selected && (
                    <div className="flex items-center gap-4 text-right font-mono text-xs shrink-0">
                      <div>
                        <div className="text-slate-500">Distance</div>
                        <div className="font-semibold text-slate-900">
                          {selected.total_distance_km.toFixed(1)} km
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Est. Time</div>
                        <div className="font-semibold text-slate-900">
                          {selected.total_time_min.toFixed(0)} min
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {trip.status !== 'completed' && trip.status !== 'cancelled' && (
                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      type="text"
                      value={remarksMap[trip.trip_id] || ''}
                      onChange={(e) =>
                        setRemarksMap((prev) => ({ ...prev, [trip.trip_id]: e.target.value }))
                      }
                      placeholder="Optional status update remarks..."
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      {trip.status === 'assigned' && (
                        <button
                          type="button"
                          onClick={() => updateStatus(trip.trip_id, 'in_progress')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Start Trip
                        </button>
                      )}
                      {(trip.status === 'assigned' || trip.status === 'in_progress') && (
                        <button
                          type="button"
                          onClick={() => updateStatus(trip.trip_id, 'completed')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Mark Completed
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
