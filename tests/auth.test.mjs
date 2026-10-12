import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pkce } from '../dist/auth.js';
import { bearerToken } from '../dist/state.js';
import { setup, form, tokens, clientId } from './helpers.mjs';

test('PKCE uses an independent verifier and S256 base64url challenge', () => {
  const a = pkce(), b = pkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.challenge, createHash('sha256').update(a.verifier).digest('base64url'));
  assert.notEqual(a.verifier, b.verifier);
});
for (const status of [200, 303]) test(`login preserves authorize cookies (${status}), opaque client ID and literal password; uses id_token`, async t => {
  let challenge;
  const password = 'Synthetic!$[Only]';
  const s = await setup(t, async (req, res) => {
    assert.equal(req.headers.accept, 'application/json');
    const url = new URL(req.url, 'http://local');
    if (url.pathname.endsWith('/authorize')) {
      assert.equal(req.method, 'GET');
      assert.equal(url.searchParams.get('client_id'), clientId);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      challenge = url.searchParams.get('code_challenge');
      res.writeHead(status, { Location: '/must-not-follow', 'Set-Cookie': [
        `client_id=${clientId}; Path=/; HttpOnly`, 'redirect_uri=apiaccount://callback; Path=/', 'session=synthetic-session; Path=/',
      ] }); res.end('Authorize'); return;
    }
    assert.equal(req.method, 'POST'); assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    const body = await form(req);
    if (url.pathname.endsWith('/signin')) {
      assert.ok(req.headers.cookie.includes('client_id=' + clientId));
      assert.ok(req.headers.cookie.includes('redirect_uri=apiaccount://callback'));
      assert.ok(req.headers.cookie.includes('session=synthetic-session'));
      assert.equal(body.get('password'), password);
      assert.equal(body.get('username'), 'Synthetic_User');
      assert.equal(body.get('orgname'), 'test-enterprise'); // Not the decoded client-ID prefix.
      res.end(JSON.stringify({ nextOp: 'redirect', success: true, redirectUrl: 'apiaccount://callback?code=synthetic-code' })); return;
    }
    assert.ok(url.pathname.endsWith('/token')); assert.equal(body.get('code'), 'synthetic-code');
    assert.equal(body.get('client_id'), clientId); assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), challenge);
    res.end(JSON.stringify({ id_token: 'synthetic-id', access_token: 'not-for-cc', refresh_token: 'synthetic-refresh', expires_in: '1209600' }));
  });
  const result = await s.run(['auth', 'login', '--password', password]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(s.calls.length, 3);
  const saved = await s.store.load();
  assert.equal(saved.tokens.expiresIn, 1209600); assert.equal(bearerToken(saved), 'synthetic-id');
  const raw = await readFile(s.store.file, 'utf8');
  assert.doesNotMatch(raw, /not-for-cc|Synthetic!\$\[Only\]/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-id|synthetic-refresh|synthetic-code|synthetic-session|Synthetic!\$\[Only\]/);
  assert.equal(JSON.parse(result.stdout).data.tokens.hasIdToken, true);
});
for (const rotated of [true, false]) test(`refresh is password-free, persists ID token and ${rotated ? 'rotated' : 'prior'} refresh token`, async t => {
  const s = await setup(t, async (req, res) => {
    const body = await form(req);
    assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('client_id'), clientId);
    assert.equal(body.get('refresh_token'), 'synthetic-refresh'); assert.equal(body.get('code_verifier'), 'a'.repeat(43));
    assert.equal(body.has('password'), false);
    res.end(JSON.stringify({ id_token: 'new-synthetic-id', access_token: 'unused-access', expires_in: 7200, ...(rotated ? { refresh_token: 'new-synthetic-refresh' } : {}) }));
  });
  await s.store.mutate(async state => { state.tokens = tokens(); });
  const result = await s.run(['auth', 'refresh']);
  assert.equal(result.code, 0, result.stderr); assert.equal(s.calls.length, 1);
  assert.equal(JSON.parse(result.stdout).data.companies[0].status, 'refreshed');
  const saved = await s.store.load(); assert.equal(saved.tokens.idToken, 'new-synthetic-id');
  assert.equal(saved.tokens.refreshToken, rotated ? 'new-synthetic-refresh' : 'synthetic-refresh');
  assert.doesNotMatch(result.stdout + result.stderr, /new-synthetic-id|new-synthetic-refresh|unused-access/);
});
for (const status of [302, 400, 401, 500]) test(`refresh HTTP ${status} is not retried or followed; tokens survive with one-hour backoff`, async t => {
  const s = await setup(t, (_, res) => { res.writeHead(status, { Location: '/do-not-follow' }); res.end(JSON.stringify({ code: 'AUTHENTICATION_INVALID', message: 'SECRET-ECHO', pwdResetToken: 'RESET-SECRET' })); });
  await s.store.mutate(async state => { state.tokens = tokens(); });
  const before = (await s.store.load()).tokens;
  const start = Date.now();
  const result = await s.run(['auth', 'refresh']);
  assert.equal(result.code, 9); assert.equal(s.calls.length, 1); assert.equal(JSON.parse(result.stdout).data.companies[0].status, 'failed');
  assert.doesNotMatch(result.stderr, /SECRET-ECHO|RESET-SECRET|password requires changing/);
  assert.deepEqual((await s.store.load()).tokens, before);
  const registry = await s.store.loadCompanies();
  assert.ok(Date.parse(registry.companies[registry.activeCompany].refreshAfter) >= start + 3600000);
});
for (const response of [
  { access_token: 'not-a-cc-token', refresh_token: 'secret', expires_in: 100 },
  { id_token: 'secret', refresh_token: 'secret', expires_in: 'not-a-number' },
  { id_token: 'secret', refresh_token: 'secret', expires_in: -1 },
]) test('missing ID tokens fail closed; invalid expiry never loses rotated credentials or exposes tokens', async t => {
  const s = await setup(t, (_, res) => res.end(JSON.stringify(response)));
  await s.store.mutate(async state => { state.tokens = tokens(); });
  const before = (await s.store.load()).tokens;
  const result = await s.run(['auth', 'refresh']); assert.equal(result.code, response.id_token ? 0 : 9);
  assert.doesNotMatch(result.stdout + result.stderr, /secret|not-a-cc-token/);
  const saved = (await s.store.load()).tokens;
  if (response.id_token) { assert.equal(saved.refreshToken, 'secret'); assert.equal(saved.expiresIn, undefined); }
  else assert.deepEqual(saved, before);
});
test('malformed auth JSON does not leak parser excerpts', async t => {
  const s = await setup(t, (_, res) => res.end('secret-response-not-json'));
  await s.store.mutate(async state => { state.tokens = tokens(); });
  const result = await s.run(['auth', 'refresh']); assert.equal(result.code, 9);
  assert.doesNotMatch(result.stderr, /secret-response/);
});
test('explicit expiry response is distinguished from HTTP 401; reset token remains private', async t => {
  const s = await setup(t, (req, res) => {
    if (req.url.includes('/authorize')) { res.end(); return; }
    res.end(JSON.stringify({ nextOp: 'expired', success: false, pwdResetToken: 'RESET-SECRET', password: 'ECHO-SECRET' }));
  });
  const result = await s.run(['auth', 'login', '--password', 'synthetic']);
  assert.equal(result.code, 9); assert.match(result.stderr, /explicitly reports password expiry/);
  assert.doesNotMatch(result.stderr, /RESET-SECRET|ECHO-SECRET/); assert.equal(s.calls.length, 2);
});
test('untrusted callback is not followed or exchanged for tokens', async t => {
  const s = await setup(t, (req, res) => {
    if (req.url.includes('/authorize')) { res.end(); return; }
    res.end(JSON.stringify({ nextOp: 'redirect', redirectUrl: 'https://untrusted.invalid/?code=CODE-SECRET' }));
  });
  const result = await s.run(['auth', 'login', '--password', 'synthetic']);
  assert.equal(result.code, 9); assert.equal(s.calls.length, 2); assert.doesNotMatch(result.stderr, /CODE-SECRET|untrusted.invalid/);
});
test('timeout does not retry refresh', async t => {
  const s = await setup(t, () => {});
  await s.store.mutate(async state => { state.tokens = tokens(); });
  const result = await s.run(['auth', 'refresh', '--timeout', '0.1']);
  assert.equal(result.code, 10); assert.equal(s.calls.length, 1);
});
