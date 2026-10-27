import { StateStore } from './state.js';
import { CliError, Exit } from './output.js';
import { positiveId, type WriteScope } from './write-scope.js';
import { mutationOperationById } from './configuration-policy.js';
import { executeGuardedWrite, guardedDefinition, validateWriteControls, object, pointer, writeRisks, type GuardedWriteOptions, type GuardedWriteDefinition } from './guarded-write.js';

export const kdsWritePaths = {
  create: mutationOperationById('kds-displays:create:v2').path,
  update: mutationOperationById('kds-displays:update:v2').path,
  delete: mutationOperationById('kds-displays:delete:v2').path,
} as const;
export type KdsWriteAction = keyof typeof kdsWritePaths;
export const kdsWriteRisks = [...writeRisks,
  'Oracle documents updateKitchenDisplays as update/add. Existence checks do not make this an atomic update-only operation.',
  'Nested panels, recall columns and production items are explicit child settings; their omission/null/replacement semantics are not live-verified.',
  'Delete is destructive. Related references/cascades are not checked or repaired; create/delete are not a synchronization workflow.',
  'Names and IP addresses are sent exactly as authored, including addresses currently used elsewhere. No environment-specific substitutions.',
  'A location-bound record does not isolate runtime effects: copied IPs may address devices used by another site if reachable.',
];
const integers = new Set(['hierUnitId', 'objectNum', 'kdsControllerObjNum', 'toolbarObjNum', 'bumpBarObjNum', 'platformType',
  'cardId', 'videoId', 'displayOrientation', 'orderSelectionTimeInSecs', 'displayType', 'toolBarPosition', 'panelLayout',
  'tableDetailToolbarObjNum', 'kdsChitLayoutStyleObjNum', 'serpentineMode', 'menuItemFont', 'comboItemFont', 'orderTypeFont',
  'sosDisplayTableColumns', 'sosDisplayTimeout', 'sosZoneFont', 'sosSortMethod', 'minTableState', 'maxTableState',
  'kdsProdLocation', 'kdsProdColumns', 'resolutionWidth', 'resolutionHeight', 'locationFromTop', 'locationFromLeft']);
