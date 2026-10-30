// Storage wrapper. Today: local filesystem under DATA_DIR (mounted volume in
// prod). Everything else talks to this interface, so swapping in S3/R2 later
// means changing one file (portability rule from the dev guide).
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface Storage {
  /** Save bytes and return a storage key (relative path). */
  put(bytes: Uint8Array, ext: string): Promise<string>;
  /** Delete a stored file. Missing files are not an error. */
  remove(key: string): Promise<void>;
  /** Absolute path on disk for a key (used by the static file route). */
  absolutePath(key: string): string;
  /** Public URL path for a key. */
  publicPath(key: string): string;
}

export class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.root, "media"), { recursive: true });
  }

  async put(bytes: Uint8Array, ext: string): Promise<string> {
    const key = `media/${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${ext}`;
    await fs.writeFile(path.join(this.root, key), bytes);
    return key;
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.absolutePath(key), { force: true });
  }

  absolutePath(key: string): string {
    const abs = path.resolve(this.root, key);
    if (!abs.startsWith(path.resolve(this.root))) throw new Error("Invalid storage key");
    return abs;
  }

  publicPath(key: string): string {
    return `/${key}`;
  }
}
