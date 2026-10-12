import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { request, validateUrl } from '../dist/transport.js';
import { setup } from './helpers.mjs';
test('transport preserves decoded bytes without JSON interpretation or newline changes', async t => {
  const bytes = Buffer.from('{ "large": 9007199254740993 }\r\n');
  const s = await setup(t, (_, res) => { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(gzipSync(bytes)); });
  assert.deepEqual((await request({ url: s.url, method: 'POST', body: '{}' })).body, bytes);
});
test('transport returns redirects unchanged without following them', async t => {
  const s = await setup(t, (_, res) => { res.writeHead(302, { Location: '/not-followed' }); res.end('redirect'); });
  const result = await request({ url: s.url, method: 'GET' });
  assert.equal(result.status, 302); assert.equal(s.calls.length, 1); assert.equal(result.body.toString(), 'redirect');
});
test('no-body responses ignore compression metadata, broken encoded bodies fail', async t => {
  const s = await setup(t, (req, res) => { res.writeHead(req.url === '/empty' ? 204 : 200, { 'Content-Encoding': 'gzip' }); res.end(); });
  assert.equal((await request({ url: s.url + '/empty', method: 'GET' })).body.length, 0);
  await assert.rejects(request({ url: s.url, method: 'GET' }));
});
test('HTTPS is required outside loopback and embedded credentials are rejected', () => {
  assert.equal(validateUrl('https://example.invalid').protocol, 'https:');
  assert.equal(validateUrl('http://127.0.0.1:9999').protocol, 'http:');
  for (const url of ['http://example.invalid', 'https://user:secret@example.invalid', 'file:///private', 'https://example.invalid/#fragment']) assert.throws(() => validateUrl(url));
});
