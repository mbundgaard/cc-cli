import { createHash } from 'node:crypto';
import { type Writable } from 'node:stream';
import { readDefinitions, type ReadId } from './read-definitions.js';
import { recordDefinitions, type RecordDefinition } from './record-definitions.js';
import { requestInto, validateUrl, type HttpRequest } from './transport.js';
import { CliError, Exit } from './output.js';

export type ConfigurationEffect = 'read' | 'create' | 'update' | 'delete';
interface Operation { readonly id: string; readonly method: string; readonly path: string; readonly effect: ConfigurationEffect }
export interface ReadOperation extends Operation {
  readonly effect: 'read'; readonly task: ReadId; readonly apiVersion: 'v1' | 'v2';
  readonly record: Readonly<RecordDefinition>; readonly catalogueRole: 'release' | 'records';
}
export const readOperations: readonly ReadOperation[] = Object.freeze(readDefinitions.flatMap(definition =>
  Object.entries(definition.paths).map(([version, path]) => Object.freeze({id: `${definition.id}:${version}`,
    method: 'POST', path, effect: 'read' as const, task: definition.id, apiVersion: version as 'v1' | 'v2',
    record: recordDefinitions[definition.id], catalogueRole: definition.catalogueRole}))));
export function readOperationById(id: string): ReadOperation {
  const operation = readOperations.find(item => item.id === id);
  if (!operation) throw new CliError(Exit.usage, 'Missing reviewed read capability metadata');
  return operation;
}
// Fixed capabilities, not caller-provided routes or imported executable Swagger.
export const mutationOperations = Object.freeze([
  Object.freeze({id: 'order-devices:update:v2', method: 'POST', path: '/config/sim/v2/devices/updateOrderDevices', effect: 'update', readOperationId: 'order-devices:v2', namespace: 'order-device', scope: 'rvc'} as const),
  Object.freeze({id: 'kds-displays:create:v2', method: 'POST', path: '/config/sim/v2/devices/kitchenDisplays', effect: 'create', readOperationId: 'kds-displays:v2', namespace: 'kds-display', scope: 'location'} as const),
  Object.freeze({id: 'kds-displays:update:v2', method: 'POST', path: '/config/sim/v2/devices/updateKitchenDisplays', effect: 'update', readOperationId: 'kds-displays:v2', namespace: 'kds-display', scope: 'location'} as const),
  Object.freeze({id: 'kds-displays:delete:v2', method: 'POST', path: '/config/sim/v2/devices/deleteKitchenDisplays', effect: 'delete', readOperationId: 'kds-displays:v2', namespace: 'kds-display', scope: 'location'} as const),
]);
export function mutationOperationById(id: string) {
  const operation = mutationOperations.find(item => item.id === id);
  if (!operation) throw new CliError(Exit.usage, 'Missing reviewed mutation capability metadata');
  return operation;
}
export const configurationOperations: readonly Readonly<Operation>[] = Object.freeze([...readOperations, ...mutationOperations]);
function denied(): never { throw new CliError(Exit.usage, 'Configuration request blocked by read-only policy; reviewed operation and matching single-use authorization required'); }
export function requireConfigurationOperation(input: Pick<HttpRequest, 'url' | 'method'>, effect: ConfigurationEffect): Readonly<Operation> {
  const url = validateUrl(input.url);
  // Reject aliases/normalization, query routes and fragments, even an empty delimiter.
  if (input.url !== `${url.origin}${url.pathname}` || url.search || url.hash) return denied();
  const operation = configurationOperations.find(item => item.path === url.pathname && item.method === input.method);
  if (!operation || operation.effect !== effect) return denied();
  return operation;
}
const permitBrand: unique symbol = Symbol('configuration-write-permit');
export interface ConfigurationWritePermit { readonly [permitBrand]: true }
const permits = new WeakMap<ConfigurationWritePermit, {fingerprint: string; expiresAt: number}>();
function fingerprint(input: HttpRequest): string {
  return createHash('sha256').update(JSON.stringify({url: input.url, method: input.method,
    headers: Object.entries(input.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)), body: input.body ?? null})).digest('hex');
}
// Internal trusted issuer: only guarded-write may call this, AFTER durable approval
// consumption and account/scope/target/payload checks. Not a CLI unlock or credential.
export function issueConfigurationWritePermit(input: HttpRequest, effect: Exclude<ConfigurationEffect, 'read'>): ConfigurationWritePermit {
  requireConfigurationOperation(input, effect);
  const permit: ConfigurationWritePermit = Object.freeze({[permitBrand]: true as const});
  permits.set(permit, {fingerprint: fingerprint(input), expiresAt: Date.now() + 30_000});
  return permit;
}
export async function configurationRequestInto(input: HttpRequest, sink: Writable, permit?: ConfigurationWritePermit) {
  if (permit) {
    const authorization = permits.get(permit);
    permits.delete(permit); // Consume before dispatch, including failed/mismatched attempts.
    if (!authorization || authorization.expiresAt <= Date.now() || authorization.fingerprint !== fingerprint(input)) return denied();
  } else requireConfigurationOperation(input, 'read');
  return requestInto(input, sink);
}
