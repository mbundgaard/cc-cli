# Order types: names and parameters

Oracle exposes two independent tasks. Neither command invokes the other.

| Command | v2 path (preferred) | v1 path (explicit) |
|---|---|---|
| `cc order-types list` | `/config/sim/v2/setup/getOrderTypeNames` | `/config/sim/v1/setup/getordertypenames` |
| `cc order-types parameters list` | `/config/sim/v2/setup/getOrderTypeParameters` | `/config/sim/v1/setup/getOrderTypeParameters` |

Both are read-only POSTs with JSON, scoped through searchCriteria, not a top-level
hierUnitId body field. Both require an explicit local --hier-unit-id. Additional user
criteria are safely AND-grouped within that requested hierarchy unit.

The supported-operation guide permits names at enterprise/zone/location, not RVC; parameters
also support RVC. The CLI does not look up the node type or follow ancestors to select a
scope. Oracle validates hierarchy support and access. Explicitly select the hierarchy to
read; a location query is not an automatically resolved effective/inherited configuration.

Use [shared read controls](READS.md) for filters, server-side sorting/projection, language
selection, JSON/file/stdin, dry-run and explicit one-page retrieval. No record field allowlist,
client-side comparison, value conversion, implicit pagination, fallback, or writes.

```sh
# Synthetic hierarchy ID, not live authorization.
cc order-types list --hier-unit-id 7 --order-by lineNum:asc --include lineNum,name --dry-run
cc order-types parameters list --hier-unit-id 7 --order-by objectNum:asc --include-all detailed --dry-run
```

Names return lineNum, translated name and dataExtensions. Do not rename lineNum to objectNum
because common examples mention objectNum. Parameters document objectNum, active, options,
order-device/tax masks and descriptive Ext objects, KDS highlight references, SLA time and
other settings. No names/parameters join, enum decoding, tax/tip calculation, or related
record lookup is performed. Unknown fields and all record values are delivered unchanged.

The documentation distinguishes options length for Simphony 19.8 and 19.9; the CLI does not
hardcode mask/option widths or trim/pad them. Version differences are recorded in the field
catalogue, never inferred from a mask's length. v1 languages and v2 langIds remain separate.
The lower-case v1 getordertypenames path is intentional, not a generated casing assumption.

Tests are synthetic/offline; these reads remain live-unverified. Public Swagger version
2026.06.15, SHA-256 `f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`,
is documentation provenance, not a deployment-matched schema guarantee.

- [v2 names](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-setup-getordertypenames-post.html)
- [v1 names](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-setup-getordertypenames-post.html)
- [v2 parameters](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-setup-getordertypeparameters-post.html)
- [v1 parameters](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-setup-getordertypeparameters-post.html)
