// Unpackaged collector/auth-preflight harness. Not a production read command or
// alternate capture mode. Public configuration tests use real named read commands.
import { CommanderError } from 'commander';
import { readFileSync } from 'node:fs';
import { createProgram } from '../dist/cli.js';
import { prepareQuery, stringField } from '../dist/requests.js';
import { ResponseCollector } from '../dist/responses.js';
import { configurationRequestInto } from '../dist/configuration-policy.js';
import { companyKey } from '../dist/state.js';
import { httpExit } from '../dist/transport.js';
import { CliError, Exit, reportError } from '../dist/output.js';
const version = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;

async function collectorFixture(input, directory, quiet) {
  const collector = new ResponseCollector(directory), controller = new AbortController();
  const cancel = () => controller.abort(); process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  let published=false;
  try {
    const response = await configurationRequestInto({...input,signal:controller.signal},collector);
    controller.signal.throwIfAborted();
    const delivery = await collector.complete();controller.signal.throwIfAborted();
    if(!quiet)process.stderr.write(`[cc testRead] HTTP ${response.status}\n`);
    published=true;
    const output=delivery.kind==='inline'?delivery.body:JSON.stringify({delivery:'file',path:delivery.path,uri:delivery.uri,
      bytes:delivery.bytes,lines:delivery.lines,sha256:delivery.sha256,httpStatus:response.status,
      instructions:'Inspect saved data instead of loading it all into context.'})+'\n';
    await new Promise((resolve,reject)=>process.stdout.write(output,error=>error?reject(error):resolve()));
    return httpExit(response.status);
  } catch(error) {
    if(!published)await collector.discard();
    if(error instanceof CliError)throw error;
    throw new CliError(Exit.network,controller.signal.aborted?'CC read request cancelled; no retry was made':'CC read request failed; no retry was made');
  } finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
export async function executeTestRead(store, options, directory = store.directory, notify = async () => {}) {
  const prepared = await prepareQuery(store, options, (state,input)=>{
    const body={...input};if(options.locRef!==undefined)body.locRef=options.locRef;
    stringField(body,'locRef',99);if(body.locRef===undefined)throw new CliError(Exit.usage,'Synthetic test requires explicit locRef');
    const url=new URL(state.auth.apiUrl);
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Test harness is loopback only');
    return {method:'POST',url:`${url.origin}/config/sim/v2/hierarchy/getHierarchy`,headers:{'Content-Type':'application/json',Accept:'application/json'},body,scope:'synthetic-test-only',
      capture:{company:companyKey(state.auth),apiUrl:url.origin,task:'hierarchy',apiVersion:'v2',scopeKind:'organization',scopeId:'all',detail:'default',purpose:'read'}};
  });
  if(!prepared)return Exit.ok;
  const {built,token}=prepared;
  const code=await collectorFixture({...built,headers:{...built.headers,Authorization:`Bearer ${token}`},body:JSON.stringify(built.body),timeoutMs:(options.timeout??30)*1000},directory,options.quiet);
  if(code===Exit.ok&&!options.quiet){try{await notify(store.directory,version);}catch{}}
  return code;
}
export async function main(argv, store, notify = async () => {}) {
  let code = Exit.ok;
  try {
    const program = createProgram(store, result => { code = result; });
    program.command('test-read').option('--loc-ref <value>').option('--json <object>').option('--file <path>')
      .option('--dry-run').option('--quiet').option('--timeout <seconds>', 'Synthetic timeout', Number)
      .action(async options => { code = await executeTestRead(store, options, store.directory, notify); });
    await program.parseAsync(argv); return code;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : reportError(new CliError(Exit.usage, 'Invalid synthetic test invocation'));
    return reportError(error);
  }
}
