import { useCallback, useState } from 'react';
import type { ServerMessage, StorageUsage } from '@/shared/types/protocol';

/** The account's storage quota display — updated by the server after every
 * upload (or after one of the account's messages with files gets deleted).
 * The upload flow itself lives in stageFileInChunks/useMessageOutbox. */
export function useStorageUsage() {
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({ totalBytes: 0, totalFiles: 0, maxBytes: 0 });

  const onStorageUsage = useCallback((m: Extract<ServerMessage, { t: 'storage-usage' }>) => {
    setStorageUsage({ totalBytes: m.totalBytes, totalFiles: m.totalFiles, maxBytes: m.maxBytes });
  }, []);

  return { storageUsage, setStorageUsage, onStorageUsage };
}
