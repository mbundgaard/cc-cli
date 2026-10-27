import {test} from 'node:test';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {readFile, writeFile, readdir, unlink} from 'node:fs/promises';
import {RecordHistoryStore} from '../dist/record-history.js';
import path from 'node:path';
import {setup, tokens, responseText} from './helpers.mjs';
import {WriteScopeStore} from '../dist/write-scope.js';
import {executeOrderDeviceUpdate} from '../dist/order-device-update.js';

const body = {hierUnitId: 71, objectNum: 3, deviceType: 1, menuItemPrinting: 1, condimentSortType: 1, name: {'1': 'New synthetic name'}, kdsSettings: {beepOnNewOrder: 0}};
const options = extra => ({hierUnitId: 71, objectNum: 3, json: JSON.stringify(body), quiet: true, ...extra});
const list = items => ({items: items.map((item, index) => item.nodeType ? {...item, hierStrucId: item.hierUnitId * 100 + index + 1} : item), count: items.length, totalResults: items.length, hasMore: false, offset: 0});
async function capture(action) {
  const output = [], original = process.stdout.write;
  process.stdout.write = function(chunk, encoding, callback) { output.push(Buffer.from(chunk)); if(typeof encoding === 'function') encoding(); else callback?.(); return true; };
  try { return {value: await action(), stdout: Buffer.concat(output).toString()}; }
  finally { process.stdout.write = original; }
}
async function fixture(t, behavior = {}) {
  const requests = [];
  const current = {...body, name: {'1': 'Old synthetic name'}, untouched: 'SYNTHETIC-RECORD-VALUE'};
  const s = await setup(t, async (req, res) => {
    const chunks = []; for await(const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const request = {url: req.url, raw, body: JSON.parse(raw), headers: req.headers}; requests.push(request);
    assert.equal(req.headers.authorization, 'Bearer synthetic-id');
    if(behavior.respond && await behavior.respond(request, res, s)) return;
    if(req.url === '/config/sim/v2/hierarchy/getHierarchyNodes') {
      if(request.body.searchCriteria.includes('(hierUnitId,70)')) res.end(JSON.stringify(list([{hierUnitId:70, objectNum:901, nodeType:'Location'}, {hierUnitId:70, objectNum:901, nodeType:'Location'}])));
      else res.end(JSON.stringify(list([{hierUnitId:71, parentHierUnitId:70, nodeType:'RVC'}, {hierUnitId:71, parentHierUnitId:70, nodeType:'RVC'}])));
    } else if(req.url === '/config/sim/v2/devices/getOrderDevices') res.end(JSON.stringify(list([current])));
    else if(req.url === '/config/sim/v2/devices/updateOrderDevices') res.end('{"hierUnitId":71,"objectNum":3}');
    else { res.writeHead(500); res.end(); }
  });
  await s.store.mutate(async state => {state.tokens = tokens();});
  await s.store.mutateCompanies(async registry => {registry.companies[registry.activeCompany].refreshAfter = new Date(Date.now()+86400000).toISOString();});
  const scopes = new WriteScopeStore(s.directory), company = (await s.store.loadCompanies()).activeCompany;
  const scope = await scopes.configure(s.store, 901, 70, [71, 72], company, 901, false);
  const invoke = extra => capture(() => executeOrderDeviceUpdate(s.store, options(extra), async () => {}));
  const prepare = async extra => JSON.parse((await invoke({prepare:true, ...extra})).stdout).data;
  return {...s, scopes, scope, requests, current, invoke, prepare};
}
test('offline default/dry-run and CLI help; boundary and invalid input precede renewal', async t => {
  const s = await fixture(t);
  await s.store.mutateCompanies(async registry => {registry.companies[registry.activeCompany].refreshAfter='2000-01-01T00:00:00Z';});
  const before = await readFile(s.store.file, 'utf8');
  assert.equal(JSON.parse((await s.invoke({})).stdout).data.networkRequests, 0);
  const args=['order-devices','update','--hier-unit-id','71','--object-num','3','--json',JSON.stringify(body),'--dry-run'];
  assert.equal((await s.run(args)).code, 0);
  assert.equal((await s.run(['order-devices','update','--help'])).code, 0);
  assert.equal((await s.run([...args,'--api-version','v1'])).code, 6);
  assert.equal(s.calls.length, 0); assert.equal(await readFile(s.store.file,'utf8'), before);
});
for(const [name, extra] of [
  ['foreign RVC', {hierUnitId:81}], ['different object', {objectNum:4}], ['missing required field', {json:JSON.stringify({...body,deviceType:undefined})}],
  ['extra identity', {json:JSON.stringify({...body,hierUnitObjNum:999})}], ['nested identity', {json:JSON.stringify({...body,kdsSettings:{hierUnitId:81}}),allowUnverifiedFields:true}],
  ['selector alias', {json:JSON.stringify({...body,Hierarchy_Unit_ID:81}),allowUnverifiedFields:true}],
  ['batch', {json:JSON.stringify([body])}], ['nested batch', {json:JSON.stringify({...body,extension:[{objectNum:4}]}),allowUnverifiedFields:true}],
  ['unverified field without acknowledgement', {json:JSON.stringify({...body,futureFlag:true})}],
  ['header injection', {auditRef:'reference\r\nInjected: yes'}], ['infinite timeout', {timeout:Infinity}],
  ['no approval', {execute:true,ackUpdateRisks:true}], ['no risk acknowledgement', {execute:true,approve:'a'.repeat(64)}],
  ['mixed modes', {prepare:true,dryRun:true}], ['unsafe numeric identity', {objectNum:9007199254740992}],
  ['null identity', {json:JSON.stringify({...body,hierUnitId:null})}], ['wrong documented type', {json:JSON.stringify({...body,kdsSettings:{beepOnNewOrder:'0'}})}],
]) test(`update fails offline: ${name}`, async t => {
  const s=await fixture(t); await assert.rejects(s.invoke(extra)); assert.equal(s.calls.length,0);
});
test('prepare verifies duplicate placements and links saved evidence without values in approval; execute sends one exact object', async t => {
  const s=await fixture(t), plan=await s.prepare();
  assert.equal(plan.updateSent,false); assert.equal(plan.ownershipVerified,true); assert.ok(plan.changes.some(item=>item.field==='name'));
  assert.ok(plan.absentFromSubmittedPayload.includes('untouched')); assert.equal(s.requests.length,3);
  const approval=await readFile(s.scopes.approvalFile,'utf8'); assert.doesNotMatch(approval,/SYNTHETIC-RECORD-VALUE|Old synthetic name|New synthetic name|synthetic-id/);
  const result=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true});
  assert.equal(result.value,0); assert.equal(await responseText(result),'{"hierUnitId":71,"objectNum":3}'); assert.equal(s.requests.length,7);
  const update=s.requests.at(-1); assert.equal(update.url,'/config/sim/v2/devices/updateOrderDevices'); assert.deepEqual(update.body,body);
  assert.equal(update.headers['simphony-audittrailref'],'Muneris CC-CLI // Synthetic_User');
  assert.equal(s.requests.filter(r=>r.url.endsWith('updateOrderDevices')).length,1);
  assert.equal((await s.scopes.approval()).status,'consumed');
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/consumed/); assert.equal(s.requests.length,7);
  assert.ok(!(await readdir(s.directory)).some(name=>/snapshot|backup|response-/.test(name)));
});
test('prepare and execute retain separate pre-change observations, proposal and consumed evidence links', async t => {
  const s=await fixture(t), plan=await s.prepare();
  const prepared=JSON.parse(await readFile(plan.beforeCapture.manifestPath,'utf8'));
  assert.equal(prepared.status,'complete');assert.equal(prepared.entries.length,1);
  assert.deepEqual(JSON.parse(await readFile(path.join(path.dirname(plan.beforeCapture.manifestPath),'proposed.json'),'utf8')),body);
  await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true});
  const approval=await s.scopes.approval();assert.equal(approval.status,'consumed');
  assert.notEqual(approval.executionCapture.captureId,approval.beforeCapture.captureId);
  const history=await new RecordHistoryStore(s.directory).load(prepared.entries[0].identity);
  assert.equal(history.observations.length,2);
  assert.ok(history.observations.every(item=>item.record.name['1']==='Old synthetic name'));
});

