import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { StateStore, emptyState, validateState, bearerToken } from '../dist/state.js';
import { tokens } from './helpers.mjs';
async function storeFor(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-state-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new StateStore(directory);
}
test('fixed per-user state is separate from STS on every platform', () => {
  const expected = process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming', 'CcCli')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'CcCli') : path.join(os.homedir(), '.config', 'CcCli');
  const store = new StateStore(); assert.equal(store.directory, expected); assert.equal(store.file, path.join(expected, 'CcCli.json'));
});
test('ID token selection rejects absent/expired tokens without auto-refresh', () => {
  assert.throws(() => bearerToken(emptyState()), error => error.exitCode === 8);
  assert.equal(bearerToken({ ...emptyState(), tokens: tokens() }), 'synthetic-id');
  assert.throws(() => bearerToken({ ...emptyState(), tokens: { ...tokens(), obtainedAt: '2000-01-01T00:00:00.000Z' } }), error => error.exitCode === 9);
});
test('corrupt state is not reset and parser excerpts remain private', async t => {
  const store = await storeFor(t); await fs.writeFile(store.file, 'CORRUPT-SECRET');
  await assert.rejects(store.load(), error => error.exitCode === 12 && !error.message.includes('CORRUPT-SECRET'));
  await assert.rejects(store.mutate(async () => {})); assert.equal(await fs.readFile(store.file, 'utf8'), 'CORRUPT-SECRET');
});
test('state rejects password fields, malformed tokens and foreign schemas', () => {
  for (const state of [
    { auth: {} }, { ...emptyState(), auth: { password: 'secret' } },
    { ...emptyState(), tokens: { ...tokens(), accessToken: 'not-for-cc' } },
    { ...emptyState(), tokens: { ...tokens(), expiresIn: -1 } },
    { ...emptyState(), tokens: { ...tokens(), expiresIn: Number.MAX_SAFE_INTEGER } },
  ]) assert.throws(() => validateState(state), error => error.exitCode === 12);
});
test('concurrent auth mutations are locked; failed operations leave state unchanged', async t => {
  const store = await storeFor(t); await store.save(emptyState());
  let release, acquired; const gate = new Promise(resolve => { release = resolve; }); const ready = new Promise(resolve => { acquired = resolve; });
  const first = store.mutate(async () => { acquired(); await gate; });
  await ready;
  try { await assert.rejects(store.mutate(async () => {}), error => error.exitCode === 12); }
  finally { release(); await first; }
  await assert.rejects(store.mutate(async state => { state.auth.username = 'not-saved'; throw new Error('synthetic'); }));
  assert.deepEqual(await store.load(), emptyState());
});
test('failed rename retains a complete synced rotated-token recovery copy', async t => {
  const store = await storeFor(t); const old = { ...emptyState(), tokens: tokens() };
  await store.save(old);
  t.mock.method(fs, 'rename', async () => { throw new Error('synthetic denial'); }); syncBuiltinESMExports();
  let error;
  try { await store.mutate(async state => { state.tokens.refreshToken = 'rotated-synthetic'; }); } catch (e) { error = e; }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(error.exitCode, 12); assert.match(error.hint, /Do not retry/); assert.doesNotMatch(error.hint, /rotated-synthetic/);
  assert.deepEqual(await store.load(), old);
  const files = await fs.readdir(store.directory); const recovery = files.filter(file => file.endsWith('.tmp'));
  assert.equal(recovery.length, 1); assert.ok(!files.some(file => file.endsWith('.lock')));
  const file = path.join(store.directory, recovery[0]); assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).pending.tokens.refreshToken, 'rotated-synthetic');
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});
for (const failure of ['writeFile', 'sync']) test(`failed ${failure} cleans incomplete state copies`, async t => {
  const store = await storeFor(t); await store.save(emptyState());
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args); t.mock.method(handle, failure, async () => { throw new Error('synthetic failure'); }); return handle;
  }); syncBuiltinESMExports();
  try { await assert.rejects(store.save({ ...emptyState(), tokens: tokens() }), error => error.exitCode === 12); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(await store.load(), emptyState()); assert.deepEqual(await fs.readdir(store.directory), ['CcCli.json']);
});
