import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister } from '../shared/lib/api';
import type { ApiUser } from '../shared/lib/api';


type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, confirmPassword: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
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
    try { await apiLogout(); } catch {  }
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
