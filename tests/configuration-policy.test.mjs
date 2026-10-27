import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Writable } from 'node:stream';
import { readFile, readdir } from 'node:fs/promises';
import { configurationOperations, configurationRequestInto, issueConfigurationWritePermit, requireConfigurationOperation } from '../dist/configuration-policy.js';

const readPath = '/config/sim/v2/devices/getOrderDevices';
const writePath = '/config/sim/v2/devices/updateOrderDevices';
const sink = () => new Writable({write(_chunk, _encoding, done) { done(); }});

test('fixed operation catalogue is immutable, unique and exact; POST reads remain allowed', () => {
  assert.equal(new Set(configurationOperations.map(o => `${o.method}:${o.path}`)).size, configurationOperations.length);
  assert.ok(Object.isFrozen(configurationOperations));
  for (const operation of configurationOperations) {
    assert.ok(Object.isFrozen(operation));
    assert.equal(requireConfigurationOperation({method: operation.method, url: `https://example.invalid${operation.path}`}, operation.effect), operation);
  }
  for (const suffix of ['?x=1', '?', '#', '/', '/..', '%2f']) {
    assert.throws(() => requireConfigurationOperation({method: 'POST', url: `https://example.invalid${readPath}${suffix}`}, 'read'));
  }
  for (const method of ['GET', 'DELETE', 'post']) assert.throws(() => requireConfigurationOperation({method, url: `https://example.invalid${readPath}`}, 'read'));
});

test('request boundary blocks default mutations and unknown routes; permits are bound and single-use', async () => {
  let count = 0;
  const server = http.createServer((_req, res) => { count++; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const read = {method: 'POST', url: origin + readPath, body: '{}'};
    const write = {method: 'POST', url: origin + writePath, headers: {Authorization: 'Bearer synthetic', 'Simphony-AuditTrailRef': 'synthetic'}, body: '{"objectNum":1,"hierUnitId":2}'};
    await configurationRequestInto(read, sink());
    assert.equal(count, 1);
    for (const operation of configurationOperations.filter(o => o.effect !== 'read')) {
      await assert.rejects(configurationRequestInto({...write, url: origin + operation.path}, sink()), /read-only policy/);
    }
    await assert.rejects(configurationRequestInto({...read, url: origin + '/unknown'}, sink()), /read-only policy/);
    await assert.rejects(configurationRequestInto(write, sink(), {}), /read-only policy/);
    assert.equal(count, 1);
    assert.throws(() => issueConfigurationWritePermit(write, 'delete'), /read-only policy/);
    for (const altered of [
      {...write, body: '{"objectNum":2,"hierUnitId":2}'},
      {...write, headers: {Authorization: 'Bearer different'}},
      {...write, url: origin + '/config/sim/v2/devices/deleteKitchenDisplays'},
      {...write, method: 'DELETE'},
      {...write, url: 'http://localhost:' + server.address().port + writePath},
    ]) {
      const permit = issueConfigurationWritePermit(write, 'update');
      await assert.rejects(configurationRequestInto(altered, sink(), permit), /read-only policy/);
      await assert.rejects(configurationRequestInto(write, sink(), permit), /read-only policy/);
    }
    const expired = issueConfigurationWritePermit(write, 'update');
    const now = Date.now;
    try {
      Date.now = () => now() + 31_000;
      await assert.rejects(configurationRequestInto(write, sink(), expired), /read-only policy/);
    } finally { Date.now = now; }
    assert.equal(count, 1);
    const permit = issueConfigurationWritePermit(write, 'update');
    await configurationRequestInto(write, sink(), permit);
    assert.equal(count, 2);
    await assert.rejects(configurationRequestInto(write, sink(), permit), /read-only policy/);
    assert.equal(count, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('production configuration dispatch and permit issuance have no alternate import path', async () => {
  for (const name of await readdir(new URL('../src/', import.meta.url))) {
    if (!name.endsWith('.ts')) continue;
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    if (!['transport.ts', 'configuration-policy.ts'].includes(name)) assert.doesNotMatch(source, /\brequestInto\s*\(/, name);
    if (!['auth.ts', 'transport.ts'].includes(name)) assert.doesNotMatch(source, /\brequest\s*\(/, name);
    if (!['guarded-write.ts', 'configuration-policy.ts'].includes(name)) assert.doesNotMatch(source, /\bissueConfigurationWritePermit\b/, name);
    if (name !== 'transport.ts') assert.doesNotMatch(source, /from ['"]node:https?['"]/, name);
  }
});
