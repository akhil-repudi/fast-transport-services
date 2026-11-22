import { useEffect, useState } from 'react';
import { Clock, History, RefreshCw, XCircle } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { TripRecord, TripStatus, User } from '../types';

interface TripHistoryProps {
  user: User | null;
  onRequireAuth: () => void;
  onNotify: (title: string, message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

const STATUS_LABELS: Record<TripStatus, { label: string; textClass: string }> = {
  saved: { label: 'Saved', textClass: 'text-slate-700' },
  assigned: { label: 'Driver Assigned', textClass: 'text-blue-700' },
  in_progress: { label: 'In Progress', textClass: 'text-amber-700' },
  completed: { label: 'Completed', textClass: 'text-emerald-700' },
  cancelled: { label: 'Cancelled', textClass: 'text-red-700' },
};

export function TripHistory({ user, onRequireAuth, onNotify }: TripHistoryProps) {
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | TripStatus>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function loadTrips() {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getTrips();
      setTrips(res.trips);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to load trip history.';
      onNotify('Load failed', msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrips();
  }, [user]);

  async function handleCancel(tripId: number) {
    try {
      await api.updateTripStatus(tripId, 'cancelled', 'Cancelled by user from Trip History.');
      onNotify('Trip cancelled', `Trip #${tripId} marked as cancelled.`, 'info');
      await loadTrips();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to cancel trip.';
      onNotify('Error', msg, 'error');
    }
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-4">
        <History className="w-8 h-8 text-slate-400 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">Sign in to view your Trip History</h1>
        <p className="text-sm text-slate-600">
          Saved routes, preference rankings, and trip status logs are tied to your account.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="px-4 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 cursor-pointer"
        >
          Sign In or Register
        </button>
      </div>
    );
  }

  const filtered = filter === 'all' ? trips : trips.filter((t) => t.status === filter);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Trip History</h1>
          <p className="text-sm text-slate-600">
            Saved route comparisons and status updates for {user.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {(['all', 'saved', 'assigned', 'in_progress', 'completed', 'cancelled'] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilter(st)}
                  className={`px-2.5 py-1.5 rounded-md font-medium capitalize transition-colors cursor-pointer whitespace-nowrap ${
                    filter === st
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            onClick={loadTrips}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 animate-pulse">
          <div className="h-5 w-56 bg-slate-200 rounded" />
          <div className="h-24 w-full bg-slate-100 rounded-lg" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Clock className="w-7 h-7 text-slate-400 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900">No trips found</h2>
          <p className="text-sm text-slate-600">
            Search for a route in the Route Planner and click Save Trip to store it here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((trip) => {
            const selected =
              trip.results.find((r) => r.is_selected === 1) || trip.results[0];
            const statusInfo = STATUS_LABELS[trip.status] || {
              label: trip.status,
              textClass: 'text-slate-700',
            };
            const isExpanded = expandedId === trip.trip_id;

            return (
              <div
                key={trip.trip_id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">
                        Trip #{trip.trip_id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${statusInfo.textClass}`}>
                        {statusInfo.label}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">Preference: {trip.preference}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(trip.created_at).toLocaleString()}</span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {trip.source_name} → {trip.destination_name}
                    </h2>
                    {selected && (
                      <p className="text-xs text-slate-600">
                        Selected path: {selected.path.map((p) => p.name).join(' → ')}
                      </p>
                    )}
                    {trip.driver_name && (
                      <p className="text-xs text-slate-500">
                        Assigned driver: {trip.driver_name} ({trip.driver_vehicle})
                      </p>
                    )}
                  </div>

                  {selected && (
                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">Distance</div>
                        <div className="text-sm font-mono font-semibold text-slate-900">
                          {selected.total_distance_km.toFixed(1)} km
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">Duration</div>
                        <div className="text-sm font-mono font-semibold text-slate-900">
                          {selected.total_time_min.toFixed(0)} min
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">Cost</div>
                        <div className="text-sm font-mono font-semibold text-slate-900">
                          {selected.total_cost !== null
                            ? `$${selected.total_cost.toFixed(2)}`
                            : 'Unavailable'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : trip.trip_id)}
                    className="font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    {isExpanded
                      ? 'Hide ranked options & status log'
                      : `View ${trip.results.length} saved option(s) & status log`}
                  </button>

                  {(trip.status === 'saved' || trip.status === 'assigned') && (
                    <button
                      type="button"
                      onClick={() => handleCancel(trip.trip_id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 font-medium cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancel Trip
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                    <div>
                      <div className="font-semibold text-slate-800 mb-2">
                        Saved Ranked Alternatives (Sample data)
                      </div>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {trip.results.map((r) => (
                          <div key={r.result_id} className="p-2.5 flex items-center justify-between gap-2">
                            <div>
                              <span className="font-mono font-semibold text-slate-900">
                                #{r.rank_number}
                              </span>{' '}
                              {r.is_selected === 1 && (
                                <span className="text-blue-700 font-medium">(Selected)</span>
                              )}
                              <div className="text-slate-500 mt-0.5">
                                {r.path.map((p) => p.name).join(' → ')}
                              </div>
                            </div>
                            <div className="font-mono text-right text-slate-700 shrink-0">
                              <div>{r.total_distance_km.toFixed(1)} km</div>
                              <div>
                                {r.total_time_min.toFixed(0)} min ·{' '}
                                {r.total_cost !== null ? `$${r.total_cost.toFixed(2)}` : 'N/A'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="font-semibold text-slate-800 mb-2">Status Timeline</div>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {trip.status_logs.map((log) => (
                          <div key={log.log_id} className="p-2.5 space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="font-medium capitalize text-slate-800">
                                {log.status.replace('_', ' ')}
                              </span>
                              <span className="text-slate-400 font-mono">
                                {new Date(log.updated_at).toLocaleString()}
                              </span>
                            </div>
                            {log.remarks && <div className="text-slate-600">{log.remarks}</div>}
                          </div>
                        ))}
                      </div>
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
