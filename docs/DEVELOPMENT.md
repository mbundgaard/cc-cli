# Development

Node 22+, TypeScript ESM, UTF-8/LF, two spaces. Run npm ci, npm test,
npm run test:package and node bin/cc.js --help before declaring ready.

## Foundation

Ported from BiCli at 56d8acd (auth/state/company/transport/update/response core),
without runtime dependencies on sibling repositories. No changes to BI or STS.

- src/auth.ts: PKCE S256, Oracle cookie jar, ID tokens, safe diagnostics and refresh.
- src/state.ts: fixed CC paths, strict registry/profile product tags, atomic persistence.
- src/companies.ts: explicit company keys, staged login, renewal/expiry and lifecycle.
- src/cli.ts: auth/company/local metadata and read task registration.
- src/read-definitions.ts: reviewed hardcoded calls, paths and scope transport/level.
- src/read-commands.ts: generic registration, shared read controls, explicit v1/v2 and dry-run.
- src/read-filters.ts: structurally validated scope composition, no record-field allowlist.
  Scope helpers are request construction, not client-side filtering or investigation logic.
- src/write-scope.ts: explicit account/location/RVC boundary, one-use approvals and locks.
- src/guarded-write.ts: shared review-bound, account-pinned, locked single-record lifecycle;
  bounded ownership/existence proofs, one-use approval consumption, unchanged response delivery.
- src/order-device-update.ts: reviewed RVC-scoped v2 update definition/field validation.
- src/kds-display-writes.ts: reviewed location-scoped v2 create/update/delete definitions,
  target identity rules and nested child-array validation. No source-copy workflow.
- src/write-commands.ts: offline boundary configuration and explicit prepare/execute commands.
- src/transport.ts: HTTPS/TLS, bounded requests, no redirects/retries; loopback for tests.
- src/requests.ts: internal one-input-read/pinned-company execution seam, no API paths.
- src/responses.ts: internal byte-exact bounded delivery, never used for token responses.
- src/json.ts: exact input numbers; not a response decoder.
- src/catalogue.ts: bounded streaming structural observation and locked versioned metadata.
- src/catalogue-commands.ts: explicit local Swagger import/comparison and post-delivery learning.
  Uses stream-json tokens without assembling values. JSON observation never rewrites output.
- src/updates.ts: explicit npm check and internal future-read advisory notifier.

CC profile schema 1 requires product cc as well as the schema-2 registry. This intentionally
differs from BI's untagged profile compatibility: an untagged BI ID-token snapshot must
not be silently accepted by a new product. Restore never reads sibling state directories.

Tests are synthetic loopback only, use isolated stores and never contact Oracle. Adapted
BI auth/company tests cover cookie/client-ID preservation, safe failures, rotation,
expiry, concurrency, lock/recovery, staged config and duplicate avoidance. Internal
protected-read behavior is exercised through unpackaged tests/test-read.mjs; this fake
route is loopback-only, not a real CC endpoint or production CLI escape hatch.

Package tests install a temporary archive and invoke its real shim. Stateful checks use
installed modules with isolated stores and mock authentication. No real saved credentials,
private documentation downloads, test runners or repository internals belong in the package.
The package is private/unpublished. CI is configured for Linux/macOS/Windows and Node 22/24;
configuration alone does not establish remote CI execution. No publish workflow.

## Next stages

Review individual CC endpoint contracts/version support before implementing data commands.
The guide includes v1/v2, hierarchy scopes, translated strings, options and explicit
pagination. Do not copy BI location/date bodies or infer universal paths/media types.
Hierarchy tree/node, menu-master, KDS-display, order-device, workstation and order-type
names/parameters reads are implemented and synthetic-tested.
Authorized scoped hierarchy, KDS and order-device reads have been exercised live. No broad
endpoint generation, comparison orchestration or implicit schema fetches.
Single-record v2 order-device updates are implemented with offline review by default,
explicit read-only preparation and one-use approved execution inside a local boundary.
[KDS display CRUD](KDS-CRUD.md) shares this lifecycle with presence/absence checks and
additional destructive confirmation. See [update safety](ORDER-DEVICE-UPDATES.md).
No automatic snapshot/readback/merge/retry.
Never infer write permission or omission/null/concurrency semantics from successful reads.

Authorized logins and version reads also succeeded. Live updates, refresh and other
record-task permissions remain unverified. Do not bypass documented inconsistencies with silent alternate grants/callbacks.
Use safe token handling, explicit requests and verbatim data as the three pillars.
