import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail, MapPin, User as UserIcon } from 'lucide-react';
import { api, ApiError, setStoredToken } from '../api/client';
import type { User } from '../types';

interface AuthViewProps {
  enableDriverRole: boolean;
  onAuthenticated: (user: User) => void;
  onContinueAsGuest: () => void;
}

const DEMO_ACCOUNTS = [
  {
    label: 'Passenger',
    email: 'passenger@demo.local',
    password: 'pass1234',
    note: 'Search, compare, save trips',
  },
  {
    label: 'Driver',
    email: 'driver@demo.local',
    password: 'driver1234',
    note: 'Assigned trips & status updates',
  },
  {
    label: 'Administrator',
    email: 'admin@demo.local',
    password: 'admin1234',
    note: 'Users, roads, settings, reports',
  },
];

export function AuthView({
  enableDriverRole,
  onAuthenticated,
  onContinueAsGuest,
}: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('Full name is required to create an account.');
      return;
    }

    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login({ email: email.trim(), password })
          : await api.register({
              name: name.trim(),
              email: email.trim(),
              password,
              role,
              vehicle_number: role === 'driver' ? vehicleNumber.trim() : undefined,
            });
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to connect to authentication service.');
      }
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(account: (typeof DEMO_ACCOUNTS)[number]) {
    setMode('login');
    setEmail(account.email);
    setPassword(account.password);
    setError('');
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 lg:py-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left column: Clear PBL Overview */}
        <div className="lg:col-span-7 space-y-6">
          <div className="text-xs font-medium text-blue-700 tracking-wide">
            Software Engineering PBL Prototype · Sample Transit Network
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight max-w-2xl">
            Transport Route Optimization System
          </h1>
          <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
            Compare multi-stop route alternatives between regional hubs using Dijkstra&apos;s
            shortest-path algorithm. Rank candidates by distance, travel duration, or estimated
            cost, inspect paths on an interactive OpenStreetMap canvas, and persist saved trips.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-sm font-semibold text-slate-900">Dijkstra Engine</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Computes shortest, fastest, and lowest-cost paths plus edge-penalized alternatives.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-sm font-semibold text-slate-900">Honest Sample Data</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                14 seeded hubs and 48 directional road segments. Clearly labeled as non-live estimates.
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-sm font-semibold text-slate-900">Role-Based Access</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Passenger trip history, optional Driver dispatch view, and Admin network management.
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onContinueAsGuest}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <MapPin className="w-4 h-4 text-blue-700" />
              Open Route Planner without signing in
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
            <span className="text-xs text-slate-500">
              Sign in is required to save trips or view history.
            </span>
          </div>
        </div>

        {/* Right column: Sign In / Register Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-7 space-y-6">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="auth-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full pl-9 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && enableDriverRole && (
              <div className="space-y-3 pt-1">
                <div>
                  <label htmlFor="auth-role" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Account Role
                  </label>
                  <select
                    id="auth-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'passenger' | 'driver')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="passenger">Passenger (Search &amp; Save Trips)</option>
                    <option value="driver">Driver (Assigned Trip Updates)</option>
                  </select>
                </div>
                {role === 'driver' && (
                  <div>
                    <label
                      htmlFor="auth-vehicle"
                      className="block text-sm font-medium text-slate-700 mb-1.5"
                    >
                      Vehicle Number
                    </label>
                    <input
                      id="auth-vehicle"
                      type="text"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value)}
                      placeholder="e.g. KA-01-TR-8840"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {loading
                ? 'Submitting...'
                : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
            </button>
          </form>

          {/* Demo credentials */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="text-xs font-semibold text-slate-700">
              Demo Credentials (click to autofill)
            </div>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.filter((acc) => enableDriverRole || acc.label !== 'Driver').map(
                (acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => fillDemo(acc)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-left transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{acc.label}</div>
                      <div className="text-[11px] text-slate-500">{acc.note}</div>
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 text-right">
                      <div>{acc.email}</div>
                      <div>{acc.password}</div>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
