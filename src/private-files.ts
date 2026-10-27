import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// Caller supplies an internally generated path inside an already protected directory.
export async function persistPrivateJson(file: string, value: unknown): Promise<string> {
  const text = JSON.stringify(value, null, 2) + '\n', temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
    return createHash('sha256').update(text).digest('hex');
  } finally { await unlink(temp).catch(() => {}); }
}

export async function protectDirectory(directory: string): Promise<void> {
  if (process.platform !== 'win32') { await chmod(directory, 0o700); return; }
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const { stdout } = await execute(path.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { timeout: 10_000, windowsHide: true });
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error('Cannot determine current Windows identity');
  await execute(path.join(system, 'icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { timeout: 10_000, windowsHide: true });
}

// Components are generated internally. Never traverse a linked directory beneath
// the application-data root. Read-only inspection does not create/chmod anything.
export async function privateSubdirectory(root: string, components: string[], create = false): Promise<string> {
  let current = path.resolve(root);
  if (create) await mkdir(current, {recursive: true, mode: 0o700});
  const base = await lstat(current);
  if (!base.isDirectory() || base.isSymbolicLink()) throw new Error('Unsafe storage root');
  for (const component of components) {
    if (!/^[a-zA-Z0-9-]+$/.test(component)) throw new Error('Unsafe storage component');
    current = path.join(current, component);
    if (create) {
      try { await mkdir(current, {mode: 0o700}); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe storage directory');
    if (create) await protectDirectory(current);
  }
  return current;
}
