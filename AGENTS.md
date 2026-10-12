# CC agent guide

Read CONTRIBUTING.md and docs/DEVELOPMENT.md before implementation changes.

- Authentication/company lifecycle and server-version read implemented. No configuration
  record reads/writes yet. Live UAT login and one v1 version read succeeded; refresh and
  configuration-data permissions remain unverified. Hardcode calls, not response fields.
- Mirror BI's tested PKCE/cookies/ID-token lifecycle, not STS access tokens or client-ID decoding.
- Requires a Simphony Configuration API account; never assume BI/STS permissions apply.
- Fixed per-user CcCli/CcCli.json. Require product cc in registry AND profiles. Reject BI,
  STS and untagged restore files. Never relabel foreign credentials to bypass isolation.
- Password only for authorized login, never saved/echoed. Client ID is opaque, org explicit,
  username case and cookie values preserved. No retries, redirects or TLS bypass.
- Same-key/same-user usable or unknown-expiry token skips duplicate login. Config is staged;
  only successful login commits/selects. Failed login preserves saved profiles.
- Exact company keys enterpriseShortname@lowercaseAuthHostname. Select explicitly. Confirm
  profile deletion; deleting active never chooses another. Logout active tokens only.
- Future read preflight pins company, reads/validates input once and renews all due profiles.
  Success +24h, failure +1h keeping usable tokens. Known expiry clears entire token set;
  unknown lifetime is preserved, not guessed. No automatic login, daemon or polling.
- Locks and atomic persistence/recovery are mandatory. Save failure stops further requests;
  rotated credentials may only survive in recovery copy. Never blindly repeat auth.
- Three pillars: safe auth/tokens, explicit requests, verbatim data. Future reads use the
  internal executor and response layer: 16 KiB AND 500 lines inline, otherwise full private
  export/receipt. Auth secrets never use data export handling.
- No public arbitrary endpoint, test-read, directory override or application environment
  configuration. Test injection is unpackaged and loopback-only.
- No live account use, data queries, configuration writes, commits, push or publication
  without authorization. Never copy real state/customer data into source or fixtures.
- Help/local commands stay offline; version --check explicitly queries npm without secrets.
  Internal daily notifier is ready for future reads but does not run during auth/local work.
- Catalogue imports are explicit/offline; hardcode calls, never generate executable routes.
  Keep documented and observed fields separate, v1/v2 separate, and archive release changes.
  Learn types/paths only from successful requested reads; never save record values or infer
  writability, completeness, removal from absence, or an integer type from null.
- Keep help/docs/tests/package allowlist synchronized. Node22+, ESM, UTF-8/LF, two spaces.
- Before ready: npm test; npm run test:package; node bin/cc.js --help.
- Support support@muneris.dk. Package remains private/unpublished.
