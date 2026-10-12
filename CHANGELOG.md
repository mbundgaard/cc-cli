# Changelog

## Unreleased

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
