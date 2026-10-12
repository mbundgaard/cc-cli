import { Command } from 'commander';
import { StateStore } from './state.js';
import { CliError, Exit, localResult } from './output.js';
import { WriteScopeStore, positiveId, withFileLock } from './write-scope.js';
import { executeOrderDeviceUpdate, orderDeviceUpdatePath, updateRisks } from './order-device-update.js';

const integer = (value: string) => { if (!/^[1-9][0-9]*$/.test(value)) throw new CliError(Exit.usage, 'Expected a positive integer'); const number = Number(value); positiveId(number, 'ID'); return number; };
export const writeDefinitions = [{id: 'order-device-update', command: 'order-devices update', method: 'POST', path: orderDeviceUpdatePath,
  apiVersion: 'v2', scope: 'one RVC-owned record inside the configured location boundary', automaticRetry: false, automaticReadback: false}];
export function registerWrites(root: Command, store: StateStore, setExit: (code: number) => void): void {
  const scopes = new WriteScopeStore(store.directory);
  const scope = root.command('write-scope').description('[local] Explicit location/RVC write boundary; not an Oracle permission grant');
  scope.command('show').description('[local] Show configured write boundary').action(async () => localResult('write-scope show', await scopes.load()));
  scope.command('set').description('[writes-state][local] Pin the selected account/environment, location and explicit RVC IDs')
    .requiredOption('--location-number <number>', 'Location object number', integer)
    .requiredOption('--location-hier-unit-id <id>', 'Location hierarchy unit ID', integer)
    .requiredOption('--rvc-hier-unit-ids <ids>', 'Comma-separated RVC hierarchy unit IDs', value => value.split(',').map(integer))
    .requiredOption('--confirm-company <key>', 'Exact selected company key')
    .requiredOption('--confirm-location <number>', 'Repeat the location object number', integer)
    .option('--replace', 'Deliberately replace an existing boundary; invalidates old approvals')
    .action(async opts => localResult('write-scope set', {scope: await scopes.configure(store, opts.locationNumber, opts.locationHierUnitId, opts.rvcHierUnitIds, opts.confirmCompany, opts.confirmLocation, !!opts.replace), serverVerified: false}));
  scope.command('disable').description('[writes-state][local] Disable updates; retain boundary metadata').action(async () => {
    await withFileLock(scopes.lock, async () => {const current = await scopes.load(); await scopes.persist(scopes.file, {...current, enabled: false});});
    localResult('write-scope disable', {enabled: false});
  });
  const devices = root.commands.find(command => command.name() === 'order-devices');
  if (!devices) throw new Error('Register order-device reads before writes');
  devices.description('Order-device reads and guarded single-record updates');
  devices.command('update').description('[writes-config only with --execute] One v2 order-device record; offline review by default')
    .requiredOption('--hier-unit-id <id>', 'Target RVC hierarchy unit ID, inside the configured boundary', integer)
    .requiredOption('--object-num <number>', 'Target order-device object number', integer)
    .requiredOption('--audit-ref <text>', 'Explicit Simphony audit reference; printable ASCII')
    .option('--json <json>', 'One explicit update object; never a collection or automatic merge')
    .option('--file <path>', 'One update object from UTF-8 JSON file; - reads stdin once')
    .option('--dry-run', 'Offline exact payload/target review (the default); ownership NOT verified')
    .option('--prepare', 'Read-only ownership/existence checks and diff; issue a 15-minute one-use approval')
    .option('--execute', 'Repeat checks, require matching approved content, consume approval and send one update')
    .option('--approve <id>', 'One-use approval from reviewed --prepare output')
    .option('--ack-update-risks', 'Acknowledge omission/null clearing, non-atomic checks and no readback')
    .option('--allow-unverified-fields', 'Explicitly permit unverified non-identity fields/nulls; not proof of writability')
    .option('--quiet', 'Suppress HTTP status diagnostics, not safety warnings')
    .option('--timeout <seconds>', 'Positive per-request timeout, at most 300 seconds', Number, 30)
    .addHelpText('after', `\n${updateRisks.join('\n')}\nThree prerequisite reads verify location, RVC and existing target. No automatic pagination or inheritance resolution.\nReview --prepare output before --execute; repeat identical payload, target and audit reference.\nArrays/batches and additional/nested identities are rejected. Unknown non-identity fields need explicit acknowledgement.\nApproval metadata stores hashes, not record values. Configuring/changing the boundary is explicit and offline.\n`)
    .action(async opts => setExit(await executeOrderDeviceUpdate(store, opts)));
}
