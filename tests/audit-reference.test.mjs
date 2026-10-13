import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditReference} from '../dist/guarded-write.js';
import {executeKdsWrite} from '../dist/kds-display-writes.js';
import {WriteScopeStore} from '../dist/write-scope.js';
import {setup,tokens} from './helpers.mjs';

test('audit identity has one exact product format; preserves saved username case without task/location suffixes',()=>{
  assert.equal(auditReference('Synthetic_User'),'Muneris CC-CLI // Synthetic_User');
  assert.equal(auditReference('mixed_CASE'),'Muneris CC-CLI // mixed_CASE');
  assert.equal(auditReference(' User '),'Muneris CC-CLI //  User ');
});
test('50 ASCII characters accepted, 51 rejected locally without truncation',()=>{
  const prefix='Muneris CC-CLI // ';
  assert.equal(prefix.length,18);
  assert.equal(auditReference('x'.repeat(32)),prefix+'x'.repeat(32));
  assert.equal(auditReference('x'.repeat(32)).length,50);
  assert.throws(()=>auditReference('x'.repeat(33)),/50-character.*not truncated/);
});
for(const username of [undefined,null,'','  ','user\r\nInjected: value','user\t','user\x7f','Usér','user😀'])test(`invalid audit username fails: ${JSON.stringify(username)}`,()=>{
  assert.throws(()=>auditReference(username),/printable ASCII/);
});
test('overlong saved account blocks even preparation before due renewal or data requests',async t=>{
  const s=await setup(t);
  await s.store.mutate(async state=>{state.auth.username='x'.repeat(33);state.tokens=tokens();});
  await s.store.mutateCompanies(async registry=>{registry.companies[registry.activeCompany].refreshAfter='2000-01-01T00:00:00Z';});
  const scope=new WriteScopeStore(s.directory),company=(await s.store.loadCompanies()).activeCompany;
  await scope.configure(s.store,901,70,[],company,901,false);
  const before=await readFile(s.store.file,'utf8');
  await assert.rejects(executeKdsWrite('update',s.store,{hierUnitId:70,objectNum:4,json:JSON.stringify({hierUnitId:70,objectNum:4,name:{'1':'Synthetic'}}),prepare:true,quiet:true}),/50-character/);
  assert.equal(s.calls.length,0);assert.equal(await readFile(s.store.file,'utf8'),before);
});
test('all write commands advertise the fixed reference and reject custom flags offline',async t=>{
  const s=await setup(t);
  const commands=[['order-devices','update'],['kds-displays','create'],['kds-displays','update'],['kds-displays','delete']];
  for(const command of commands){
    const help=await s.run([...command,'--help']);assert.equal(help.code,0);assert.match(help.stdout,/Muneris CC-CLI \/\/ <saved username>/);assert.doesNotMatch(help.stdout,/--audit-ref/);
    const old=await s.run([...command,'--hier-unit-id','70','--object-num','4','--audit-ref','custom']);assert.equal(old.code,6);assert.equal(old.stdout,'');
  }
  assert.equal(s.calls.length,0);
});
