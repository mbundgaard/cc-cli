import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildReadRequest} from '../dist/read-commands.js';
import {CatalogueStore, targetFor} from '../dist/catalogue.js';
import {setup, tokens, responseText} from './helpers.mjs';

test('workstation scope may come from JSON, never duplicates flags; nested synthetic secrets remain out of catalogue', async t => {
  const body = '{"items":[{"hierUnitId":7,"objectNum":1,"devices":[{"clientCertPassword":"SYNTHETIC-NOT-A-REAL-PASSWORD","customDeviceSettingsConfig":"SYNTHETIC-PRIVATE-SETTING"}],"newField":true}]}';
  const s = await setup(t, async (req, res) => {
    assert.equal(req.url, '/config/sim/v2/devices/getWorkstations');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {hierUnitId: 7, searchCriteria: 'where equals(objectNum,1)'});
    res.end(body);
  });
  await s.store.mutate(async state => {state.tokens = tokens();});
  const catalogue = new CatalogueStore(s.directory), target = targetFor(await s.store.load());
  await catalogue.detect(target, {enterprise: '19.synthetic', api: '23.synthetic'});
  const result = await s.run(['workstations','list','--json','{"hierUnitId":7,"searchCriteria":"where equals(objectNum,1)"}','--quiet']);
  assert.equal(result.code, 0, result.stderr); assert.equal(await responseText(result), body);
  const stored = await readFile(catalogue.file, 'utf8');
  assert.doesNotMatch(stored, /SYNTHETIC-NOT-A-REAL-PASSWORD|SYNTHETIC-PRIVATE-SETTING/);
  assert.match(stored, /clientCertPassword/); // Field name only, not its value.
  assert.equal(s.calls.length, 1);
  const profile = await s.store.load();
  assert.throws(() => buildReadRequest('workstations', profile, {hierUnitId: 7}, {hierUnitId: 7}));
});
