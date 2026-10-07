import { useOutletContext } from 'react-router';
import type { AdminMode } from './useAdminLayout';

export interface AdminOutletContext {
  mode: AdminMode;
}

/** Lets a routed page know which navigation surface is showing (the bare
 * /admin entry is the index in compact and a redirect in wide). */
export function useAdminMode(): AdminMode {
  return useOutletContext<AdminOutletContext>().mode;
}
