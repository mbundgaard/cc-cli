import test from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, open, unlink, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RecordHistoryStore, diffRecords, selectObservation } from '../dist/record-history.js';
import { parseJson } from '../dist/json.js';
const run = promisify(execFile);
const scope = {company: 'SYNTHETIC@idm.invalid', apiUrl: 'https://api.invalid', task: 'order-devices', scopeKind: 'rvc', scopeId: '123'};
const identity = {...scope, recordId: '7'};
function source(extra = {}) { return {captureId: randomUUID(), capturedAt: new Date().toISOString(), operationId: 'order-devices:v2', responseSha256: 'a'.repeat(64), detail: 'detailed', purpose: 'read', ...extra}; }
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cc-history-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return {directory, store: new RecordHistoryStore(directory)};
}

test('one record file retains full observations, exact numbers, unknown fields and partial provenance', async t => {
  const {store} = await fixture(t);
  const first = parseJson('{"objectNum":7,"large":90071992547409931234,"unknown":{"a":[null,0,false]},"backup":null}');
  const a = await store.append(identity, source(), first);
  const b = await store.append(identity, source({detail: 'projection', projection: 'objectNum'}), {objectNum: 7});
  assert.equal(a.path, b.path);
  const history = await store.load(identity);
  assert.equal(history.observations.length, 2);
  assert.equal(JSON.stringify(selectObservation(history, a.observationId).record), JSON.stringify(first));
  assert.deepEqual(selectObservation(history).record, {objectNum: 7});
  assert.equal(selectObservation(history).detail, 'projection');
  const text = await readFile(a.path, 'utf8');
  assert.match(text, /90071992547409931234/);
  if (process.platform !== 'win32') assert.equal((await lstat(a.path)).mode & 0o777, 0o600);
});

test('company/environment/scope/task identity is isolated and unknown task/source is rejected', async t => {
  const {store} = await fixture(t);
  await store.append(identity, source(), {value: 'original'});
  for (const other of [{...identity, company: 'OTHER@idm.invalid'}, {...identity, apiUrl: 'https://other.invalid'}, {...identity, scopeId: '456'}, {...identity, recordId: '8'}]) {
    await assert.rejects(store.load(other));
  }
  const other = await store.append({...identity, scopeId: '456'}, source(), {value: 'other'});
  assert.equal((await store.list(scope)).items.length, 1);
  assert.equal((await store.list({...scope, scopeId: '456'})).items[0].path, other.path);
  await assert.rejects(store.append({...identity, task: '../../escape'}, source(), {}));
  await assert.rejects(store.append(identity, source({operationId: 'kds-displays:update:v2'}), {}));
  await assert.rejects(store.append(identity, source({authorization: 'must-not-store'}), {}));
  assert.equal((await store.load(identity)).observations.length, 1);
});

test('lock contention and corrupted history fail closed without overwriting earlier bytes', async t => {
  const {store} = await fixture(t);
  const result = await store.append(identity, source(), {old: 1});
  const original = await readFile(result.path, 'utf8');
  const lock = await open(result.path + '.lock', 'wx');
  try { await assert.rejects(store.append(identity, source(), {old: 2})); }
  finally { await lock.close(); await unlink(result.path + '.lock'); }
  assert.equal(await readFile(result.path, 'utf8'), original);
  const corrupt = original.replace('"old": 1', '"old": 999');
  await writeFile(result.path, corrupt);
  await assert.rejects(store.load(identity));
  await assert.rejects(store.append(identity, source(), {old: 3}));
  assert.equal(await readFile(result.path, 'utf8'), corrupt);
});

for (const failure of ['writeFile', 'sync', 'rename']) test(`failed history ${failure} preserves all previous observations`, async t => {
  const {store} = await fixture(t);
  const saved = await store.append(identity, source(), {before: true});
  const previous = await readFile(saved.path, 'utf8');
  const originalOpen = fs.open, originalRename = fs.rename;
  try {
    if (failure === 'rename') fs.rename = async (from, to) => {
      if (to === saved.path) throw new Error('Synthetic rename failure');
      return originalRename(from, to);
    };
    else fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).startsWith(saved.path + '.') && String(args[0]).endsWith('.tmp')) handle[failure] = async () => { throw new Error('Synthetic storage failure'); };
      return handle;
    };
    syncBuiltinESMExports();
    await assert.rejects(store.append(identity, source(), {after: true}));
  } finally { fs.open = originalOpen; fs.rename = originalRename; syncBuiltinESMExports(); }
  assert.equal(await readFile(saved.path, 'utf8'), previous);
  assert.equal((await store.load(identity)).observations.length, 1);
});

