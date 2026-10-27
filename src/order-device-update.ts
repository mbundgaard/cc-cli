import { StateStore } from './state.js';
import { CliError, Exit } from './output.js';
import { type WriteScope } from './write-scope.js';
import { executeGuardedWrite, guardedDefinition, validateWriteControls, writeRisks, object, pointer, type GuardedWriteOptions } from './guarded-write.js';
import { mutationOperationById } from './configuration-policy.js';

export const orderDeviceUpdatePath = mutationOperationById('order-devices:update:v2').path;
export const updateRisks = writeRisks;
export type OrderDeviceUpdateOptions = GuardedWriteOptions;
// Reviewed v2 types classify warnings, NOT an executable route or record-column allowlist.
const integers = new Set(['hierUnitId', 'objectNum', 'deviceType', 'primaryDeviceType', 'deviceObjNum', 'backupDeviceObjNum',
  'orderDeviceRedirectObjNum', 'primaryDistGroupObjNum', 'condimentSortType', 'menuItemPrinting', 'maxNumLinePerChit',
  'sortConsoldiationMethod', 'languageObjNum', 'language2ObjNum', 'language3ObjNum', 'lineFeedBeforeOrder', 'lineFeedsAfterOrder']);
const strings = new Set(['customInstructions', 'printerOptions', 'kdsOptions']);
const kdsIntegers = new Set(['course1FirstAlertTimeInSecs', 'course1SecondAlertTimeInSecs', 'othCourseFirstAlertTimeInSecs',
  'othCourseSecondAlertTimeInSecs', 'primaryRunnerChitPrinterObjNum', 'backupRunnerChitPrinterObjNum', 'sendToPanelNum',
  'domType', 'addSortRule', 'modifySortRule', 'voidSortRule', 'addHighlightScheme', 'modifyHighlightScheme', 'voidHighlightScheme',
  'beepOnNewOrder', 'newOrderNotificationTimeInSecs', 'beepOnPrioritize', 'beepOnVIP', 'beepOnRush']);
export function validateUpdate(body: Record<string, unknown>, options: OrderDeviceUpdateOptions, scope: WriteScope): string[] {
  validateWriteControls(body, options);
  if (!scope.enabled || !scope.rvcHierarchyUnitIds.includes(options.hierUnitId)) throw new CliError(Exit.usage, 'RVC is outside the enabled write boundary');
  if (options.confirmDelete !== undefined) throw new CliError(Exit.usage, 'Delete confirmation is not an update control');
  for (const [key, values] of [['deviceType', [1, 2]], ['menuItemPrinting', [1, 2, 3]], ['condimentSortType', [1, 2, 3]]] as const) {
    if (!(values as readonly unknown[]).includes(body[key])) throw new CliError(Exit.usage, `${key} is required and must match its documented integer values`);
  }
  const unverified: string[] = []; let nodes = 0;
  function walk(value: unknown, at: string, depth: number): void {
    if (++nodes > 10000 || depth > 16) throw new CliError(Exit.usage, 'Update structural limits exceeded');
    if (Array.isArray(value)) throw new CliError(Exit.usage, 'Arrays/batches are not supported by the single-record update command');
    if (!object(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (!key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new CliError(Exit.usage, 'Unsafe update field name');
      const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (/(?:id|ids)$/.test(normalized) || /^(?:hier|parenthier|location|locref|org|company|tenant|revenuecenter|rvc|objectnum|items$|records$|data$|operation$|operations$|method$|url$|path$|searchcriteria$)/.test(normalized)) {
        if (!(at === '' && (key === 'hierUnitId' || key === 'objectNum'))) throw new CliError(Exit.usage, 'Additional/nested identity, routing or batch fields are forbidden');
      }
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
const definition = guardedDefinition('order-devices:update:v2', 'order-devices update', updateRisks, validateUpdate);
export function executeOrderDeviceUpdate(store: StateStore, options: OrderDeviceUpdateOptions, wait?: (signal: AbortSignal) => Promise<void>): Promise<number> {
  return executeGuardedWrite(definition, store, options, wait);
}
