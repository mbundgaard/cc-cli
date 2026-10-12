import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { StateStore, activeState, bearerToken } from './state.js';
import { refreshCompanies } from './companies.js';
import { inputBody, type QueryOptions } from './requests.js';
import { requestInto, httpExit, type HttpRequest } from './transport.js';
import { deliverResponse } from './responses.js';
import { CliError, Exit, localResult } from './output.js';
import { parseJson, isRawJson } from './json.js';
import { WriteScopeStore, withFileLock, writeIdentity, digest, positiveId, type WriteScope, type WriteApproval } from './write-scope.js';

export const orderDeviceUpdatePath = '/config/sim/v2/devices/updateOrderDevices';
export const updateRisks = [
  'Omitted optional fields may be cleared; this is not PATCH or an automatic read/merge/write.',
  'Documentation and observed reads do not prove completeness or writability. Explicit null may clear or be rejected.',
  'Ownership/existence and approval freshness checks are not atomic with the update. No documented conditional-write guarantee.',
  'One top-level record only; nested settings may affect child rows. No automatic snapshot, readback, retry, or rollback.',
];
export interface OrderDeviceUpdateOptions extends QueryOptions {
  hierUnitId: number; objectNum: number; auditRef: string; prepare?: boolean; execute?: boolean;
  approve?: string; ackUpdateRisks?: boolean; allowUnverifiedFields?: boolean;
}
// Reviewed v2 types classify warnings, NOT an executable route or record-column allowlist.
const integers = new Set(['hierUnitId', 'objectNum', 'deviceType', 'primaryDeviceType', 'deviceObjNum', 'backupDeviceObjNum',
  'orderDeviceRedirectObjNum', 'primaryDistGroupObjNum', 'condimentSortType', 'menuItemPrinting', 'maxNumLinePerChit',
  'sortConsoldiationMethod', 'languageObjNum', 'language2ObjNum', 'language3ObjNum', 'lineFeedBeforeOrder', 'lineFeedsAfterOrder']);
