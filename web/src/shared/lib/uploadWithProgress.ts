import { ApiError } from './api';

/** Binary upload (attachment/avatar) with real progress — `fetch` exposes
 * no UPLOAD progress event (only download, via the response body), so this
 * uses XMLHttpRequest underneath just for that. */
export interface UploadWithProgressOptions {
  url: string;
  file: Blob;
  headers?: Record<string, string>;
  onProgress?: (fraction: number) => void;
}

export function uploadWithProgress<T = unknown>({ url, file, headers, onProgress }: UploadWithProgressOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // equivalent to fetch's credentials:'same-origin' for /api/* routes —
    // every URL used here is relative (same origin), so it sends the
    // session cookie too.
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (e) => {
      // e.total===0 (empty file) would give 0/0 = NaN — should never
      // actually happen (server rejects empty files), but avoids a "NaN%"
      // on screen if some browser fires the event anyway.
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* non-JSON response — treated as empty body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null) || {};
      reject(new ApiError(xhr.status, err.code || 'unknown_error', err.message || 'Erro inesperado.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Falha de rede ao enviar o arquivo.'));
    xhr.send(file);
  });
}
