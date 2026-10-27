import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {ResponseCollector} from '../dist/responses.js';
import {prepareQuery} from '../dist/requests.js';
import {exchangeConfiguration} from '../dist/configuration-exchange.js';
import {readOperations, mutationOperations, readOperationById} from '../dist/configuration-policy.js';
import {guardedDefinition} from '../dist/guarded-write.js';
import {WriteScopeStore, SHARED_WRITE_LOCK} from '../dist/write-scope.js';
import {setup, tokens} from './helpers.mjs';

const capture = url => ({company:'test-enterprise@127.0.0.1',apiUrl:url,task:'order-devices',apiVersion:'v2',scopeKind:'rvc',scopeId:'7',detail:'detailed',purpose:'read'});

test('missing/mismatched mandatory read metadata fails before renewal or configuration dispatch',async t=>{
  const s=await setup(t);await s.store.mutate(async state=>{state.tokens=tokens();});
  await s.store.mutateCompanies(async registry=>{registry.companies[registry.activeCompany].refreshAfter='2000-01-01T00:00:00.000Z';});
  const request={method:'POST',url:s.url+'/config/sim/v2/devices/getOrderDevices',headers:{},body:{},scope:'rvc'};
  await assert.rejects(prepareQuery(s.store,{quiet:true},()=>request),/mandatory/);
  await assert.rejects(prepareQuery(s.store,{quiet:true},()=>({...request,capture:{...capture(s.url),task:'kds-displays'}})),/capture/);
  await assert.rejects(exchangeConfiguration({...request,body:'{}'},s.directory,{kind:'read'}),/capture/);
  await assert.rejects(exchangeConfiguration({...request,body:'{}'},s.directory,undefined),/context/);
  assert.equal(s.calls.length,0);
});

test('compiled read/write capabilities are coherent and produce guarded definitions without topic defaults',()=>{
  assert.ok(readOperations.every(op=>op.record&&op.catalogueRole&&op.apiVersion&&op.task));
  for(const op of mutationOperations){
    const definition=guardedDefinition(op.id,'synthetic',[],()=>[]);
    assert.equal(definition.action,op.effect);assert.equal(definition.namespace,op.namespace);
    assert.equal(definition.scope,op.scope);assert.equal(definition.path,op.path);
    assert.equal(definition.readPath,readOperationById(op.readOperationId).path);
  }
  assert.throws(()=>guardedDefinition('invented:update:v2','synthetic',[],()=>[]));
  assert.throws(()=>readOperationById('invented:v2'));
});

test('one network lifecycle is enforced structurally; collector code is network-free',async()=>{
  for(const name of await readdir(new URL('../src/',import.meta.url))){
    if(!name.endsWith('.ts'))continue;
    const source=await readFile(new URL(`../src/${name}`,import.meta.url),'utf8');
    if(!['configuration-exchange.ts','configuration-policy.ts'].includes(name))assert.doesNotMatch(source,/\bconfigurationRequestInto\b/,name);
    if(['guarded-write.ts','requests.ts','configuration-exchange.ts','catalogue-commands.ts'].includes(name)){
      assert.doesNotMatch(source,/(?:===|!==)\s*['"](?:order-device|kds-display|server-version)['"]/,name);
      assert.doesNotMatch(source,/capture\?:/,name);
    }
  }
  const collector=await readFile(new URL('../src/responses.ts',import.meta.url),'utf8');
  assert.doesNotMatch(collector,/from ['"]\.\/(?:transport|configuration-policy|captures)/);
});

test('shared response persistence refuses linked roots before writing customer bytes',async t=>{
  const s=await setup(t),external=await mkdtemp(path.join(tmpdir(),'cc-external-responses-'));
  t.after(()=>rm(external,{recursive:true,force:true}));
  await symlink(external,path.join(s.directory,'responses'),process.platform==='win32'?'junction':'dir');
  const collector=new ResponseCollector(s.directory,true);
  await assert.rejects(pipeline(Readable.from([Buffer.from('private-synthetic')]),collector));
  await collector.discard();
  assert.deepEqual(await readdir(external),[]);
});

test('all approval namespaces retain the same legacy lock, with no accidental split-lock migration',async t=>{
  const s=await setup(t);
  const names=[...new Set(mutationOperations.map(o=>o.namespace))];
  assert.equal(new Set(names.map(name=>new WriteScopeStore(s.directory,name).lock)).size,1);
  assert.equal(SHARED_WRITE_LOCK,'order-device-write.lock');
});
