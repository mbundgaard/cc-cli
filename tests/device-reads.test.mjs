import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {buildReadRequest} from '../dist/read-commands.js';
import {CatalogueStore, targetFor} from '../dist/catalogue.js';
import {setup, tokens} from './helpers.mjs';

// Independent reviewed route fixtures, not generated from the production registry.
export const cases = [
  {id: 'kds-displays', command: ['kds-displays', 'list'], mode: 'criteria',
    v1: '/config/sim/v1/devices/getKitchenDisplays', v2: '/config/sim/v2/devices/getKitchenDisplays'},
  {id: 'order-devices', command: ['order-devices', 'list'], mode: 'criteria',
    v1: '/config/sim/v1/devices/getOrderDevices', v2: '/config/sim/v2/devices/getOrderDevices'},
  {id: 'workstations', command: ['workstations', 'list'], mode: 'body',
    v1: '/config/sim/v1/devices/getWorkstations', v2: '/config/sim/v2/devices/getWorkstations'},
  {id: 'order-types', command: ['order-types', 'list'], mode: 'criteria',
    v1: '/config/sim/v1/setup/getordertypenames', v2: '/config/sim/v2/setup/getOrderTypeNames'},
  {id: 'order-type-parameters', command: ['order-types', 'parameters', 'list'], mode: 'criteria',
    v1: '/config/sim/v1/setup/getOrderTypeParameters', v2: '/config/sim/v2/setup/getOrderTypeParameters'},
];
const profile = {schemaVersion: 1, product: 'cc', auth: {apiUrl: 'https://cc.example.invalid', orgName: 'Synthetic'}};
async function ready(s) {
  await s.store.mutate(async state => {state.tokens = tokens();});
  const catalogue = new CatalogueStore(s.directory), target = targetFor(await s.store.load());
  await catalogue.detect(target, {enterprise: '19.synthetic', api: '23.synthetic'});
  return {catalogue, target};
}
for (const task of cases) {
  for (const version of ['v1', 'v2']) test(`${task.id} ${version}: reviewed route/scope, generic filters/sort/projection and no record allowlist`, () => {
    const body = {searchCriteria: "where (equals(newField,1) or contains(name,'Prep'))", include: 'objectNum,newField', includeAll: 'detailed',
      orderBy: 'newField:desc', limit: 5, offset: 10, [version === 'v1' ? 'languages' : 'langIds']: version === 'v1' ? 'en-US' : '1'};
    const before = JSON.stringify(body);
    const built = buildReadRequest(task.id, profile, body, {apiVersion: version, hierUnitId: 7});
    assert.equal(built.url, profile.auth.apiUrl + task[version]); assert.equal(built.method, 'POST'); assert.equal(JSON.stringify(body), before);
    const expected = task.mode === 'body' ? {...body, hierUnitId: 7} : {...body, searchCriteria: "where (equals(hierUnitId,7) and ((equals(newField,1) or contains(name,'Prep'))))"};
    assert.deepEqual(built.body, expected); assert.equal(built.headers['Simphony-OrgShortName'], undefined);
    assert.deepEqual(buildReadRequest(task.id, profile, {}, {hierUnitId: 7}).body, task.mode === 'body' ? {hierUnitId: 7} : {searchCriteria: 'where equals(hierUnitId,7)'});
  });
  test(`${task.id}: flags/JSON/file/stdin each make one scoped call, no pagination/dependencies or transformation`, async t => {
    const requests = [], response = '{"items":[{"hierUnitId":7,"name":{"1":"PRIVATE-NAME"},"options":"00001","optionsExt":{"newBit":true},"newField":9007199254740993,"panelConfiguration":[{"futureField":null}]}],"hasMore":true}';
    const s = await setup(t, async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      requests.push({url: req.url, body: JSON.parse(Buffer.concat(chunks).toString())});
      assert.equal(req.headers.authorization, 'Bearer synthetic-id'); res.end(response);
    });
    const {catalogue, target} = await ready(s);
    const controls = {searchCriteria: 'where equals(objectNum,1)', include: 'newField,options,optionsExt,panelConfiguration', orderBy: 'newField:desc', limit: 5, offset: 0, langIds: '1'};
    const file = path.join(s.directory, 'request.json'); await writeFile(file, JSON.stringify(controls));
    for (const [args, input] of [
      [['--search-criteria', controls.searchCriteria, '--include', controls.include, '--order-by', controls.orderBy, '--limit', '5', '--offset', '0', '--lang-ids', '1'], ''],
      [['--json', JSON.stringify(controls)], ''], [['--file', file], ''], [['--file', '-'], JSON.stringify(controls)],
    ]) {
      const r = await s.run([...task.command, '--hier-unit-id', '7', '--quiet', ...args], input);
      assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout, response);
    }
    assert.equal(requests.length, 4);
    const expected = task.mode === 'body' ? {...controls, hierUnitId: 7} : {...controls, searchCriteria: 'where (equals(hierUnitId,7) and (equals(objectNum,1)))'};
    for (const request of requests) assert.deepEqual(request, {url: task.v2, body: expected});
    const observation = (await catalogue.view(target)).environment.current.observations[task.id + ':v2'];
    assert.equal(observation.samples, 4); assert.deepEqual(observation.fields['/items/*/newField'], ['number']);
    assert.deepEqual(observation.fields['/items/*/optionsExt/newBit'], ['boolean']);
    assert.doesNotMatch(await readFile(catalogue.file, 'utf8'), /PRIVATE-NAME|00001|9007199254740993|synthetic-id/);
  });
  test(`${task.id}: invalid scope/controls fail offline before due-token renewal; dry-run requires no version cache`, async t => {
    const s = await setup(t); await s.store.mutate(async state => {state.tokens = tokens();});
    await s.store.mutateCompanies(async registry => {registry.companies[registry.activeCompany].refreshAfter = '2000-01-01T00:00:00.000Z';});
    const before = await readFile(s.store.file, 'utf8');
    const bad = [[], ['--search-criteria', 'where equals(hierUnitId,7)'], ['--hier-unit-id', '0'], ['--hier-unit-id', '1.5'],
      ['--hier-unit-id', '7', '--organization-wide'], ['--hier-unit-id', '7', '--languages', 'en-US'],
      ['--hier-unit-id', '7', '--api-version', 'v1', '--lang-ids', '1'], ['--hier-unit-id', '7', '--limit', '0'],
      ['--hier-unit-id', '7', '--offset', '-1'], ['--hier-unit-id', '7', '--json', '{"arbitrary":"PRIVATE"}'],
      ['--hier-unit-id', '7', '--json', '{"hierStrucId":7}'], ['--hier-unit-id', '7', '--json', '{"orderBy":null}'],
      ['--hier-unit-id', '7', '--json', '{"include":"name"}', '--include', 'id'],
      ['--hier-unit-id', '7', '--json', '{}', '--file', 'absent']];
    if (task.mode === 'criteria') bad.push(['--json', '{"hierUnitId":7}'], ['--hier-unit-id', '7', '--json', '{"hierUnitId":7}'], ['--hier-unit-id', '7', '--search-criteria', 'equals(x,1)) or equals(hierUnitId,8)']);
    for (const args of bad) assert.equal((await s.run([...task.command, ...args])).code, 6, JSON.stringify(args));
    const dry = await s.run([...task.command, '--hier-unit-id', '7', '--include', 'undocumented', '--order-by', 'undocumented:asc', '--dry-run']);
    assert.equal(dry.code, 0, dry.stderr); assert.equal(JSON.parse(dry.stdout).data.authorizationOmitted, true);
    assert.equal((await s.run([...task.command, '--help'])).code, 0);
    assert.equal(s.calls.length, 0); assert.equal(await readFile(s.store.file, 'utf8'), before);
  });
  test(`${task.id}: explicit v1 stays v1; HTTP errors never fallback/retry or learn`, async t => {
    let status = 200;
    const body = '{"items":[{"futureField":true}]}';
    const s = await setup(t, (_, res) => {res.writeHead(status); res.end(body);});
    const {catalogue, target} = await ready(s);
    let result = await s.run([...task.command, '--hier-unit-id', '7', '--api-version', 'v1', '--quiet']);
    assert.equal(result.code, 0); assert.equal(s.calls[0], task.v1);
    assert.ok((await catalogue.view(target)).environment.current.observations[task.id + ':v1']);
    const before = await readFile(catalogue.file, 'utf8');
    for (const code of [400, 401, 403, 429, 503]) {
      status = code; result = await s.run([...task.command, '--hier-unit-id', '7', '--quiet']);
      assert.equal(result.code, code === 401 ? 9 : 11); assert.equal(result.stdout, body);
    }
    assert.equal(s.calls.length, 6); assert.equal(await readFile(catalogue.file, 'utf8'), before);
  });
  for (const compressed of [false, true]) test(`${task.id}: large ${compressed ? 'gzip' : 'plain'} record exported exactly and structurally observed`, async t => {
    const body = Buffer.from(JSON.stringify({items: [{futureField: 'x'.repeat(32 * 1024), nested: [{enabled: true}]}]}));
    const s = await setup(t, (_, res) => {if (compressed) res.setHeader('Content-Encoding', 'gzip'); res.end(compressed ? gzipSync(body) : body);});
    const {catalogue, target} = await ready(s);
    const result = await s.run([...task.command, '--hier-unit-id', '7', '--quiet']); assert.equal(result.code, 0, result.stderr);
    const receipt = JSON.parse(result.stdout); assert.equal(receipt.delivery, 'file'); assert.deepEqual(await readFile(receipt.path), body);
    assert.deepEqual((await catalogue.view(target)).environment.current.observations[task.id + ':v2'].fields['/items/*/nested/*/enabled'], ['boolean']);
  });
}
