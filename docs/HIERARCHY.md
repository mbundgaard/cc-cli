# Hierarchy reads

Hardcoded read-only POST tasks; v2 preferred, explicit v1 only where reviewed:

| Command | v2 route | v1 route |
|---|---|---|
| `cc hierarchy list` | `/config/sim/v2/hierarchy/getHierarchy` | `/config/sim/v1/hierarchy/getHierarchy` |
| `cc hierarchy nodes list` | `/config/sim/v2/hierarchy/getHierarchyNodes` | Not documented/implemented; rejected locally |

Both tasks require local `--organization-wide` acknowledgement, even with a filter.
It is not sent to Oracle. Organization comes from the saved CC ID token, not an invented
header or URL segment. No implicit hierarchy discovery precedes a read. First run
`cc server-version` explicitly to establish the local catalogue's deployment generation.

```sh
cc hierarchy list --organization-wide --limit 50 --offset 0 --dry-run
cc hierarchy list --organization-wide --limit 50 --offset 0 --quiet
cc hierarchy nodes list --organization-wide --include hierUnitId,hierStrucId,name --lang-ids 1 --quiet
cc hierarchy list --organization-wide --api-version v1 --languages en-US --quiet
cc catalogue compare hierarchy --api-version v2
```

These examples are not authorization to query a real enterprise. Live configuration reads
remain unverified and require the owner's chosen scope. Do not infer permissions from login
or the prior version read.

## Controls, not record-column allowlists

Request controls: `searchCriteria`, `include`, `includeAll`, `offset`, `limit`, `orderBy`,
and v1 `languages` OR v2 `langIds`. Use flags, `--json`, or `--file` (`-` reads stdin once).
Do not supply a control in both flags and JSON. JSON and file are mutually exclusive.
Wrong-version controls and arbitrary top-level body keys are rejected before renewal.
Record field names inside projections/filter/order expressions are not allowlisted and
expressions are forwarded unchanged; Oracle validates their semantics. `includeAll`
accepts basic/detailed and overrides `include` on the server, without CLI rewriting.

Paging is explicit: positive safe-integer limit and nonnegative safe-integer offset.
Zero limit is rejected locally to avoid ambiguous unbounded reads. No limit, offset,
ordering, language or projection defaults are injected. Exactly one page is requested;
`hasMore` never triggers another call, returned limit may differ, and omitted `hasMore`
can mean false. Do not interpret an incomplete page as the whole enterprise.

No hidden child filtering, deduplication, tree traversal, inheritance resolution or schema
validation modifies responses. Request and response media type is application/json.
The shared byte-exact/private-file delivery, pinned-company renewal and catalogue observer
are used. No retries, redirects, version fallback or writes.

## Hierarchy semantics and documentation gaps

A location/RVC can have multiple `hierStrucId` values under zones but retains `hierUnitId`.
Do not merge nodes or substitute one identifier for another. The default hierarchy and
zones coexist; EMC's Default System View folder is not an actual node. Lower definitions
can override ancestors; equal-distance conflicts must not be resolved by this CLI.

`getHierarchy` returns recursive nodes. Structural IDs and locRef/parentLocRef can be
excluded by default; absence is not evidence of unsupported fields. `simphonyType` is
present on the first object and cannot be used for searching according to Oracle.
`getHierarchyNodes` exposes node identity/parents and `hierOptions`; preserve option strings
and any unknown fields unchanged. v1 names use culture-code keys; v2 uses language-ID keys.

A flattened recursive/open documented schema can leave descendant comparisons indeterminate;
those paths are not falsely labelled undocumented. The catalogue preserves observed paths
and records this limitation. Importing documentation never enables additional routes.

Sources reviewed: public Oracle guide and Swagger 2 version 2026.06.15,
SHA-256 `f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.
This source is pinned evidence, NOT proof of a match to the installed deployment.

- [v2 hierarchy](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-hierarchy-gethierarchy-post.html)
- [v1 hierarchy](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v1-hierarchy-gethierarchy-post.html)
- [v2 nodes](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-hierarchy-gethierarchynodes-post.html)
