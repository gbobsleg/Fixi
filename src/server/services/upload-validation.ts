import { basename, extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { LIMITS } from '../../shared/types.js';

export interface ValidatedFile {
  /** Extension used for the stored file, derived from the real content (never from the client). */
  ext: string;
  mime: string;
}

/** Real content types accepted for the manual attachment, mapped to the stored extension. */
const BINARY_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const TEXT_EXTENSIONS: Record<string, string> = {
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

export class UploadError extends Error {
  constructor(
    public readonly code: 'too_large' | 'invalid_type',
    message: string,
  ) {
    super(message);
  }
}

/** The screenshot must really be a PNG (checked on the magic bytes, not on the filename). */
export async function validateScreenshot(buffer: Buffer): Promise<ValidatedFile> {
  assertSize(buffer);
  const detected = await fileTypeFromBuffer(buffer);
  if (detected?.mime !== 'image/png') throw new UploadError('invalid_type', 'screenshot must be a PNG image');
  return { ext: 'png', mime: 'image/png' };
}

/** Manual attachment: images, PDF, xlsx/xls (checked on content), csv/txt (checked as clean UTF-8). */
export async function validateAttachment(buffer: Buffer, originalName: string): Promise<ValidatedFile> {
  assertSize(buffer);
  const detected = await fileTypeFromBuffer(buffer);
  const clientExt = extname(originalName).toLowerCase();

  if (detected) {
    const ext = BINARY_TYPES[detected.mime];
    if (ext) return { ext, mime: detected.mime };
    // Legacy .xls files are OLE2/CFB containers: only accept them when named .xls.
    if (detected.mime === 'application/x-cfb' && clientExt === '.xls') {
      return { ext: 'xls', mime: 'application/vnd.ms-excel' };
    }
    throw new UploadError('invalid_type', `file type not allowed: ${detected.mime}`);
  }

  // No binary signature: only plain text formats are acceptable.
  const textMime = TEXT_EXTENSIONS[clientExt];
  if (!textMime) throw new UploadError('invalid_type', 'file type not allowed');
  if (buffer.includes(0)) throw new UploadError('invalid_type', 'text file contains binary data');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new UploadError('invalid_type', 'text file is not valid UTF-8');
  }
  return { ext: clientExt.slice(1), mime: textMime };
}

/** Strips directories and control characters from a client-provided filename. */
export function sanitizeOriginalName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.slice(0, 200) || 'attachment';
}

function assertSize(buffer: Buffer): void {
  if (buffer.length > LIMITS.maxFileBytes) throw new UploadError('too_large', 'file is larger than 5 MB');
}
