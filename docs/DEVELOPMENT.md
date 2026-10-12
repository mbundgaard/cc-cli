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
- src/read-commands.ts: hardcoded version-read routes, explicit v1/v2 and offline dry-run.
- src/transport.ts: HTTPS/TLS, bounded requests, no redirects/retries; loopback for tests.
- src/requests.ts: internal one-input-read/pinned-company execution seam, no API paths.
- src/responses.ts: internal byte-exact bounded delivery, never used for token responses.
- src/json.ts: exact input numbers; not a response decoder.
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
Read-only hierarchy is a candidate next slice, not implemented or authorized for live calls.
Separate any future configuration writes clearly and require explicit authorization;
never infer write permission from a successful read or auto-retry uncertain writes.

One authorized UAT login and v1 version read succeeded; live refresh and configuration
record permissions remain unverified. Do not bypass documented inconsistencies with silent alternate grants/callbacks.
Use safe token handling, explicit requests and verbatim data as the three pillars.
