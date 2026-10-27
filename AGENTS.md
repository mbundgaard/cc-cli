# CC agent guide

Read CONTRIBUTING.md and docs/DEVELOPMENT.md before implementation changes.
Read docs/READ-ONLY-RECORD-HISTORY-DESIGN.md as the implementation contract and
docs/SAFETY-AND-RECORD-HISTORY.md for the user-facing promises/status. Update both
when a stage ships; never describe planned safeguards or commands as available.
See docs/SHARED-ENGINE-AUDIT.md for resolved findings and regression gates. Preserve the single
configuration-exchange lifecycle; do not add per-topic policy exceptions or optional capture.

- Architecture: generic execution methods with fixed reviewed capabilities, not arbitrary
  endpoints/tasks. All configuration reads/proofs/delivery use configuration-policy.ts.
  Only guarded-write.ts may issue internal mutation permits, after durable approval consumption.
  See docs/READ-ONLY-RECORD-HISTORY-DESIGN.md and docs/RECORDS.md: history storage and local
  inspection and mandatory capture are implemented. Every public read uses the same pipeline;
  task definitions supply identity, never capture enablement. No successful raw-only fallback.
  Updates/deletes require saved source-linked before-values at preparation and execution.

- Auth/company, version, hierarchy, menu-master, KDS-display, order-device, workstation and
  order-type names/parameters reads; guarded v2 order-device updates and KDS display CRUD.
  Writes default offline; --prepare does ownership/existence checks and issues a one-use approval;
  --execute requires matching payload/current record/boundary/audit and risk acknowledgement.
  Every configuration write uses Muneris CC-CLI // <saved username> for its audit header;
  no override, location/task-specific tag or truncation. Enforce 50 printable ASCII chars.
  Location/RVC boundaries are private user state, never customer IDs hardcoded into source.
  KDS create requires absence; update/delete require existence. Delete requires object-number
  confirmation. Documented nested KDS arrays are child settings, never display batches.
  Copying settings/comparing locations stays outside the CLI; no silent identity/alias/IP rewrites.
  Mandatory pre-change capture preserves previous values; no automatic merge, restoration,
  readback, rollback or retry. No other writes.
  Workstation responses may contain sensitive nested peripheral settings;
  preserve exact bytes, keep exports private and never paste credentials into reports.
  Explicit scope per reviewed endpoint; no comparison workflow, discovery or related reads.
  Authorized login/version/hierarchy/KDS/order-device reads succeeded. Live updates, refresh
  and other record reads remain unverified. Permissions are endpoint-specific. Hardcode calls, not fields.
- Mirror BI's tested PKCE/cookies/ID-token lifecycle, not STS access tokens.
- User preference: agents infer enterprise from a client ID when a recognizable encoded
  enterprise prefix exists, then supply --org explicitly. Preserve the client ID unchanged.
  If opaque, ask instead of guessing; the CLI itself still accepts opaque IDs and explicit org.
- Requires a Simphony Configuration API account; never assume BI/STS permissions apply.
- Fixed per-user CcCli/CcCli.json. Require product cc in registry AND profiles. Reject BI,
  STS and untagged restore files. Never relabel foreign credentials to bypass isolation.
- Password only for authorized login, never saved/echoed. Client ID preserved, org explicit,
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
  internal executor and response layer: all public reads produce private captures/receipts.
  Mutation responses are always retained with durable attempt/outcome records; only local
  record inspection retains 16 KiB/500-line threshold delivery.
  Auth secrets never use data export handling.
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
- Shared server-side searchCriteria/orderBy/include/paging controls; no client-side record
  filtering/sorting or auto paging. Scope transport (body versus criteria) is endpoint metadata;
  scoped criteria are safely AND-grouped, visible in dry-run. Never inject unsupported body keys.
- Keep help/docs/tests/package allowlist synchronized. Node22+, ESM, UTF-8/LF, two spaces.
- Before ready: npm test; npm run test:package; node bin/cc.js --help.
- Support support@muneris.dk. Package remains private/unpublished.
