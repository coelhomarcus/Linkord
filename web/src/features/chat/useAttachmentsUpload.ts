import { useCallback, useState } from 'react';
import { uploadFileInChunks } from '@/shared/lib/chunkedUpload';
import type { ServerMessage, StorageUsage } from '@/shared/types/protocol';

export class PartialAttachmentError extends Error {
  sentCount: number;
  totalCount: number;
  constructor(sentCount: number, totalCount: number) {
    super(`partial_attachment_failure: ${sentCount}/${totalCount}`);
    this.sentCount = sentCount;
    this.totalCount = totalCount;
  }
}

/** Storage quota display + the chunked multi-file upload flow. The actual
 * per-message text/attachment insertion happens server-side (chat.ts) and
 * arrives back as ordinary 'chat'/'chat-attachment-added' messages, handled
 * by useChatMessages — this hook only drives the upload requests and the
 * quota readout. */
export function useAttachmentsUpload() {
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({ totalBytes: 0, totalFiles: 0, maxBytes: 0 });

  const sendAttachments = useCallback(async (
    conversationId: string, files: File[], caption: string, onProgress?: (fileIndex: number, fraction: number) => void
  ): Promise<void> => {
    if (!files.length) return;
    const msgId = await uploadFileInChunks({ conversationId, file: files[0]!, caption, onProgress: (f) => onProgress?.(0, f) });
    for (let i = 1; i < files.length; i++) {
      try {
        await uploadFileInChunks({ conversationId, file: files[i]!, caption: '', targetMsgId: msgId, onProgress: (f) => onProgress?.(i, f) });
      } catch {
        throw new PartialAttachmentError(i, files.length);
      }
    }
  }, []);

  const onStorageUsage = useCallback((m: Extract<ServerMessage, { t: 'storage-usage' }>) => {
    setStorageUsage({ totalBytes: m.totalBytes, totalFiles: m.totalFiles, maxBytes: m.maxBytes });
  }, []);

  return { storageUsage, setStorageUsage, sendAttachments, onStorageUsage };
}
