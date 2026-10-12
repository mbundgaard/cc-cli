import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProgram } from '../dist/cli.js';
import { validateCompanies, validateState, emptyState, emptyCompanies, stateDirectory } from '../dist/state.js';
import { setup, tokens, clientId } from './helpers.mjs';
test('production exposes reviewed read-only calls, never synthetic or BI commands', () => {
  const root = createProgram();
  assert.deepEqual(root.commands.map(c => c.name()).sort(), ['auth', 'catalogue', 'company', 'endpoints', 'hierarchy', 'kds-displays', 'menu-item-masters', 'server-version', 'version']);
  for (const args of [['--help'], ['auth', 'login', '--help'], ['company', '--help'], ['endpoints'], ['version']]) {
    const r = spawnSync(process.execPath, ['bin/cc.js', ...args], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    if (args[0] === 'endpoints') assert.deepEqual(JSON.parse(r.stdout).data.dataEndpoints.map(item => item.id), ['server-version', 'hierarchy', 'hierarchy-nodes', 'menu-item-masters', 'kds-displays']);
  }
  for (const args of [['test-read'], ['pos-dimensions'], ['getHierarchy'], ['--state-dir', 'elsewhere'], ['--insecure']]) {
    const r = spawnSync(process.execPath, ['bin/cc.js', ...args], {encoding: 'utf8'});
    assert.equal(r.status, 6); assert.equal(r.stdout, '');
  }
});
test('CC product tagging rejects BI/STS and untagged single profiles, registries, nested profiles and pending config', () => {
  const profile = {...emptyState(), auth: {orgName: 'Synthetic', authUrl: 'https://idm.example.invalid'}, tokens: tokens()};
  const untagged = {...profile}; delete untagged.product;
  for (const value of [untagged, {...profile, product: 'bi'}, {...profile, product: 'sts'}]) {
    assert.throws(() => validateState(value)); assert.throws(() => validateCompanies(value));
  }
  const key = 'Synthetic@idm.example.invalid';
  for (const registry of [
    {...emptyCompanies(), product: 'bi'}, {...emptyCompanies(), product: 'sts'},
    {...emptyCompanies(), pending: untagged},
    {...emptyCompanies(), activeCompany: key, companies: {[key]: untagged}},
    {...emptyCompanies(), activeCompany: key, companies: {[key]: {...profile, product: 'bi'}}},
  ]) assert.throws(() => validateCompanies(registry));
  assert.ok(stateDirectory().endsWith('CcCli'));
  assert.doesNotMatch(stateDirectory(), /BiCli|StsCli/);
});
test('restore rejects foreign products even with force and never overwrites current CC state', async t => {
  const s = await setup(t); await s.store.mutate(async p => { p.tokens = tokens(); });
  const before = await readFile(s.store.file, 'utf8');
  const old = JSON.parse(before), currentProfile = old.companies[old.activeCompany];
  const untagged = {...currentProfile}; delete untagged.product; delete untagged.refreshAfter;
  const file = path.join(s.directory, 'foreign.json');
  for (const foreign of [{...old, product: 'bi'}, {...old, product: 'sts'}, untagged]) {
    await writeFile(file, JSON.stringify(foreign));
    const r = await s.run(['auth', 'restore', '--file', file, '--force']);
    assert.equal(r.code, 12); assert.doesNotMatch(r.stdout + r.stderr, /synthetic-id|synthetic-refresh/);
    assert.equal(await readFile(s.store.file, 'utf8'), before);
  }
  assert.equal(s.calls.length, 0);
});
test('CC config stages opaque identifiers without decoding; rejects insecure URLs and never takes passwords as config', async t => {
  const s = await setup(t);
  const r = await s.run(['auth', 'config', '--org', 'NewEnterprise', '--client-id', clientId, '--username', 'Case_Sensitive']);
  assert.equal(r.code, 0);
  const p = (await s.store.loadCompanies()).pending;
  assert.equal(p.product, 'cc'); assert.equal(p.auth.clientId, clientId); assert.equal(p.auth.orgName, 'NewEnterprise'); assert.equal(p.auth.username, 'Case_Sensitive');
  const before = await readFile(s.store.file, 'utf8');
  for (const args of [['--auth-url', 'http://example.invalid'], ['--api-url', 'https://user:secret@example.invalid'], ['--auth-url', 'https://idm.example.invalid?x=1'], ['--org', ''], ['--password', 'synthetic']]) {
    const bad = await s.run(['auth', 'config', ...args]); assert.equal(bad.code, 6, bad.stderr);
    assert.equal(await readFile(s.store.file, 'utf8'), before);
  }
  const status = await s.run(['auth', 'status']); assert.equal(JSON.parse(status.stdout).data.serverValidated, false);
  assert.equal(s.calls.length, 0);
});
