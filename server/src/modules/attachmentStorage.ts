import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config/env.js';

// Shared by every other attachment* module (uploads, serving, avatar, core
// CRUD) — kept in its own leaf file, with no dependency on anything else
// attachment-related, so none of those modules end up importing each other
// in a cycle just to get an id/path.

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function filePathFor(id: string): string {
  return path.join(config.UPLOAD_DIR, id);
}
