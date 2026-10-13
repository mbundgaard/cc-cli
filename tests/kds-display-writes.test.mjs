import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {setup,tokens} from './helpers.mjs';
import {WriteScopeStore} from '../dist/write-scope.js';
import {executeKdsWrite} from '../dist/kds-display-writes.js';
const routes={create:'/config/sim/v2/devices/kitchenDisplays',update:'/config/sim/v2/devices/updateKitchenDisplays',delete:'/config/sim/v2/devices/deleteKitchenDisplays'};
const body={hierUnitId:70,objectNum:4,name:{'1':'Synthetic reference display'},ipAddress:'192.0.2.40',cardId:0,videoId:0,toolbarObjNum:1,
  locationFromTop:0,locationFromLeft:0,resolutionWidth:0,resolutionHeight:0,options:'0'.repeat(32),
  panelConfiguration:[{panelNum:1,proportion:1,chitColumns:5,chitRows:0,capacity:0}],
  recallReviewList:[{colNum:1,colType:0,width:0}],prodItems:[{prodItemNum:1,prodItemObjNum:2,persistence:1}]};
async function capture(fn){
  const chunks=[],original=process.stdout.write;
  process.stdout.write=function(chunk,encoding,callback){chunks.push(Buffer.from(chunk));if(typeof encoding==='function')encoding();else callback?.();return true;};
  try{return {code:await fn(),stdout:Buffer.concat(chunks).toString()};}finally{process.stdout.write=original;}
}
async function fixture(t,action='update',respond){
  let current=action==='create'?null:{...body,name:{'1':'Synthetic old display'},kdsClientId:501,hierUnitObjNum:901};
  const requests=[];
  const list=items=>({items,count:items.length,totalResults:items.length,hasMore:false,offset:0});
  const s=await setup(t,async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks).toString(),request={url:req.url,raw,body:JSON.parse(raw),headers:req.headers};requests.push(request);
    assert.equal(req.headers.authorization,'Bearer synthetic-id');
    if(respond&&await respond(request,res,s))return;
    if(req.url==='/config/sim/v2/hierarchy/getHierarchyNodes'){
      assert.deepEqual(request.body,{searchCriteria:'where equals(hierUnitId,70)',include:'hierUnitId,objectNum,nodeType',limit:100,offset:0});
      res.end(JSON.stringify(list([{hierUnitId:70,objectNum:901,nodeType:'Location'},{hierUnitId:70,objectNum:901,nodeType:'Location'}])));return;
    }
    if(req.url==='/config/sim/v2/devices/getKitchenDisplays'){
      assert.deepEqual(request.body,{searchCriteria:'where (equals(hierUnitId,70) and equals(objectNum,4))',includeAll:'detailed',limit:2,offset:0});
      res.end(JSON.stringify(list(current?[current]:[])));return;
    }
    assert.equal(req.url,routes[action]);assert.equal(req.headers['simphony-audittrailref'],'Synthetic KDS change');
    current=action==='delete'?null:{...request.body,kdsClientId:501,hierUnitObjNum:901};
    res.end(action==='delete'?' {"msg":"1 record deleted"} ':' {"hierUnitId":70,"objectNum":4} ');
  });
  await s.store.mutate(async state=>{state.tokens=tokens();});
  await s.store.mutateCompanies(async registry=>{registry.companies[registry.activeCompany].refreshAfter=new Date(Date.now()+86400000).toISOString();});
  const scopes=new WriteScopeStore(s.directory,'kds-display'),company=(await s.store.loadCompanies()).activeCompany;
  const scope=await scopes.configure(s.store,901,70,[],company,901,false);
  const opts=extra=>({hierUnitId:70,objectNum:4,auditRef:'Synthetic KDS change',quiet:true,...(action==='delete'?{}:{json:JSON.stringify(body)}),...extra});
  const invoke=(extra={},chosen=action)=>capture(()=>executeKdsWrite(chosen,s.store,opts(extra),async()=>{}));
  const prepare=async extra=>JSON.parse((await invoke({prepare:true,...extra})).stdout).data;
  return {...s,requests,scope,scopes,invoke,prepare,opts,setCurrent:value=>{current=value;}};
}
for(const action of ['create','update','delete']){
  test(`KDS ${action}: offline by default; prepare and execute exactly one reviewed route without readback`,async t=>{
    const s=await fixture(t,action),review=JSON.parse((await s.invoke()).stdout).data;
    assert.equal(review.action,action);assert.equal(review.url,s.url+routes[action]);assert.equal(s.requests.length,0);
    const plan=await s.prepare();assert.equal(plan.writeSent,false);assert.equal(s.requests.length,2);
    if(action==='delete'){assert.equal(plan.destructive,true);assert.equal(plan.deleteTarget.objectNum,4);}
    const metadata=await readFile(s.scopes.approvalFile,'utf8');assert.doesNotMatch(metadata,/Synthetic reference|Synthetic old|192\.0\.2|synthetic-id|panelConfiguration/);
    const result=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,...(action==='delete'?{confirmDelete:4}:{})});
    assert.equal(result.code,0);assert.equal(result.stdout,action==='delete'?' {"msg":"1 record deleted"} ':' {"hierUnitId":70,"objectNum":4} ');
    assert.equal(s.requests.length,5);assert.deepEqual(s.requests.at(-1).body,action==='delete'?{hierUnitId:70,objectNum:4}:body);
    assert.equal((await s.scopes.approval()).status,'consumed');
    await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,...(action==='delete'?{confirmDelete:4}:{})}),/consumed/);
    assert.equal(s.requests.length,5);assert.ok(!(await readdir(s.directory)).some(name=>/snapshot|backup/.test(name)));
  });
  test(`KDS ${action}: exact file/stdin review uses isolated CLI; v1/upsert are not exposed`,async t=>{
    const s=await fixture(t,action),payload=action==='delete'?{hierUnitId:70,objectNum:4}:body;
    const file=path.join(s.directory,'payload.json');await writeFile(file,JSON.stringify(payload));
    const args=['kds-displays',action,'--hier-unit-id','70','--object-num','4','--audit-ref','Synthetic'];
    for(const source of [file,'-']){
      const r=await s.run([...args,'--file',source],JSON.stringify(payload));assert.equal(r.code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).data.body,payload);
    }
    assert.equal((await s.run([...args,'--api-version','v1'])).code,6);assert.equal((await s.run(['kds-displays','upsert'])).code,6);assert.equal(s.requests.length,0);
  });
  test(`KDS ${action}: HTTP error preserves bytes and consumes approval; never fallback/retry`,async t=>{
    const s=await fixture(t,action,async(req,res)=>{if(req.url===routes[action]){res.writeHead(400);res.end('{"detail":"Synthetic rejection"}');return true;}});
    const plan=await s.prepare(),r=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,...(action==='delete'?{confirmDelete:4}:{})});
    assert.equal(r.code,11);assert.equal(r.stdout,'{"detail":"Synthetic rejection"}');assert.equal(s.requests.length,5);assert.equal((await s.scopes.approval()).status,'consumed');
  });
  test(`KDS ${action}: dropped connection is uncertain with consumed approval`,async t=>{
    const s=await fixture(t,action,async(req,res)=>{if(req.url===routes[action]){res.destroy();return true;}});
    const plan=await s.prepare();await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,...(action==='delete'?{confirmDelete:4}:{})}),/uncertain.*Do not blindly retry/);
    assert.equal(s.requests.length,5);assert.equal((await s.scopes.approval()).status,'consumed');
  });
}
for(const [name,extra] of [
  ['other location',{hierUnitId:80}],['RVC instead of location',{hierUnitId:71}],['foreign root',{json:JSON.stringify({...body,hierUnitId:80})}],
  ['other object',{objectNum:5}],['source client ID',{json:JSON.stringify({...body,kdsClientId:999})}],
  ['source hierarchy number',{json:JSON.stringify({...body,hierUnitObjNum:902})}],['derived options',{json:JSON.stringify({...body,optionsExt:{enableItemSelect:true}})}],
  ['nested identity',{json:JSON.stringify({...body,panelConfiguration:[{panelNum:1,hierUnitId:80}]})}],
  ['nested client ID',{json:JSON.stringify({...body,prodItems:[{prodItemNum:1,kdsClientId:999}]})}],
  ['nested hardware ID',{json:JSON.stringify({...body,panelConfiguration:[{panelNum:1,cardId:1}]})}],
  ['batch',{json:JSON.stringify([body])}],['unknown array',{json:JSON.stringify({...body,newArray:[{}]})}],
  ['duplicate panel',{json:JSON.stringify({...body,panelConfiguration:[{panelNum:1},{panelNum:1}]})}],
  ['missing child selector',{json:JSON.stringify({...body,panelConfiguration:[{chitColumns:3}]})}],
  ['invalid selector',{json:JSON.stringify({...body,prodItems:[{prodItemNum:0}]})}],
  ['too many recall columns',{json:JSON.stringify({...body,recallReviewList:Array.from({length:7},(_,i)=>({colNum:i+1}))})}],
  ['name missing',{json:JSON.stringify({...body,name:undefined})}],['name null',{json:JSON.stringify({...body,name:null})}],
  ['translation not string',{json:JSON.stringify({...body,name:{'1':123}})}],
  ['alias conflict',{json:JSON.stringify({...body,toolBarObjNum:2})}],['invalid options',{json:JSON.stringify({...body,options:'not binary'})}],
  ['bad child type',{json:JSON.stringify({...body,panelConfiguration:[{panelNum:1,chitColumns:'3'}]})}],
  ['not an array',{json:JSON.stringify({...body,panelConfiguration:{panelNum:1}})}],
  ['audit header injection',{auditRef:'Synthetic\r\nOther: value'}],['mode conflict',{dryRun:true,prepare:true}],
])test(`KDS invalid ${name} fails offline even with unverified-field acknowledgement`,async t=>{
  const s=await fixture(t);await assert.rejects(s.invoke({allowUnverifiedFields:true,...extra}));assert.equal(s.requests.length,0);
});
for(const action of ['create','update','delete'])test(`KDS ${action} existence guard never switches actions`,async t=>{
  const s=await fixture(t,action);s.setCurrent(action==='create'?body:null);
  await assert.rejects(s.prepare());assert.equal(s.requests.length,2);
});
for(const scenario of ['wrong-location','foreign-record','duplicate','more','missing-count'])test(`KDS rejects ${scenario} proof`,async t=>{
  const s=await fixture(t,'update',async(req,res)=>{
    if(scenario==='wrong-location'&&req.url.endsWith('getHierarchyNodes')){res.end(JSON.stringify({items:[{hierUnitId:70,objectNum:902,nodeType:'Location'}],count:1,totalResults:1}));return true;}
    if(scenario!=='wrong-location'&&req.url.endsWith('getKitchenDisplays')){
      const row={...body,hierUnitId:scenario==='foreign-record'?80:70},items=scenario==='duplicate'?[row,row]:[row];
      res.end(JSON.stringify({items,totalResults:items.length,...(scenario==='missing-count'?{}:{count:items.length}),hasMore:scenario==='more'}));return true;
    }
  });await assert.rejects(s.prepare());assert.ok(s.requests.every(r=>!Object.values(routes).includes(r.url)));
});
test('create execution rechecks absence; update/delete execution recheck complete current record',async t=>{
  for(const action of ['create','update','delete']){
    const s=await fixture(t,action),plan=await s.prepare();s.setCurrent({...body,kdsClientId:999,name:{'1':'Concurrent actor'}});
    await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,...(action==='delete'?{confirmDelete:4}:{})}));assert.equal(s.requests.length,4);
  }
});
test('action-specific approval cannot authorize delete after update preparation',async t=>{
  const s=await fixture(t),plan=await s.prepare();
  await assert.rejects(s.invoke({json:undefined,execute:true,approve:plan.approval,ackUpdateRisks:true,confirmDelete:4},'delete'),/changed/);
  assert.equal(s.requests.length,4);
});
test('delete requires its own object-number confirmation and identity-only body',async t=>{
  const s=await fixture(t,'delete'),plan=await s.prepare();
  for(const confirmDelete of [undefined,5])await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true,confirmDelete}),/confirm-delete/);
  await assert.rejects(s.invoke({json:JSON.stringify({...body})}),/only hierUnitId/);assert.equal(s.requests.length,2);
});
test('unverified casing/extensions/null/option widths are explicit; payload is never renamed or merged',async t=>{
  const s=await fixture(t);
  const json=JSON.stringify({...body,toolbarObjNum:undefined,toolBarObjNum:2,prodItems:null,options:'0'.repeat(40),futureSetting:{flag:true}}).slice(0,-1)+',"futureNumber":9007199254740993}';
  await assert.rejects(s.invoke({json}),/unverified-fields/);assert.equal(s.requests.length,0);
  const plan=await s.prepare({json,allowUnverifiedFields:true});assert.ok(plan.unverifiedFields.includes('/toolBarObjNum'));assert.ok(plan.unverifiedFields.includes('/prodItems'));
  const r=await s.invoke({json,allowUnverifiedFields:true,execute:true,approve:plan.approval,ackUpdateRisks:true});assert.equal(r.code,0);
  const wire=s.requests.at(-1);assert.match(wire.raw,/"futureNumber":9007199254740993/);assert.equal(wire.body.toolbarObjNum,undefined);assert.equal(wire.body.toolBarObjNum,2);assert.equal(wire.body.prodItems,null);assert.equal(wire.body.kdsClientId,undefined);
});
test('KDS and order-device approvals are distinct but share the global write lock',async t=>{
  const s=await fixture(t),other=new WriteScopeStore(s.directory),plan=await s.prepare();
  assert.equal(other.lock,s.scopes.lock);assert.notEqual(other.approvalFile,s.scopes.approvalFile);
  await writeFile(other.approvalFile,await readFile(s.scopes.approvalFile));await assert.rejects(other.approval(),/valid prepared approval/);
  await writeFile(s.scopes.lock,'synthetic lock');await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/lock/);assert.equal(s.requests.length,2);
});
test('disabled/changed environment and stale approval fail closed without data calls',async t=>{
  const s=await fixture(t),plan=await s.prepare();
  await s.scopes.persist(s.scopes.approvalFile,{...await s.scopes.approval(),expiresAt:1});
  await assert.rejects(s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true}),/expired/);
  await s.scopes.persist(s.scopes.file,{...s.scope,enabled:false});await assert.rejects(s.invoke(),/boundary/);
  await s.scopes.persist(s.scopes.file,s.scope);await s.store.mutate(async state=>{state.auth.username='Different_User';});await assert.rejects(s.invoke(),/environment/);assert.equal(s.requests.length,2);
});
test('large KDS write response uses unchanged private-file delivery',async t=>{
  const response='{"extension":"'+'x'.repeat(18000)+'"}';
  const s=await fixture(t,'update',async(req,res)=>{if(req.url===routes.update){res.end(response);return true;}});
  const plan=await s.prepare(),r=await s.invoke({execute:true,approve:plan.approval,ackUpdateRisks:true});
  const receipt=JSON.parse(r.stdout);assert.equal(receipt.delivery,'file');assert.equal(await readFile(receipt.path,'utf8'),response);assert.equal(s.requests.length,5);
});
