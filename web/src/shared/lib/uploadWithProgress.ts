import { ApiError } from './api';

/** Upload binario (anexo/avatar) com progresso real — `fetch` nao expoe
 * evento de progresso de UPLOAD (so de download, via o body da resposta),
 * entao isso usa XMLHttpRequest por baixo so por causa disso. */
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
    // equivalente a credentials:'same-origin' do fetch pras rotas /api/* —
    // toda URL usada aqui e relativa (mesma origem), entao manda cookie de
    // sessao igual.
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (e) => {
      // e.total===0 (arquivo vazio) daria 0/0 = NaN — nunca deveria chegar
      // aqui de verdade (servidor rejeita arquivo vazio), mas evita um
      // "NaN%" na tela se algum navegador disparar o evento mesmo assim.
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* resposta nao-JSON — trata como corpo vazio */ }
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
