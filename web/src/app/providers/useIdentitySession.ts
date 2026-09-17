
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
