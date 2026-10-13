# KDS display clients

`cc kds-displays list --hier-unit-id <location-hierarchy-unit>` is a single read-only POST.
Oracle calls this task **Get Kitchen Display Clients**; it returns KDS display configuration.
Guarded single-display [create/update/delete](KDS-CRUD.md) complete this CRUD family.
Listing stays read-only; copying/comparison workflows remain outside the CLI.

| Contract | Hardcoded path |
|---|---|
| v2 (preferred) | `/config/sim/v2/devices/getKitchenDisplays` |
| v1 (explicit) | `/config/sim/v1/devices/getKitchenDisplays` |

Scope is a **location** hierarchy unit, not its location number, a structure ID or an RVC ID.
The API has no top-level hierUnitId body parameter: the local required --hier-unit-id flag
compiles into searchCriteria. Optional user criteria are AND-grouped within that scope.
Use [shared read controls](READS.md) for filtering, sorting, projection, languages and pages.
No related controller, workstation, RVC, bump-bar or toolbar records are fetched implicitly.

```sh
# Synthetic ID; first establish versions with an explicitly authorized server-version read.
cc kds-displays list --hier-unit-id 7 --include-all detailed --limit 50 --offset 0 --dry-run
cc kds-displays list --hier-unit-id 7 --search-criteria "equals(objectNum,1)" --order-by objectNum:asc --quiet
cc kds-displays list --api-version v1 --hier-unit-id 7 --languages en-US --quiet
```

Preserve all returned fields, including unknown additions: translated names, display and
platform types, options/optionsExt, panels, production items, recall/review columns, timers,
network addresses and object references. Do not coerce option types: some option descriptions
say Boolean while their schemas specify integer. No fixed record-column list, runtime
interpretation, display/bit normalization or comparison logic is part of this task.

Media type: application/json. v2 uses langIds; v1 uses languages. No inferred pagination,
field defaults or v1 fallback. Catalogue learning is structural only and separate by API
version. Implemented and synthetic-tested; no live KDS read is established by these tests.

Sources reviewed: Oracle endpoint pages and public Swagger 2 version 2026.06.15,
SHA-256 `f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.
This is documentation provenance, not a deployment-specific schema guarantee.

- [v2](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-getkitchendisplays-post.html)
- [v1](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-devices-getkitchendisplays-post.html)
