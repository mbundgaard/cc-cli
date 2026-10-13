# Changelog

## Unreleased

- Standardize every configuration write audit reference as `Muneris CC-CLI // <saved username>`.
  Remove --audit-ref overrides; derive from the pinned account and bind into approval.
  Enforce 50 printable ASCII characters before networking; never truncate usernames.
  Live KDS update probes on CCAPI 23.8.0.1 accepted 50 and rejected 51 ASCII characters;
  this cap is a conservative client policy for other write endpoints/deployments.

- Complete the first CRUD task family with v2 KDS display create/update/delete alongside
  existing list reads. One location-owned display per write, guarded presence/absence,
  action-bound one-use approval, delete confirmation and reviewed child arrays. No batch,
  automatic copy/alias/IP rewriting, merge, snapshot, readback, rollback or retry.
- Extract the shared guarded-write lifecycle without widening order-device update scope.
  KDS and order-device approvals are separate; registry/write locks and location boundary
  are shared. Location-only boundaries may omit RVC IDs. No live KDS writes performed.

- Add guarded single-record v2 order-device updates: private explicit account/environment/
  location/RVC boundary; offline review by default; three ownership/existence proofs;
  reviewed 15-minute one-use approvals bound to payload/current record/audit/boundary.
  Consume approval before POST; preserve exact response delivery. Reject batches and
  extra/nested identities; explicitly acknowledge unverified fields and update risks.
  No live updates, auto-merge, snapshots, readback, rollback or retries. Omission/null and
  non-atomic concurrency limitations remain explicit. Authorized scoped KDS/order-device
  reads succeeded separately; private records remain outside the repository.

- Add independent order-type names and parameter reads (v2/v1), explicit hierarchy criteria
  scope and shared controls. Preserve v1 route casing, names lineNum and raw option/mask
  lengths; no companion reads, inheritance resolution or workflow logic.

- Add workstation reads (v2/v1), required location hierUnitId in the request body and shared
  controls. Preserve sensitive nested settings verbatim without persisting values in the
  field catalogue; no automatic peripheral or service-host reads. No live workstation calls.

- Add order-device reads (v2/v1) with explicit RVC scope and shared server-side controls.
  No related-device lookups, response normalization, live calls or writes.

- Refactor reviewed read calls into a hardcoded capability registry with shared registration,
  filtering/sorting/projections/paging and body-versus-criteria scope transport. No record
  column allowlist or investigation workflow. Add bounded, AND-grouped scoped filters.
- Implement KDS display-client reads (v2/v1) with explicit location scope, synthetic tests,
  unchanged delivery and independent field learning. No live KDS read or writes performed.

- Add menu item master reads (v2 preferred, explicit v1) with mandatory hierarchy-unit
  scope, shared request controls, extensible record fields and separate versioned learning.
  No field-based response rejection, interpretation, related reads or write commands.

- Add reviewed hierarchy tree reads (v2/v1) and hierarchy-node reads (v2 only), local
  organization-wide acknowledgement, explicit controls/one-page delivery and field learning.
- Classify unresolved recursive/open schema descendants as indeterminate, not undocumented.
  Hierarchy configuration-data access remains live-unverified; no writes.

- Add explicit offline Swagger imports pinned by SHA-256, documented/observed comparisons,
  streaming field-only learning, company/environment/account and v1/v2 isolation, and
  archived Enterprise/CC-release generations. No hidden version queries or generated calls.
- Keep metadata learning failures separate from original response delivery and HTTP status.

- Scaffold private @muneris/cc-cli with Node22+/TypeScript, cc shim, auth/company/local
  commands, offline synthetic tests and installed-package checks.
- Port BI PKCE/cookie-preserving ID-token auth, explicit company registry, staged config,
  duplicate-login avoidance, renewal/expiry and locked atomic recovery semantics.
- Isolate CcCli state and enforce product cc on registry and profiles; reject BI/STS
  and untagged restore files. No automatic import or credential reuse.
- Include internal pinned-query, exact-number and bounded response/update foundations
  for future reads, without implementing or exposing a CC data endpoint.
- Add hardcoded server-version reads (v2 preferred, explicit v1), offline dry-run,
  exact response delivery, help/inventory and synthetic route/error tests.
- Record successful authorized UAT login and v1 version read. Live refresh and
  configuration-data permissions remain unverified. No writes, release or publication.
