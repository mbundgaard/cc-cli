import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const temp = mkdtempSync(path.join(tmpdir(), 'cc-package-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const addedTasks = [
  {id: 'kds-displays', command: ['kds-displays','list'], route: '/config/sim/v2/devices/getKitchenDisplays', body: {searchCriteria:'where equals(hierUnitId,7)'}},
  {id: 'order-devices', command: ['order-devices','list'], route: '/config/sim/v2/devices/getOrderDevices', body: {searchCriteria:'where equals(hierUnitId,7)'}},
  {id: 'workstations', command: ['workstations','list'], route: '/config/sim/v2/devices/getWorkstations', body: {hierUnitId:7}},
  {id: 'order-types', command: ['order-types','list'], route: '/config/sim/v2/setup/getOrderTypeNames', body: {searchCriteria:'where equals(hierUnitId,7)'}},
  {id: 'order-type-parameters', command: ['order-types','parameters','list'], route: '/config/sim/v2/setup/getOrderTypeParameters', body: {searchCriteria:'where equals(hierUnitId,7)'}},
];
function npmRun(args) {
  const r = spawnSync(process.execPath, [npm, ...args], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr); return r.stdout;
}
try {
  const [packed] = JSON.parse(npmRun(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const allow = new Set(['package.json', 'bin/cc.js', 'README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/CLI.md', 'docs/AUTHENTICATION.md', 'docs/DEVELOPMENT.md', 'docs/RESPONSES.md', 'docs/CATALOGUE.md', 'docs/HIERARCHY.md', 'docs/MENU-ITEM-MASTERS.md', 'docs/READS.md', 'docs/KDS-DISPLAYS.md', 'docs/ORDER-DEVICES.md', 'docs/WORKSTATIONS.md', 'docs/ORDER-TYPES.md', 'docs/ORDER-DEVICE-UPDATES.md', 'docs/KDS-CRUD.md']);
  for (const f of packed.files) assert.ok(allow.has(f.path) || /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(f.path), `Unexpected package file: ${f.path}`);
  npmRun(['install', '--prefix', temp, '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed.filename)]);
  const shim = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'cc.cmd' : 'cc');
  const run = args => process.platform === 'win32' ? spawnSync(`"${shim}" ${args.join(' ')}`, {encoding: 'utf8', shell: true}) : spawnSync(shim, args, {encoding: 'utf8'});
  const v = run(['--version']); assert.equal(v.status, 0, v.stderr); assert.equal(v.stdout.trim(), pkg.version);
  const help = run(['--help']); assert.equal(help.status, 0); assert.match(help.stdout.replace(/\s+/g, ' '), /Explicit reads and guarded single-record device writes/);
  assert.doesNotMatch(help.stdout, /--state-dir|--insecure|test-read|pos-dimensions/);
  for (const args of [['auth', 'config', '--help'], ['auth', 'login', '--help'], ['auth', 'refresh', '--help'], ['auth', 'restore', '--help'], ['company', '--help'], ['version', '--help'], ['server-version', '--help'], ['catalogue', '--help'], ['catalogue', 'import', '--help'], ['hierarchy', 'list', '--help'], ['hierarchy', 'nodes', 'list', '--help'], ['menu-item-masters', 'list', '--help']]) assert.equal(run(args).status, 0);
  for (const task of addedTasks) assert.equal(run([...task.command, '--help']).status, 0);
  for (const command of [['write-scope','set'],['write-scope','show'],['write-scope','disable'],['order-devices','update'],['kds-displays','create'],['kds-displays','update'],['kds-displays','delete']]) assert.equal(run([...command,'--help']).status, 0);
  const endpoints = run(['endpoints']); assert.equal(endpoints.status, 0); assert.deepEqual(JSON.parse(endpoints.stdout).data.dataEndpoints.map(item => item.id), ['server-version', 'hierarchy', 'hierarchy-nodes', 'menu-item-masters', ...addedTasks.map(task => task.id)]);
  for (const name of ['test-read', 'getHierarchy', 'pos-dimensions']) { const r = run([name]); assert.equal(r.status, 6); assert.equal(r.stdout, ''); }
  const module = name => pathToFileURL(path.join(temp, 'node_modules/@muneris/cc-cli/dist', name)).href;
  // Installed modules with isolated state and loopback IDM only; never real user credentials.
  const flow = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { readFile } from 'node:fs/promises';
    import { main } from ${JSON.stringify(module('cli.js'))};
    import { StateStore } from ${JSON.stringify(module('state.js'))};
    const addedTasks = ${JSON.stringify(addedTasks)};
    let calls = 0, writePhase = false, updates = 0, kdsPhase = false, kdsRecord = null;
    const kdsBody = {hierUnitId:70,objectNum:4,name:{'1':'Synthetic display'},ipAddress:'192.0.2.40',panelConfiguration:[{panelNum:1,chitColumns:5}]};
    const updateBody = {hierUnitId:71,objectNum:3,deviceType:1,menuItemPrinting:1,condimentSortType:1};
    const server = http.createServer(async (req,res) => {
      calls++;
      if(writePhase) {
        assert.equal(req.headers.authorization,'Bearer synthetic-id-token');
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks).toString());
        const respond=items=>res.end(JSON.stringify({items,count:items.length,totalResults:items.length,hasMore:false}));
        if(req.url==='/config/sim/v2/hierarchy/getHierarchyNodes') {
          respond(body.searchCriteria.includes('(hierUnitId,70)')?[{hierUnitId:70,objectNum:901,nodeType:'Location'}]:[{hierUnitId:71,parentHierUnitId:70,nodeType:'RVC'}]);return;
        }
        if(kdsPhase) {
          if(req.url==='/config/sim/v2/devices/getKitchenDisplays'){respond(kdsRecord?[kdsRecord]:[]);return;}
          assert.ok(['/config/sim/v2/devices/kitchenDisplays','/config/sim/v2/devices/updateKitchenDisplays','/config/sim/v2/devices/deleteKitchenDisplays'].includes(req.url));
          const deleting=req.url.endsWith('deleteKitchenDisplays');
          assert.deepEqual(body,deleting?{hierUnitId:70,objectNum:4}:kdsBody);
          assert.equal(req.headers['simphony-audittrailref'],'Muneris CC-CLI // Synthetic_User');
          kdsRecord=deleting?null:body;updates++;res.end(JSON.stringify(deleting?{msg:'1 record deleted'}:{hierUnitId:70,objectNum:4}));return;
        }
        if(req.url==='/config/sim/v2/devices/getOrderDevices'){respond([updateBody]);return;}
        assert.equal(req.url,'/config/sim/v2/devices/updateOrderDevices');assert.deepEqual(body,updateBody);
        assert.equal(req.headers['simphony-audittrailref'],'Muneris CC-CLI // Synthetic_User');updates++;res.end(JSON.stringify({hierUnitId:71,objectNum:3}));return;
      }
      const task = addedTasks.find(task => task.route === req.url);
      if (task) {
        assert.equal(req.headers.authorization, 'Bearer synthetic-id-token');
        const chunks=[]; for await(const chunk of req) chunks.push(chunk);
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), task.body);
        res.end(JSON.stringify({items:[{undocumentedField:true}],hasMore:true})); return;
      }
      if (req.url === '/config/sim/v2/getReleaseVersions') {
        assert.equal(req.headers.authorization, 'Bearer synthetic-id-token');
        res.end(JSON.stringify({simphonyEnterpriseVersion:'19.synthetic','C&CVersion':'23.synthetic'})); return;
      }
      if (['/config/sim/v2/hierarchy/getHierarchy','/config/sim/v2/hierarchy/getHierarchyNodes','/config/sim/v2/menuItems/getMenuItemMasters'].includes(req.url)) {
        assert.equal(req.headers.authorization, 'Bearer synthetic-id-token');
        res.end(JSON.stringify({items:[{hierUnitId:7,undocumentedField:true}],hasMore:true})); return;
      }
      if (req.url.includes('/authorize?')) {
        const url = new URL(req.url,'http://localhost');
        assert.equal(url.searchParams.get('code_challenge_method'),'S256');
        res.setHeader('Set-Cookie','opaque=synthetic==; Path=/'); res.end('{}'); return;
      }
      const chunks=[]; for await (const c of req) chunks.push(c);
      const form=new URLSearchParams(Buffer.concat(chunks).toString());
      if(req.url.endsWith('/signin')) {
        assert.equal(req.headers.cookie,'opaque=synthetic==');
        assert.equal(form.get('username'),'Synthetic_User'); assert.equal(form.get('orgname'),'Synthetic');
        res.end(JSON.stringify({nextOp:'redirect',redirectUrl:'apiaccount://callback?code=synthetic-code'}));return;
      }
      assert.ok(['authorization_code','refresh_token'].includes(form.get('grant_type')));
      res.end(JSON.stringify({id_token:'synthetic-id-token',refresh_token:'synthetic-refresh-token',expires_in:'1209600'}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const store=new StateStore(${JSON.stringify(path.join(temp, 'auth-state'))});
      const url='http://127.0.0.1:'+server.address().port;
      const invoke=args=>main(['node','cc',...args],store);
      assert.equal(await invoke(['auth','config','--auth-url',url,'--api-url',url,'--client-id','opaque==','--org','Synthetic','--username','Synthetic_User']),0);
      assert.equal(calls,0);
      assert.equal(await invoke(['auth','login','--password','synthetic-password','--quiet']),0);assert.equal(calls,3);
      assert.equal(await invoke(['auth','login']),0);assert.equal(calls,3);
      assert.equal(await invoke(['auth','refresh','--quiet']),0);assert.equal(calls,4);
      const saved=JSON.parse(await readFile(store.file,'utf8'));
      assert.equal(saved.product,'cc');assert.equal(saved.companies[saved.activeCompany].product,'cc');
      assert.equal(saved.companies[saved.activeCompany].tokens.idToken,'synthetic-id-token');
      assert.doesNotMatch(JSON.stringify(saved),/synthetic-password/);
      assert.equal(await invoke(['server-version','--quiet']),0);assert.equal(calls,5);
      assert.equal(await invoke(['hierarchy','list','--organization-wide','--quiet']),0);assert.equal(calls,6);
      assert.equal(await invoke(['hierarchy','nodes','list','--organization-wide','--quiet']),0);assert.equal(calls,7);
      assert.equal(await invoke(['menu-item-masters','list','--hier-unit-id','7','--quiet']),0);assert.equal(calls,8);
      for (const [index, task] of addedTasks.entries()) {
        assert.equal(await invoke([...task.command,'--hier-unit-id','7','--quiet']),0);assert.equal(calls,9+index);
      }
      const catalogue=JSON.parse(await readFile(${JSON.stringify(path.join(temp, 'auth-state', 'catalogue.json'))},'utf8'));
      const environment=Object.values(catalogue.environments)[0];
      assert.deepEqual(environment.current.observations['hierarchy:v2'].fields['/items/*/undocumentedField'],['boolean']);
      assert.deepEqual(environment.current.observations['menu-item-masters:v2'].fields['/items/*/undocumentedField'],['boolean']);
      for (const task of addedTasks) assert.deepEqual(environment.current.observations[task.id+':v2'].fields['/items/*/undocumentedField'],['boolean']);
      writePhase=true;const readCalls=calls;
      assert.equal(await invoke(['write-scope','set','--location-number','901','--location-hier-unit-id','70','--rvc-hier-unit-ids','71','--confirm-company',saved.activeCompany,'--confirm-location','901']),0);
      const updateArgs=['order-devices','update','--hier-unit-id','71','--object-num','3','--json',JSON.stringify(updateBody),'--quiet'];
      assert.equal(await invoke([...updateArgs,'--dry-run']),0);assert.equal(calls,readCalls);
      assert.equal(await invoke([...updateArgs,'--prepare']),0);assert.equal(calls,readCalls+3);assert.equal(updates,0);
      const approval=JSON.parse(await readFile(${JSON.stringify(path.join(temp, 'auth-state', 'order-device-approval.json'))},'utf8'));
      assert.equal(await invoke([...updateArgs,'--execute','--approve',approval.id,'--ack-update-risks']),0);assert.equal(calls,readCalls+7);assert.equal(updates,1);
      kdsPhase=true;
      for(const action of ['create','update','delete']) {
        const before=calls;
        const args=['kds-displays',action,'--hier-unit-id','70','--object-num','4','--quiet',...(action==='delete'?[]:['--json',JSON.stringify(kdsBody)])];
        assert.equal(await invoke([...args,'--dry-run']),0);assert.equal(calls,before);
        assert.equal(await invoke([...args,'--prepare']),0);assert.equal(calls,before+2);
        const approval=JSON.parse(await readFile(${JSON.stringify(path.join(temp, 'auth-state', 'kds-display-approval.json'))},'utf8'));
        assert.equal(await invoke([...args,'--execute','--approve',approval.id,'--ack-update-risks',...(action==='delete'?['--confirm-delete','4']:[])]),0);
        assert.equal(calls,before+5);
      }
      assert.equal(updates,4);
      assert.equal(await invoke(['write-scope','disable']),0);
      assert.equal(await invoke(['auth','logout']),0);assert.equal((await store.load()).tokens,undefined);
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  `], {encoding: 'utf8', timeout: 60000});
  assert.equal(flow.status, 0, flow.stderr);
  assert.doesNotMatch(flow.stdout + flow.stderr, /synthetic-password|synthetic-id-token|synthetic-refresh-token/);
  console.log(`${packed.filename}: ${packed.files.length} allowlisted files; installed shim/help/parser, reviewed read inventory, installed reviewed reads/catalogue, guarded order-device updates/KDS CRUD prepare/execute and isolated PKCE/login/duplicate/refresh/logout verified. No live Oracle calls.`);
} finally { rmSync(temp, {recursive: true, force: true}); }
