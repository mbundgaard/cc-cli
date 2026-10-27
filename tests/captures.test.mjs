import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {captureBytes, verifyCapture} from '../dist/captures.js';
import {RecordHistoryStore} from '../dist/record-history.js';
import {setup, tokens} from './helpers.mjs';
import {CatalogueStore, targetFor} from '../dist/catalogue.js';
import {readDefinitions} from '../dist/read-definitions.js';
import {recordDefinitions} from '../dist/record-definitions.js';
async function ready(s) {
  await s.store.mutate(async state=>{state.tokens=tokens();});
  await new CatalogueStore(s.directory).detect(targetFor(await s.store.load()), {enterprise:'19.synthetic',api:'23.synthetic'});
}
const context = {company:'SYNTHETIC@idm.invalid',apiUrl:'https://api.invalid',task:'order-devices',apiVersion:'v2',scopeKind:'rvc',scopeId:'7',detail:'detailed',purpose:'read'};
const page = items => Buffer.from(JSON.stringify({items,count:items.length,totalResults:items.length,hasMore:false}));
async function directory(t) { const dir=await fs.mkdtemp(path.join(tmpdir(),'cc-capture-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir; }

test('every reviewed task has mandatory record metadata and uses the generic history pipeline', async t => {
  const dir=await directory(t);
  assert.deepEqual(Object.keys(recordDefinitions).sort(),readDefinitions.map(d=>d.id).sort());
  const samples={
    'server-version':{simphonyEnterpriseVersion:'19.synthetic','C&CVersion':'23.synthetic'},
    hierarchy:{items:[{hierUnitId:1,nodes:[{hierUnitId:7}]}]},
    'hierarchy-nodes':{items:[{hierUnitId:7,hierStrucId:71},{hierUnitId:7,hierStrucId:72}]},
    'menu-item-masters':{items:[{hierUnitId:7,objectNum:1}]},
    'kds-displays':{items:[{hierUnitId:7,objectNum:1}]},
    'order-devices':{items:[{hierUnitId:7,objectNum:1}]},
    workstations:{items:[{hierUnitId:7,objectNum:1}]},
    'order-types':{items:[{hierUnitId:7,lineNum:1}]},
    'order-type-parameters':{items:[{hierUnitId:7,objectNum:1}]},
  };
  for(const definition of readDefinitions) for(const apiVersion of Object.keys(definition.paths)) {
    const receipt=await captureBytes(dir,Buffer.from(JSON.stringify(samples[definition.id])),{...context,task:definition.id,apiVersion});
    assert.equal(receipt.historyStatus,'complete');assert.ok(receipt.recordCount>=1);
    await verifyCapture(dir,receipt);
  }
});

test('file-first production reads retain exact small bodies and index supported records', async t => {
  const raw=' {"items":[{"hierUnitId":7,"objectNum":3,"future":90071992547409931234,"nested":[null]}],"count":1,"totalResults":1,"hasMore":false} ';
  const s=await setup(t,(_,res)=>res.end(raw));await ready(s);
  const r=await s.run(['order-devices','list','--hier-unit-id','7','--include-all','detailed','--quiet']);
  assert.equal(r.code,0,r.stderr);
  const receipt=JSON.parse(r.stdout);assert.equal(receipt.delivery,'file');assert.equal(receipt.historyStatus,'complete');assert.equal(receipt.recordCount,1);
  assert.equal(await fs.readFile(receipt.path,'utf8'),raw);assert.doesNotMatch(r.stdout,/90071992547409931234|nested|synthetic-id/);
  const manifest=JSON.parse(await fs.readFile(receipt.manifestPath,'utf8'));
  const history=await new RecordHistoryStore(s.directory).load(manifest.entries[0].identity);
  assert.match(JSON.stringify(history),/90071992547409931234/);assert.equal(history.observations.length,1);
  assert.equal(s.calls.length,1);
});

test('identity-less projections fail capture for ordinary reads as well as pre-change reads',async t=>{
  const dir=await directory(t),raw=page([{name:'Projected'}]);
  await assert.rejects(captureBytes(dir,raw,{...context,detail:'projection',projection:'name'}));
  await assert.rejects(captureBytes(dir,raw,{...context,requireRecord:true,purpose:'pre-update'}));
});

test('foreign or duplicate identities fail with no guessed/merged history',async t=>{
  const dir=await directory(t);
  for(const rows of [[{hierUnitId:8,objectNum:3}],[{hierUnitId:7,objectNum:3},{hierUnitId:7,objectNum:3}]]) {
    await assert.rejects(captureBytes(dir,page(rows),context));
  }
  await assert.rejects(fs.lstat(path.join(dir,'records')));
});

test('pre-change evidence verifies raw source, proposal and saved observation; any tampering blocks',async t=>{
  const dir=await directory(t),raw=page([{hierUnitId:7,objectNum:3,old:1}]);
  for(const changed of ['response.body','proposed.json','manifest.json']) {
    const result=await captureBytes(dir,raw,{...context,purpose:'pre-update',requireRecord:true,expectedObjectNum:'3'},{hierUnitId:7,objectNum:3,new:2});
    await verifyCapture(dir,result);
    await fs.writeFile(path.join(path.dirname(result.manifestPath),changed),'{}');
    await assert.rejects(verifyCapture(dir,result),/evidence/);
  }
});

test('required capture rejects incomplete pages and multi-record results',async t=>{
  const dir=await directory(t);
  for(const body of [
    {items:[{hierUnitId:7,objectNum:3}],count:1,totalResults:2,hasMore:true},
    {items:[{hierUnitId:7,objectNum:3},{hierUnitId:7,objectNum:4}],count:2,totalResults:2,hasMore:false},
    {items:[],count:0,totalResults:0,hasMore:false},
  ]) await assert.rejects(captureBytes(dir,Buffer.from(JSON.stringify(body)),{...context,requireRecord:true,purpose:'pre-delete'}));
});

test('failed manifest finalization retains raw evidence and cannot verify as a complete capture',async t=>{
  const dir=await directory(t),original=fs.rename;
  let manifestPath,versions=0;
  try {
    fs.rename=async(from,to)=>{
      if(String(to).endsWith('manifest.json')) {manifestPath=to;versions++;if(versions>=2)throw new Error('Synthetic disk failure');}
      return original(from,to);
    };syncBuiltinESMExports();
    await assert.rejects(captureBytes(dir,page([{hierUnitId:7,objectNum:3}]),context),/capture\/indexing failed/);
  }finally{fs.rename=original;syncBuiltinESMExports();}
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));assert.equal(manifest.status,'indexing');
  assert.ok((await fs.readFile(path.join(path.dirname(manifestPath),'response.body'))).length>0);
});

test('malformed success JSON retains raw evidence but never reports an indexed capture',async t=>{
  const s=await setup(t,(_,res)=>res.end('not-json-SYNTHETIC-PRIVATE'));await ready(s);
  const r=await s.run(['order-devices','list','--hier-unit-id','7','--quiet']);
  assert.notEqual(r.code,0);assert.equal(r.stdout,'');assert.doesNotMatch(r.stderr,/not-json-SYNTHETIC-PRIVATE/);
  const dirs=await fs.readdir(path.join(s.directory,'responses'));assert.equal(dirs.length,1);
  assert.equal(await fs.readFile(path.join(s.directory,'responses',dirs[0],'response.body'),'utf8'),'not-json-SYNTHETIC-PRIVATE');
});

test('API errors are stored as bytes but never added to record history',async t=>{
  const s=await setup(t,(_,res)=>{res.statusCode=400;res.end('{"items":[{"hierUnitId":7,"objectNum":3}]}');});
  await ready(s);
  const result=await s.run(['order-devices','list','--hier-unit-id','7','--quiet']);assert.equal(result.code,11);
  const receipt=JSON.parse(result.stdout);assert.equal(receipt.httpStatus,400);assert.equal(receipt.captureId,undefined);
  await assert.rejects(fs.lstat(path.join(s.directory,'records')));
});
