import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { companyKey, validateCompanies, tokenSummary, DAY, HOUR, StateStore } from '../dist/state.js';
import { refreshCompanies } from '../dist/companies.js';
import { executeTestRead } from './test-read.mjs';
import { AuthClient } from '../dist/auth.js';
import { spawn } from 'node:child_process';
import { setup, tokens, form } from './helpers.mjs';
const command = ['test-read', '--loc-ref', 'synthetic'];
function profile(code, url, extra = {}) {
  return { schemaVersion: 1, product: 'cc', auth: { orgName: code, clientId: code + '-opaque-client==', authUrl: url, apiUrl: url, username: code + '_USER' },
    tokens: { ...tokens(), idToken: code + '-id', refreshToken: code + '-refresh', obtainedAt: new Date(Date.now() - 2 * DAY).toISOString(), expiresIn: 14 * DAY / 1000 },
    refreshAfter: new Date(Date.now() - HOUR).toISOString(), ...extra };
}
async function save(s, profiles, selected = 0) {
  const keys = profiles.map(p => companyKey(p.auth));
  await s.store.saveCompanies({ schemaVersion: 2, product: 'cc', activeCompany: selected === null ? null : keys[selected], companies: Object.fromEntries(profiles.map((p, i) => [keys[i], p])) });
  return keys;
}
function renewal(res, name) { res.end(JSON.stringify({ id_token: name + '-new-id', refresh_token: name + '-new-refresh', access_token: 'never-for-cc', expires_in: '1209600' })); }
test('keys use explicit shortname and lowercase hostname, never decode client IDs; foreign/invalid registries fail closed', () => {
  const p = profile('Enterprise', 'https://IDM.example.invalid:9443/path');
  assert.equal(companyKey(p.auth), 'Enterprise@idm.example.invalid');
  const key = companyKey(p.auth);
  for (const value of [
    { schemaVersion: 2, companies: {}, activeCompany: null },
    { schemaVersion: 2, product: 'cc', companies: {}, activeCompany: 'missing' },
    { schemaVersion: 2, product: 'cc', companies: { wrong: p }, activeCompany: null },
    { schemaVersion: 2, product: 'cc', companies: { [key]: { ...p, refreshAfter: '123' } }, activeCompany: null },
    { schemaVersion: 2, product: 'cc', companies: { [key]: { ...p, auth: { ...p.auth, password: 'never-save' } } }, activeCompany: null },
    { schemaVersion: 2, product: 'cc', companies: { [key]: { ...p, tokens: { ...p.tokens, accessToken: 'foreign' } } }, activeCompany: null },
  ]) assert.throws(() => validateCompanies(value));
  const now = Date.now();
  assert.equal(tokenSummary({ ...tokens(), obtainedAt: new Date(now - 999).toISOString(), expiresIn: 1 }, now).expired, false);
  assert.equal(tokenSummary({ ...tokens(), obtainedAt: new Date(now - 1000).toISOString(), expiresIn: 1 }, now).expired, true);
});
test('CC-tagged single profile migrates without token loss and persists only on mutation', async t => {
  const s = await setup(t), old = profile('A', s.url); delete old.refreshAfter;
  await fs.writeFile(s.store.file, JSON.stringify(old)); const before = await fs.readFile(s.store.file, 'utf8');
  const registry = await s.store.loadCompanies(), key = companyKey(old.auth);
  assert.equal(registry.activeCompany, key); assert.deepEqual(registry.companies[key].tokens, old.tokens);
  assert.equal(registry.companies[key].refreshAfter, new Date(Date.parse(old.tokens.obtainedAt) + DAY).toISOString());
  assert.equal(await fs.readFile(s.store.file, 'utf8'), before);
  assert.equal((await s.run(['company', 'select', key])).code, 0);
  assert.equal(JSON.parse(await fs.readFile(s.store.file, 'utf8')).schemaVersion, 2); assert.equal(s.calls.length, 0);
});
test('exact selection/deletion distinguishes environments; deleting active never selects a sibling', async t => {
  const s = await setup(t), a = profile('A', s.url), b = profile('A', s.url.replace('127.0.0.1', 'localhost'));
  const [ka, kb] = await save(s, [a, b]);
  const list = await s.run(['company', 'list']); assert.equal(JSON.parse(list.stdout).data.companies.length, 2);
  assert.doesNotMatch(list.stdout, /A-id|A-refresh|codeVerifier/);
  assert.equal((await s.run(['company', 'select', 'A'])).code, 6);
  assert.equal((await s.run(['company', 'select', kb])).code, 0);
  assert.equal((await s.run(['company', 'delete', kb])).code, 0);
  const registry = await s.store.loadCompanies(); assert.equal(registry.activeCompany, null); assert.deepEqual(registry.companies[ka], a);
  assert.equal((await s.run(command)).code, 7); assert.equal(s.calls.length, 0);
});
test('config leaves existing tokens/selection intact; duplicates skip login without needing a password', async t => {
  const s = await setup(t), a = profile('A', s.url), b = profile('B', s.url), [ka, kb] = await save(s, [a, b]);
  assert.equal((await s.run(['auth', 'config', '--org', 'B', '--username', 'B_USER', '--client-id', b.auth.clientId])).code, 0);
  let registry = await s.store.loadCompanies(); assert.equal(registry.activeCompany, ka); assert.deepEqual(registry.companies[ka], a);
  const duplicate = await s.run(['auth', 'login']); assert.equal(duplicate.code, 0); assert.equal(JSON.parse(duplicate.stdout).data.alreadyStored, true);
  assert.equal((await s.store.loadCompanies()).activeCompany, ka); assert.equal(s.calls.length, 0);
  assert.equal((await s.run(['company', 'select', kb])).code, 0);
  assert.equal((await s.store.loadCompanies()).pending, undefined);
  assert.equal((await s.run(['auth', 'logout'])).code, 0);
  registry = await s.store.loadCompanies(); assert.equal(registry.companies[kb].tokens, undefined); assert.deepEqual(registry.companies[ka], a);
});
for (const failure of [false, true]) test(`new company login ${failure ? 'failure preserves' : 'success selects'} saved profiles`, async t => {
  const s = await setup(t, async (req, res) => {
    if (failure) { res.writeHead(401); res.end('rejected'); return; }
    if (req.url.includes('/authorize?')) { res.end('{}'); return; }
    if (req.url.endsWith('/signin')) {
      const fields = await form(req); assert.equal(fields.get('orgname'), 'B'); assert.equal(fields.get('username'), 'B_USER');
      res.end(JSON.stringify({ nextOp: 'redirect', redirectUrl: 'apiaccount://callback?code=synthetic-code' })); return;
    }
    renewal(res, 'B');
  });
  const a = profile('A', s.url), b = profile('B', s.url), [ka] = await save(s, [a]);
  await s.store.mutateCompanies(async registry => { registry.pending = { schemaVersion: 1, product: 'cc', auth: b.auth }; });
  const before = Date.now(), r = await s.run(['auth', 'login', '--password', 'synthetic-password']);
  assert.equal(r.code, failure ? 9 : 0, r.stderr);
  const registry = await s.store.loadCompanies(); assert.deepEqual(registry.companies[ka], a);
  assert.equal(registry.activeCompany, failure ? ka : companyKey(b.auth));
  if (!failure) { assert.equal(registry.pending, undefined); assert.ok(Date.parse(registry.companies[registry.activeCompany].refreshAfter) >= before + DAY); }
  assert.doesNotMatch(await fs.readFile(s.store.file, 'utf8'), /synthetic-password|never-for-cc/);
});
for (const failure of [false, true]) test(`preflight renews inactive profiles and ${failure ? 'backs off active failures' : 'persists both rotations'}`, async t => {
  const renewed = [];
  const s = await setup(t, async (req, res) => {
    if (req.url.endsWith('/token')) {
      const body = await form(req), name = body.get('client_id').slice(0, 1); renewed.push(name);
      assert.equal(body.get('refresh_token'), name + '-refresh'); assert.equal(req.headers.authorization, undefined);
      if (failure && name === 'A') { res.writeHead(503); res.end('offline'); } else renewal(res, name);
    } else { assert.equal(req.headers.authorization, failure ? 'Bearer A-id' : 'Bearer A-new-id'); res.end('EXACT\r\n'); }
  });
  const a = profile('A', s.url), [ka, kb] = await save(s, [a, profile('B', s.url)]);
  const before = Date.now(), r = await s.run(command), after = Date.now();
  assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout, 'EXACT\r\n'); assert.deepEqual(renewed, ['A', 'B']);
  const registry = await s.store.loadCompanies(), delay = failure ? HOUR : DAY;
  assert.equal(registry.activeCompany, ka); assert.equal(registry.companies[kb].tokens.idToken, 'B-new-id');
  assert.ok(Date.parse(registry.companies[ka].refreshAfter) >= before + delay && Date.parse(registry.companies[ka].refreshAfter) <= after + delay);
  if (failure) assert.deepEqual(registry.companies[ka].tokens, a.tokens);
  assert.equal((await s.run(command)).code, 0); assert.equal(renewed.length, 2);
});
test('expired tokens are removed even during cooldown; active and inactive configuration survives', async t => {
  const s = await setup(t), a = profile('A', s.url), b = profile('B', s.url);
  for (const p of [a, b]) { p.tokens.obtainedAt = '2000-01-01T00:00:00.000Z'; p.refreshAfter = new Date(Date.now() + DAY).toISOString(); }
  const [ka, kb] = await save(s, [a, b]);
  assert.equal((await s.run(command)).code, 8); assert.equal(s.calls.length, 0);
  const registry = await s.store.loadCompanies(); assert.equal(registry.activeCompany, ka);
  for (const key of [ka, kb]) { assert.equal(registry.companies[key].tokens, undefined); assert.equal(registry.companies[key].refreshAfter, undefined); }
  assert.deepEqual(registry.companies[ka].auth, a.auth);
});
test('help, local commands, invalid input and dry-run never renew due tokens', async t => {
  const s = await setup(t); await save(s, [profile('A', s.url)]);
  const before = await fs.readFile(s.store.file, 'utf8');
  for (const args of [['--help'], ['auth', 'status'], ['company', 'list'], [...command, '--dry-run'], ['test-read'], [...command, '--json', '{invalid']]) await s.run(args);
  assert.equal(s.calls.length, 0); assert.equal(await fs.readFile(s.store.file, 'utf8'), before);
});
test('explicit refresh bypasses cooldown for all profiles; unknown expiry is retained, not guessed', async t => {
  const s = await setup(t, (req, res) => { req.resume(); renewal(res, 'manual'); });
  const [ka, kb] = await save(s, [profile('A', s.url, { refreshAfter: new Date(Date.now() + DAY).toISOString() }), profile('B', s.url)]);
  assert.equal((await s.run(['auth', 'refresh'])).code, 0); assert.equal(s.calls.length, 2);
  await s.store.mutateCompanies(async registry => { delete registry.companies[kb].tokens.expiresIn; });
  const r = await s.run(['auth', 'refresh']); assert.equal(r.code, 9); assert.equal(s.calls.length, 3);
  const registry = await s.store.loadCompanies(); assert.equal(registry.activeCompany, ka); assert.ok(registry.companies[kb].tokens);
});
test('failed rotation persistence retains a complete registry recovery and stops before other renewals', async t => {
  const s = await setup(t, (req, res) => { req.resume(); renewal(res, 'rotated'); });
  const [ka, kb] = await save(s, [profile('A', s.url), profile('B', s.url)]);
  t.mock.method(fs, 'rename', async () => { throw Error('synthetic failure'); }); syncBuiltinESMExports();
  try { await assert.rejects(refreshCompanies(s.store, true, 30, true), error => error.exitCode === 12); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(s.calls.length, 1);
  const copy = (await fs.readdir(s.directory)).find(name => name.endsWith('.tmp')); assert.ok(copy);
  const recovery = JSON.parse(await fs.readFile(path.join(s.directory, copy), 'utf8'));
  assert.equal(recovery.companies[ka].tokens.refreshToken, 'rotated-new-refresh'); assert.equal(recovery.companies[kb].tokens.refreshToken, 'B-refresh');
  assert.equal((await s.store.loadCompanies()).companies[ka].tokens.refreshToken, 'A-refresh');
});
test('schedule recheck under lock avoids duplicate automatic renewal', async t => {
  const s = await setup(t); await save(s, [profile('A', s.url)]);
  const original = s.store.mutateCompanies.bind(s.store); let first = true;
  s.store.mutateCompanies = async callback => {
    if (first) { first = false; await original(async registry => { registry.companies[registry.activeCompany].refreshAfter = new Date(Date.now() + DAY).toISOString(); }); }
    return original(callback);
  };
  assert.equal((await refreshCompanies(s.store, true, 30, true))[0].status, 'not-due'); assert.equal(s.calls.length, 0);
});
test('selected company is pinned during concurrent selection; request body is reused without changing ID-token identity', async t => {
  const s = await setup(t, async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer A-id'); assert.equal(req.url, '/config/sim/v2/hierarchy/getHierarchy');
    const body = []; for await (const chunk of req) body.push(chunk);
    assert.match(Buffer.concat(body).toString(), /9007199254740993/); res.end('PINNED');
  });
  const [ka, kb] = await save(s, [profile('A', s.url, { refreshAfter: new Date(Date.now() + DAY).toISOString() }), profile('B', s.url, { refreshAfter: new Date(Date.now() + DAY).toISOString() })]);
  class SwitchingStore extends StateStore {
    count = 0;
    async loadCompanies() {
      if (++this.count === 2) await new StateStore(this.directory).mutateCompanies(async registry => { registry.activeCompany = kb; });
      return super.loadCompanies();
    }
  }
  let output = '';
  t.mock.method(process.stdout, 'write', (chunk, callback) => { output += chunk.toString(); if (typeof callback === 'function') callback(); return true; });
  const result = await executeTestRead(new SwitchingStore(s.directory), { locRef: 'synthetic', quiet: true, json: '{"exact":9007199254740993}' }, s.directory);
  assert.equal(result, 0); assert.equal(output, 'PINNED'); assert.notEqual(ka, kb); assert.equal((await s.store.loadCompanies()).activeCompany, kb);
});
for (const expired of [false, true]) for (const fail of [false, true]) test(`same-key login expired=${expired}, failure=${fail} preserves siblings and commits only on success`, async t => {
  const s = await setup(t, (req, res) => {
    req.resume();
    if (fail) { res.writeHead(401); res.end('rejected'); }
    else if (req.url.includes('/authorize?')) res.end('{}');
    else if (req.url.endsWith('/signin')) res.end(JSON.stringify({ nextOp: 'redirect', redirectUrl: 'apiaccount://callback?code=synthetic' }));
    else renewal(res, 'A');
  });
  const a = profile('A', s.url), b = profile('B', s.url);
  if (expired) a.tokens.obtainedAt = '2000-01-01T00:00:00.000Z';
  const [ka, kb] = await save(s, [a, b]);
  const result = await s.run(['auth', 'login', '--password', 'synthetic', ...(!expired ? ['--username', 'NEW_USER'] : [])]);
  assert.equal(result.code, fail ? 9 : 0, result.stderr);
  const registry = await s.store.loadCompanies(); assert.equal(registry.activeCompany, ka); assert.deepEqual(registry.companies[kb], b);
  if (fail) assert.deepEqual(registry.companies[ka], a);
  else { assert.equal(registry.companies[ka].tokens.idToken, 'A-new-id'); assert.equal(JSON.parse(result.stdout).data.alreadyStored, false); }
});
test('restore accepts a complete CC registry and preserves its selection, but requires force', async t => {
  const s = await setup(t); await save(s, [profile('A', s.url), profile('B', s.url)], 1);
  const registry = await s.store.loadCompanies(), file = path.join(s.directory, 'backup.json');
  await fs.writeFile(file, JSON.stringify(registry));
  await s.store.mutateCompanies(async current => { current.activeCompany = null; });
  assert.equal((await s.run(['auth', 'restore', '--file', file])).code, 12);
  assert.equal((await s.run(['auth', 'restore', '--file', file, '--force'])).code, 0);
  assert.deepEqual(await s.store.loadCompanies(), registry); assert.equal(s.calls.length, 0);
});
test('401 after scheduled renewal is returned verbatim without another refresh or data retry', async t => {
  const s = await setup(t, (req, res) => {
    req.resume();
    if (req.url.endsWith('/token')) renewal(res, 'A');
    else { res.writeHead(401); res.end('ORIGINAL 401\r\n'); }
  });
  await save(s, [profile('A', s.url)]);
  const r = await s.run(command); assert.equal(r.code, 9); assert.equal(r.stdout, 'ORIGINAL 401\r\n'); assert.equal(s.calls.length, 2);
});
test('inclusive schedule boundary and expiry during failed renewal remove the entire token set', async t => {
  const s = await setup(t), now = Date.now(), p = profile('A', s.url, { refreshAfter: new Date(now).toISOString() });
  const [key] = await save(s, [p]);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AuthClient.prototype, 'refresh', async () => {
    t.mock.method(Date, 'now', () => Date.parse(p.tokens.obtainedAt) + p.tokens.expiresIn * 1000);
    throw Error('outage at expiry');
  });
  assert.equal((await refreshCompanies(s.store, true, 30, true))[0].status, 'expired-cleared');
  assert.equal((await s.store.loadCompanies()).companies[key].tokens, undefined);
});
test('stdin is consumed once before due renewal and exact request numbers reach the data API', async t => {
  const raw = '{"locRef":"synthetic","exact":9007199254740993}';
  const s = await setup(t, async (req, res) => {
    if (req.url.endsWith('/token')) { req.resume(); renewal(res, 'A'); return; }
    const body = []; for await (const chunk of req) body.push(chunk);
    assert.equal(Buffer.concat(body).toString(), raw); res.end('ONCE');
  });
  await save(s, [profile('A', s.url)]);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/cli-runner.mjs', s.directory, 'test-read', '--file', '-']);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end(raw);
  });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, 'ONCE'); assert.equal(s.calls.length, 2);
});