test('concurrent appends never silently lose a successful observation', async t => {
  const {store} = await fixture(t);
  const results = await Promise.allSettled([store.append(identity, source(), {n: 1}), store.append(identity, source(), {n: 2})]);
  const successful = results.filter(r => r.status === 'fulfilled');
  assert.ok(successful.length >= 1);
  const history = await store.load(identity);
  assert.equal(history.observations.length, successful.length);
  assert.deepEqual(new Set(history.observations.map(o => o.observationId)), new Set(successful.map(r => r.value.observationId)));
});

test('linked record directories are refused rather than followed', async t => {
  const {store, directory} = await fixture(t);
  const external = await mkdtemp(path.join(tmpdir(), 'cc-history-external-'));
  t.after(() => rm(external, {recursive: true, force: true}));
  await symlink(external, path.join(directory, 'records'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.append(identity, source(), {value: 1}));
  await assert.rejects(store.load(identity));
});

test('local diff distinguishes null/absent, escapes pointers and compares arrays whole', () => {
  const changes = diffRecords({'a/b': null, list: [1], nested: {same: 1, gone: 2}}, {list: [1, 2], nested: {same: 1}, added: null});
  assert.deepEqual(changes.map(c => c.pointer), ['/a~1b', '/added', '/list', '/nested/gone']);
  assert.deepEqual(changes[0], {pointer: '/a~1b', beforePresent: true, afterPresent: false, before: null});
  assert.deepEqual(changes[1], {pointer: '/added', beforePresent: false, afterPresent: true, after: null});
});

test('local commands inspect without credentials, preserve history, paginate and export large output', async t => {
  const {store, directory} = await fixture(t);
  const a = await store.append(identity, source(), {n: 1});
  const b = await store.append(identity, source(), {n: 2, big: 'x'.repeat(17000)});
  await store.append({...identity, recordId: '8'}, source(), {n: 8});
  const before = await readFile(a.path, 'utf8');
  const args = ['--company', scope.company, '--api-url', scope.apiUrl, '--task', scope.task, '--scope-kind', scope.scopeKind, '--scope-id', scope.scopeId];
  async function command(name, rest = []) {
    const result = await run(process.execPath, ['tests/cli-runner.mjs', directory, 'records', name, ...args, ...rest]);
    assert.equal(result.stderr, ''); return JSON.parse(result.stdout);
  }
  const list = await command('list', ['--limit', '1']);
  assert.equal(list.data.items.length, 1); assert.equal(list.data.nextOffset, 1);
  const second = await command('list', ['--limit', '1', '--offset', '1']);
  assert.equal(second.data.nextOffset, null);
  const history = await command('history', ['--record-id', '7']);
  assert.equal(history.data.observations.length, 2); assert.equal(history.serverValidated, false);
  assert.ok(history.data.observations.every(o => !Object.hasOwn(o, 'record')));
  const show = await command('show', ['--record-id', '7', '--observation', a.observationId]);
  assert.deepEqual(show.data.observation.record, {n: 1});
  const latest = await command('show', ['--record-id', '7']);
  assert.equal(latest.delivery, 'file');
  assert.equal(JSON.parse(await readFile(latest.path, 'utf8')).data.observation.observationId, b.observationId);
  const diff = await command('diff', ['--record-id', '7', '--from', a.observationId, '--to', b.observationId]);
  assert.equal(diff.delivery, 'file');
  assert.equal(await readFile(a.path, 'utf8'), before);
  await assert.rejects(readFile(path.join(directory, 'CcCli.json')));
});

test('late persistence of an older observation does not replace latest observed values', async t => {
  const {store} = await fixture(t);
  const recent = await store.append(identity, source({capturedAt: '2026-01-02T00:00:00.000Z'}), {value: 'recent'});
  await store.append(identity, source({capturedAt: '2026-01-01T00:00:00.000Z'}), {value: 'older'});
  assert.equal(selectObservation(await store.load(identity)).observationId, recent.observationId);
});

test('malformed history diagnostics do not leak record values through JSON parse errors', async t => {
  const {store} = await fixture(t);
  const saved = await store.append(identity, source(), {value: 'private'});
  await writeFile(saved.path, '{"sensitive": "SYNTHETIC-NOT-FOR-DIAGNOSTICS", bad }');
  await assert.rejects(store.load(identity), error => !error.message.includes('SYNTHETIC-NOT-FOR-DIAGNOSTICS'));
  await assert.rejects(store.list(scope), error => !error.message.includes('SYNTHETIC-NOT-FOR-DIAGNOSTICS'));
});

test('empty local listing creates no store, and invalid paging is rejected', async t => {
  const {store, directory} = await fixture(t);
  assert.deepEqual(await store.list(scope), {items: [], nextOffset: null});
  await assert.rejects(lstat(path.join(directory, 'records')));
  for (const [offset, limit] of [[-1, 1], [0, 0], [0, 101], [0.5, 2]]) await assert.rejects(store.list(scope, offset, limit));
});
