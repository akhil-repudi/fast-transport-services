import type {
  AdminDriver,
  AdminReports,
  LocationItem,
  NotificationItem,
  OptimizationPreference,
  PublicSettings,
  RankedRoute,
  RoadSegment,
  RouteSearchResponse,
  TripRecord,
  User,
  UserRole,
} from '../types';

const TOKEN_STORAGE_KEY = 'tros_access_token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

export const api = {
  getPublicSettings: () => request<PublicSettings>('/api/settings/public'),

  register: (payload: {
    name: string;
    email: string;
    password: string;
    role?: 'passenger' | 'driver';
    vehicle_number?: string;
  }) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    request<{ message: string }>('/api/auth/logout', {
      method: 'POST',
    }),

  me: () => request<{ user: User }>('/api/auth/me'),

  getLocations: (q = '') =>
    request<{ locations: LocationItem[] }>(
      `/api/locations${q ? `?q=${encodeURIComponent(q)}` : ''}`
    ),

  createLocation: (payload: { name: string; latitude: number; longitude: number; zone?: string }) =>
    request<{ location: LocationItem }>('/api/locations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLocation: (
    id: number,
    payload: { name: string; latitude: number; longitude: number; zone?: string }
  ) =>
    request<{ location: LocationItem }>(`/api/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteLocation: (id: number) =>
    request<{ deleted: boolean }>(`/api/locations/${id}`, { method: 'DELETE' }),

  getRoutes: () => request<{ routes: RoadSegment[] }>('/api/routes'),

  createRoute: (payload: {
    start_location_id: number;
    end_location_id: number;
    distance_km: number;
    time_min: number;
    cost: number | null;
    road_name: string;
    road_type: string;
    bidirectional: boolean;
  }) =>
    request<{ route: RoadSegment }>('/api/routes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateRoute: (
    id: number,
    payload: {
      distance_km: number;
      time_min: number;
      cost: number | null;
      road_name: string;
      road_type: string;
    }
  ) =>
    request<{ route: RoadSegment }>(`/api/routes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteRoute: (id: number) =>
    request<{ deleted: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }),

  searchRoutes: (payload: {
    source_id: number | '';
    destination_id: number | '';
    preference: OptimizationPreference;
  }) =>
    request<RouteSearchResponse>('/api/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveTrip: (payload: {
    source_id: number;
    destination_id: number;
    preference: OptimizationPreference;
    selected_rank: number;
    routes: RankedRoute[];
  }) =>
    request<{ trip_id: number; status: string }>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getTrips: () => request<{ trips: TripRecord[] }>('/api/trips'),

  updateTripStatus: (tripId: number, status: string, remarks = '') =>
    request<{ trip_id: number; status: string }>(`/api/trips/${tripId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, remarks }),
    }),

  getDriverTrips: () => request<{ trips: TripRecord[] }>('/api/driver/trips'),

  getNotifications: () =>
    request<{ notifications: NotificationItem[]; unread_count: number }>('/api/notifications'),

  markNotificationRead: (id: number) =>
    request<{ updated: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),

  markAllNotificationsRead: () =>
    request<{ updated: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  getAdminUsers: () => request<{ users: User[] }>('/api/admin/users'),

  updateAdminUserRole: (userId: number, role: UserRole) =>
    request<{ user_id: number; role: UserRole }>(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  getAdminDrivers: () => request<{ drivers: AdminDriver[] }>('/api/admin/drivers'),

  assignTripDriver: (tripId: number, driverId: number) =>
    request<{ trip_id: number; assigned_driver_id: number; status: string }>(
      `/api/admin/trips/${tripId}/assign`,
      {
        method: 'PATCH',
        body: JSON.stringify({ driver_id: driverId }),
      }
    ),

  getAdminReports: () => request<AdminReports>('/api/admin/reports'),

  getAdminSettings: () =>
    request<{ settings: Record<string, string | boolean> }>('/api/admin/settings'),

  updateAdminSettings: (payload: Record<string, string | boolean>) =>
    request<{ updated: boolean }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
