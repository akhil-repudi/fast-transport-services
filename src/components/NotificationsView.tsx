import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../api/client';
import type { NotificationItem, User } from '../types';

interface NotificationsViewProps {
  user: User | null;
  notifications: NotificationItem[];
  onRefresh: () => void;
  onRequireAuth: () => void;
}

export function NotificationsView({
  user,
  notifications,
  onRefresh,
  onRequireAuth,
}: NotificationsViewProps) {
  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-14 text-center space-y-4">
        <Bell className="w-8 h-8 text-slate-400 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">Sign in to view Notifications</h1>
        <p className="text-sm text-slate-600">
          Route optimization summaries and trip status updates appear here.
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

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function markOne(id: number) {
    await api.markNotificationRead(id);
    onRefresh();
  }

  async function markAll() {
    await api.markAllNotificationsRead();
    onRefresh();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-600">
            {unreadCount} unread alert{unreadCount === 1 ? '' : 's'}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <CheckCheck className="w-4 h-4 text-blue-700" />
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Bell className="w-7 h-7 text-slate-400 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900">No notifications yet</h2>
          <p className="text-sm text-slate-600">
            Search for a route or save a trip to generate route notifications.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          {notifications.map((n) => (
            <div
              key={n.notification_id}
              className={`p-4 sm:p-5 flex items-start justify-between gap-4 ${
                n.is_read ? 'bg-white' : 'bg-blue-50/40'
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium capitalize text-slate-700">{n.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(n.created_at).toLocaleString()}</span>
                  {!n.is_read && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-blue-700">Unread</span>
                    </>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                <p className="text-sm text-slate-600">{n.message}</p>
              </div>

              {!n.is_read && (
                <button
                  type="button"
                  onClick={() => markOne(n.notification_id)}
                  className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 shrink-0 cursor-pointer"
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
