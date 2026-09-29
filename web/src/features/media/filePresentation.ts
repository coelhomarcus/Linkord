import { Archive, File, FileCode, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo2, Presentation } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type FileFamily = 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'text-code' | 'image' | 'audio' | 'video' | 'unknown';

export interface FilePresentation {
  family: FileFamily;
  /** The word shown next to the size, e.g. "Documento PDF" — never the raw MIME. */
  typeLabel: string;
  icon: LucideIcon;
  /** Small corner marker on the icon — only PDF gets one; every other family
   * relies on its own icon shape, not color, to read as distinct (see the
   * plan's "diferenciáveis sem depender de cor" requirement). */
  badge?: string;
  iconBgClassName: string;
  iconTextClassName: string;
  /** Name split so a truncated display can keep the extension visible. */
  baseName: string;
  /** Without the leading dot; original casing, e.g. "PDF" stays "PDF". */
  extension: string;
}

// Same list as server/src/modules/attachments.ts#TEXT_PREVIEW_EXTENSIONS and
// web/src/features/chat/ChatAttachment.tsx#TEXT_PREVIEW_EXTENSIONS — kept as
// three separate copies (no shared package between them, and importing the
// chat one here would create features/media <-> features/chat import cycle)
// instead of one shared source.
const TEXT_CODE_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'log', 'env',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php',
  'sh', 'bash', 'sql', 'css', 'scss', 'html', 'vue', 'toml', 'ini', 'diff', 'patch',
]);

const COMPOUND_EXTENSIONS = ['tar.gz', 'tar.bz2', 'tar.xz'];

const MIME_FAMILY: Partial<Record<string, FileFamily>> = {
  'application/pdf': 'pdf',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/rtf': 'document',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
  'application/zip': 'archive',
  'application/x-zip-compressed': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/vnd.rar': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive',
  'application/x-gzip': 'archive',
  'application/x-bzip2': 'archive',
};

const EXT_FAMILY: Partial<Record<string, FileFamily>> = {
  pdf: 'pdf',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive',
  'tar.gz': 'archive', 'tar.bz2': 'archive', 'tar.xz': 'archive',
};

const FAMILY_LABEL: Record<FileFamily, string> = {
  pdf: 'Documento PDF',
  document: 'Documento',
  spreadsheet: 'Planilha',
  presentation: 'Apresentação',
  archive: 'Arquivo compactado',
  'text-code': 'Texto/código',
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  unknown: 'Arquivo',
};

const FAMILY_ICON: Record<FileFamily, LucideIcon> = {
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: Archive,
  'text-code': FileCode,
  image: FileImage,
  audio: FileMusic,
  video: FileVideo2,
  unknown: File,
};

// Reinforcement only (rule: "usar cor apenas como reforço") — every family
// already has a distinct icon shape; these just add a second signal.
const FAMILY_COLOR: Record<FileFamily, { bg: string; text: string }> = {
  pdf: { bg: 'bg-red/10', text: 'text-red' },
  document: { bg: 'bg-blue/10', text: 'text-blue' },
  spreadsheet: { bg: 'bg-green/10', text: 'text-green' },
  presentation: { bg: 'bg-orange/10', text: 'text-orange' },
  archive: { bg: 'bg-yellow/10', text: 'text-yellow' },
  'text-code': { bg: 'bg-purple/10', text: 'text-purple' },
  image: { bg: 'bg-bg-secondary', text: 'text-text-muted' },
  audio: { bg: 'bg-bg-secondary', text: 'text-text-muted' },
  video: { bg: 'bg-bg-secondary', text: 'text-text-muted' },
  unknown: { bg: 'bg-bg-secondary', text: 'text-text-muted' },
};

/** Splits a file name so a display can truncate only the base and always
 * keep the extension readable. A dotfile with no other dot ("`.env`") has
 * no extension — the whole name is the base. */
export function splitFileName(name: string): { baseName: string; extension: string } {
  const trimmed = name.trim();
  if (!trimmed) return { baseName: '', extension: '' };
  const lower = trimmed.toLowerCase();
  for (const compound of COMPOUND_EXTENSIONS) {
    if (lower.endsWith(`.${compound}`)) {
      return { baseName: trimmed.slice(0, -(compound.length + 1)), extension: trimmed.slice(-compound.length) };
    }
  }
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) return { baseName: trimmed, extension: '' };
  return { baseName: trimmed.slice(0, lastDot), extension: trimmed.slice(lastDot + 1) };
}

function normalizeMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}

function familyFromMime(mime: string): FileFamily | null {
  const specific = MIME_FAMILY[mime];
  if (specific) return specific;
  if (mime.startsWith('text/')) return 'text-code';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function familyFromExtension(extension: string): FileFamily | null {
  const ext = extension.toLowerCase();
  return EXT_FAMILY[ext] ?? (TEXT_CODE_EXTENSIONS.has(ext) ? 'text-code' : null);
}

/** Pure classification for a file's identity — used by the draft tray, the
 * pending (outbox) chip and the published card, so the same file reads the
 * same everywhere. Never fetches, never decides what can be previewed
 * inline: that stays with each surface's own renderer selection. */
export function presentFile(name: string, mime: string): FilePresentation {
  const normalizedMime = normalizeMime(mime);
  const { baseName, extension } = splitFileName(name);
  const family = familyFromMime(normalizedMime) ?? familyFromExtension(extension) ?? 'unknown';
  const color = FAMILY_COLOR[family];
  return {
    family,
    typeLabel: FAMILY_LABEL[family],
    icon: FAMILY_ICON[family],
    badge: family === 'pdf' ? 'PDF' : undefined,
    iconBgClassName: color.bg,
    iconTextClassName: color.text,
    baseName: baseName || name,
    extension,
  };
}
