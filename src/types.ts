export type UserRole = 'passenger' | 'driver' | 'admin';

export type OptimizationPreference = 'shortest' | 'fastest' | 'cheapest';

export type TripStatus = 'saved' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export interface User {
  user_id: number;
  name: string;
  email: string;
  role: UserRole;
  created_at?: string;
  driver_id?: number | null;
  vehicle_number?: string | null;
  availability?: string | null;
}

export interface LocationItem {
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
  zone: string;
}

export interface RoadSegment {
  route_id: number;
  start_location_id: number;
  end_location_id: number;
  start_name: string;
  end_name: string;
  distance_km: number;
  time_min: number;
  cost: number | null;
  road_name: string;
  road_type: string;
}

export interface RouteSegmentDetail {
  route_id: number;
  start_location_id: number;
  end_location_id: number;
  distance_km: number;
  time_min: number;
  cost: number | null;
  road_name: string;
  road_type: string;
}

export interface RoutePathNode {
  location_id: number;
  name: string;
  latitude: number;
  longitude: number;
}

export interface RankedRoute {
  rank_number: number;
  recommended: boolean;
  label: string;
  score: number | null;
  node_ids: number[];
  path: RoutePathNode[];
  segments: RouteSegmentDetail[];
  primary_route_id: number | null;
  total_distance_km: number;
  total_time_min: number;
  total_cost: number | null;
  cost_available: boolean;
  data_source: 'sample' | 'live';
  highlights?: string[];
}

export interface TrafficApiStatus {
  live_available: boolean;
  fallback_used: boolean;
  data_source: 'sample' | 'live';
  message: string;
}

export interface RouteSearchResponse {
  found: boolean;
  preference: OptimizationPreference;
  source: { location_id: number; name: string };
  destination: { location_id: number; name: string };
  routes: RankedRoute[];
  cost_unavailable: boolean;
  data_source: 'sample' | 'live';
  message: string;
  traffic_api: TrafficApiStatus;
}

export interface SavedRouteResult {
  result_id: number;
  route_id: number | null;
  rank_number: number;
  score: number | null;
  path: Array<{ location_id: number; name: string; latitude?: number; longitude?: number }>;
  total_distance_km: number;
  total_time_min: number;
  total_cost: number | null;
  data_source: 'sample' | 'live';
  is_selected: number;
}

export interface TripStatusLog {
  log_id: number;
  status: string;
  updated_at: string;
  remarks: string;
}

export interface TripRecord {
  trip_id: number;
  passenger_id: number;
  passenger_name: string;
  source_id: number;
  source_name: string;
  destination_id: number;
  destination_name: string;
  preference: OptimizationPreference;
  status: TripStatus;
  assigned_driver_id: number | null;
  driver_name: string | null;
  driver_vehicle: string | null;
  created_at: string;
  results: SavedRouteResult[];
  status_logs: TripStatusLog[];
}

export interface NotificationItem {
  notification_id: number;
  title: string;
  message: string;
  category: string;
  is_read: number;
  created_at: string;
}

export interface PublicSettings {
  enable_driver_role: boolean;
  default_preference: OptimizationPreference;
  system_notice: string;
}

export interface AdminDriver {
  driver_id: number;
  user_id: number;
  name: string;
  email: string;
  vehicle_number: string;
  availability: string;
}

export interface AdminReports {
  totals: {
    users: number;
    locations: number;
    routes: number;
    trips: number;
  };
  trips_by_preference: Array<{ preference: string; count: number }>;
  trips_by_status: Array<{ status: string; count: number }>;
  popular_corridors: Array<{ source_name: string; destination_name: string; trip_count: number }>;
}

export interface ToastMessage {
  id: number;
  title: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}