const arrays = {
  panelConfiguration: {selector: 'panelNum', fields: ['panelNum', 'proportion', 'chitColumns', 'chitRows', 'capacity'], maximum: 100},
  recallReviewList: {selector: 'colNum', fields: ['colNum', 'colType', 'width'], maximum: 6},
  prodItems: {selector: 'prodItemNum', fields: ['prodItemNum', 'prodItemObjNum', 'persistence'], maximum: 100},
} as const;
const arrayDefinition = (key: string) => Object.hasOwn(arrays, key) ? arrays[key as keyof typeof arrays] : undefined;
export function validateKdsWrite(action: KdsWriteAction, body: Record<string, unknown>, options: GuardedWriteOptions, scope: WriteScope): string[] {
  validateWriteControls(body, options);
  if (!scope.enabled || options.hierUnitId !== scope.locationHierarchyUnitId) throw new CliError(Exit.usage, 'KDS target is outside the enabled location write boundary');
  if (action === 'delete') {
    if (Object.keys(body).some(key => !['hierUnitId', 'objectNum'].includes(key))) throw new CliError(Exit.usage, 'Delete accepts only hierUnitId and objectNum, never filters or additional fields');
    if (options.execute && options.confirmDelete !== options.objectNum) throw new CliError(Exit.usage, '--execute delete requires --confirm-delete matching the object number');
    return [];
  }
  if (options.confirmDelete !== undefined) throw new CliError(Exit.usage, '--confirm-delete is only a delete control');
  if (!object(body.name) || !Object.keys(body.name).length) throw new CliError(Exit.usage, 'name must be a nonempty language-ID/string map');
  if (Object.keys(body).filter(key => key.toLowerCase() === 'toolbarobjnum').length > 1) throw new CliError(Exit.usage, 'Conflicting toolbar field spellings; author exactly one explicitly');
  let nodes = 0; const unverified: string[] = [];
  function walk(value: unknown, at: string, depth: number): void {
    if (++nodes > 10000 || depth > 16) throw new CliError(Exit.usage, 'KDS write structural limits exceeded');
    if (Array.isArray(value)) {
      const definition = at.startsWith('/') && at.indexOf('/', 1) < 0 ? arrayDefinition(at.slice(1)) : undefined;
      if (!definition) throw new CliError(Exit.usage, 'Only the reviewed KDS child arrays are permitted; no batches or unknown arrays');
      if (value.length > definition.maximum) throw new CliError(Exit.usage, 'KDS child array exceeds its supported limit');
      const seen = new Set<number>();
      for (const child of value) {
        if (!object(child)) throw new CliError(Exit.usage, 'KDS child array entries must be objects');
        const selector = child[definition.selector]; positiveId(selector, definition.selector);
        if (seen.has(selector)) throw new CliError(Exit.usage, 'Duplicate KDS child selector');
        seen.add(selector); walk(child, `${at}/*`, depth + 1);
      }
      return;
    }
    if (!object(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (!key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new CliError(Exit.usage, 'Unsafe KDS field name');
      const p = `${at}/${pointer(key)}`, normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const rootKnownInteger = at === '' && integers.has(key);
      const identity = /(?:id|ids)$/.test(normalized) || /^(?:hier|parenthier|location|locref|org|company|tenant|revenuecenter|rvc|objectnum|items$|records$|data$|operation$|operations$|method$|url$|path$|searchcriteria$)/.test(normalized);
      // cardId/videoId and locationFromTop/Left are documented display settings, NOT
      // transferable database identities. They are allowed only at the root, exact case.
      if (identity && !rootKnownInteger) throw new CliError(Exit.usage, 'Additional/nested identity, routing or batch fields are forbidden');
      if (normalized === 'optionsext') throw new CliError(Exit.usage, 'optionsExt is a descriptive read field; author the raw options string explicitly');
      let known = false;
      if (at === '') {
        if (rootKnownInteger) {
          known = true;
          if (item === null && key !== 'hierUnitId' && key !== 'objectNum') unverified.push(p);
          else if (!Number.isSafeInteger(item)) throw new CliError(Exit.usage, `${key} must be a safe integer or acknowledged explicit null`);
        } else if (key === 'ipAddress' || key === 'options') {
          known = true;
          if (item === null) unverified.push(p);
          else if (typeof item !== 'string') throw new CliError(Exit.usage, `${key} must be a string or acknowledged explicit null`);
          if (key === 'options' && typeof item === 'string') {
            if (!/^[01]+$/.test(item)) throw new CliError(Exit.usage, 'options must be a raw binary string');
            if (item.length !== 32) unverified.push(p);
          }
        } else if (key === 'name') known = true;
        else if (arrayDefinition(key)) {
          known = true;
          if (item === null) unverified.push(p);
          else if (!Array.isArray(item)) throw new CliError(Exit.usage, `${key} must be an array or acknowledged explicit null`);
        }
      } else if (at === '/name') {
        known = true;
        if (!/^[1-9][0-9]*$/.test(key) || typeof item !== 'string') throw new CliError(Exit.usage, 'name must map positive language IDs to strings');
      } else if (at.endsWith('/*')) {
        const definition = arrayDefinition(at.slice(1, -2));
        if (definition && (definition.fields as readonly string[]).includes(key)) {
          known = true;
          if (!Number.isSafeInteger(item)) throw new CliError(Exit.usage, 'Documented KDS child fields must be safe integers');
        }
      }
      if (!known) unverified.push(p);
      walk(item, p, depth + 1);
    }
  }
  walk(body, '', 0);
  if (unverified.length && !options.allowUnverifiedFields) throw new CliError(Exit.usage, 'Unverified KDS fields/nulls/option widths require explicit --allow-unverified-fields; this does not prove writability');
  return [...new Set(unverified)].sort();
}
export function kdsDefinition(action: KdsWriteAction): GuardedWriteDefinition {
  if (!Object.hasOwn(kdsWritePaths, action)) throw new CliError(Exit.usage, 'Unsupported KDS write action');
  return guardedDefinition(`kds-displays:${action}:v2`, `kds-displays ${action}`, kdsWriteRisks,
    (body, options, scope) => validateKdsWrite(action, body, options, scope));
}
export function executeKdsWrite(action: KdsWriteAction, store: StateStore, options: GuardedWriteOptions, wait?: (signal: AbortSignal) => Promise<void>): Promise<number> {
  return executeGuardedWrite(kdsDefinition(action), store, options, wait);
}
