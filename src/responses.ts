import { mkdir, mkdtemp, chmod, open, rename, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { requestInto, httpExit, type HttpRequest } from './transport.js';
import { stateDirectory } from './state.js';
import { CliError, Exit } from './output.js';

export const INLINE_MAX_BYTES = 16 * 1024;
export const INLINE_MAX_LINES = 500;
const execute = promisify(execFile);

async function protectDirectory(directory: string): Promise<void> {
  if (process.platform !== 'win32') { await chmod(directory, 0o700); return; }
  // POSIX modes do not enforce Windows privacy. Protect the new empty directory
  // before writing any response data; files inherit this current-user-only ACL.
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const { stdout } = await execute(path.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { timeout: 10_000, windowsHide: true });
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error('Cannot determine current Windows identity');
  await execute(path.join(system, 'icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { timeout: 10_000, windowsHide: true });
}

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
  constructor(private readonly baseDirectory: string) { super({ highWaterMark: 64 * 1024 }); }
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
    if (!this.handle && this.bytes <= INLINE_MAX_BYTES && this.lines <= INLINE_MAX_LINES) {
      this.chunks.push(Buffer.from(chunk)); return;
    }
    try {
      if (!this.handle) {
        const root = path.resolve(this.baseDirectory, 'responses');
        await mkdir(root, { recursive: true, mode: 0o700 });
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

// The one data-response boundary for current and future task areas. Output-mode
// switches, agent detection, token persistence and response interpretation do not belong here.
export type DeliveryObserver = (response: { status: number; delivery: Delivery }) => Promise<void>;
export async function deliverResponse(input: HttpRequest, operation: string, baseDirectory = stateDirectory(), quiet = false, observer?: DeliveryObserver, kind: 'read' | 'write' = 'read'): Promise<number> {
  const collector = new ResponseCollector(baseDirectory);
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  const signal = input.signal ? AbortSignal.any([input.signal, cancellation.signal]) : cancellation.signal;
  let published = false;
  try {
    const response = await requestInto({ ...input, signal }, collector);
    signal.throwIfAborted();
    const delivery = await collector.complete();
    signal.throwIfAborted();
    if (!quiet) process.stderr.write(`[cc ${operation}] HTTP ${response.status}\n`);
    // Once output begins, retain completed files even if stdout fails or its reader exits.
    published = true;
    const output = delivery.kind === 'inline' ? delivery.body : JSON.stringify({
      delivery: 'file', path: delivery.path, uri: delivery.uri, bytes: delivery.bytes,
      lines: delivery.lines, sha256: delivery.sha256, httpStatus: response.status,
      description: `Large Oracle CC response for ${operation}, saved verbatim.`,
      instructions: 'Filter, aggregate, or read selected portions of this file instead of loading it all into context. Keep it private and delete it when no longer needed.',
    }) + '\n';
    try {
      await new Promise<void>((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
    } catch { throw new CliError(1, 'Cannot write CC response delivery to stdout', delivery.kind === 'file' ? `Completed response retained at ${delivery.path}` : undefined); }
    // Learning is a separate, best-effort side channel AFTER unchanged output delivery.
    // Never turn a metadata failure into a misleading HTTP failure or a retry.
    if (observer && response.status >= 200 && response.status < 300) {
      try { await observer({ status: response.status, delivery }); }
      catch { process.stderr.write('[cc catalogue] Metadata was not saved; response delivery and HTTP result are unchanged. Inspect the local catalogue before further learning.\n'); }
    }
    return httpExit(response.status);
  } catch (error) {
    if (!published) await collector.discard();
    if (kind === 'write') throw new CliError(error instanceof CliError ? error.exitCode : Exit.network, 'CC write outcome may be uncertain. Do not blindly retry.', 'No automatic retry or readback was performed.');
    if (error instanceof CliError) throw error;
    throw new CliError(Exit.network, signal.aborted ? 'CC read request cancelled; no retry was made' : 'CC read request failed; no retry was made', 'Check connectivity and TLS. No partial response was delivered.');
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
