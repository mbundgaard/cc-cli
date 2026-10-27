import { type ReadId } from './read-definitions.js';

export interface RecordDefinition {
  container: 'items' | 'self'; identityField?: string; singletonId?: string;
  hierarchyField?: string;
}
// Reviewed v1/v2 response structures. These describe records, not whether capture
// is enabled: every supported read MUST have a definition and use the same pipeline.
// Hierarchy trees remain one root record with all nested nodes intact. Flat hierarchy
// nodes use placement identity (hierStrucId), not a potentially repeated hierUnitId.
export const recordDefinitions: Readonly<Record<ReadId, Readonly<RecordDefinition>>> = Object.freeze({
  'server-version': Object.freeze({container: 'self', singletonId: 'release-versions'}),
  hierarchy: Object.freeze({container: 'items', identityField: 'hierUnitId'}),
  'hierarchy-nodes': Object.freeze({container: 'items', identityField: 'hierStrucId'}),
  'menu-item-masters': Object.freeze({container: 'items', identityField: 'objectNum', hierarchyField: 'hierUnitId'}),
  'kds-displays': Object.freeze({container: 'items', identityField: 'objectNum', hierarchyField: 'hierUnitId'}),
  'order-devices': Object.freeze({container: 'items', identityField: 'objectNum', hierarchyField: 'hierUnitId'}),
  workstations: Object.freeze({container: 'items', identityField: 'objectNum', hierarchyField: 'hierUnitId'}),
  'order-types': Object.freeze({container: 'items', identityField: 'lineNum', hierarchyField: 'hierUnitId'}),
  'order-type-parameters': Object.freeze({container: 'items', identityField: 'objectNum', hierarchyField: 'hierUnitId'}),
});
