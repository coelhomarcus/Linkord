import { useCallback, useState } from 'react';
import { uploadFileInChunks } from '@/shared/lib/chunkedUpload';
import type { ServerMessage, StorageUsage } from '@/shared/types/protocol';

export interface SendAttachmentsRequest {
  conversationId: string;
  files: File[];
  caption: string;
  replyTo?: number;
  /** Continues a batch whose earlier files already created this message —
   * set when retrying after a PartialAttachmentError, so the files that did
   * go out aren't published a second time. */
  targetMsgId?: number;
  onProgress?: (fileIndex: number, fraction: number) => void;
  /** Fires as each file is published, which is what lets a caller retry only
   * the files after a failure. */
  onFileSent?: (fileIndex: number, msgId: number) => void;
}

/** Some files of the batch went out (as message `msgId`) and the one at
 * `failedIndex` did not. Nothing after it was attempted. */
export class PartialAttachmentError extends Error {
  msgId: number;
  failedIndex: number;
  totalCount: number;
  constructor(msgId: number, failedIndex: number, totalCount: number, cause: unknown) {
    super(`partial_attachment_failure: ${failedIndex}/${totalCount}`, { cause });
    this.msgId = msgId;
    this.failedIndex = failedIndex;
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

  const sendAttachments = useCallback(async ({
    conversationId, files, caption, replyTo, targetMsgId, onProgress, onFileSent,
  }: SendAttachmentsRequest): Promise<void> => {
    if (!files.length) return;
    let msgId = targetMsgId;
    let startIndex = 0;
    if (msgId == null) {
      // a failure here published nothing, so it propagates as-is and the
      // whole batch is safe to resend
      msgId = await uploadFileInChunks({ conversationId, file: files[0]!, caption, replyTo, onProgress: (f) => onProgress?.(0, f) });
      onFileSent?.(0, msgId);
      startIndex = 1;
    }
    for (let i = startIndex; i < files.length; i++) {
      try {
        await uploadFileInChunks({ conversationId, file: files[i]!, caption: '', targetMsgId: msgId, onProgress: (f) => onProgress?.(i, f) });
      } catch (err) {
        throw new PartialAttachmentError(msgId, i, files.length, err);
      }
      onFileSent?.(i, msgId);
    }
  }, []);

  const onStorageUsage = useCallback((m: Extract<ServerMessage, { t: 'storage-usage' }>) => {
    setStorageUsage({ totalBytes: m.totalBytes, totalFiles: m.totalFiles, maxBytes: m.maxBytes });
  }, []);

  return { storageUsage, setStorageUsage, sendAttachments, onStorageUsage };
}
