import { Command } from 'commander';
import { StateStore } from './state.js';
import { CliError, Exit, localResult } from './output.js';
import { WriteScopeStore, positiveId, withFileLock } from './write-scope.js';
import { executeOrderDeviceUpdate, orderDeviceUpdatePath, updateRisks } from './order-device-update.js';
import { executeKdsWrite, kdsWritePaths, kdsWriteRisks, type KdsWriteAction } from './kds-display-writes.js';

const integer = (value: string) => { if (!/^[1-9][0-9]*$/.test(value)) throw new CliError(Exit.usage, 'Expected a positive integer'); const number = Number(value); positiveId(number, 'ID'); return number; };
export const writeDefinitions = [
  {id: 'order-device-update', command: 'order-devices update', method: 'POST', path: orderDeviceUpdatePath,
    apiVersion: 'v2', scope: 'one RVC-owned record inside the configured location boundary', automaticRetry: false, automaticReadback: false},
  ...Object.entries(kdsWritePaths).map(([action, path]) => ({id: `kds-display-${action}`, command: `kds-displays ${action}`, method: 'POST', path,
    apiVersion: 'v2', scope: 'one location-owned display inside the configured location boundary', automaticRetry: false, automaticReadback: false})),
];
function controls(command: Command, scope: string): Command {
  return command.addHelpText('after', '\nAudit reference is automatic: Muneris CC-CLI // <saved username>. Maximum 50 printable ASCII characters; no override or truncation.\n')
    .requiredOption('--hier-unit-id <id>', `Target ${scope} hierarchy unit ID, inside the configured boundary`, integer)
    .requiredOption('--object-num <number>', 'Target object number', integer)
    .option('--json <json>', 'One explicit object; never a collection or automatic merge')
    .option('--file <path>', 'One object from UTF-8 JSON file; - reads stdin once')
    .option('--dry-run', 'Offline exact action/payload/target review (the default); ownership NOT verified')
    .option('--prepare', 'Read-only ownership/existence checks and review; issue a 15-minute one-use approval')
    .option('--execute', 'Repeat checks, require matching approved action/content, consume approval and send one write')
    .option('--approve <id>', 'One-use approval from reviewed --prepare output')
    .option('--ack-update-risks', 'Acknowledge omission/null clearing, non-atomic checks and no readback; required for all writes')
    .option('--allow-unverified-fields', 'Explicitly permit unverified non-identity fields/nulls; not proof of writability')
    .option('--quiet', 'Suppress HTTP status diagnostics, not safety warnings')
    .option('--timeout <seconds>', 'Positive per-request timeout, at most 300 seconds', Number, 30);
}
export function registerWrites(root: Command, store: StateStore, setExit: (code: number) => void): void {
  const scopes = new WriteScopeStore(store.directory);
  const scope = root.command('write-scope').description('[local] Explicit location/RVC write boundary; not an Oracle permission grant');
  scope.command('show').description('[local] Show configured write boundary').action(async () => localResult('write-scope show', await scopes.load()));
  scope.command('set').description('[writes-state][local] Pin the selected account/environment, location and optional explicit RVC IDs')
    .requiredOption('--location-number <number>', 'Location object number', integer)
    .requiredOption('--location-hier-unit-id <id>', 'Location hierarchy unit ID', integer)
    .option('--rvc-hier-unit-ids <ids>', 'Comma-separated RVC hierarchy unit IDs; omit for location-only writes', value => value.split(',').map(integer), [])
    .requiredOption('--confirm-company <key>', 'Exact selected company key')
    .requiredOption('--confirm-location <number>', 'Repeat the location object number', integer)
    .option('--replace', 'Deliberately replace an existing boundary; invalidates old approvals')
    .action(async opts => localResult('write-scope set', {scope: await scopes.configure(store, opts.locationNumber, opts.locationHierUnitId, opts.rvcHierUnitIds, opts.confirmCompany, opts.confirmLocation, !!opts.replace), serverVerified: false}));
  scope.command('disable').description('[writes-state][local] Disable all writes; retain boundary metadata').action(async () => {
    await withFileLock(scopes.lock, async () => {const current = await scopes.load(); await scopes.persist(scopes.file, {...current, enabled: false});});
    localResult('write-scope disable', {enabled: false});
  });
  const devices = root.commands.find(command => command.name() === 'order-devices');
  const displays = root.commands.find(command => command.name() === 'kds-displays');
  if (!devices || !displays) throw new Error('Register device reads before writes');
  devices.description('Order-device reads and guarded single-record updates');
  controls(devices.command('update').description('[writes-config only with --execute] One v2 order-device record; offline review by default'), 'RVC')
    .addHelpText('after', `\n${updateRisks.join('\n')}\nThree prerequisite reads verify location, RVC and existing target. No automatic pagination or inheritance resolution.\nReview --prepare output before --execute; repeat identical payload, target and audit reference.\nArrays/batches and additional/nested identities are rejected. Unknown non-identity fields need explicit acknowledgement.\nApproval metadata stores hashes, not record values. Configuring/changing the boundary is explicit and offline.\n`)
    .action(async opts => setExit(await executeOrderDeviceUpdate(store, opts)));
  displays.description('KDS display CRUD: list reads; guarded single-display create/update/delete');
  for (const action of Object.keys(kdsWritePaths) as KdsWriteAction[]) {
    const command = controls(displays.command(action).description(`[writes-config only with --execute] ${action} one v2 KDS display; offline review by default`), 'location');
    if (action === 'delete') command.option('--confirm-delete <number>', 'Repeat object number for destructive execution; mandatory with --execute', integer);
    command.addHelpText('after', `\n${kdsWriteRisks.join('\n')}\nTwo prerequisite reads verify the location and target ${action === 'create' ? 'absence' : 'existence'}. No automatic fallback or related-record fetches.\nCreate/update require an explicit object with hierUnitId, objectNum and translated name.\nDelete sends only the explicit target IDs; JSON/file is optional but must match if supplied.\nReviewed child arrays are allowed; top-level batches, database IDs and optionsExt are rejected.\nNames/IPs stay as authored. No copying, alias translation, synchronization or environment rewrites.\n`)
      .action(async opts => setExit(await executeKdsWrite(action, store, opts)));
  }
}
