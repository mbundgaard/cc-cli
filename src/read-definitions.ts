// Reviewed calls and request capabilities only. Record columns never become an allowlist.
export interface ReadDefinition {
  id: string; command: string; summary: string;
  paths: Partial<Record<'v1' | 'v2', string>>;
  scope: string; scopeMode: 'none' | 'acknowledgement' | 'body' | 'criteria';
  scopeLabel: string; help: string;
}
export const readDefinitions = [
  { id: 'server-version', command: 'server-version', summary: 'Deployed Simphony Enterprise and CC API releases',
    paths: { v1: '/config/sim/v1/getReleaseVersions', v2: '/config/sim/v2/getReleaseVersions' },
    scope: 'environment-version', scopeMode: 'none', scopeLabel: '',
    help: 'One POST with an empty JSON body. Distinct from the installed CLI version. No implicit version lookup.' },
  { id: 'hierarchy', command: 'hierarchy list', summary: 'Organization hierarchy trees',
    paths: { v1: '/config/sim/v1/hierarchy/getHierarchy', v2: '/config/sim/v2/hierarchy/getHierarchy' },
    scope: 'organization-wide', scopeMode: 'acknowledgement', scopeLabel: '',
    help: 'Explicit organization-wide acknowledgement, even with a filter. No hierarchy traversal or node changes.' },
  { id: 'hierarchy-nodes', command: 'hierarchy nodes list', summary: 'Hierarchy nodes (v2 only)',
    paths: { v2: '/config/sim/v2/hierarchy/getHierarchyNodes' },
    scope: 'organization-wide', scopeMode: 'acknowledgement', scopeLabel: '',
    help: 'Flat nodes; reviewed v2 route only. No fallback, deduplication or node changes.' },
  { id: 'menu-item-masters', command: 'menu-item-masters list', summary: 'Menu item masters at one explicit hierarchy unit',
    paths: { v1: '/config/sim/v1/menuItems/getMenuItemMasters', v2: '/config/sim/v2/menuItems/getMenuItemMasters' },
    scope: 'hierarchy-unit', scopeMode: 'body', scopeLabel: 'Hierarchy unit ID (or hierUnitId in JSON); never a structure ID',
    help: 'CLI requires hierUnitId although Oracle marks it optional. A filter is not a substitute. No inherited/effective-menu calculation.' },
  { id: 'kds-displays', command: 'kds-displays list', summary: 'Kitchen display clients at one location',
    paths: { v1: '/config/sim/v1/devices/getKitchenDisplays', v2: '/config/sim/v2/devices/getKitchenDisplays' },
    scope: 'location', scopeMode: 'criteria', scopeLabel: 'Location hierarchy unit ID; local scope compiled into searchCriteria',
    help: 'Oracle names these Kitchen Display Clients. No controller, RVC or related-object lookup. Preserve nested panels, options and references unchanged.' },
  { id: 'order-devices', command: 'order-devices list', summary: 'Order devices at one revenue center',
    paths: { v1: '/config/sim/v1/devices/getOrderDevices', v2: '/config/sim/v2/devices/getOrderDevices' },
    scope: 'revenue-center', scopeMode: 'criteria', scopeLabel: 'Revenue-center hierarchy unit ID; local scope compiled into searchCriteria',
    help: 'Order-device scope is an RVC, not a location. No printer, display, distribution-group, redirect or backup lookup. Preserve options and nested settings unchanged.' },
  { id: 'workstations', command: 'workstations list', summary: 'Workstation configuration at one location',
    paths: { v1: '/config/sim/v1/devices/getWorkstations', v2: '/config/sim/v2/devices/getWorkstations' },
    scope: 'location', scopeMode: 'body', scopeLabel: 'Location hierarchy unit ID (or hierUnitId in JSON); never a workstation number',
    help: 'No workstation class, RVC, peripheral or service-host lookup. Nested devices may contain certificate/password settings: review projections and keep responses private. No redaction alters returned bytes.' },
  { id: 'order-types', command: 'order-types list', summary: 'Order type names at one explicit hierarchy unit',
    paths: { v1: '/config/sim/v1/setup/getordertypenames', v2: '/config/sim/v2/setup/getOrderTypeNames' },
    scope: 'definition-hierarchy', scopeMode: 'criteria', scopeLabel: 'Enterprise, zone or location hierarchy unit ID; local scope compiled into searchCriteria',
    help: 'Names use lineNum in the documented response, not an invented objectNum alias. Parameters are a separate explicit task. No ancestor traversal or inherited-value resolution.' },
  { id: 'order-type-parameters', command: 'order-types parameters list', summary: 'Order type parameters at one explicit hierarchy unit',
    paths: { v1: '/config/sim/v1/setup/getOrderTypeParameters', v2: '/config/sim/v2/setup/getOrderTypeParameters' },
    scope: 'definition-hierarchy', scopeMode: 'criteria', scopeLabel: 'Enterprise, zone, location or RVC hierarchy unit ID; local scope compiled into searchCriteria',
    help: 'Separate from names: preserve masks/options, KDS highlight references and unknown fields unchanged. No automatic name lookup, tax/payment calculation or configuration writes.' },
] as const satisfies readonly ReadDefinition[];
export type ReadId = typeof readDefinitions[number]['id'];
