import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { LocationItem, RankedRoute, RoadSegment } from '../types';

interface RouteMapProps {
  locations: LocationItem[];
  roadNetwork: RoadSegment[];
  routes: RankedRoute[];
  selectedRank: number;
  sourceId: number | '';
  destinationId: number | '';
  onSelectSource: (locationId: number) => void;
  onSelectDestination: (locationId: number) => void;
}

const INTERCITY_NAMES = new Set([
  'Hyderabad',
  'Vijayawada',
  'Visakhapatnam',
  'Bengaluru',
]);

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function RouteMap({
  locations,
  roadNetwork,
  routes,
  selectedRank,
  sourceId,
  destinationId,
  onSelectSource,
  onSelectDestination,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const locById = new Map<number, LocationItem>();
  for (const loc of locations) {
    locById.set(loc.location_id, loc);
  }
  const sourceLoc = sourceId !== '' ? locById.get(sourceId) || null : null;
  const destLoc = destinationId !== '' ? locById.get(destinationId) || null : null;
  const selectedRoute =
    routes.find((r) => r.rank_number === selectedRank) || routes[0] || null;

  const directGeodesicKm =
    sourceLoc && destLoc && sourceLoc.location_id !== destLoc.location_id
      ? haversineKm(
          sourceLoc.latitude,
          sourceLoc.longitude,
          destLoc.latitude,
          destLoc.longitude
        )
      : null;

  // Initialize Leaflet map once centered on South India inter-city corridor
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [15.35, 79.85],
      zoom: 6,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Re-render network edges, location markers, distance labels, and ranked routes
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const localMap = new Map<number, LocationItem>();
    for (const loc of locations) {
      localMap.set(loc.location_id, loc);
    }

    // 1. Subtle background road topology
    const drawnPairs = new Set<string>();
    for (const seg of roadNetwork) {
      const a = Math.min(seg.start_location_id, seg.end_location_id);
      const b = Math.max(seg.start_location_id, seg.end_location_id);
      const key = `${a}-${b}-${seg.road_name}`;
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      const startLoc = localMap.get(seg.start_location_id);
      const endLoc = localMap.get(seg.end_location_id);
      if (!startLoc || !endLoc) continue;

      const isInterCityEdge =
        INTERCITY_NAMES.has(startLoc.name) && INTERCITY_NAMES.has(endLoc.name);

      L.polyline(
        [
          [startLoc.latitude, startLoc.longitude],
          [endLoc.latitude, endLoc.longitude],
        ],
        {
          color: isInterCityEdge ? '#64748b' : '#94a3b8',
          weight: isInterCityEdge ? 2 : 1.5,
          opacity: isInterCityEdge ? 0.35 : 0.3,
        }
      )
        .bindTooltip(
          `${seg.road_name || 'Road'}: ${seg.distance_km} km · ${seg.time_min} min`,
          { sticky: true }
        )
        .addTo(group);
    }

    // 2. If Source and Destination are selected before search, draw preview line with straight-line distance
    if (
      (!selectedRoute || selectedRoute.path.length < 2) &&
      sourceLoc &&
      destLoc &&
      sourceLoc.location_id !== destLoc.location_id
    ) {
      const straightKm = haversineKm(
        sourceLoc.latitude,
        sourceLoc.longitude,
        destLoc.latitude,
        destLoc.longitude
      );
      L.polyline(
        [
          [sourceLoc.latitude, sourceLoc.longitude],
          [destLoc.latitude, destLoc.longitude],
        ],
        {
          color: '#2563eb',
          weight: 3,
          opacity: 0.65,
          dashArray: '8 6',
        }
      ).addTo(group);

      const midLat = (sourceLoc.latitude + destLoc.latitude) / 2;
      const midLng = (sourceLoc.longitude + destLoc.longitude) / 2;
      L.marker([midLat, midLng], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          iconSize: [140, 26],
          iconAnchor: [70, 13],
          html: `<div style="background:#ffffff;border:1px solid #2563eb;color:#1e40af;font-family:JetBrains Mono,monospace;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;white-space:nowrap;text-align:center;box-shadow:0 1px 3px rgba(15,23,42,0.12);">~${straightKm.toFixed(1)} km direct</div>`,
        }),
      }).addTo(group);
    }

    // 3. Alternative routes (dashed muted slate)
    for (const r of routes) {
      if (selectedRoute && r.rank_number === selectedRoute.rank_number) continue;
      const latlngs: L.LatLngExpression[] = r.path.map((p) => [p.latitude, p.longitude]);
      if (latlngs.length < 2) continue;

      L.polyline(latlngs, {
        color: '#64748b',
        weight: 3.5,
        opacity: 0.7,
        dashArray: '6 6',
      })
        .bindTooltip(
          `${r.label}: ${r.total_distance_km} km · ${r.total_time_min} min`,
          { sticky: true }
        )
        .addTo(group);
    }

    // 4. Selected / Recommended route (bold cobalt) + midpoint segment distance labels
    if (selectedRoute && selectedRoute.path.length >= 2) {
      const latlngs: L.LatLngExpression[] = selectedRoute.path.map((p) => [
        p.latitude,
        p.longitude,
      ]);
      const poly = L.polyline(latlngs, {
        color: '#1d4ed8',
        weight: 5,
        opacity: 0.95,
      }).addTo(group);

      poly.bindTooltip(
        `${selectedRoute.label}: ${selectedRoute.total_distance_km} km · ${selectedRoute.total_time_min} min`,
        { sticky: true }
      );

      // Draw exact segment distance label at each leg midpoint on the map
      for (let i = 0; i < selectedRoute.segments.length; i++) {
        const seg = selectedRoute.segments[i];
        const pA = selectedRoute.path[i];
        const pB = selectedRoute.path[i + 1];
        if (!pA || !pB) continue;

        const midLat = (pA.latitude + pB.latitude) / 2;
        const midLng = (pA.longitude + pB.longitude) / 2;
        const labelHtml = `<div style="background:#1e3a8a;color:#ffffff;border:1px solid #ffffff;font-family:JetBrains Mono,monospace;font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 5px rgba(15,23,42,0.22);">${seg.distance_km.toFixed(1)} km · ${seg.time_min.toFixed(0)}m</div>`;

        L.marker([midLat, midLng], {
          icon: L.divIcon({
            className: '',
            iconSize: [110, 24],
            iconAnchor: [55, 12],
            html: labelHtml,
          }),
        })
          .bindTooltip(
            `${escapeHtml(seg.road_name || 'Road segment')}: ${seg.distance_km} km, ${seg.time_min} min${
              seg.cost !== null ? `, $${seg.cost.toFixed(2)}` : ''
            }`,
            { direction: 'top' }
          )
          .addTo(group);
      }
    }

    // 5. Location markers with interactive Source / Destination assignment popup
    const activeNodeIds = new Set(selectedRoute ? selectedRoute.node_ids : []);
    for (const loc of locations) {
      const isSource = loc.location_id === sourceId;
      const isDest = loc.location_id === destinationId;
      const isOnActivePath = activeNodeIds.has(loc.location_id);
      const isInterCity = INTERCITY_NAMES.has(loc.name);

      let fillColor = isInterCity ? '#0f172a' : '#ffffff';
      let strokeColor = isInterCity ? '#ffffff' : '#475569';
      let radius = isInterCity ? 7 : 5;

      if (isSource) {
        fillColor = '#15803d';
        strokeColor = '#ffffff';
        radius = 10;
      } else if (isDest) {
        fillColor = '#b91c1c';
        strokeColor = '#ffffff';
        radius = 10;
      } else if (isOnActivePath) {
        fillColor = '#1d4ed8';
        strokeColor = '#ffffff';
        radius = 8;
      }

      const marker = L.circleMarker([loc.latitude, loc.longitude], {
        radius,
        color: strokeColor,
        weight: 2,
        fillColor,
        fillOpacity: 1,
      }).addTo(group);

      marker.bindTooltip(`${loc.name}${loc.zone ? ` (${loc.zone})` : ''}`, {
        direction: 'top',
        offset: [0, -6],
      });

      // Keep major city names or active source/dest/waypoints visibly labeled on the map
      if (isInterCity || isSource || isDest || isOnActivePath) {
        const badgePrefix = isSource ? 'A · ' : isDest ? 'B · ' : '';
        L.marker([loc.latitude, loc.longitude], {
          interactive: false,
          icon: L.divIcon({
            className: '',
            iconSize: [140, 20],
            iconAnchor: [70, -10],
            html: `<div style="display:inline-block;background:rgba(255,255,255,0.92);border:1px solid ${
              isSource ? '#15803d' : isDest ? '#b91c1c' : '#cbd5e1'
            };color:#0f172a;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;white-space:nowrap;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,0.1);">${escapeHtml(
              badgePrefix + loc.name
            )}</div>`,
          }),
        }).addTo(group);
      }

      const popupContainer = document.createElement('div');
      popupContainer.className = 'text-xs space-y-2 min-w-[170px]';

      const title = document.createElement('div');
      title.className = 'font-semibold text-slate-900';
      title.textContent = loc.name;
      popupContainer.appendChild(title);

      if (loc.zone) {
        const sub = document.createElement('div');
        sub.className = 'text-slate-500';
        sub.textContent = `${loc.zone} (${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°)`;
        popupContainer.appendChild(sub);
      }

      const btnRow = document.createElement('div');
      btnRow.className = 'flex gap-1.5 pt-1';

      const srcBtn = document.createElement('button');
      srcBtn.type = 'button';
      srcBtn.className =
        'px-2 py-1 rounded bg-emerald-700 text-white font-medium hover:bg-emerald-800 cursor-pointer';
      srcBtn.textContent = 'Set Source';
      srcBtn.onclick = () => {
        onSelectSource(loc.location_id);
        marker.closePopup();
      };

      const dstBtn = document.createElement('button');
      dstBtn.type = 'button';
      dstBtn.className =
        'px-2 py-1 rounded bg-blue-700 text-white font-medium hover:bg-blue-800 cursor-pointer';
      dstBtn.textContent = 'Set Dest';
      dstBtn.onclick = () => {
        onSelectDestination(loc.location_id);
        marker.closePopup();
      };

      btnRow.appendChild(srcBtn);
      btnRow.appendChild(dstBtn);
      popupContainer.appendChild(btnRow);

      marker.bindPopup(popupContainer);
    }

    // 6. Fit bounds accurately to active route, selected pair, or South India cities
    if (selectedRoute && selectedRoute.path.length >= 2) {
      const bounds = L.latLngBounds(
        selectedRoute.path.map((p) => [p.latitude, p.longitude] as [number, number])
      );
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: 13 });
    } else if (sourceLoc && destLoc) {
      const bounds = L.latLngBounds([
        [sourceLoc.latitude, sourceLoc.longitude],
        [destLoc.latitude, destLoc.longitude],
      ]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
    } else if (sourceLoc || destLoc) {
      const single = sourceLoc || destLoc!;
      map.setView([single.latitude, single.longitude], INTERCITY_NAMES.has(single.name) ? 7 : 12);
    } else {
      const cityLocs = locations.filter((l) => INTERCITY_NAMES.has(l.name));
      if (cityLocs.length >= 2) {
        const bounds = L.latLngBounds(
          cityLocs.map((l) => [l.latitude, l.longitude] as [number, number])
        );
        map.fitBounds(bounds, { padding: [45, 45], maxZoom: 7 });
      }
    }
  }, [
    locations,
    roadNetwork,
    routes,
    selectedRank,
    sourceId,
    destinationId,
    sourceLoc,
    destLoc,
    selectedRoute,
    onSelectSource,
    onSelectDestination,
  ]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden relative">
      {/* Live Distance Readout Overlay on Map */}
      {(selectedRoute || (sourceLoc && destLoc && directGeodesicKm !== null)) && (
        <div
          aria-live="polite"
          className="absolute top-3 right-3 z-10 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3.5 py-2.5 shadow-sm max-w-[270px] text-xs space-y-1"
        >
          {selectedRoute ? (
            <>
              <div className="font-semibold text-slate-900 truncate">
                {selectedRoute.path[0]?.name} →{' '}
                {selectedRoute.path[selectedRoute.path.length - 1]?.name}
              </div>
              <div className="flex items-center gap-3 font-mono text-slate-800">
                <span className="font-bold text-blue-700">
                  {selectedRoute.total_distance_km.toFixed(1)} km
                </span>
                <span className="text-slate-300">·</span>
                <span>{selectedRoute.total_time_min.toFixed(0)} min</span>
                <span className="text-slate-300">·</span>
                <span>
                  {selectedRoute.total_cost !== null
                    ? `$${selectedRoute.total_cost.toFixed(2)}`
                    : 'N/A'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                {selectedRoute.label} · {selectedRoute.segments.length} road leg
                {selectedRoute.segments.length === 1 ? '' : 's'}
              </div>
            </>
          ) : (
            sourceLoc &&
            destLoc &&
            directGeodesicKm !== null && (
              <>
                <div className="font-semibold text-slate-900 truncate">
                  {sourceLoc.name} → {destLoc.name}
                </div>
                <div className="font-mono text-slate-800">
                  Direct geodesic:{' '}
                  <span className="font-bold text-blue-700">
                    {directGeodesicKm.toFixed(1)} km
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Click &ldquo;Find Routes&rdquo; for highway distance &amp; ranking
                </div>
              </>
            )
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full h-[360px] sm:h-[430px]"
        aria-label="Interactive OpenStreetMap route visualization"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-700 inline-block" />
            Source
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-700 inline-block" />
            Destination
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-blue-700 inline-block" />
            Selected route
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 border-t-2 border-dashed border-slate-500 inline-block" />
            Alternative
          </span>
        </div>
        <span className="text-slate-500">Click any city or hub marker to set Source / Destination</span>
      </div>
    </div>
  );
}