test('small mutation responses are retained with durable HTTP outcome and no credentials', async t => {
  const s=await fixture(t),plan=await s.prepare();
  const result=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true});
  const receipt=JSON.parse(result.stdout),text=await readFile(receipt.attemptPath,'utf8'),attempt=JSON.parse(text);
  assert.equal(attempt.status,'http-response');assert.equal(attempt.httpStatus,200);
  assert.equal(attempt.responsePath,receipt.path);assert.equal(attempt.responseSha256,receipt.sha256);
  assert.equal(attempt.savedStateVerified,false);assert.doesNotMatch(text,/Bearer|synthetic-id|synthetic-refresh|Authorization/);
  assert.equal((await s.scopes.approval()).attemptPath,receipt.attemptPath);
  const folders=await readdir(path.join(s.directory,'responses'));
  const manifests=await Promise.all(folders.map(folder=>readFile(path.join(s.directory,'responses',folder,'manifest.json'),'utf8').then(JSON.parse).catch(()=>null)));
  assert.equal(manifests.filter(m=>m?.context?.purpose==='ownership').length,4);
});

test('durable attempt preparation failure blocks mutation before approval consumption', async t => {
  const s=await fixture(t),plan=await s.prepare();
  await writeFile(path.join(s.directory,'write-attempts'),'not-a-directory');
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}));
  assert.ok(s.requests.every(r=>!r.url.endsWith('updateOrderDevices')));
  assert.equal((await s.scopes.approval()).status,'prepared');
});

