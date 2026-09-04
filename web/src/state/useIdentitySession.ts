/** Identidade (id + token) persistida no sessionStorage — por aba, pra uma
 * reconexao (queda de rede, reload da mesma aba) retomar a mesma pessoa
 * sem duplicar na lista de participantes. */

interface StoredIdentity {
  id: string;
  token: string;
}

const KEY = 'ss-identity';

export function loadIdentity(): StoredIdentity | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveIdentity(id: string, token: string): void {
  sessionStorage.setItem(KEY, JSON.stringify({ id, token }));
}
