import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CatalogueStore, compareFields, documentedFields, importSpecification, observeFields, releaseVersions, targetFor } from '../dist/catalogue.js';
import { readDefinitions } from '../dist/read-commands.js';
import { setup, tokens, responseText } from './helpers.mjs';
const inline = value => ({kind: 'inline', body: Buffer.from(value)});
const target = {company: 'Synthetic@idm.example.invalid', apiUrl: 'https://cc.example.invalid', accountHash: 'synthetic'};
const versions = {enterprise: '19.9.synthetic', api: '23.synthetic'};
const specimen = () => ({swagger: '2.0', info: {version: 'synthetic'}, paths: Object.fromEntries(['v1', 'v2'].map(v => [`/config/sim/${v}/getReleaseVersions`, {post: {
  parameters: [{$ref: '#/parameters/versionBody'}], responses: {'200': {schema: {$ref: '#/definitions/version'}}},
}}])), parameters: {versionBody: {in: 'body', schema: {type: 'object', properties: {include: {type: 'string'}}}}},
  definitions: {version: {type: 'object', properties: {simphonyEnterpriseVersion: {type: 'string'}, 'C&CVersion': {type: 'string'}, documentedOnly: {type: 'integer'}}}}});
async function isolated(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cc-catalogue-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return {directory, store: new CatalogueStore(directory)};
}
test('schema extraction resolves refs, nested arrays/maps, compositions, and rejects remote/broken references', () => {
  const document = {definitions: {item: {type: 'object', properties: {id: {type: 'integer'}, translated: {type: 'object'}}}}};
  const fields = documentedFields({type: 'array', items: {$ref: '#/definitions/item'}}, document);
  assert.deepEqual(fields['/*/id'], ['integer']); assert.deepEqual(fields['/*/translated/*'], ['unknown']);
  assert.throws(() => documentedFields({$ref: 'https://example.invalid/schema'}, {}));
  assert.throws(() => documentedFields({$ref: '#/absent'}, {}));
  assert.deepEqual(documentedFields({allOf: [{type: 'string'}, {type: 'null'}]}, {})[''], ['null', 'string']);
  const recursive = {definitions: {self: {type: 'object', properties: {next: {$ref: '#/definitions/self'}}}}};
  assert.deepEqual(documentedFields({$ref: '#/definitions/self'}, recursive)['/next'], ['recursive']);
});
test('Swagger import pins bytes/version and only imports hardcoded routes; never credentials, examples or arbitrary calls', async t => {
  const {directory, store} = await isolated(t), file = path.join(directory, 'spec.json');
  const specification = specimen(); specification.paths['/arbitrary'] = {post: {}};
  specification.definitions.version.properties.documentedOnly.example = 'DO-NOT-SAVE';
  await writeFile(file, JSON.stringify(specification));
  const source = await importSpecification(file, readDefinitions); await store.import(source);
  assert.deepEqual(Object.keys(source.contracts), ['server-version:v1', 'server-version:v2']);
  assert.match(source.sha256, /^[a-f0-9]{64}$/); assert.equal((await store.view()).document.version, 'synthetic');
  assert.doesNotMatch(await readFile(store.file, 'utf8'), /DO-NOT-SAVE|arbitrary|spec\.json/);
  await writeFile(file, '{bad json'); await assert.rejects(importSpecification(file, readDefinitions));
});
test('streamed observations keep structure/types only, normalize arrays/maps and union null with real types', async () => {
  const data = '{"items":[{"id":9007199254740993,"newField":"SECRET-VALUE","nullable":null,"name":{"en-US":"SECRET-TRANSLATION"}},{"id":1,"nullable":true,"name":{"da-DK":"SECRET"}}],"empty":[]}';
  const fields = await observeFields(inline(data), {'/items/*/name/*': ['unknown']});
  assert.deepEqual(fields['/items/*/id'], ['number']); assert.deepEqual(fields['/items/*/nullable'], ['boolean', 'null']);
  assert.deepEqual(fields['/items/*/name/*'], ['string']); assert.deepEqual(fields['/empty'], ['array']);
  assert.doesNotMatch(JSON.stringify(fields), /SECRET|en-US|9007199254740993/);
  await assert.rejects(observeFields(inline('{"field":1')));
  await assert.rejects(observeFields(inline('{}{}')));
  await assert.rejects(observeFields(inline(JSON.stringify({['x'.repeat(257)]: 1}))));
  const polluted = await observeFields(inline('{"__proto__":{"polluted":"x"}}'));
  assert.deepEqual(polluted['/__proto__/polluted'], ['string']); assert.equal({}.polluted, undefined);
});
test('large response observation streams values without retaining a record-sized string', async t => {
  const {directory} = await isolated(t), file = path.join(directory, 'large.json');
  const handle = await open(file, 'wx');
  try {
    await handle.writeFile('{"items":[{"large":"');
    for (let i = 0; i < 128; i++) await handle.writeFile('x'.repeat(1024 * 1024));
    await handle.writeFile('","after":true}]}');
  } finally { await handle.close(); }
  const fields = await observeFields({kind: 'file', path: file});
  assert.deepEqual(fields['/items/*/large'], ['string']); assert.deepEqual(fields['/items/*/after'], ['boolean']);
  assert.ok(JSON.stringify(fields).length < 300);
});
test('comparison distinguishes undocumented/type discrepancies/not-yet-observed and makes no null or integer inference', () => {
  const result = compareFields({'/id': ['integer'], '/nullable': ['string'], '/absent': ['boolean'], '/changed': ['integer']},
    {'/id': ['number'], '/nullable': ['null'], '/changed': ['string'], '/new': ['object']});
  assert.deepEqual(result.observedOnly, ['/new']); assert.deepEqual(result.documentedNotYetObserved, ['/absent']);
  assert.deepEqual(result.typeDifferences.map(item => item.path), ['/changed']);
  assert.match(result.caveat, /not mean missing/);
});
test('catalogue versions archive, never merge across versions/accounts/environments/contracts and fence in-flight learning', async t => {
  const {store} = await isolated(t);
  await store.detect(target, versions); const first = (await store.view(target)).environment.current;
  await store.observe(target, first.id, 'example:v2', {'/new': ['string']}, 'default');
  await store.observe(target, first.id, 'example:v1', {'/legacy': ['number']}, 'default');
  await store.detect(target, versions); assert.equal((await store.view(target)).environment.current.id, first.id);
  await store.detect(target, {...versions, api: '24.synthetic'});
  const next = (await store.view(target)).environment;
  assert.notEqual(next.current.id, first.id); assert.deepEqual(next.current.observations, {});
  assert.deepEqual(next.archives[0].observations['example:v2'].fields, {'/new': ['string']});
  await assert.rejects(store.observe(target, first.id, 'example:v2', {'/stale': ['string']}, 'default'));
  assert.equal((await store.view({...target, accountHash: 'another'})).environment, undefined);
  assert.equal((await store.view({...target, apiUrl: 'https://other.example.invalid'})).environment, undefined);
  await store.detect(target, versions); assert.equal((await store.view(target)).environment.archives.length, 2);
});
test('catalogue locks/corruption never overwrite prior data and unsafe version values cannot become paths', async t => {
  const {store} = await isolated(t); await store.detect(target, versions);
  const before = await readFile(store.file, 'utf8'); await writeFile(store.file + '.lock', 'synthetic');
  await assert.rejects(store.detect(target, {...versions, api: 'other'})); assert.equal(await readFile(store.file, 'utf8'), before);
  await rm(store.file + '.lock'); await writeFile(store.file, '{broken');
  await assert.rejects(store.detect(target, versions)); assert.equal(await readFile(store.file, 'utf8'), '{broken');
  assert.throws(() => releaseVersions({'simphonyEnterpriseVersion': '../bad', 'C&CVersion': 'x'}));
  assert.throws(() => releaseVersions({}));
});
test('explicit version read learns metadata; HTTP errors do not; catalogue lock warns without changing output/status', async t => {
  let status = 200;
  const body = '{"simphonyEnterpriseVersion":"19.synthetic","C&CVersion":"23.synthetic","observedOnly":"DO-NOT-SAVE"}';
  const s = await setup(t, (_, res) => {res.writeHead(status); res.end(body);});
  await s.store.mutate(async state => {state.tokens = tokens();});
  const catalogue = new CatalogueStore(s.directory);
  let r = await s.run(['server-version', '--quiet']); assert.equal(r.code, 0, r.stderr); assert.equal(await responseText(r), body);
  const before = await readFile(catalogue.file, 'utf8'); assert.doesNotMatch(before, /DO-NOT-SAVE|synthetic-id|synthetic-refresh/);
  status = 400; r = await s.run(['server-version', '--quiet']); assert.equal(r.code, 11); assert.equal(await readFile(catalogue.file, 'utf8'), before);
  status = 200; await writeFile(catalogue.file + '.lock', 'synthetic');
  r = await s.run(['server-version', '--quiet']); assert.equal(r.code, 0); assert.equal(await responseText(r), body); assert.match(r.stderr, /Metadata was not saved/);
  assert.equal(await readFile(catalogue.file, 'utf8'), before); assert.equal(s.calls.length, 3);
});
test('local catalogue commands stay offline and compare imported schemas with observed structures', async t => {
  const s = await setup(t), file = path.join(s.directory, 'spec.json'); await writeFile(file, JSON.stringify(specimen()));
  assert.equal((await s.run(['catalogue', 'import', '--file', file])).code, 0);
  const r = await s.run(['catalogue', 'compare', 'server-version']); assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout).data; assert.equal(result.referenceAvailable, true); assert.equal(result.observationAvailable, false);
  assert.equal((await s.run(['catalogue', 'show'])).code, 0);
  assert.equal((await s.run(['catalogue', 'changes', 'server-version'])).code, 6);
  assert.equal((await s.run(['catalogue', 'compare', 'arbitrary'])).code, 6);
  assert.equal((await s.run(['catalogue', 'compare', 'server-version', '--archive', 'absent'])).code, 6);
  assert.equal(s.calls.length, 0);
  const profile = await s.store.load(); const other = {...profile, auth: {...profile.auth, username: 'Different'}};
  assert.notEqual(targetFor(profile).accountHash, targetFor(other).accountHash);
});
