# Changelog

## Unreleased

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
