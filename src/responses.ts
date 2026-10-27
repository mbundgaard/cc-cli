import { mkdtemp, open, rename, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { protectDirectory, privateSubdirectory } from './private-files.js';
import { Writable } from 'node:stream';
import { CliError } from './output.js';

export const INLINE_MAX_BYTES = 16 * 1024;
export const INLINE_MAX_LINES = 500;

export type Delivery = { kind: 'inline'; body: Buffer } | {
  kind: 'file'; path: string; uri: string; bytes: number; lines: number; sha256: string;
};

// Counts and hashes bytes, but never parses the response. Only the small inline
// candidate stays in memory; exceeding either threshold spills it and all later
// decoded chunks to a private file with stream backpressure.
export class ResponseCollector extends Writable {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private breaks = 0;
  private lastByte = 10;
  private hash = createHash('sha256');
  private directory?: string;
  private handle?: FileHandle;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly baseDirectory: string, private readonly forceFile = false) { super({ highWaterMark: 64 * 1024 }); }
  private get lines() { return this.breaks + (this.bytes && this.lastByte !== 10 ? 1 : 0); }
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.pending = this.accept(chunk);
    this.pending.then(() => done(), error => done(error));
  }
  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    // Cancellation must not race directory creation or an in-flight disk write.
    this.pending.then(() => done(error), () => done(error));
  }
  private async accept(chunk: Buffer): Promise<void> {
    this.bytes += chunk.length;
    if (chunk.length) this.lastByte = chunk[chunk.length - 1]!;
    for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) this.breaks++;
    this.hash.update(chunk);
    if (!this.forceFile && !this.handle && this.bytes <= INLINE_MAX_BYTES && this.lines <= INLINE_MAX_LINES) {
      this.chunks.push(Buffer.from(chunk)); return;
    }
    try {
      if (!this.handle) {
        const root = await privateSubdirectory(this.baseDirectory, ['responses'], true);
        this.directory = await mkdtemp(path.join(root, 'response-'));
        await protectDirectory(this.directory);
        this.handle = await open(path.join(this.directory, 'response.part'), 'wx', 0o600);
        for (const buffered of this.chunks) await this.handle.writeFile(buffered);
        this.chunks = [];
      }
      await this.handle.writeFile(chunk);
    } catch {
      throw new CliError(1, 'Cannot store CC response securely; no response was delivered', 'Check private storage permissions and free disk space. No retry was made.');
    }
  }
  async complete(): Promise<Delivery> {
    if (this.forceFile && !this.handle) await this.accept(Buffer.alloc(0));
    if (!this.directory) return { kind: 'inline', body: Buffer.concat(this.chunks) };
    try {
      await this.handle!.sync(); await this.handle!.close(); this.handle = undefined;
      const file = path.join(this.directory, 'response.body');
      await rename(path.join(this.directory, 'response.part'), file);
      return { kind: 'file', path: file, uri: pathToFileURL(file).href, bytes: this.bytes, lines: this.lines, sha256: this.hash.digest('hex') };
    } catch {
      throw new CliError(1, 'Cannot finalize CC response file; no response was delivered', 'Check private storage permissions and free disk space. No retry was made.');
    }
  }
  async discard(): Promise<void> {
    await this.pending.catch(() => {});
    try {
      if (this.handle) { await this.handle.close(); this.handle = undefined; }
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
    } catch {
      throw new CliError(1, 'Incomplete CC response cleanup failed; no completed response was delivered', `Inspect and remove the private partial response directory: ${this.directory}. No retry was made.`);
    }
  }
}

// Network-free collection types. Configuration exchange owns all network dispatch,
// mandatory capture and publication; local inspection may also use this collector.
export type DeliveryObserver = (response: { status: number; delivery: Delivery }) => Promise<void>;
