# Menu item master reads

`cc menu-item-masters list` uses one hardcoded read-only POST:
- preferred v2: `/config/sim/v2/menuItems/getMenuItemMasters`
- explicit v1: `/config/sim/v1/menuItems/getMenuItemMasters`

No automatic version fallback, arbitrary routes, writes, related-object lookup or menu
reconstruction. Master records are not menu item definitions, prices or an effective menu.

```sh
cc server-version --quiet
cc menu-item-masters list --hier-unit-id 7 --limit 25 --offset 0 --dry-run
cc menu-item-masters list --hier-unit-id 7 --limit 25 --offset 0 --lang-ids 1 --quiet
cc menu-item-masters list --hier-unit-id 7 --include-all detailed --quiet
cc menu-item-masters list --api-version v1 --hier-unit-id 7 --languages en-US --quiet
cc catalogue compare menu-item-masters --api-version v2
```

ID 7 is synthetic. Do not execute against a real environment without the owner's explicit
scope. These reads remain live-unverified. No scope is inferred from an earlier BI/STS test,
login or release-version result.

## Explicit request controls

Oracle documents `hierUnitId` as optional with a searchCriteria alternative. This CLI
intentionally requires a positive safe-integer `hierUnitId`, via `--hier-unit-id` or JSON.
A filter alone does not satisfy scope. `hierUnitID`, `hierStrucId`, location references
and an organization-wide acknowledgement are not substitutes. No IDs are discovered or
converted automatically. Hierarchy scope is the requested API target, not a client-side
permission boundary or proof that inherited records were defined at that same level.

Shared controls: searchCriteria, include, includeAll, offset, limit, orderBy, and v1
languages OR v2 langIds. Flags, JSON, file and stdin work as described in
[Hierarchy](HIERARCHY.md). Conflicting JSON/flags are rejected. No paging, language,
projection, sorting or filter defaults are injected. Exactly one request/page; never follow
hasMore, query related groups/extensions, or retry permission/rate-limit errors.

Field names inside include/searchCriteria/orderBy are not an allowlist. Unknown response
fields are delivered unchanged and learned as field metadata. Arbitrary top-level request
keys are not record payloads: this is a reviewed read call, not a generic write command.
Oracle validates expressions. includeAll overrides include; detailed can expose more fields
but does not prove every database column or writable field has been returned.

## Verbatim records and observed fields

Preserve names/translations, IDs, option strings, descriptive options, external references,
dietary labels, dataExtensions and effectivityGroups unchanged. No bit decoding, enum
rewriting, number coercion, flattening, default filling or response field rejection.

Documentation differences are kept rather than translated:
- v1 language controls and name maps use culture codes; v2 uses language IDs.
- v2 documents name2; the reviewed v1 master model does not.
- v1 effectivityGroups documents a translated effectivityGroupName; reviewed v2 does not.
- effectivityGroups is excluded by default; its absence does not mean unsupported.

The generic catalogue learns JSON field paths/types, not database columns from record
values. For example, dataExtensions entries expose `columnName` and `value` properties;
their values are not promoted into additional inferred schema fields or persisted as
metadata. A dedicated extension-definition feature would need a separate reviewed task.
Read observations never establish field writability or safe omission/null update behavior.

## Evidence

Synthetic tests cover fixed routes, explicit scope, version controls, all input sources,
exact large plain/gzip delivery, unknown nested fields, metadata privacy, separate v1/v2
catalogues, documented/observed discrepancies, errors and no automatic extra calls.
No live configuration read, write, financial calculation or publication was performed.

Sources: public Oracle endpoint pages and Swagger 2 version 2026.06.15,
SHA-256 `f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.
The public documentation is pinned evidence, not a deployment-matched schema guarantee.

- [v1](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-menuitems-getmenuitemmasters-post.html)
- [v2](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-menuitems-getmenuitemmasters-post.html)