for (const failAt of [2,3]) test(`mutation journal persistence failure at stage ${failAt} never triggers a retry`, async t => {
  const s=await fixture(t),plan=await s.prepare(),original=fs.rename;
  let journalSaves=0;
  try {
    fs.rename=async(from,to)=>{
      if(String(to).includes('write-attempts')&&String(to).endsWith('manifest.json')){
        journalSaves++;if(journalSaves===failAt)throw new Error('Synthetic journal storage failure');
      }
      return original(from,to);
    };syncBuiltinESMExports();
    await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/uncertain/);
  }finally{fs.rename=original;syncBuiltinESMExports();}
  const approval=await s.scopes.approval();assert.equal(approval.status,'consumed');
  assert.equal(s.requests.filter(r=>r.url.endsWith('updateOrderDevices')).length,failAt===2?0:1);
  const attempt=JSON.parse(await readFile(approval.attemptPath,'utf8'));
  assert.equal(attempt.status,failAt===2?'prepared':'uncertain');
  if(failAt===3)assert.equal(await readFile(attempt.responsePath,'utf8'),'{"hierUnitId":71,"objectNum":3}');
});

test('lost mutation response retains an uncertain journal and consumed approval without retry', async t => {
  const s=await fixture(t,{respond:async(request,res)=>{
    if(request.url.endsWith('updateOrderDevices')){res.destroy();return true;}
    return false;
  }}),plan=await s.prepare();
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/uncertain/);
  const approval=await s.scopes.approval();assert.equal(approval.status,'consumed');
  const attempt=JSON.parse(await readFile(approval.attemptPath,'utf8'));assert.equal(attempt.status,'uncertain');
  assert.equal(s.requests.filter(r=>r.url.endsWith('updateOrderDevices')).length,1);
});

test('failed pre-change history save blocks preparation and sends no mutation', async t => {
  const s=await fixture(t);await writeFile(path.join(s.directory,'records'),'not-a-directory');
  await assert.rejects(s.prepare());
  assert.equal(s.requests.length,1);assert.ok(s.requests.every(r=>!r.url.endsWith('updateOrderDevices')));
  await assert.rejects(s.scopes.approval());
});

test('removed baseline evidence blocks execution before any new network request', async t => {
  const s=await fixture(t),plan=await s.prepare();
  await unlink(path.join(path.dirname(plan.beforeCapture.manifestPath),'response.body'));
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/evidence/);
  assert.equal(s.requests.length,3);assert.equal((await s.scopes.approval()).status,'prepared');
});

test('failure saving the fresh execution observation blocks dispatch and approval consumption', async t => {
  const s=await fixture(t),plan=await s.prepare();
  const manifest=JSON.parse(await readFile(plan.beforeCapture.manifestPath,'utf8'));
  await writeFile(manifest.entries[0].path+'.lock','');
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}));
  assert.equal(s.requests.length,6);assert.ok(s.requests.every(r=>!r.url.endsWith('updateOrderDevices')));
  assert.equal((await s.scopes.approval()).status,'prepared');
});

