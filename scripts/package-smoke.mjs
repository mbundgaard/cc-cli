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
function npmRun(args) {
  const r = spawnSync(process.execPath, [npm, ...args], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr); return r.stdout;
}
try {
  const [packed] = JSON.parse(npmRun(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const allow = new Set(['package.json', 'bin/cc.js', 'README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/CLI.md', 'docs/AUTHENTICATION.md', 'docs/DEVELOPMENT.md', 'docs/RESPONSES.md', 'docs/CATALOGUE.md', 'docs/HIERARCHY.md', 'docs/MENU-ITEM-MASTERS.md']);
  for (const f of packed.files) assert.ok(allow.has(f.path) || /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(f.path), `Unexpected package file: ${f.path}`);
  npmRun(['install', '--prefix', temp, '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed.filename)]);
  const shim = path.join(temp, 'node_modules', '.bin', process.platform === 'win32' ? 'cc.cmd' : 'cc');
  const run = args => process.platform === 'win32' ? spawnSync(`"${shim}" ${args.join(' ')}`, {encoding: 'utf8', shell: true}) : spawnSync(shim, args, {encoding: 'utf8'});
  const v = run(['--version']); assert.equal(v.status, 0, v.stderr); assert.equal(v.stdout.trim(), pkg.version);
  const help = run(['--help']); assert.equal(help.status, 0); assert.match(help.stdout.replace(/\s+/g, ' '), /Safe authentication and explicit read-only tasks/);
  assert.doesNotMatch(help.stdout, /--state-dir|--insecure|test-read|pos-dimensions/);
  for (const args of [['auth', 'config', '--help'], ['auth', 'login', '--help'], ['auth', 'refresh', '--help'], ['auth', 'restore', '--help'], ['company', '--help'], ['version', '--help'], ['server-version', '--help'], ['catalogue', '--help'], ['catalogue', 'import', '--help'], ['hierarchy', 'list', '--help'], ['hierarchy', 'nodes', 'list', '--help'], ['menu-item-masters', 'list', '--help']]) assert.equal(run(args).status, 0);
  const endpoints = run(['endpoints']); assert.equal(endpoints.status, 0); assert.deepEqual(JSON.parse(endpoints.stdout).data.dataEndpoints.map(item => item.id), ['server-version', 'hierarchy', 'hierarchy-nodes', 'menu-item-masters']);
  for (const name of ['test-read', 'getHierarchy', 'pos-dimensions']) { const r = run([name]); assert.equal(r.status, 6); assert.equal(r.stdout, ''); }
  const module = name => pathToFileURL(path.join(temp, 'node_modules/@muneris/cc-cli/dist', name)).href;
  // Installed modules with isolated state and loopback IDM only; never real user credentials.
  const flow = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { readFile } from 'node:fs/promises';
    import { main } from ${JSON.stringify(module('cli.js'))};
    import { StateStore } from ${JSON.stringify(module('state.js'))};
    let calls = 0;
    const server = http.createServer(async (req,res) => {
      calls++;
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
      const catalogue=JSON.parse(await readFile(${JSON.stringify(path.join(temp, 'auth-state', 'catalogue.json'))},'utf8'));
      const environment=Object.values(catalogue.environments)[0];
      assert.deepEqual(environment.current.observations['hierarchy:v2'].fields['/items/*/undocumentedField'],['boolean']);
      assert.deepEqual(environment.current.observations['menu-item-masters:v2'].fields['/items/*/undocumentedField'],['boolean']);
      assert.equal(await invoke(['auth','logout']),0);assert.equal((await store.load()).tokens,undefined);
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  `], {encoding: 'utf8', timeout: 30000});
  assert.equal(flow.status, 0, flow.stderr);
  assert.doesNotMatch(flow.stdout + flow.stderr, /synthetic-password|synthetic-id-token|synthetic-refresh-token/);
  console.log(`${packed.filename}: ${packed.files.length} allowlisted files; installed shim/help/parser, reviewed read inventory, installed version/hierarchy/menu-master/catalogue and isolated PKCE/login/duplicate/refresh/logout verified. No live Oracle calls.`);
} finally { rmSync(temp, {recursive: true, force: true}); }
