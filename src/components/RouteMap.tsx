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

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [12.99, 77.61],
      zoom: 11,
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

  // Re-render network edges, location markers, and ranked routes
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const locById = new Map<number, LocationItem>();
    for (const loc of locations) {
      locById.set(loc.location_id, loc);
    }

    // 1. Subtle background road topology
    const drawnPairs = new Set<string>();
    for (const seg of roadNetwork) {
      const a = Math.min(seg.start_location_id, seg.end_location_id);
      const b = Math.max(seg.start_location_id, seg.end_location_id);
      const key = `${a}-${b}`;
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      const startLoc = locById.get(seg.start_location_id);
      const endLoc = locById.get(seg.end_location_id);
      if (!startLoc || !endLoc) continue;

      L.polyline(
        [
          [startLoc.latitude, startLoc.longitude],
          [endLoc.latitude, endLoc.longitude],
        ],
        {
          color: '#94a3b8',
          weight: 2,
          opacity: 0.45,
        }
      )
        .bindTooltip(
          `${seg.road_name || 'Road'}: ${seg.distance_km} km · ${seg.time_min} min`,
          { sticky: true }
        )
        .addTo(group);
    }

    // 2. Alternative routes (dashed muted slate)
    const selectedRoute =
      routes.find((r) => r.rank_number === selectedRank) || routes[0] || null;

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

    // 3. Selected / Recommended route (bold cobalt)
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
    }

    // 4. Location markers with interactive Source / Destination assignment popup
    const activeNodeIds = new Set(selectedRoute ? selectedRoute.node_ids : []);
    for (const loc of locations) {
      const isSource = loc.location_id === sourceId;
      const isDest = loc.location_id === destinationId;
      const isOnActivePath = activeNodeIds.has(loc.location_id);

      let fillColor = '#ffffff';
      let strokeColor = '#475569';
      let radius = 6;

      if (isSource) {
        fillColor = '#15803d';
        strokeColor = '#ffffff';
        radius = 9;
      } else if (isDest) {
        fillColor = '#b91c1c';
        strokeColor = '#ffffff';
        radius = 9;
      } else if (isOnActivePath) {
        fillColor = '#1d4ed8';
        strokeColor = '#ffffff';
        radius = 7;
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

      const popupContainer = document.createElement('div');
      popupContainer.className = 'text-xs space-y-2 min-w-[170px]';

      const title = document.createElement('div');
      title.className = 'font-semibold text-slate-900';
      title.textContent = loc.name;
      popupContainer.appendChild(title);

      if (loc.zone) {
        const sub = document.createElement('div');
        sub.className = 'text-slate-500';
        sub.textContent = `Zone: ${loc.zone}`;
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

    // 5. Fit bounds to selected route or all locations
    if (selectedRoute && selectedRoute.path.length >= 2) {
      const bounds = L.latLngBounds(
        selectedRoute.path.map((p) => [p.latitude, p.longitude] as [number, number])
      );
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 13 });
    } else if (locations.length > 0) {
      const bounds = L.latLngBounds(
        locations.map((l) => [l.latitude, l.longitude] as [number, number])
      );
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
    }
  }, [locations, roadNetwork, routes, selectedRank, sourceId, destinationId, onSelectSource, onSelectDestination]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div
        ref={containerRef}
        className="w-full h-[320px] sm:h-[380px]"
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
        <span className="text-slate-500">Click any map node to assign Source or Destination</span>
      </div>
    </div>
  );
}
