import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister } from '../shared/lib/api';
import type { ApiUser } from '../shared/lib/api';

// ---------------------------------------------------------------------------
// Dono da conta logada (ou nao). Fica ACIMA do RoomProvider de proposito: o
// RoomProvider so deve montar (e abrir o socket) quando ja existe sessao —
// nunca deve existir socket anonimo. 'loading' e o estado inicial (checando
// /api/auth/me) pra nao piscar a tela de login antes de saber se ja ha
// cookie valido.
// ---------------------------------------------------------------------------

type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, confirmPassword: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Reconsulta /api/auth/me — usado quando o socket rejeita o handshake
   * (sessao expirada/revogada em outra aba) pra cair de volta na tela de
   * login sem esperar o usuario recarregar a pagina. */
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
    try { await apiLogout(); } catch { /* mesmo se falhar no servidor, esquece localmente */ }
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