const strings = new Set(['customInstructions', 'printerOptions', 'kdsOptions']);
const kdsIntegers = new Set(['course1FirstAlertTimeInSecs', 'course1SecondAlertTimeInSecs', 'othCourseFirstAlertTimeInSecs',
  'othCourseSecondAlertTimeInSecs', 'primaryRunnerChitPrinterObjNum', 'backupRunnerChitPrinterObjNum', 'sendToPanelNum',
  'domType', 'addSortRule', 'modifySortRule', 'voidSortRule', 'addHighlightScheme', 'modifyHighlightScheme', 'voidHighlightScheme',
  'beepOnNewOrder', 'newOrderNotificationTimeInSecs', 'beepOnPrioritize', 'beepOnVIP', 'beepOnRush']);
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !isRawJson(value); }
export function validateUpdate(body: Record<string, unknown>, options: OrderDeviceUpdateOptions, scope: WriteScope): string[] {
  positiveId(options.hierUnitId, '--hier-unit-id'); positiveId(options.objectNum, '--object-num');
  if (!scope.enabled || !scope.rvcHierarchyUnitIds.includes(options.hierUnitId)) throw new CliError(Exit.usage, 'RVC is outside the enabled write boundary');
  if (body.hierUnitId !== options.hierUnitId || body.objectNum !== options.objectNum) throw new CliError(Exit.usage, 'Payload hierUnitId/objectNum must exactly match the explicit target flags');
  for (const [key, values] of [['deviceType', [1, 2]], ['menuItemPrinting', [1, 2, 3]], ['condimentSortType', [1, 2, 3]]] as const) {
    if (!(values as readonly unknown[]).includes(body[key])) throw new CliError(Exit.usage, `${key} is required and must match its documented integer values`);
  }
  if (typeof options.auditRef !== 'string' || !options.auditRef.trim() || options.auditRef.length > 2000 || /[\u0000-\u001f\u007f-\uffff]/.test(options.auditRef)) throw new CliError(Exit.usage, '--audit-ref must be nonblank printable ASCII, at most 2000 characters');
  if (!Number.isFinite(options.timeout ?? 30) || (options.timeout ?? 30) <= 0 || (options.timeout ?? 30) > 300) throw new CliError(Exit.usage, 'Timeout must be positive and at most 300 seconds');
  if ([options.dryRun, options.prepare, options.execute].filter(Boolean).length > 1) throw new CliError(Exit.usage, 'Choose only one of --dry-run, --prepare, --execute');
  if ((options.approve || options.ackUpdateRisks) && !options.execute) throw new CliError(Exit.usage, '--approve and --ack-update-risks require --execute');
  if (options.execute && (!options.ackUpdateRisks || !/^[a-f0-9]{64}$/.test(options.approve ?? ''))) throw new CliError(Exit.usage, '--execute requires --approve <one-use-id> and --ack-update-risks');
  if (Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024) throw new CliError(Exit.usage, 'Update body exceeds the 1 MiB limit');
  const unverified: string[] = []; let nodes = 0;
  function walk(value: unknown, at: string, depth: number): void {
    if (++nodes > 10000 || depth > 16) throw new CliError(Exit.usage, 'Update structural limits exceeded');
    if (Array.isArray(value)) throw new CliError(Exit.usage, 'Arrays/batches are not supported by the single-record update command');
    if (!object(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (!key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new CliError(Exit.usage, 'Unsafe update field name');
      const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      // Known routing/identity aliases and nested record selectors cannot be extensions.
      if (/(?:id|ids)$/.test(normalized) || /^(?:hier|parenthier|location|locref|org|company|tenant|revenuecenter|rvc|objectnum|items$|records$|data$|operation$|operations$|method$|url$|path$|searchcriteria$)/.test(normalized)) {
        if (!(at === '' && (key === 'hierUnitId' || key === 'objectNum'))) throw new CliError(Exit.usage, 'Additional/nested identity, routing or batch fields are forbidden');
      }
      // Translation maps are field values, not arbitrary child-record containers.
      const p = `${at}/${pointer(key)}`;
      let known = false;
      if (at === '') {
        if (integers.has(key)) { known = true; if (!Number.isSafeInteger(item)) throw new CliError(Exit.usage, `${key} must be a safe integer`); }
        else if (strings.has(key)) { known = true; if (item !== null && typeof item !== 'string') throw new CliError(Exit.usage, `${key} must be a string or explicit null`); if (item === null) unverified.push(p); }
        else if (key === 'name' || key === 'kdsSettings') { known = true; if (!object(item)) throw new CliError(Exit.usage, `${key} must be an object`); }
      } else if (at === '/name') {
        known = true; if (!/^[1-9][0-9]*$/.test(key) || typeof item !== 'string') throw new CliError(Exit.usage, 'name must map positive language IDs to strings');
      } else if (at === '/kdsSettings' && (kdsIntegers.has(key) || key === 'displayNewOrderNotification')) {
        known = true;
        if (key === 'displayNewOrderNotification' ? typeof item !== 'boolean' : !Number.isSafeInteger(item)) throw new CliError(Exit.usage, 'Invalid documented kdsSettings field type');
      }
      if (!known) unverified.push(p);
      walk(item, p, depth + 1);
    }
  }
  walk(body, '', 0);
  if (unverified.length && !options.allowUnverifiedFields) throw new CliError(Exit.usage, 'Unverified fields/nulls require explicit --allow-unverified-fields; documentation is not proof of writability');
  return [...new Set(unverified)].sort();
}
async function proof(input: HttpRequest): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0;
  const sink = new Writable({write(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) done(new Error('Ownership response too large')); else { chunks.push(Buffer.from(chunk)); done(); }
  }});
  let result;
  try { result = await requestInto(input, sink); }
  catch { throw new CliError(Exit.network, 'Ownership check failed or was cancelled; no update sent, no retry'); }
  if (result.status !== 200) throw new CliError(httpExit(result.status) || Exit.api, `Ownership check returned HTTP ${result.status}; no update sent`);
  try { const body = parseJson(Buffer.concat(chunks).toString('utf8')); if (!object(body)) throw new Error(); return body; }
  catch { throw new CliError(Exit.api, 'Invalid ownership response; no update sent'); }
}
function rows(body: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100 || !body.items.every(object) ||
      body.hasMore === true || (body.hasMore !== undefined && body.hasMore !== false) || body.count !== body.items.length ||
      body.totalResults !== body.items.length || (body.offset !== undefined && body.offset !== 0)) throw new CliError(Exit.api, 'Ownership response is empty, ambiguous or incomplete; no update sent');
  return body.items;
}
function changes(before: Record<string, unknown>, after: Record<string, unknown>): unknown[] {
  const result: unknown[] = [];
  for (const key of Object.keys(after)) if (!(key in before) || digest(before[key]) !== digest(after[key])) result.push({field: key, ...(key in before ? {before: before[key]} : {previouslyAbsent: true}), proposed: after[key]});
  return result;
}
export async function executeOrderDeviceUpdate(store: StateStore, options: OrderDeviceUpdateOptions, wait: (signal: AbortSignal) => Promise<void> = signal => delay(1100, undefined, {signal})): Promise<number> {
  const scopes = new WriteScopeStore(store.directory), scope = await scopes.load();
  const initial = activeState(await store.loadCompanies());
  if (digest(writeIdentity(initial)) !== digest({company: scope.company, apiUrl: scope.apiUrl, authDigest: scope.authDigest})) throw new CliError(Exit.state, 'Selected company/account/environment differs from the write boundary');
  const body = await inputBody(options); // One input read, before any auth/data network activity.
  const unverifiedFields = validateUpdate(body, options, scope);
  const wireBody = JSON.stringify(body);
  const plan = {method: 'POST', url: scope.apiUrl + orderDeviceUpdatePath, headers: {'Content-Type': 'application/json', 'Simphony-AuditTrailRef': options.auditRef},
    company: scope.company, locationNumber: scope.locationNumber, locationHierarchyUnitId: scope.locationHierarchyUnitId,
    rvcHierarchyUnitId: options.hierUnitId, objectNum: options.objectNum, body, unverifiedFields, risks: updateRisks};
  if (!options.prepare && !options.execute) { localResult('order-devices update dry-run', {...plan, authorizationOmitted: true, ownershipVerified: false, networkRequests: 0}); return Exit.ok; }
  let updateDispatched = false;
  try { return await withFileLock(scopes.lock, async () => {
    const approval = options.execute ? await scopes.approval() : undefined;
    function checkApproval() {
      if (approval && (approval.status !== 'prepared' || approval.id !== options.approve || approval.expiresAt <= Date.now())) throw new CliError(Exit.usage, 'Approval is expired, consumed or does not match; no update sent');
    }
    checkApproval();
    if (digest(await scopes.load()) !== digest(scope)) throw new CliError(Exit.state, 'Write boundary changed; prepare again');
    await refreshCompanies(store, true, options.timeout, options.quiet);
    // Ordinary company/config/auth commands share this lock: no cooperating CLI process
    // can select/reconfigure/renew an account between ownership checks and this write.
    return withFileLock(`${store.file}.lock`, async () => {
      const currentState = activeState(await store.loadCompanies());
      if (digest(writeIdentity(currentState)) !== digest(writeIdentity(initial))) throw new CliError(Exit.state, 'Selected company/account/environment changed; no update sent');
      const token = bearerToken(currentState), controller = new AbortController();
      const cancel = () => controller.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      const signal = controller.signal;
      const read = (route: string, requestBody: unknown) => proof({method: 'POST', url: scope.apiUrl + route, body: JSON.stringify(requestBody),
        headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`}, timeoutMs: (options.timeout ?? 30) * 1000, signal});
      let sent = false;
      try {
        const location = rows(await read('/config/sim/v2/hierarchy/getHierarchyNodes', {searchCriteria: `where equals(hierUnitId,${scope.locationHierarchyUnitId})`, include: 'hierUnitId,objectNum,nodeType', limit: 100, offset: 0}));
        if (!location.every(row => row.hierUnitId === scope.locationHierarchyUnitId && row.objectNum === scope.locationNumber && row.nodeType === 'Location')) throw new CliError(Exit.api, 'Location identity differs from the write boundary; no update sent');
        await wait(signal);
        const rvcs = rows(await read('/config/sim/v2/hierarchy/getHierarchyNodes', {searchCriteria: `where equals(hierUnitId,${options.hierUnitId})`, include: 'hierUnitId,nodeType,parentHierUnitId', limit: 100, offset: 0}));
        if (!rvcs.every(row => row.hierUnitId === options.hierUnitId && row.nodeType === 'RVC' && row.parentHierUnitId === scope.locationHierarchyUnitId)) throw new CliError(Exit.api, 'RVC ownership differs from the write boundary; no update sent');
        await wait(signal);
        const devices = rows(await read('/config/sim/v2/devices/getOrderDevices', {searchCriteria: `where (equals(hierUnitId,${options.hierUnitId}) and equals(objectNum,${options.objectNum}))`, includeAll: 'detailed', limit: 2, offset: 0}));
        if (devices.length !== 1 || devices[0]!.hierUnitId !== options.hierUnitId || devices[0]!.objectNum !== options.objectNum) throw new CliError(Exit.api, 'Target is missing, inherited, ambiguous or foreign; no update sent');
        const current = devices[0]!;
        const requestHash = digest({scope, plan, current});
        signal.throwIfAborted();
        if (options.prepare) {
          const fresh: WriteApproval = {schemaVersion: 1, product: 'cc-order-device-approval', id: randomBytes(32).toString('hex'), requestHash, expiresAt: Date.now() + 15 * 60 * 1000, status: 'prepared'};
          await scopes.persist(scopes.approvalFile, fresh);
          localResult('order-devices update prepare', {...plan, ownershipVerified: true, changes: changes(current, body),
            absentFromSubmittedPayload: Object.keys(current).filter(key => !Object.hasOwn(body, key)), approval: fresh.id, expiresAt: new Date(fresh.expiresAt).toISOString(),
            updateSent: false, warning: 'Review the FULL submitted payload, omitted fields and risks. Approval metadata contains no record values; this is not a before-snapshot.'});
          return Exit.ok;
        }
        if (!approval || requestHash !== approval.requestHash) throw new CliError(Exit.usage, 'Target, payload, audit reference, boundary or current record changed since preparation; prepare and approve again');
        await wait(signal); checkApproval(); signal.throwIfAborted();
        // Persist consumption BEFORE the possible side effect. A crash, timeout, output
        // failure or uncertain API result must never make this approval reusable.
        await scopes.persist(scopes.approvalFile, {...approval, status: 'consumed'});
        signal.throwIfAborted(); sent = true; updateDispatched = true;
        const code = await deliverResponse({method: 'POST', url: plan.url, headers: {...plan.headers, Accept: 'application/json', Authorization: `Bearer ${token}`},
          body: wireBody, timeoutMs: (options.timeout ?? 30) * 1000, signal}, 'order-devices update', store.directory, options.quiet, undefined, 'write');
        process.stderr.write('[cc order-devices update] One update sent; no readback performed. Approval consumed. HTTP success is not verified application. Do not blindly retry an uncertain outcome.\n');
        return code;
      } catch (error) {
        if (sent) throw new CliError(error instanceof CliError ? error.exitCode : Exit.network, 'Order-device update outcome may be uncertain. Do not blindly retry; approval has been consumed.', 'Reconcile independently before preparing another write. No automatic readback or rollback was attempted.');
        if (error instanceof CliError) throw error;
        throw new CliError(Exit.network, 'Order-device preparation/checks failed or were cancelled; no update sent');
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    });
  }); } catch (error) {
    if (updateDispatched) throw new CliError(error instanceof CliError ? error.exitCode : Exit.state,
      'Order-device update outcome may be uncertain. Do not blindly retry; approval has been consumed.',
      'Inspect the delivered response and any local lock/storage failure; no automatic readback or rollback was attempted.');
    throw error;
  }
}
