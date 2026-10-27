import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StateStore, activeState, baseUrl, companyKey, type State } from './state.js';
import { CliError, Exit } from './output.js';
import { isRawJson } from './json.js';
import { type CaptureReference } from './captures.js';

export function canonical(value: unknown): string {
  if (isRawJson(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export interface WriteIdentity { company: string; apiUrl: string; authDigest: string }
export function writeIdentity(state: State): WriteIdentity {
  if (!state.auth.apiUrl) throw new CliError(Exit.notConfigured, 'Configure the CC application URL first');
  return { company: companyKey(state.auth), apiUrl: baseUrl(state.auth.apiUrl), authDigest: digest(state.auth) };
}
export interface WriteScope extends WriteIdentity {
  schemaVersion: 1; product: 'cc-write-scope'; revision: string; enabled: boolean;
  locationNumber: number; locationHierarchyUnitId: number; rvcHierarchyUnitIds: number[];
}
// Stable on-disk identifiers only: every operation still uses the same locks and lifecycle.
const approvalStorage = Object.freeze({
  'order-device': {product: 'cc-order-device-approval', file: 'order-device-approval.json'},
  'kds-display': {product: 'cc-kds-display-approval', file: 'kds-display-approval.json'},
} as const);
export const SHARED_WRITE_LOCK = 'order-device-write.lock'; // Keep old clients on the SAME lock.
export interface WriteApproval {
  schemaVersion: 1; product: 'cc-order-device-approval' | 'cc-kds-display-approval'; id: string; requestHash: string;
  expiresAt: number; status: 'prepared' | 'consumed'; beforeCapture?: CaptureReference; executionCapture?: CaptureReference; attemptPath?: string;
}
export function positiveId(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new CliError(Exit.usage, `${label} must be a positive safe integer`);
}
export function validateScope(value: unknown): WriteScope {
  const scope = value as WriteScope;
  if (!scope || scope.schemaVersion !== 1 || scope.product !== 'cc-write-scope' || typeof scope.enabled !== 'boolean' ||
      typeof scope.revision !== 'string' || !scope.revision || typeof scope.company !== 'string' || !scope.company ||
      typeof scope.authDigest !== 'string' || !/^[a-f0-9]{64}$/.test(scope.authDigest) || typeof scope.apiUrl !== 'string' || !Array.isArray(scope.rvcHierarchyUnitIds)) {
    throw new CliError(Exit.state, 'Invalid CC write boundary; no network permitted');
  }
  baseUrl(scope.apiUrl); positiveId(scope.locationNumber, 'Location number'); positiveId(scope.locationHierarchyUnitId, 'Location hierarchy ID');
  if (scope.rvcHierarchyUnitIds.length > 100 || new Set(scope.rvcHierarchyUnitIds).size !== scope.rvcHierarchyUnitIds.length) throw new CliError(Exit.state, 'Invalid RVC boundary');
  scope.rvcHierarchyUnitIds.forEach(id => positiveId(id, 'RVC hierarchy ID'));
  if (scope.rvcHierarchyUnitIds.includes(scope.locationHierarchyUnitId)) throw new CliError(Exit.state, 'Location and RVC IDs must be distinct');
  return scope;
}
export async function withFileLock<T>(file: string, run: () => Promise<T>): Promise<T> {
  let handle;
  try { await mkdir(path.dirname(file), {recursive: true, mode: 0o700}); handle = await open(file, 'wx', 0o600); }
  catch { throw new CliError(Exit.state, 'CC write/state lock unavailable; inspect before removing a stale lock'); }
  try { return await run(); } finally { await handle.close(); await unlink(file); }
}
export class WriteScopeStore {
  readonly file: string; readonly approvalFile: string; readonly lock: string;
  readonly approvalProduct: WriteApproval['product'];
  constructor(readonly directory: string, namespace: 'order-device' | 'kds-display' = 'order-device') {
    if (!Object.hasOwn(approvalStorage, namespace)) throw new CliError(Exit.state, 'Unsupported approval namespace');
    const storage = approvalStorage[namespace];
    this.approvalProduct = storage.product;
    this.file = path.join(directory, 'write-scope.json');
    this.approvalFile = path.join(directory, storage.file);
    // Retain the original shared lock filename for compatibility with existing clients.
    this.lock = path.join(directory, SHARED_WRITE_LOCK);
  }
  async load(): Promise<WriteScope> {
    try { return validateScope(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch { throw new CliError(Exit.state, 'Missing or invalid write boundary; configure cc write-scope explicitly before preparing an update'); }
  }
  async persist(file: string, value: unknown): Promise<void> {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, file);
    } catch { throw new CliError(Exit.state, 'Cannot persist write boundary/approval; no further request is permitted'); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async configure(store: StateStore, locationNumber: number, locationHierarchyUnitId: number, ids: number[], confirmCompany: string, confirmLocation: number, replace: boolean): Promise<WriteScope> {
    return withFileLock(this.lock, async () => {
      const state = activeState(await store.loadCompanies()), identity = writeIdentity(state);
      if (identity.company !== confirmCompany || locationNumber !== confirmLocation) throw new CliError(Exit.usage, 'Explicit company/location confirmations must match the selected boundary');
      if (!replace) {
        try { await readFile(this.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; else return this.saveNew(identity, locationNumber, locationHierarchyUnitId, ids); }
        throw new CliError(Exit.state, 'A write boundary exists; explicit --replace and company/location confirmations are required');
      }
      return this.saveNew(identity, locationNumber, locationHierarchyUnitId, ids);
    });
  }
  private async saveNew(identity: WriteIdentity, locationNumber: number, locationHierarchyUnitId: number, ids: number[]) {
    const scope = validateScope({schemaVersion: 1, product: 'cc-write-scope', revision: randomUUID(), enabled: true,
      ...identity, locationNumber, locationHierarchyUnitId, rvcHierarchyUnitIds: [...ids].sort((a, b) => a - b)});
    await this.persist(this.file, scope); return scope;
  }
  async approval(): Promise<WriteApproval> {
    try {
      const value = JSON.parse(await readFile(this.approvalFile, 'utf8'));
      if (value.schemaVersion !== 1 || value.product !== this.approvalProduct || !/^[a-f0-9]{64}$/.test(value.id) ||
          !/^[a-f0-9]{64}$/.test(value.requestHash) || !Number.isSafeInteger(value.expiresAt) || !['prepared', 'consumed'].includes(value.status)) throw new Error();
      return value;
    } catch { throw new CliError(Exit.state, 'No valid prepared approval; run the explicit read-only --prepare step'); }
  }
}
