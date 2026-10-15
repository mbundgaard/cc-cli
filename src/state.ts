import { mkdir, readFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CliError, Exit } from './output.js';
import { validateUrl } from './transport.js';

export interface AuthConfig {
  authUrl?: string; apiUrl?: string; clientId?: string; orgName?: string; username?: string;
}
export interface TokenSet {
  idToken: string; refreshToken: string; codeVerifier: string; obtainedAt: string; expiresIn?: number;
}
// Builders consume a single CC profile, never the company registry.
export interface State { schemaVersion: 1; product: 'cc'; auth: AuthConfig; tokens?: TokenSet }
export interface Company extends State { refreshAfter?: string }
export interface CompanyState {
  schemaVersion: 2; product: 'cc'; activeCompany: string | null;
  companies: Record<string, Company>; pending?: State;
}
export const DAY = 86_400_000, HOUR = 3_600_000;
export const emptyState = (): State => ({ schemaVersion: 1, product: 'cc', auth: {} });
export const emptyCompanies = (): CompanyState => ({ schemaVersion: 2, product: 'cc', activeCompany: null, companies: {} });
export function stateDirectory(home = os.homedir()): string {
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'CcCli');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'CcCli');
  return path.join(home, '.config', 'CcCli');
}
export function baseUrl(value: string): string {
  const url = validateUrl(value);
  if (url.search || value.includes('?') || value.includes('#')) throw new CliError(Exit.usage, 'Base URL cannot contain a query or fragment');
  return url.href.replace(/\/$/, '');
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fail(message: string): never { throw new CliError(Exit.state, message); }
function timestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,7})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const lastDay = new Date(0); lastDay.setUTCFullYear(year!, month!, 0);
  return month! >= 1 && month! <= 12 && day! >= 1 && day! <= lastDay.getUTCDate();
}
export function validateState(value: unknown): State {
  if (!object(value) || value.schemaVersion !== 1 || value.product !== 'cc' || !object(value.auth)) fail('Expected a CC profile with schemaVersion 1 and an auth object; BI/STS or untagged state cannot be imported');
  if (Object.keys(value).some(key => !['schemaVersion', 'product', 'auth', 'tokens'].includes(key))) fail('Unknown CC state field');
  const keys = ['authUrl', 'apiUrl', 'clientId', 'orgName', 'username'];
  if (Object.keys(value.auth).some(key => !keys.includes(key))) fail('Unknown auth field; passwords must never be saved');
  for (const key of keys) {
    const item = value.auth[key];
    if (item !== undefined && (typeof item !== 'string' || !item.trim() || /[\u0000-\u001f\u007f]/.test(item))) fail(`Invalid auth.${key}`);
  }
  for (const key of ['authUrl', 'apiUrl']) {
    if (typeof value.auth[key] === 'string') {
      try { baseUrl(value.auth[key]); } catch { fail(`Invalid auth.${key}: HTTPS base URL required`); }
    }
  }
  if (value.tokens !== undefined) {
    if (!object(value.tokens)) fail('Invalid tokens object');
    if (Object.keys(value.tokens).some(key => !['idToken', 'refreshToken', 'codeVerifier', 'obtainedAt', 'expiresIn'].includes(key))) fail('Unknown token field; CC requires id_token, not STS access_token');
    for (const key of ['idToken', 'refreshToken', 'codeVerifier', 'obtainedAt']) {
      if (typeof value.tokens[key] !== 'string' || !value.tokens[key].trim() || /[\u0000-\u001f\u007f]/.test(value.tokens[key])) fail(`Missing or invalid tokens.${key}`);
    }
    const time = Date.parse(value.tokens.obtainedAt as string), seconds = value.tokens.expiresIn;
    if (!timestamp(value.tokens.obtainedAt as string) || (seconds !== undefined && (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(new Date(time + seconds * 1000).getTime())))) fail('Invalid token lifetime');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(value.tokens.codeVerifier as string)) fail('Invalid saved PKCE verifier');
  }
  return value as unknown as State;
}
export function companyKey(auth: AuthConfig): string {
  if (!auth.orgName?.trim() || !auth.authUrl) throw new CliError(Exit.notConfigured, 'Enterprise shortname and auth URL are required to identify a CC company');
  return `${auth.orgName}@${new URL(baseUrl(auth.authUrl)).hostname.toLowerCase()}`;
}
function scheduleLegacy(profile: Company): void {
  if (profile.tokens && profile.refreshAfter === undefined) profile.refreshAfter = new Date(Date.parse(profile.tokens.obtainedAt) + DAY).toISOString();
}
export function validateCompanies(value: unknown): CompanyState {
  if (!object(value)) fail('Invalid CC company state');
  if (value.schemaVersion === 1) {
    const legacy = validateState(value), registry = emptyCompanies();
    if (legacy.auth.orgName && legacy.auth.authUrl) {
      const key = companyKey(legacy.auth), profile: Company = { ...legacy };
      scheduleLegacy(profile); registry.companies[key] = profile; registry.activeCompany = key;
    } else registry.pending = legacy;
    return registry;
  }
  if (value.schemaVersion !== 2 || value.product !== 'cc' || !object(value.companies) || (value.activeCompany !== null && typeof value.activeCompany !== 'string')) fail('Invalid CC company registry; BI/STS or untagged state cannot be imported');
  if (Object.keys(value).some(key => !['schemaVersion', 'product', 'activeCompany', 'companies', 'pending'].includes(key))) fail('Unknown CC registry field');
  for (const [key, item] of Object.entries(value.companies)) {
    if (!object(item)) fail('Invalid CC company profile');
    const { refreshAfter, ...snapshot } = item;
    const profile = validateState(snapshot);
    if (companyKey(profile.auth) !== key) fail('Company key does not match its enterprise shortname/auth hostname');
    if (refreshAfter !== undefined && (typeof refreshAfter !== 'string' || !timestamp(refreshAfter))) fail('Invalid refreshAfter timestamp');
    scheduleLegacy(item as unknown as Company);
  }
  if (value.activeCompany !== null && !Object.hasOwn(value.companies, value.activeCompany as string)) fail('Active company is absent from the registry');
  if (value.pending !== undefined) validateState(value.pending);
  return value as unknown as CompanyState;
}
export function activeState(registry: CompanyState): Company {
  if (!registry.activeCompany) throw new CliError(Exit.notConfigured, 'No active CC company; log in or use cc company select <exact-key>');
  return registry.companies[registry.activeCompany]!;
}
function configurationState(registry: CompanyState): State {
  const profile = registry.pending ?? (registry.activeCompany ? activeState(registry) : emptyState());
  const { refreshAfter: _schedule, ...state } = profile as Company;
  return state;
}
export class StateStore {
  readonly file: string;
  constructor(readonly directory = stateDirectory()) { this.file = path.join(directory, 'CcCli.json'); }
  async loadCompanies(): Promise<CompanyState> {
    try { return validateCompanies(JSON.parse((await readFile(this.file, 'utf8')).replace(/^\uFEFF/, ''))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCompanies();
      throw new CliError(Exit.state, `Cannot read CC state at ${this.file}; invalid or inaccessible state`, 'Repair from a protected backup; state has not been overwritten.');
    }
  }
  async load(): Promise<State> { return configurationState(await this.loadCompanies()); }
  // Internal snapshot helpers preserve sibling profiles. CLI changes use locked mutations.
  async save(state: State): Promise<void> {
    const incoming = validateCompanies(state), registry = await this.loadCompanies();
    if (incoming.activeCompany) {
      registry.companies[incoming.activeCompany] = incoming.companies[incoming.activeCompany]!;
      registry.activeCompany = incoming.activeCompany; delete registry.pending;
    } else registry.pending = incoming.pending;
    await this.saveCompanies(registry);
  }
  async saveCompanies(registry: CompanyState): Promise<void> {
    validateCompanies(registry);
    const temp = `${this.file}.${randomUUID()}.tmp`;
    let complete = false;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(registry, null, 2) + '\n'); await handle.sync(); complete = true; }
      finally { await handle.close(); }
      await rename(temp, this.file);
    } catch {
      throw new CliError(Exit.state, `Cannot save CC state at ${this.file}`,
        complete ? `Complete recovery copy: ${temp}. Tokens may already have rotated. Do not retry login/refresh using old state. Repair filesystem access, then use cc auth restore --file "${temp}" --force. Keep the copy private.` : 'No complete recovery copy was written. If Oracle issued tokens, resolve the state failure before further auth operations.');
    } finally { if (!complete) await unlink(temp).catch(() => {}); }
  }
  async mutateCompanies<T>(run: (registry: CompanyState) => Promise<T>): Promise<T> {
    const file = `${this.file}.lock`;
    let lock;
    try { await mkdir(this.directory, { recursive: true, mode: 0o700 }); lock = await open(file, 'wx', 0o600); }
    catch { throw new CliError(Exit.state, `Cannot lock CC state; inspect ${file} before removing a stale lock`); }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      const registry = await this.loadCompanies(), result = await run(registry);
      await this.saveCompanies(registry); return result;
    } finally { await lock.close(); await unlink(file); }
  }
  async mutate<T>(run: (state: State) => Promise<T>): Promise<T> {
    return this.mutateCompanies(async registry => {
      const state = configurationState(registry), result = await run(state);
      if (registry.pending || !registry.activeCompany) {
        const migrated = validateCompanies(state);
        if (migrated.activeCompany) {
          const key = migrated.activeCompany; registry.companies[key] = migrated.companies[key]!; registry.activeCompany = key; delete registry.pending;
        } else registry.pending = state;
      } else {
        if (companyKey(state.auth) !== registry.activeCompany) throw new CliError(Exit.usage, 'Use auth config/login to change company identity');
        const prior = registry.companies[registry.activeCompany]!;
        registry.companies[registry.activeCompany] = { ...state, ...(prior.refreshAfter ? { refreshAfter: prior.refreshAfter } : {}) };
      }
      return result;
    });
  }
}
export function tokenSummary(tokens?: TokenSet, now = Date.now()) {
  const expiresAt = tokens?.obtainedAt && tokens.expiresIn !== undefined ? new Date(Date.parse(tokens.obtainedAt) + tokens.expiresIn * 1000).toISOString() : undefined;
  const secondsRemaining = expiresAt ? Math.floor((Date.parse(expiresAt) - now) / 1000) : undefined;
  return { hasIdToken: !!tokens?.idToken, hasRefreshToken: !!tokens?.refreshToken,
    obtainedAt: tokens?.obtainedAt, expiresIn: tokens?.expiresIn, expiresAt, secondsRemaining,
    expired: expiresAt === undefined ? undefined : Date.parse(expiresAt) <= now };
}
export function bearerToken(state: State): string {
  if (!state.tokens?.idToken) throw new CliError(Exit.noTokens, 'No CC ID token saved; run cc auth login');
  if (tokenSummary(state.tokens).expired) throw new CliError(Exit.auth, 'CC ID token expired; run cc auth login');
  return state.tokens.idToken;
}
