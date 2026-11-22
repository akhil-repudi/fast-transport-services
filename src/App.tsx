import { useCallback, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './api/client';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthView } from './components/AuthView';
import { DriverView } from './components/DriverView';
import { NotificationsView } from './components/NotificationsView';
import { RoutePlanner } from './components/RoutePlanner';
import { TripHistory } from './components/TripHistory';
import type {
  NotificationItem,
  PublicSettings,
  ToastMessage,
  User,
} from './types';

type ScreenKey = 'auth' | 'planner' | 'trips' | 'notifications' | 'driver' | 'admin';

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [publicSettings, setPublicSettings] = useState<PublicSettings>({
    enable_driver_role: true,
    default_preference: 'shortest',
    system_notice: 'Prototype network using seeded sample route metrics (not live traffic).',
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback(
    (
      title: string,
      message: string,
      tone: 'info' | 'success' | 'warning' | 'error' = 'info'
    ) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev.slice(-3), { id, title, message, tone }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const loadSettings = useCallback(async () => {
    try {
      const settings = await api.getPublicSettings();
      setPublicSettings(settings);
    } catch {
      // keep defaults
    }
  }, []);

  const loadNotifications = useCallback(async (activeUser: User | null) => {
    if (!activeUser) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const res = await api.getNotifications();
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
    } catch {
      // ignore
    }
  }, []);

  // Restore session & read hash route on startup
  useEffect(() => {
    let active = true;
    async function init() {
      await loadSettings();
      const token = getStoredToken();
      let restoredUser: User | null = null;
      if (token) {
        try {
          const meRes = await api.me();
          restoredUser = meRes.user;
        } catch {
          setStoredToken(null);
        }
      }
      if (!active) return;
      setUser(restoredUser);
      await loadNotifications(restoredUser);

      const hash = window.location.hash.replace('#', '') as ScreenKey;
      if (['planner', 'trips', 'notifications', 'driver', 'admin', 'auth'].includes(hash)) {
        setScreen(hash);
      } else if (restoredUser) {
        setScreen(restoredUser.role === 'driver' ? 'driver' : 'planner');
      } else {
        setScreen('auth');
      }
      setBootstrapped(true);
    }
    init();
    return () => {
      active = false;
    };
  }, [loadNotifications, loadSettings]);

  const navigate = useCallback((target: ScreenKey) => {
    setScreen(target);
    setMobileMenuOpen(false);
    window.location.hash = target;
  }, []);

  async function handleAuthenticated(loggedInUser: User) {
    setUser(loggedInUser);
    await loadNotifications(loggedInUser);
    pushToast('Signed in', `Welcome back, ${loggedInUser.name} (${loggedInUser.role}).`, 'success');
    if (loggedInUser.role === 'driver' && publicSettings.enable_driver_role) {
      navigate('driver');
    } else if (loggedInUser.role === 'admin') {
      navigate('admin');
    } else {
      navigate('planner');
    }
  }

  async function handleSignOut() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setNotifications([]);
    setUnreadCount(0);
    pushToast('Signed out', 'You have been logged out.', 'info');
    navigate('auth');
  }

  const navItems: Array<{ key: ScreenKey; label: string }> = [
    { key: 'planner', label: 'Route Planner' },
    { key: 'trips', label: 'Trip History' },
    {
      key: 'notifications',
      label: unreadCount > 0 ? `Notifications (${unreadCount})` : 'Notifications',
    },
    ...(publicSettings.enable_driver_role ? [{ key: 'driver' as const, label: 'Driver' }] : []),
    { key: 'admin', label: 'Admin' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => navigate('planner')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            RouteOptima
          </button>

          {/* Zone 2: Concise single-line nav links */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            {navItems.map((item) => {
              const active = screen === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.key)}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-blue-700 text-slate-900 font-semibold'
                      : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="px-4 py-2 text-xs font-medium text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign Out ({user.name.split(' ')[0]})
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('auth')}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-lg border border-slate-200 text-slate-700 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile navigation drawer */}
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-slate-200 bg-white px-4 py-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.key)}
                className={`text-left px-3 py-2 rounded-lg text-sm font-medium cursor-pointer ${
                  screen === item.key
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {!bootstrapped ? (
          <div className="max-w-5xl mx-auto px-4 py-16 text-center text-sm text-slate-500">
            Loading Transport Route Optimization System...
          </div>
        ) : (
          <>
            {screen === 'auth' && (
              <AuthView
                enableDriverRole={publicSettings.enable_driver_role}
                onAuthenticated={handleAuthenticated}
                onContinueAsGuest={() => navigate('planner')}
              />
            )}

            {screen === 'planner' && (
              <RoutePlanner
                user={user}
                defaultPreference={publicSettings.default_preference}
                onRequireAuth={() => navigate('auth')}
                onNotify={pushToast}
                onTripSaved={async () => {
                  await loadNotifications(user);
                }}
              />
            )}

            {screen === 'trips' && (
              <TripHistory
                user={user}
                onRequireAuth={() => navigate('auth')}
                onNotify={pushToast}
              />
            )}

            {screen === 'notifications' && (
              <NotificationsView
                user={user}
                notifications={notifications}
                onRefresh={() => loadNotifications(user)}
                onRequireAuth={() => navigate('auth')}
              />
            )}

            {screen === 'driver' && (
              <DriverView
                user={user}
                enableDriverRole={publicSettings.enable_driver_role}
                onRequireAuth={() => navigate('auth')}
                onNotify={pushToast}
              />
            )}

            {screen === 'admin' && (
              <AdminDashboard
                user={user}
                onSettingsChanged={loadSettings}
                onRequireAuth={() => navigate('auth')}
                onNotify={pushToast}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            Transport Route Optimization System · Software Engineering PBL Prototype
          </span>
          <span>{publicSettings.system_notice}</span>
        </div>
      </footer>

      {/* In-app Toast Stack */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0 pointer-events-none"
        >
          {toasts.map((t) => {
            const borderTone =
              t.tone === 'error'
                ? 'border-red-300 bg-red-50 text-red-900'
                : t.tone === 'warning'
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : t.tone === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-slate-200 bg-white text-slate-900';

            return (
              <div
                key={t.id}
                className={`pointer-events-auto border rounded-xl p-3.5 shadow-md flex items-start justify-between gap-3 ${borderTone}`}
              >
                <div className="space-y-0.5 text-xs">
                  <div className="font-semibold">{t.title}</div>
                  <div className="opacity-90">{t.message}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                  aria-label="Dismiss notification"
                  className="opacity-60 hover:opacity-100 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
