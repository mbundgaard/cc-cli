# Order devices

`cc order-devices list --hier-unit-id <rvc-hierarchy-unit>` sends one read-only POST:

| Contract | Hardcoded path |
|---|---|
| v2 (preferred) | `/config/sim/v2/devices/getOrderDevices` |
| v1 (explicit) | `/config/sim/v1/devices/getOrderDevices` |

Scope is a **revenue center**, not a location or structure ID. The local required
--hier-unit-id flag compiles into searchCriteria; there is no top-level hierUnitId body
parameter. Additional criteria are AND-grouped inside this scope. Oracle validates the ID's
level and permissions; the CLI never discovers RVCs or expands a location to RVCs.

[Shared read controls](READS.md) cover filtering, sorting, projection, language selection,
JSON/file/stdin, exact dry-run and explicit one-page execution. No response-field allowlist.

```sh
# Synthetic RVC hierarchy ID; not authorization for a live query.
cc order-devices list --hier-unit-id 7 --include-all detailed --order-by objectNum:asc --limit 50 --offset 0 --dry-run
cc order-devices list --hier-unit-id 7 --search-criteria "equals(primaryDeviceType,1)" --quiet
```

Preserve device type/primary type, primary and backup references, redirects, distribution
group references, printerOptions/kdsOptions and descriptive Ext objects, nested kdsSettings,
custom instructions and unknown fields. Do not decode bit strings, rename documented typos
(such as sortConsoldiationMethod), repair types, resolve references or infer runtime behavior.
No printer, display, backup device or distribution group is fetched automatically.

Both reviewed versions accept JSON and the common controls; v1 uses languages, v2 langIds.
There is no v1 fallback, polling, retry, local sorting/filtering, configuration comparison or
write operation. Responses use shared exact/private-file delivery and structural metadata
learning. Synthetic tests do not establish live order-device permissions or semantics.

Sources: Oracle endpoint pages and Swagger 2 version 2026.06.15,
SHA-256 `f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.
Public schema provenance is not a deployment-specific compatibility guarantee.

- [v2](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-getorderdevices-post.html)
- [v1](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-devices-getorderdevices-post.html)
