import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Info,
  MapPin,
  Navigation,
  Route,
  Search,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type {
  LocationItem,
  OptimizationPreference,
  RankedRoute,
  RoadSegment,
  RouteSearchResponse,
  User,
} from '../types';
import { RouteMap } from './RouteMap';

interface RoutePlannerProps {
  user: User | null;
  defaultPreference: OptimizationPreference;
  onTripSaved: (tripId: number) => void;
  onRequireAuth: () => void;
  onNotify: (title: string, message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

interface LocationComboboxProps {
  id: string;
  label: string;
  placeholder: string;
  locations: LocationItem[];
  selectedId: number | '';
  onChange: (id: number | '') => void;
}

function LocationCombobox({
  id,
  label,
  placeholder,
  locations,
  selectedId,
  onChange,
}: LocationComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const selectedLoc = locations.find((l) => l.location_id === selectedId) || null;

  useEffect(() => {
    if (selectedLoc) {
      setQuery(selectedLoc.name);
    } else if (selectedId === '') {
      setQuery('');
    }
  }, [selectedId, selectedLoc]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (selectedLoc) {
          setQuery(selectedLoc.name);
        }
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [selectedLoc]);

  const CITY_ALIASES: Record<string, string[]> = {
    visakhapatnam: ['vishakapatnam', 'vishakhapatnam', 'vizag'],
    bengaluru: ['benguluru', 'bangalore', 'blr'],
    hyderabad: ['hyd', 'hyderbad'],
    vijayawada: ['vja', 'bezawada'],
  };

  const filtered = locations.filter((loc) => {
    const q = query.trim().toLowerCase();
    if (!q || (selectedLoc && q === selectedLoc.name.toLowerCase())) return true;
    const aliases = CITY_ALIASES[loc.name.toLowerCase()] || [];
    return (
      loc.name.toLowerCase().includes(q) ||
      (loc.zone && loc.zone.toLowerCase().includes(q)) ||
      aliases.some((alias) => alias.includes(q) || q.includes(alias))
    );
  });

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (selectedId !== '') {
              onChange('');
            }
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
        />
        {query && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              setQuery('');
              onChange('');
              setOpen(true);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-56 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">No matching locations found.</li>
          ) : (
            filtered.map((loc) => (
              <li key={loc.location_id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(loc.location_id);
                    setQuery(loc.name);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-slate-50 cursor-pointer ${
                    loc.location_id === selectedId
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : 'text-slate-800'
                  }`}
                >
                  <span className="truncate">{loc.name}</span>
                  {loc.zone && (
                    <span className="text-xs text-slate-500 shrink-0">{loc.zone}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

const PREFERENCE_OPTIONS: Array<{
  value: OptimizationPreference;
  label: string;
  unit: string;
  Icon: typeof Route;
}> = [
  { value: 'shortest', label: 'Shortest', unit: 'min km', Icon: Route },
  { value: 'fastest', label: 'Fastest', unit: 'min time', Icon: Clock },
  { value: 'cheapest', label: 'Lowest cost', unit: 'min cost', Icon: DollarSign },
];

export function RoutePlanner({
  user,
  defaultPreference,
  onTripSaved,
  onRequireAuth,
  onNotify,
}: RoutePlannerProps) {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [roadNetwork, setRoadNetwork] = useState<RoadSegment[]>([]);
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [destinationId, setDestinationId] = useState<number | ''>('');
  const [preference, setPreference] = useState<OptimizationPreference>(defaultPreference);

  const [validationError, setValidationError] = useState('');
  const [searching, setSearching] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [searchResult, setSearchResult] = useState<RouteSearchResponse | null>(null);
  const [selectedRank, setSelectedRank] = useState<number>(1);
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  useEffect(() => {
    setPreference(defaultPreference);
  }, [defaultPreference]);

  useEffect(() => {
    let active = true;
    Promise.all([api.getLocations(), api.getRoutes()])
      .then(([locRes, routeRes]) => {
        if (!active) return;
        setLocations(locRes.locations);
        setRoadNetwork(routeRes.routes);
      })
      .catch(() => {
        if (!active) return;
        onNotify('Network Error', 'Failed to load location network.', 'error');
      });
    return () => {
      active = false;
    };
  }, [onNotify]);

  async function runSearch(
    srcOverride?: number | '',
    dstOverride?: number | '',
    prefOverride?: OptimizationPreference
  ) {
    const src = srcOverride !== undefined ? srcOverride : sourceId;
    const dst = dstOverride !== undefined ? dstOverride : destinationId;
    const pref = prefOverride !== undefined ? prefOverride : preference;

    setValidationError('');

    // TC03: Blank source or destination -> validation message; search is NOT run
    if (src === '' || dst === '') {
      setValidationError('Please select both a source and a destination location before searching.');
      return;
    }

    if (src === dst) {
      setValidationError('Source and destination must be different locations.');
      return;
    }

    setSearching(true);
    try {
      const res = await api.searchRoutes({
        source_id: src,
        destination_id: dst,
        preference: pref,
      });
      setSearchResult(res);
      setSelectedRank(res.routes[0]?.rank_number ?? 1);
      setExpandedRank(res.routes[0]?.rank_number ?? null);

      if (res.found && res.routes.length > 0) {
        const top = res.routes[0];
        onNotify(
          'Routes ranked',
          `${res.routes.length} option(s) found (${pref}). Best: ${top.total_distance_km} km, ${top.total_time_min} min.`,
          'success'
        );
      } else {
        onNotify('No route found', res.message || 'No connecting path exists.', 'warning');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setValidationError(err.message);
      } else {
        setValidationError('Unable to reach the route optimization server.');
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleSaveTrip(routeToSave?: RankedRoute) {
    if (!searchResult || !searchResult.found || searchResult.routes.length === 0) return;

    if (!user) {
      onNotify('Sign in required', 'Please sign in to save a trip to your history.', 'info');
      onRequireAuth();
      return;
    }

    const rankToSave = routeToSave?.rank_number ?? selectedRank;
    setSavingTrip(true);
    try {
      const res = await api.saveTrip({
        source_id: searchResult.source.location_id,
        destination_id: searchResult.destination.location_id,
        preference: searchResult.preference,
        selected_rank: rankToSave,
        routes: searchResult.routes,
      });
      onNotify(
        'Trip saved',
        `Trip #${res.trip_id} (${searchResult.source.name} to ${searchResult.destination.name}) saved to history.`,
        'success'
      );
      onTripSaved(res.trip_id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save trip.';
      onNotify('Save failed', msg, 'error');
    } finally {
      setSavingTrip(false);
    }
  }

  function applyQuickPair(srcName: string, dstName: string, pref: OptimizationPreference) {
    const src = locations.find((l) => l.name === srcName);
    const dst = locations.find((l) => l.name === dstName);
    if (!src || !dst) return;
    setSourceId(src.location_id);
    setDestinationId(dst.location_id);
    setPreference(pref);
    runSearch(src.location_id, dst.location_id, pref);
  }

  function handleSwap() {
    const prevSrc = sourceId;
    setSourceId(destinationId);
    setDestinationId(prevSrc);
    setValidationError('');
  }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Route Planner</h1>
          <p className="text-sm text-slate-600">
            Select origin and destination hubs to compute and compare optimal routes.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg text-xs font-medium shrink-0">
          <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span>Sample data · Not live traffic</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Search Form */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="space-y-3">
            <LocationCombobox
              id="source-input"
              label="Source Location"
              placeholder="Search starting hub..."
              locations={locations}
              selectedId={sourceId}
              onChange={(id) => {
                setSourceId(id);
                setValidationError('');
              }}
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSwap}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-700 cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                Swap Source &amp; Destination
              </button>
            </div>

            <LocationCombobox
              id="destination-input"
              label="Destination Location"
              placeholder="Search destination hub..."
              locations={locations}
              selectedId={destinationId}
              onChange={(id) => {
                setDestinationId(id);
                setValidationError('');
              }}
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700 mb-2">
              Optimization Preference
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
              {PREFERENCE_OPTIONS.map(({ value, label, unit, Icon }) => {
                const active = preference === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPreference(value)}
                    className={`flex flex-col items-center justify-center py-2 px-2 rounded-md text-xs transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-blue-700 font-semibold shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 font-medium'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 mb-1" />
                    <span className="whitespace-nowrap">{label}</span>
                    <span className="text-[10px] text-slate-400 font-normal">{unit}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {validationError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => runSearch()}
            disabled={searching}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
            {searching ? 'Optimizing Routes...' : 'Find Routes'}
          </button>

          {/* Quick Inter-City & Sample Scenarios */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="text-xs font-semibold text-slate-700">
              Inter-City Corridors (Accurate Sample km)
            </div>
            <div className="grid grid-cols-1 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => applyQuickPair('Hyderabad', 'Vijayawada', 'shortest')}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 text-slate-800 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span>Hyderabad → Vijayawada</span>
                <span className="font-mono text-slate-500">275 km</span>
              </button>
              <button
                type="button"
                onClick={() => applyQuickPair('Vijayawada', 'Visakhapatnam', 'shortest')}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 text-slate-800 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span>Vijayawada → Visakhapatnam</span>
                <span className="font-mono text-slate-500">350 km</span>
              </button>
              <button
                type="button"
                onClick={() => applyQuickPair('Hyderabad', 'Visakhapatnam', 'shortest')}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 text-slate-800 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span>Hyderabad → Visakhapatnam</span>
                <span className="font-mono text-slate-500">590 km</span>
              </button>
              <button
                type="button"
                onClick={() => applyQuickPair('Hyderabad', 'Bengaluru', 'fastest')}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 text-slate-800 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span>Hyderabad → Bengaluru</span>
                <span className="font-mono text-slate-500">575 km</span>
              </button>
              <button
                type="button"
                onClick={() => applyQuickPair('Bengaluru', 'Vijayawada', 'fastest')}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 text-slate-800 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span>Bengaluru → Vijayawada</span>
                <span className="font-mono text-slate-500">660 km</span>
              </button>
              <button
                type="button"
                onClick={() => applyQuickPair('Bengaluru', 'Visakhapatnam', 'cheapest')}
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 text-slate-800 transition-colors cursor-pointer flex items-center justify-between"
              >
                <span>Bengaluru → Visakhapatnam</span>
                <span className="font-mono text-slate-500">1005–1057 km</span>
              </button>
            </div>

            <div className="pt-2 text-xs font-semibold text-slate-700">
              Metro Edge-Case Scenarios
            </div>
            <div className="space-y-1.5 text-xs">
              <button
                type="button"
                onClick={() =>
                  applyQuickPair('West Industrial Park', 'University Science Hub', 'cheapest')
                }
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
              >
                West Park → Science Hub (Unpriced direct link)
              </button>
              <button
                type="button"
                onClick={() =>
                  applyQuickPair('Central Railway Terminal', 'Hilltop Relay Station', 'shortest')
                }
                className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
              >
                Central Terminal → Hilltop Relay (No-route test)
              </button>
            </div>
          </div>
        </aside>

        {/* Right: Map + Results */}
        <section className="lg:col-span-8 space-y-5">
          {searchResult && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
                <span>{searchResult.traffic_api.message}</span>
              </div>
              <span className="font-mono text-slate-500 shrink-0">
                Source: {searchResult.data_source}
              </span>
            </div>
          )}

          <RouteMap
            locations={locations}
            roadNetwork={roadNetwork}
            routes={searchResult?.routes || []}
            selectedRank={selectedRank}
            sourceId={sourceId}
            destinationId={destinationId}
            onSelectSource={(id) => {
              setSourceId(id);
              setValidationError('');
            }}
            onSelectDestination={(id) => {
              setDestinationId(id);
              setValidationError('');
            }}
          />

          {/* Loading Skeleton */}
          {searching && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 animate-pulse">
              <div className="h-5 w-48 bg-slate-200 rounded" />
              <div className="h-20 w-full bg-slate-100 rounded-lg" />
              <div className="h-20 w-full bg-slate-100 rounded-lg" />
            </div>
          )}

          {/* Initial Empty State */}
          {!searching && !searchResult && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
              <Navigation className="w-7 h-7 text-slate-400 mx-auto" />
              <h2 className="text-base font-semibold text-slate-900">
                Ready to compare route alternatives
              </h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Choose a source and destination on the left (or click hubs directly on the map) and
                run the Dijkstra optimizer.
              </p>
            </div>
          )}

          {/* TC08: No Route Found */}
          {!searching && searchResult && !searchResult.found && (
            <div
              role="status"
              className="bg-white border border-amber-300 rounded-xl p-6 space-y-2"
            >
              <div className="flex items-center gap-2 text-amber-900 font-semibold text-base">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
                <span>No route found</span>
              </div>
              <p className="text-sm text-slate-700">{searchResult.message}</p>
            </div>
          )}

          {/* Ranked Results */}
          {!searching && searchResult && searchResult.found && (
            <div className="space-y-5">
              {searchResult.cost_unavailable && (
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium">
                  {searchResult.message}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Ranked Route Options ({searchResult.routes.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    {searchResult.source.name} → {searchResult.destination.name} · Ranked by{' '}
                    <span className="font-medium text-slate-700">{searchResult.preference}</span> ·{' '}
                    Sample data, not live traffic
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleSaveTrip()}
                  disabled={savingTrip}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <BookmarkCheck className="w-4 h-4" />
                  {savingTrip ? 'Saving...' : `Save Trip (Option #${selectedRank})`}
                </button>
              </div>

              {/* Cards */}
              <div className="space-y-3">
                {searchResult.routes.map((route) => {
                  const isSelected = route.rank_number === selectedRank;
                  const isExpanded = expandedRank === route.rank_number;

                  return (
                    <div
                      key={route.rank_number}
                      className={`bg-white rounded-xl border transition-colors ${
                        isSelected
                          ? 'border-blue-600 ring-1 ring-blue-600/20'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div
                        onClick={() => setSelectedRank(route.rank_number)}
                        className="p-4 sm:p-5 cursor-pointer space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`font-semibold ${
                                  route.recommended ? 'text-blue-700' : 'text-slate-600'
                                }`}
                              >
                                {route.label}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="text-slate-500">
                                {route.segments.length} road segment
                                {route.segments.length === 1 ? '' : 's'}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="text-slate-500">
                                Sample data (not live traffic)
                              </span>
                              {route.highlights && route.highlights.length > 0 && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="text-emerald-700 font-medium">
                                    Best: {route.highlights.join(' / ')}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="text-sm font-medium text-slate-900 leading-snug">
                              {route.path.map((p) => p.name).join(' → ')}
                            </div>
                          </div>

                          <div className="flex items-center gap-5 shrink-0">
                            <div className="text-right">
                              <div className="text-[11px] text-slate-500">Distance</div>
                              <div className="text-sm font-mono font-semibold text-slate-900">
                                {route.total_distance_km.toFixed(1)} km
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] text-slate-500">Duration</div>
                              <div className="text-sm font-mono font-semibold text-slate-900">
                                {route.total_time_min.toFixed(0)} min
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] text-slate-500">Est. Cost</div>
                              <div className="text-sm font-mono font-semibold text-slate-900">
                                {route.total_cost !== null
                                  ? `$${route.total_cost.toFixed(2)}`
                                  : 'Unavailable'}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRank(isExpanded ? null : route.rank_number);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                Hide segment breakdown
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                View segment breakdown
                              </>
                            )}
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRank(route.rank_number);
                              }}
                              className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                                isSelected
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {isSelected ? 'Highlighted on map' : 'Show on map'}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRank(route.rank_number);
                                handleSaveTrip(route);
                              }}
                              className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              Save this route
                            </button>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-slate-100 bg-slate-50/70">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-200">
                                <th className="py-2 text-left font-medium">Road Segment</th>
                                <th className="py-2 text-left font-medium">Type</th>
                                <th className="py-2 text-right font-medium">Distance</th>
                                <th className="py-2 text-right font-medium">Time</th>
                                <th className="py-2 text-right font-medium">Cost</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70">
                              {route.segments.map((seg, idx) => (
                                <tr key={`${seg.route_id}-${idx}`}>
                                  <td className="py-2 text-slate-800 font-medium">
                                    {seg.road_name || `Segment #${seg.route_id}`}
                                  </td>
                                  <td className="py-2 text-slate-500 capitalize">
                                    {seg.road_type}
                                  </td>
                                  <td className="py-2 text-right font-mono text-slate-700">
                                    {seg.distance_km.toFixed(1)} km
                                  </td>
                                  <td className="py-2 text-right font-mono text-slate-700">
                                    {seg.time_min.toFixed(0)} min
                                  </td>
                                  <td className="py-2 text-right font-mono text-slate-700">
                                    {seg.cost !== null ? `$${seg.cost.toFixed(2)}` : 'Unavailable'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Comparison Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Side-by-Side Route Comparison
                  </h3>
                  <span className="text-xs text-slate-500">Sample data, not live traffic</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4 text-left font-medium">Rank</th>
                        <th className="py-2.5 px-4 text-left font-medium">Status</th>
                        <th className="py-2.5 px-4 text-left font-medium">Waypoints</th>
                        <th className="py-2.5 px-4 text-right font-medium">Distance</th>
                        <th className="py-2.5 px-4 text-right font-medium">Duration</th>
                        <th className="py-2.5 px-4 text-right font-medium">Est. Cost</th>
                        <th className="py-2.5 px-4 text-right font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {searchResult.routes.map((r) => (
                        <tr
                          key={r.rank_number}
                          onClick={() => setSelectedRank(r.rank_number)}
                          className={`cursor-pointer transition-colors ${
                            r.rank_number === selectedRank
                              ? 'bg-blue-50/60'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                            #{r.rank_number}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-800">
                            {r.recommended ? (
                              <span className="text-blue-700 font-semibold">Recommended</span>
                            ) : (
                              r.label
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 max-w-[260px] truncate">
                            {r.path.map((p) => p.name).join(' → ')}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-900">
                            {r.total_distance_km.toFixed(1)} km
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-900">
                            {r.total_time_min.toFixed(0)} min
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-900">
                            {r.total_cost !== null ? `$${r.total_cost.toFixed(2)}` : 'Unavailable'}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-500 capitalize">
                            {r.data_source}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
