import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister } from '../shared/lib/api';
import type { ApiUser } from '../shared/lib/api';

// Owns the logged-in account (or lack of one). Lives ABOVE RoomProvider on
// purpose: RoomProvider should only mount (and open the socket) once a
// session already exists — there must never be an anonymous socket.
// 'loading' is the initial state (checking /api/auth/me) so the login
// screen doesn't flash before knowing whether a valid cookie exists.

type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, confirmPassword: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-queries /api/auth/me — used when the socket rejects the handshake
   * (session expired/revoked in another tab) to fall back to the login
   * screen without waiting for a page reload. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() usado fora de <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await fetchMe();
      setUser(u);
      setStatus('authed');
    } catch {
      setUser(null);
      setStatus('anon');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const { user: u } = await apiLogin(username, password);
    setUser(u);
    setStatus('authed');
  }, []);

  const register = useCallback(async (username: string, password: string, confirmPassword: string, code: string) => {
    const { user: u } = await apiRegister(username, password, confirmPassword, code);
    setUser(u);
    setStatus('authed');
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* forget locally even if the server call fails */ }
    setUser(null);
    setStatus('anon');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export { ApiError };
