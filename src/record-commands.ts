import { Command, Option } from 'commander';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RecordHistoryStore, observationSummary, selectObservation, diffRecords, type RecordScope, type RecordIdentity } from './record-history.js';
import { ResponseCollector } from './responses.js';
import { type StateStore } from './state.js';
import { CliError, Exit } from './output.js';

async function emit(directory: string, command: string, data: unknown): Promise<void> {
  const collector = new ResponseCollector(directory);
  let delivery;
  try {
    await pipeline(Readable.from([Buffer.from(JSON.stringify({ok: true, command, savedObservationOnly: true, serverValidated: false, data}, null, 2) + '\n')]), collector);
    delivery = await collector.complete();
  } catch { await collector.discard(); throw new CliError(Exit.state, 'Cannot deliver local record inspection'); }
  const output = delivery.kind === 'inline' ? delivery.body : JSON.stringify({delivery: 'file', path: delivery.path, uri: delivery.uri,
    bytes: delivery.bytes, lines: delivery.lines, sha256: delivery.sha256, savedObservationOnly: true,
    description: 'Local record inspection export; not a live Oracle response. Source history is unchanged.'}) + '\n';
  await new Promise<void>((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
}
function scope(options: RecordScope): RecordScope {
  return {company: options.company, apiUrl: options.apiUrl, task: options.task, scopeKind: options.scopeKind, scopeId: options.scopeId};
}
function identity(options: RecordIdentity): RecordIdentity { return {...scope(options), recordId: options.recordId}; }
function scoped(command: Command): Command {
  return command.requiredOption('--company <key>', 'Exact saved company key; never selects or renews an account')
    .requiredOption('--api-url <origin>', 'Exact captured API origin')
    .requiredOption('--task <id>', 'Reviewed read task ID')
    .addOption(new Option('--scope-kind <kind>').choices(['environment', 'organization', 'hierarchy-unit', 'location', 'rvc']).makeOptionMandatory())
    .requiredOption('--scope-id <id>', 'Exact captured scope identifier');
}
export function registerRecords(root: Command, state: StateStore): void {
  const records = root.command('records').description('[local] Inspect saved observations; no Oracle requests, renewal or restoration');
  records.addHelpText('after', '\nHistory ingestion is still in development. These commands inspect existing history files only.\nLatest means last observed, not current Oracle state. Explicit scope; no arbitrary file paths.\n');
  const store = new RecordHistoryStore(state.directory);
  scoped(records.command('list').description('List captured records in one scope; explicit local pagination'))
    .option('--offset <integer>', 'Local offset', Number, 0).option('--limit <integer>', 'Maximum 1–100', Number, 50)
    .action(async options => { await emit(state.directory, 'records list', await store.list(scope(options), options.offset, options.limit)); });
  for (const name of ['show', 'history', 'diff'] as const) {
    const command = scoped(records.command(name).description(`[local] ${name} saved observations; source history is unchanged`))
      .requiredOption('--record-id <id>', 'Exact logical record identifier');
    if (name === 'show') command.option('--observation <id>', 'Saved observation ID or latest', 'latest');
    if (name === 'diff') command.requiredOption('--from <id>', 'Earlier saved observation ID').requiredOption('--to <id>', 'Later saved observation ID or latest');
    command.action(async options => {
      const history = await store.load(identity(options));
      let data: unknown;
      if (name === 'history') data = {identity: history.identity, latestObservationId: history.latestObservationId, observations: history.observations.map(observationSummary)};
      else if (name === 'show') data = {identity: history.identity, observation: selectObservation(history, options.observation)};
      else {
        const before = selectObservation(history, options.from), after = selectObservation(history, options.to);
        data = {identity: history.identity, from: observationSummary(before), to: observationSummary(after),
          warning: 'Compare returned representations only; differing projections do not prove fields were removed. Arrays are compared as whole values.',
          changes: diffRecords(before.record, after.record)};
      }
      await emit(state.directory, `records ${name}`, data);
    });
  }
}
