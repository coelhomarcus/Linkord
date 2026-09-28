import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Imported FIRST (for its side effect) by tests that write files: config/env.ts
// reads UPLOAD_DIR once at import, so it has to be set before anything pulls
// config in — otherwise uploads land in the dev server's real uploads/ folder.
export const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkord-itest-uploads-'));
process.env.UPLOAD_DIR = uploadDir;
