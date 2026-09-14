import { createReadStream, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Filesystem stand-in for the object store, used when no bucket is configured.
 *
 * It exists so the whole prediction flow can be exercised on a developer machine
 * without cloud credentials. The Explanation payload is served through NestJS
 * rather than by URL, so nothing about that path changes; the PNG plots, which
 * are handed to the browser as signed URLs, are the part this cannot stand in for.
 */
export class LocalStorageDriver {
  constructor(private readonly root: string) {
    mkdirSync(this.root, { recursive: true });
  }

  /** Resolve a key under the root, refusing anything that climbs out of it. */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    const rootResolved = resolve(this.root);
    if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
      throw new Error(
        `key "${key}" resolves outside the storage root (${relative(rootResolved, full)})`,
      );
    }
    return full;
  }

  async save(key: string, data: Buffer): Promise<string> {
    const path = this.pathFor(key);
    mkdirSync(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }
}
