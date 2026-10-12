# Workstation configuration

`cc workstations list --hier-unit-id <location-hierarchy-unit>` sends one read-only POST.

| Contract | Hardcoded path |
|---|---|
| v2 (preferred) | `/config/sim/v2/devices/getWorkstations` |
| v1 (explicit) | `/config/sim/v1/devices/getWorkstations` |

Both contracts require the **location** hierUnitId in the request body. Supply it via
--hier-unit-id or the exact JSON key hierUnitId, never both. It is not a location number,
workstation number, RVC ID or hierarchy structure ID. A filter alone is not a substitute.
Unlike filter-scoped device tasks, searchCriteria is passed unchanged alongside this body
parameter; no extra scope filter or defaults are injected.

[Shared read controls](READS.md) supply server-side filtering/sorting, extensible projections,
languages, JSON/file/stdin, dry-run and explicit one-page execution. No client-side sorting,
filtering, default filling, comparison workflow, related-object reads or writes.

```sh
# Synthetic location ID; review the dry-run before an authorized live read.
cc workstations list --hier-unit-id 7 --include objectNum,name,enabledOrderDevices --order-by objectNum:asc --limit 50 --offset 0 --dry-run
cc workstations list --hier-unit-id 7 --search-criteria "equals(objectNum,1)" --quiet
```

Responses can contain routingGroups, revenueCenters, enabledOrderDevices, services,
peripheral devices, networking, defaults, option strings and descriptive Ext objects. Keep
all returned fields and unknown additions unchanged, including IDs, option lengths and
numeric precision. No references are resolved, and no IDs or host addresses are remapped.

**Sensitive output:** nested devices can contain clientCertPassword, clientCertificate,
serverCertificate, custom settings and other private configuration. Network/host identifiers
can also be sensitive. Review the requested projection before a live read and keep responses
private. includeAll detailed can expose more information. The CLI does not silently redact
or drop fields: small bodies remain stdout, large bodies use secure response files. Never
paste sensitive values into reports or commit exports. The catalogue saves field names/types
only, never these values. There is no separate automatic getDevices call.

v1 uses languages; v2 uses langIds. Documentation is not a deployment-specific guarantee.
Tests use synthetic settings and loopback; live workstation reads remain unverified.

Sources: Oracle endpoint pages and Swagger 2 version 2026.06.15,
SHA-256 `f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.

- [v2](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-getworkstations-post.html)
- [v1](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-devices-getworkstations-post.html)
