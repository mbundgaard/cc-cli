import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildReadRequest } from '../dist/read-commands.js';
import { setup, tokens, responseText } from './helpers.mjs';
const profile = { schemaVersion: 1, product: 'cc', auth: { apiUrl: 'https://configuration.example.invalid', orgName: 'Synthetic' } };
test('version routes are explicit, v2 preferred, empty JSON body and no invented organization header', () => {
  for (const version of ['v1', 'v2']) {
    const request = buildReadRequest('server-version', profile, {}, { apiVersion: version });
    assert.equal(request.url, `https://configuration.example.invalid/config/sim/${version}/getReleaseVersions`);
    assert.equal(request.method, 'POST'); assert.deepEqual(request.body, {});
    assert.deepEqual(request.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
  }
  assert.match(buildReadRequest('server-version', profile, {}, {}).url, /\/v2\//);
  assert.throws(() => buildReadRequest('unknown', profile, {}, {}));
  assert.throws(() => buildReadRequest('server-version', profile, {}, {apiVersion: 'v3'}));
  assert.throws(() => buildReadRequest('server-version', profile, {unreviewed: true}, {}));
});
test('version help/dry-run and validation are offline and leave state unchanged', async t => {
  const s = await setup(t), before = await readFile(s.store.file, 'utf8');
  for (const args of [['server-version', '--help'], ['server-version', '--dry-run'], ['server-version', '--api-version', 'v1', '--dry-run']]) {
    const r = await s.run(args); assert.equal(r.code, 0, r.stderr); assert.doesNotMatch(r.stdout, /synthetic-id/);
  }
  for (const args of [['--api-version', 'v3'], ['--timeout', '0'], ['--timeout', '301'], ['--json', '{}']]) {
    assert.equal((await s.run(['server-version', ...args])).code, 6);
  }
  assert.equal(s.calls.length, 0); assert.equal(await readFile(s.store.file, 'utf8'), before);
});
test('version reads deliver exact response, honor explicit v1 and never fallback after an HTTP error', async t => {
  const body = '{ "simphonyEnterpriseVersion": "19.synthetic", "C&CVersion": "23.synthetic", "newField": 9007199254740993 }\n';
  let status = 200;
  const s = await setup(t, async (req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, 'Bearer synthetic-id');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '{}');
    res.writeHead(status, {'Content-Type': 'application/json'}); res.end(body);
  });
  await s.store.mutate(async state => { state.tokens = tokens(); });
  for (const version of ['v2', 'v1']) {
    const r = await s.run(['server-version', '--api-version', version, '--quiet']);
    assert.equal(r.code, 0, r.stderr); assert.equal(await responseText(r), body);
    assert.equal(s.calls.at(-1), `/config/sim/${version}/getReleaseVersions`);
  }
  status = 403;
  const r = await s.run(['server-version', '--quiet']);
  assert.equal(r.code, 11); assert.equal(await responseText(r), body); assert.equal(s.calls.length, 3);
});
