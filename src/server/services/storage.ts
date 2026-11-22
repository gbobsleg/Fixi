import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Stored files are named `<uuid>.<ext>` and live outside any public web root. */
export const STORED_NAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

export class StorageService {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  /** Writes the buffer under a random name and returns that name. */
  async save(buffer: Buffer, ext: string): Promise<string> {
    const name = `${randomUUID()}.${ext}`;
    await writeFile(resolve(this.dir, name), buffer, { flag: 'wx' });
    return name;
  }

  /** Absolute path of a stored file, or null if the name is not a valid stored name. */
  pathFor(name: string): string | null {
    return STORED_NAME_PATTERN.test(name) ? resolve(this.dir, name) : null;
  }

  async exists(name: string): Promise<boolean> {
    const path = this.pathFor(name);
    if (!path) return false;
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }

  /** Deletes a file. Returns false if it was already missing (ENOENT); rethrows other errors. */
  async remove(name: string): Promise<boolean> {
    const path = this.pathFor(name);
    if (!path) return false;
    try {
      await unlink(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}
