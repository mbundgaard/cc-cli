import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CatalogueStore, targetFor} from '../dist/catalogue.js';
import {setup, tokens} from './helpers.mjs';

test('order names retain lineNum and parameters retain future option widths; calls remain independent', async t => {
  const names = '{"items":[{"lineNum":3,"name":{"1":"Synthetic"},"futureNameField":true}]}';
  const parameters = '{"items":[{"objectNum":3,"options":"' + '01'.repeat(48) + '","orderDeviceMask":"000001","newOption":null}]}';
  const s = await setup(t, (req, res) => {
    if (req.url === '/config/sim/v2/setup/getOrderTypeNames') res.end(names);
    else if (req.url === '/config/sim/v2/setup/getOrderTypeParameters') res.end(parameters);
    else {res.writeHead(500); res.end('{}');}
  });
  await s.store.mutate(async state => {state.tokens = tokens();});
  const catalogue = new CatalogueStore(s.directory), target = targetFor(await s.store.load());
  await catalogue.detect(target, {enterprise: '19.synthetic', api: '23.synthetic'});
  const a = await s.run(['order-types', 'list', '--hier-unit-id', '7', '--order-by', 'lineNum:asc', '--quiet']);
  assert.equal(a.code, 0, a.stderr); assert.equal(a.stdout, names); assert.equal(s.calls.length, 1);
  const b = await s.run(['order-types', 'parameters', 'list', '--hier-unit-id', '7', '--quiet']);
  assert.equal(b.code, 0, b.stderr); assert.equal(b.stdout, parameters); assert.equal(s.calls.length, 2);
  const observations = (await catalogue.view(target)).environment.current.observations;
  assert.deepEqual(observations['order-types:v2'].fields['/items/*/lineNum'], ['number']);
  assert.equal(observations['order-types:v2'].fields['/items/*/objectNum'], undefined);
  assert.deepEqual(observations['order-type-parameters:v2'].fields['/items/*/options'], ['string']);
});
