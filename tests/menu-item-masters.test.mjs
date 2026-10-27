import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildReadRequest } from '../dist/read-commands.js';
import { CatalogueStore, targetFor, importSpecification } from '../dist/catalogue.js';
import { readDefinitions } from '../dist/read-commands.js';
import { setup, tokens, responseText } from './helpers.mjs';
const profile = {schemaVersion: 1, product: 'cc', auth: {apiUrl: 'https://cc.example.invalid', orgName: 'Synthetic'}};
async function ready(s) {
  await s.store.mutate(async state => {state.tokens = tokens();});
  const catalogue = new CatalogueStore(s.directory), target = targetFor(await s.store.load());
  await catalogue.detect(target, {enterprise: '19.synthetic', api: '23.synthetic'});
  return {catalogue, target};
}
for (const version of ['v1', 'v2']) test(`menu item masters ${version}: explicit hierarchy and version-specific controls without column allowlists`, () => {
  const body = {hierUnitId: 7, include: 'name,name2,undocumentedField', searchCriteria: 'where equals(objectNum,1)',
    includeAll: 'detailed', offset: 0, limit: 10, orderBy: 'objectNum:asc', [version === 'v1' ? 'languages' : 'langIds']: version === 'v1' ? 'en-US' : '1'};
  const request = buildReadRequest('menu-item-masters', profile, body, {apiVersion: version});
  assert.equal(request.url, `https://cc.example.invalid/config/sim/${version}/menuItems/getMenuItemMasters`);
  assert.equal(request.method, 'POST'); assert.equal(request.scope, 'hierarchy-unit'); assert.deepEqual(request.body, body);
  assert.deepEqual(buildReadRequest('menu-item-masters', profile, {}, {hierUnitId: 7}).body, {hierUnitId: 7});
});
test('menu master scope is explicit: no hierarchy guessing, aliases, organization-wide or filter-only bypass', async t => {
  const s = await setup(t); await s.store.mutate(async state => {state.tokens = tokens();});
  await s.store.mutateCompanies(async registry => {registry.companies[registry.activeCompany].refreshAfter = '2000-01-01T00:00:00.000Z';});
  const before = await readFile(s.store.file, 'utf8');
  for (const args of [[], ['--search-criteria', 'where equals(hierUnitId,7)'], ['--organization-wide'],
    ['--hier-unit-id', '0'], ['--hier-unit-id', '-1'], ['--hier-unit-id', '1.5'], ['--hier-unit-id', '9007199254740993'],
    ['--json', '{"hierUnitId":null}'], ['--json', '{"hierUnitId":"7"}'], ['--json', '{"hierUnitId":true}'],
    ['--json', '{"hierUnitID":7}'], ['--json', '{"hierStrucId":7}'],
    ['--hier-unit-id', '7', '--json', '{"hierUnitId":8}'], ['--hier-unit-id', '7', '--languages', 'en-US'],
    ['--hier-unit-id', '7', '--api-version', 'v1', '--lang-ids', '1'],
    ['--json', '{"hierUnitId":7,"newRecordField":"not-a-request-control"}']]) {
    const result = await s.run(['menu-item-masters', 'list', ...args]); assert.equal(result.code, 6, JSON.stringify({args, ...result}));
  }
  assert.equal(s.calls.length, 0); assert.equal(await readFile(s.store.file, 'utf8'), before);
});
test('menu master dry-run needs neither tokens nor version cache and preserves explicit numeric input', async t => {
  const s = await setup(t);
  const result = await s.run(['menu-item-masters', 'list', '--json', '{"hierUnitId":7e0,"include":"newField"}', '--dry-run']);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /7e0/);
  assert.equal(s.calls.length, 0);
});
test('menu masters flags/JSON/file/stdin all send one page, preserve unknowns/options/translations/extensions exactly', async t => {
  const requests = [], response = '{"items":[{"hierUnitId":7,"objectNum":9007199254740993,"name":{"1":"SECRET-NAME"},"name2":{"1":"SECOND-NAME"},"miMasterOptions":"00000001","miMasterOptionsExt":{"futureOption":true},"dataExtensions":[{"columnName":"CUSTOM-NAME","value":"SECRET-EXTENSION"}],"newField":null}],"hasMore":true}';
  const s = await setup(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); requests.push({url: req.url, body: JSON.parse(Buffer.concat(chunks).toString())});
    assert.equal(req.headers.authorization, 'Bearer synthetic-id'); res.end(response);
  });
  const {catalogue, target} = await ready(s);
  const body = {hierUnitId: 7, includeAll: 'detailed', limit: 5, offset: 0, langIds: '1'};
  const file = path.join(s.directory, 'request.json'); await writeFile(file, JSON.stringify(body));
  for (const [args, input] of [
    [['--hier-unit-id', '7', '--include-all', 'detailed', '--limit', '5', '--offset', '0', '--lang-ids', '1'], ''],
    [['--json', JSON.stringify(body)], ''], [['--file', file], ''], [['--file', '-'], JSON.stringify(body)],
  ]) {
    const result = await s.run(['menu-item-masters', 'list', '--quiet', ...args], input);
    assert.equal(result.code, 0, result.stderr); assert.equal(await responseText(result), response);
  }
  assert.equal(requests.length, 4); for (const request of requests) assert.deepEqual(request, {url: '/config/sim/v2/menuItems/getMenuItemMasters', body});
  const observation = (await catalogue.view(target)).environment.current.observations['menu-item-masters:v2'];
  assert.equal(observation.samples, 4); assert.deepEqual(observation.projections, ['includeAll:detailed']);
  assert.deepEqual(observation.fields['/items/*/miMasterOptions'], ['string']);
  assert.deepEqual(observation.fields['/items/*/miMasterOptionsExt/futureOption'], ['boolean']);
  assert.deepEqual(observation.fields['/items/*/dataExtensions/*/columnName'], ['string']);
  assert.deepEqual(observation.fields['/items/*/newField'], ['null']);
  assert.doesNotMatch(await readFile(catalogue.file, 'utf8'), /SECRET-NAME|SECRET-EXTENSION|CUSTOM-NAME|9007199254740993|00000001/);
});
test('v1/v2 menu translations are not converted or combined and failures neither fallback nor enrich', async t => {
  let status = 200;
  const s = await setup(t, (req, res) => {
    const body = req.url.includes('/v1/') ? '{"items":[{"hierUnitId":7,"objectNum":1,"name":{"en-US":"Synthetic"},"effectivityGroups":[{"effectivityGroupName":{"en-US":"Synthetic"}}]}]}' : '{"items":[{"hierUnitId":7,"objectNum":1,"name":{"1":"Synthetic"},"name2":{"1":"Synthetic"}}]}';
    res.writeHead(status); res.end(body);
  });
  const {catalogue, target} = await ready(s);
  const one = await s.run(['menu-item-masters', 'list', '--hier-unit-id', '7', '--api-version', 'v1', '--quiet']);
  const two = await s.run(['menu-item-masters', 'list', '--hier-unit-id', '7', '--quiet']);
  assert.equal(one.code, 0); assert.equal(two.code, 0); assert.match(await responseText(one), /en-US/); assert.doesNotMatch(await responseText(two), /en-US/);
  assert.deepEqual(Object.keys((await catalogue.view(target)).environment.current.observations), ['menu-item-masters:v1', 'menu-item-masters:v2']);
  const before = await readFile(catalogue.file, 'utf8'); status = 429;
  const failed = await s.run(['menu-item-masters', 'list', '--hier-unit-id', '7', '--quiet']); assert.equal(failed.code, 11);
  assert.equal(s.calls.length, 3); assert.equal(await readFile(catalogue.file, 'utf8'), before);
});
for (const compressed of [false, true]) test(`menu master large ${compressed ? 'gzip' : 'plain'} response is a complete private file plus independent metadata`, async t => {
  const body = Buffer.from(JSON.stringify({items: [{hierUnitId: 7, objectNum: 1, unknownRecordField: 'x'.repeat(32 * 1024), nested: [{future: true}]}]}));
  const s = await setup(t, (_, res) => {if (compressed) res.setHeader('Content-Encoding', 'gzip'); res.end(compressed ? gzipSync(body) : body);});
  const {catalogue, target} = await ready(s);
  const result = await s.run(['menu-item-masters', 'list', '--hier-unit-id', '7', '--quiet']); assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout); assert.equal(receipt.delivery, 'file'); assert.deepEqual(await readFile(receipt.path), body);
  assert.deepEqual((await catalogue.view(target)).environment.current.observations['menu-item-masters:v2'].fields['/items/*/nested/*/future'], ['boolean']);
});
test('menu schemas remain independent and documented/discovered comparisons expose differences without rejecting data', async t => {
  const s = await setup(t, (_, res) => res.end('{"items":[{"hierUnitId":7,"objectNum":1,"futureNumber":"unexpected-string","name2":{"1":"private"},"undocumented":true}]}'));
  await ready(s);
  const paths = Object.fromEntries(['v1', 'v2'].map(version => [`/config/sim/${version}/menuItems/getMenuItemMasters`, {post: {responses: {'200': {schema: {type: 'object', properties: {items: {type: 'array', items: {type: 'object', properties: {
    hierUnitId: {type: 'integer'}, objectNum: {type: 'integer'}, futureNumber: {type: 'integer'}, name: {type: 'object'}, ...(version === 'v2' ? {name2: {type: 'object'}} : {}),
  }}}}}}}}}]));
  const file = path.join(s.directory, 'spec.json'); await writeFile(file, JSON.stringify({swagger: '2.0', info: {version: 'synthetic'}, paths}));
  const imported = await importSpecification(file, readDefinitions);
  assert.equal(imported.contracts['menu-item-masters:v1'].response['/items/*/name2'], undefined);
  assert.deepEqual(imported.contracts['menu-item-masters:v2'].response['/items/*/name2'], ['object']);
  assert.equal((await s.run(['catalogue', 'import', '--file', file])).code, 0);
  assert.equal((await s.run(['menu-item-masters', 'list', '--hier-unit-id', '7', '--quiet'])).code, 0);
  const result = JSON.parse((await s.run(['catalogue', 'compare', 'menu-item-masters'])).stdout).data;
  assert.deepEqual(result.observedOnly, ['/items/*/undocumented']);
  assert.deepEqual(result.typeDifferences.map(item => item.path), ['/items/*/futureNumber']);
  assert.ok(result.documentedNotYetObserved.includes('/items/*/name'));
  assert.equal(s.calls.length, 1);
});