test('explicit unverified non-identity fields preserve values and exact large numbers; no merge', async t => {
  const s=await fixture(t);
  const json=JSON.stringify(body).slice(0,-1)+',"futureValue":9007199254740993,"futureObject":{"futureBit":true},"customInstructions":null}';
  const plan=await s.prepare({json,allowUnverifiedFields:true}); assert.ok(plan.unverifiedFields.includes('/futureValue'));
  const r=await s.invoke({json,allowUnverifiedFields:true,execute:true,approve:plan.approval,ackUpdateRisks:true}); assert.equal(r.value,0);
  assert.equal(s.requests.at(-1).body.untouched,undefined); // No read/merge/write.
  assert.match(s.requests.at(-1).raw,/"futureValue":9007199254740993/);
});
for(const change of ['payload','audit','current','policy','expired','disabled','account']) test(`approval rejects changed ${change}`, async t => {
  const s=await fixture(t), plan=await s.prepare();let extra={};
  if(change==='payload')extra={json:JSON.stringify({...body,deviceType:2})};
  if(change==='audit')extra={auditRef:'Different audit reference'};
  if(change==='current')s.current.untouched='Changed by another actor';
  if(change==='policy')await s.scopes.persist(s.scopes.file,{...s.scope,revision:'new-policy'});
  if(change==='expired')await s.scopes.persist(s.scopes.approvalFile,{...await s.scopes.approval(),expiresAt:1});
  if(change==='disabled')await s.scopes.persist(s.scopes.file,{...s.scope,enabled:false});
  if(change==='account')await s.store.mutate(async state=>{state.auth.username='Different_User';});
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,...extra}));
  assert.equal(s.requests.filter(r=>r.url.endsWith('updateOrderDevices')).length,0);
});
for(const scenario of ['wrong-location','wrong-parent','mixed-parents','zone-target','foreign-device','missing-device','duplicate-device','hasMore','missing-count','redirect','oversized','invalid-json']) test(`ownership failure stops update: ${scenario}`, async t => {
  const s=await fixture(t,{respond:async(req,res)=>{
    if(scenario==='redirect'){res.writeHead(302,{Location:'/other'});res.end();return true;}
    if(scenario==='oversized'){res.end('x'.repeat(1024*1024+1));return true;}
    if(scenario==='invalid-json'){res.end('{broken');return true;}
    if(scenario==='wrong-location'&&req.body.searchCriteria?.includes('(hierUnitId,70)')){res.end(JSON.stringify(list([{hierUnitId:70,objectNum:902,nodeType:'Location'}])));return true;}
    if(scenario==='mixed-parents'&&req.body.searchCriteria?.includes('(hierUnitId,71)')){res.end(JSON.stringify(list([{hierUnitId:71,parentHierUnitId:70,nodeType:'RVC'},{hierUnitId:71,parentHierUnitId:80,nodeType:'RVC'}])));return true;}
    if(['wrong-parent','zone-target'].includes(scenario)&&req.body.searchCriteria?.includes('(hierUnitId,71)')){res.end(JSON.stringify(list([{hierUnitId:71,parentHierUnitId:scenario==='wrong-parent'?80:70,nodeType:scenario==='zone-target'?'Zone':'RVC'}])));return true;}
    if(req.url.endsWith('getOrderDevices')){
      const row={...body,hierUnitId:scenario==='foreign-device'?81:71};const data=list(scenario==='missing-device'?[]:scenario==='duplicate-device'?[row,row]:[row]);
      if(scenario==='hasMore')data.hasMore=true;if(scenario==='missing-count')delete data.count;
      res.end(JSON.stringify(data));return true;
    }
  }});
  await assert.rejects(s.prepare());assert.equal(s.requests.filter(r=>r.url.endsWith('updateOrderDevices')).length,0);
});
test('one-use approval is consumed before a dropped connection; no retry/readback',async t=>{
  const s=await fixture(t,{respond:async(req,res)=>{if(req.url.endsWith('updateOrderDevices')){res.destroy();return true;}}});
  const plan=await s.prepare();await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/uncertain.*Do not blindly retry/);
  assert.equal(s.requests.length,7);assert.equal((await s.scopes.approval()).status,'consumed');
});
test('approval persistence failure prevents update',async t=>{
  const s=await fixture(t),plan=await s.prepare(),original=WriteScopeStore.prototype.persist;
  WriteScopeStore.prototype.persist=async function(file,value){if(value.status==='consumed')throw new Error('Synthetic disk failure');return original.call(this,file,value);};
  try{await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}));}finally{WriteScopeStore.prototype.persist=original;}
  assert.equal(s.requests.filter(r=>r.url.endsWith('updateOrderDevices')).length,0);
});
test('HTTP error bytes remain unchanged and approval stays consumed',async t=>{
  const response='{"status":400,"detail":"Synthetic validation error"}';
  const s=await fixture(t,{respond:async(req,res)=>{if(req.url.endsWith('updateOrderDevices')){res.writeHead(400);res.end(response);return true;}}});
  const plan=await s.prepare(),r=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true});
  assert.equal(r.value,11);assert.equal(await responseText(r),response);assert.equal(s.requests.length,7);
});
test('large update response keeps complete private-file delivery',async t=>{
  const response=JSON.stringify({value:'x'.repeat(18000),unknownField:true});
  const s=await fixture(t,{respond:async(req,res)=>{if(req.url.endsWith('updateOrderDevices')){res.end(response);return true;}}});
  const plan=await s.prepare(),r=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true});
  const receipt=JSON.parse(r.stdout);assert.equal(receipt.delivery,'file');assert.equal(await readFile(receipt.path,'utf8'),response);assert.equal(s.requests.length,7);
});
test('boundary configuration requires confirmations/replacement; lock and corruption fail closed',async t=>{
  const s=await fixture(t);
  await assert.rejects(s.scopes.configure(s.store,901,70,[71],s.scope.company,901,false),/exists/);
  await assert.rejects(s.scopes.configure(s.store,901,70,[71],'wrong-company',901,true),/confirmations/);
  await writeFile(s.scopes.lock,'synthetic lock');await assert.rejects(s.prepare(),/lock/);assert.equal(s.requests.length,0);
  await writeFile(s.scopes.file,'{"product":"sts"}');await assert.rejects(s.invoke({dryRun:true}),/boundary/);
});
test('new preparation retires the previous approval; missing or wrong approvals stay offline',async t=>{
  const s=await fixture(t);
  await assert.rejects(s.invoke({execute:true,approve:'a'.repeat(64),ackUpdateRisks:true}),/approval/);assert.equal(s.requests.length,0);
  const first=await s.prepare(),second=await s.prepare();assert.notEqual(first.approval,second.approval);
  await assert.rejects(s.invoke({execute:true,approve:first.approval,ackUpdateRisks:true}),/match/);assert.equal(s.requests.length,6);
});
test('file is read once before checks; later edits cannot replace the approved wire payload',async t=>{
  let changeFile=false, file;
  const s=await fixture(t,{respond:async(req,res)=>{
    if(changeFile&&req.url.endsWith('getHierarchyNodes')){changeFile=false;await writeFile(file,JSON.stringify({...body,hierUnitId:81}));}
    return false;
  }});
  file=path.join(s.directory,'update-input.json');await writeFile(file,JSON.stringify(body));
  const plan=await s.prepare({json:undefined,file});changeFile=true;
  const r=await s.invoke({json:undefined,file,execute:true,approve:plan.approval,ackUpdateRisks:true});
  assert.equal(r.value,0);assert.deepEqual(s.requests.at(-1).body,body);
});
test('file and stdin dry-run use the same validator and remain offline',async t=>{
  const s=await fixture(t),file=path.join(s.directory,'input.json');await writeFile(file,JSON.stringify(body));
  const args=['order-devices','update','--hier-unit-id','71','--object-num','3'];
  for(const [source,text] of [[file,''],['-',JSON.stringify(body)]]){
    const result=await s.run([...args,'--file',source],text);assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).data.body,body);
  }
  assert.equal(s.requests.length,0);
});
test('cooperating profile/boundary mutation is locked during ownership checks',async t=>{
  let checks=0;
  const s=await fixture(t,{respond:async(req,res,state)=>{
    checks++;
    await assert.rejects(state.store.mutate(async profile=>{profile.auth.username='Other_User';}),/lock/i);
    await assert.rejects(new WriteScopeStore(state.directory).configure(state.store,901,70,[71],'test-enterprise@127.0.0.1',901,true),/lock/i);
    return false;
  }});
  await s.prepare();assert.equal(checks,3);
});
test('output failure after dispatch is uncertain and does not restore approval',async t=>{
  const s=await fixture(t),plan=await s.prepare(),original=process.stdout.write;
  process.stdout.write=function(chunk,encoding,callback){const cb=typeof encoding==='function'?encoding:callback;cb?.(new Error('Synthetic output failure'));return true;};
  try{await assert.rejects(executeOrderDeviceUpdate(s.store,options({execute:true,approve:plan.approval,ackUpdateRisks:true}),async()=>{}),/uncertain/);}
  finally{process.stdout.write=original;}
  assert.equal(s.requests.length,7);assert.equal((await s.scopes.approval()).status,'consumed');
});
for(const status of [401,403,500])test(`ownership HTTP ${status} is not retried or refreshed again`,async t=>{
  const s=await fixture(t,{respond:async(req,res)=>{res.writeHead(status);res.end('{"detail":"Synthetic"}');return true;}});
  await assert.rejects(s.prepare(),new RegExp('HTTP '+status));assert.equal(s.requests.length,1);
});
