import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildReadRequest } from '../dist/read-commands.js';
import { CatalogueStore, targetFor, compareFields } from '../dist/catalogue.js';
import { setup, tokens, responseText } from './helpers.mjs';
const profile = {schemaVersion: 1, product: 'cc', auth: {apiUrl: 'https://cc.example.invalid', orgName: 'Synthetic'}};
const acknowledgement = {organizationWide: true};
async function ready(s) {
  await s.store.mutate(async state => {state.tokens = tokens();});
  const catalogue = new CatalogueStore(s.directory), target = targetFor(await s.store.load());
  await catalogue.detect(target, {enterprise: '19.synthetic', api: '23.synthetic'});
  return {catalogue, target};
}
for (const [id, version, route] of [
  ['hierarchy', 'v1', '/config/sim/v1/hierarchy/getHierarchy'],
  ['hierarchy', 'v2', '/config/sim/v2/hierarchy/getHierarchy'],
  ['hierarchy-nodes', 'v2', '/config/sim/v2/hierarchy/getHierarchyNodes'],
]) test(`${id} ${version}: fixed route, explicit scope, extensible projection and untouched body`, () => {
  const body = {include: 'hierUnitId,newUndocumentedField', searchCriteria: 'where equals(hierUnitId,7)', offset: 0, limit: 2,
    orderBy: 'hierUnitId:asc', [version === 'v1' ? 'languages' : 'langIds']: version === 'v1' ? 'en-US' : '1'};
  const built = buildReadRequest(id, profile, body, {...acknowledgement, apiVersion: version});
  assert.equal(built.url, profile.auth.apiUrl + route); assert.deepEqual(built.body, body);
  assert.equal(built.scope, 'organization-wide'); assert.equal(built.method, 'POST');
  assert.equal(built.headers['Simphony-OrgShortName'], undefined); assert.equal(built.body.organizationWide, undefined);
  assert.deepEqual(buildReadRequest(id, profile, {}, {...acknowledgement, apiVersion: version}).body, {});
});
test('hierarchy request validation rejects wrong controls/version/missing scope before network or renewal', async t => {
  const s = await setup(t); await s.store.mutate(async state => {state.tokens = tokens();});
  await s.store.mutateCompanies(async registry => {registry.companies[registry.activeCompany].refreshAfter = '2000-01-01T00:00:00.000Z';});
  const before = await readFile(s.store.file, 'utf8');
  for (const args of [[], ['--json', '{}'], ['--organization-wide', '--languages', 'en-US'],
    ['--organization-wide', '--limit', '0'], ['--organization-wide', '--offset', '-1'], ['--organization-wide', '--limit', '9007199254740993'],
    ['--organization-wide', '--include', ''], ['--organization-wide', '--include-all', 'yes'],
    ['--organization-wide', '--json', '{"hierUnitId":7}'], ['--organization-wide', '--json', '{"organizationWide":true}'],
    ['--organization-wide', '--json', '{"limit":true}'], ['--organization-wide', '--json', '{"offset":null}'],
    ['--organization-wide', '--json', '{"include":"name"}', '--include', 'id'],
    ['--organization-wide', '--json', '{}', '--file', 'anything'], ['--organization-wide', '--json', '[]']]) {
    const result = await s.run(['hierarchy', 'list', ...args]); assert.equal(result.code, 6, JSON.stringify({args, ...result}));
  }
  assert.equal((await s.run(['hierarchy', 'nodes', 'list', '--organization-wide', '--api-version', 'v1'])).code, 6);
  assert.equal(s.calls.length, 0); assert.equal(await readFile(s.store.file, 'utf8'), before);
});
test('hierarchy dry-run works offline without catalogue/tokens; normal read never secretly fetches versions', async t => {
  const s = await setup(t);
  const r = await s.run(['hierarchy', 'list', '--organization-wide', '--dry-run', '--include', 'newField']);
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout).data.body, {include: 'newField'});
  await s.store.mutate(async state => {state.tokens = tokens();});
  const result = await s.run(['hierarchy', 'list', '--organization-wide', '--quiet']);
  assert.equal(result.code, 12); assert.match(result.stderr, /server-version/); assert.equal(s.calls.length, 0);
});
test('flags/JSON/file/stdin send one identical page and learn unknown fields without saving values or filters', async t => {
  const requests = [], body = '{"items":[{"hierUnitId":7,"newField":"PRIVATE-RECORD","nodes":[{"hierUnitId":8}]}],"hasMore":true,"limit":1}';
  const s = await setup(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({url: req.url, body: JSON.parse(Buffer.concat(chunks).toString())});
    assert.equal(req.headers.authorization, 'Bearer synthetic-id'); res.end(body);
  });
  const {catalogue, target} = await ready(s);
  const controls = {searchCriteria: "where equals(name,'PRIVATE-FILTER')", include: 'hierUnitId,newField,nodes', limit: 1, offset: 0};
  const file = path.join(s.directory, 'request.json'); await writeFile(file, JSON.stringify(controls));
  for (const [args, input] of [
    [['--search-criteria', controls.searchCriteria, '--include', controls.include, '--limit', '1', '--offset', '0'], ''],
    [['--json', JSON.stringify(controls)], ''], [['--file', file], ''], [['--file', '-'], JSON.stringify(controls)],
  ]) {
    const result = await s.run(['hierarchy', 'list', '--organization-wide', '--quiet', ...args], input);
    assert.equal(result.code, 0, result.stderr); assert.equal(await responseText(result), body);
  }
  assert.equal(requests.length, 4); for (const request of requests) assert.deepEqual(request, {url: '/config/sim/v2/hierarchy/getHierarchy', body: controls});
  const metadata = (await catalogue.view(target)).environment.current.observations['hierarchy:v2'];
  assert.equal(metadata.samples, 4); assert.deepEqual(metadata.fields['/items/*/newField'], ['string']);
  assert.deepEqual(metadata.fields['/items/*/nodes/*/hierUnitId'], ['number']);
  assert.doesNotMatch(await readFile(catalogue.file, 'utf8'), /PRIVATE-RECORD|PRIVATE-FILTER|synthetic-id/);
});
test('v1 hierarchy and v2 nodes remain separate, and HTTP failure neither retries nor learns', async t => {
  let status = 200;
  const s = await setup(t, (_, res) => {res.writeHead(status); res.end('{"items":[{"hierUnitId":7,"hierStrucId":8,"name":{"en-US":"private"}}]}');});
  const {catalogue, target} = await ready(s);
  assert.equal((await s.run(['hierarchy', 'list', '--api-version', 'v1', '--languages', 'en-US', '--organization-wide', '--quiet'])).code, 0);
  assert.equal((await s.run(['hierarchy', 'nodes', 'list', '--lang-ids', '1', '--organization-wide', '--quiet'])).code, 0);
  assert.deepEqual(Object.keys((await catalogue.view(target)).environment.current.observations), ['hierarchy:v1', 'hierarchy-nodes:v2']);
  const before = await readFile(catalogue.file, 'utf8'); status = 403;
  assert.equal((await s.run(['hierarchy', 'list', '--organization-wide', '--quiet'])).code, 11);
  assert.equal(await readFile(catalogue.file, 'utf8'), before); assert.equal(s.calls.length, 3);
});
for (const compressed of [false, true]) test(`hierarchy large ${compressed ? 'gzip' : 'plain'} response remains exact and learns through private export`, async t => {
  const body = Buffer.from(JSON.stringify({items: [{hierUnitId: 7, newField: 'x'.repeat(32 * 1024)}]}));
  const s = await setup(t, (_, res) => {if (compressed) res.setHeader('Content-Encoding', 'gzip'); res.end(compressed ? gzipSync(body) : body);});
  const {catalogue, target} = await ready(s);
  const result = await s.run(['hierarchy', 'list', '--organization-wide', '--quiet']); assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout); assert.equal(receipt.delivery, 'file');
  assert.deepEqual(await readFile(receipt.path), body); assert.equal(receipt.sha256, createHash('sha256').update(body).digest('hex'));
  assert.deepEqual((await catalogue.view(target)).environment.current.observations['hierarchy:v2'].fields['/items/*/newField'], ['string']);
});
test('recursive/open documented subtrees are indeterminate rather than falsely undocumented', () => {
  const result = compareFields({'/items/*/nodes/*': ['recursive'], '/items/*/name/*': ['unknown']}, {'/items/*/nodes/*/hierUnitId': ['number'], '/items/*/name/en-US': ['string']});
  assert.deepEqual(result.observedOnly, []); assert.deepEqual(result.indeterminate, ['/items/*/nodes/*/hierUnitId']);
  assert.deepEqual(result.documentedNotYetObserved, ['/items/*/nodes/*']);
});
