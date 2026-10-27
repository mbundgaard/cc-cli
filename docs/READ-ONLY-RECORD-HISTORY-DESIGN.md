# Read-only enforcement and record-history design

Status: agreed direction with staged implementation. The operation-policy, private record-history storage and local inspection slices are implemented; mandatory network capture, file-first public reads and saved pre-change observations are implemented for current commands. The original architecture findings are addressed: all configuration networking uses one exchange lifecycle with mandatory typed context, and compiled capability metadata replaces task-name defaults. See SHARED-ENGINE-AUDIT.md for regression gates and remaining operational limits. This document is not authorization for live writes, commits or publication.

## Architecture: generic engine, fixed vocabulary

Areas, resources and supported tasks/actions are fixed, reviewed capabilities. Generic methods implement request policy, dispatch, captures, approvals, history and inspection. Resource definitions supply reviewed routes, scope, record identity/extraction and operation-specific validators. Do not build separate execution engines per endpoint, expose caller-defined tasks or generate executable routes from imported schemas. Fixed capabilities do not imply fixed response fields: preserve unknown fields and exact numbers.

## Implementation progress

- Added `src/configuration-policy.ts`: immutable reviewed method/route/effect catalogue, read-only configuration dispatch and short-lived, request-bound, single-use internal mutation permits.
- Read queries validate policy before auth renewal and again after rebuilding the request. Response delivery and ownership proofs use the same policy dispatcher.
- Existing guarded writes issue a permit only after their existing account/scope/target/payload checks and durable approval consumption. The internal issuer is trusted code, not an independent approval validator; source-boundary regression tests restrict its use to that lifecycle.
- Generic low-level transport remains shared with authentication; this is a configuration boundary, not an OS sandbox or defense against modified code.
- Added `record-history.ts`, `record-commands.ts` and shared private-directory protection. One record file retains lossless observed snapshots, with lock/atomic replacement, integrity validation and a 64 MiB fail-closed limit. Local list/show/history/diff commands work without credentials; larger inspection output is exported privately.
- Every current public read now uses file-first capture/history through `captures.ts`. `record-definitions.ts` describes every task's reviewed identity/structure, never capture enablement. Unsupported shapes, missing/ambiguous identity and indexing failures retain raw evidence but fail the capture; there is no successful raw-only fallback.
- Guarded writes bind preparation to saved source/proposal/history evidence, save a fresh execution observation, verify evidence, then consume approval and dispatch. Create retains absence proof. A mutation acknowledgment is not an observed version. Durable mutation attempt/outcome journaling is implemented, including small responses and uncertainty. Explicit retention/reindex-recovery tools remain unfinished.
- Current limits are 32 MiB per indexed response and 64 MiB per record-history file. These are global fail-closed bounds, not per-topic exceptions. All current task/version capture paths have synthetic coverage.
- `configuration-exchange.ts` is the sole configuration request/response lifecycle. Public, ownership and target reads all require capture context and save/index their responses. Query metadata is mandatory before renewal/dispatch. Mutations require a permit plus durable attempt, and all mutation responses are file-first.
- Catalogue roles and mutation/read links resolve from compiled capabilities. Legacy on-disk approval/lock names are isolated compatibility metadata, not different policies. Byte-collector test fixtures are unpackaged and introduce no production bypass.

## Documentation contract

The user-facing companion is [Safety and saved record history](SAFETY-AND-RECORD-HISTORY.md).
Keep its capability status matrix, README, CLI help, AGENTS.md and this design synchronized
with each implementation stage. Planned commands are examples of the intended interface,
not runnable instructions. Before marking a safeguard implemented, add tests for its failure
paths and include it in installed-package verification. Retain explicit distinctions between
submitted values, acknowledged writes and observed saved values.

## Agreed requirements

- Configuration access is read-only by default. No persistent global write unlock.
- Explicit, single-record, single-operation write approval; no bulk operations.
- Before every update or deletion, read and successfully save the exact existing record. If either step fails, block the write.
- Saved previous values are useful evidence for investigation and manual correction. There is no backup, restore, rollback, automatic compensation or replay feature.
- Configuration reads save data to private storage and return compact receipts instead of pushing records into agent context.
- One logical record has one JSON file containing its observed history. Do not create a separate user-facing file per version.
- Provide local-only record listing, selective inspection, history and diff commands.
- Preserve company isolation, explicit scopes, exact numbers, unknown response fields, reviewed routes and no automatic paging/retries.

## Scope of read-only

Read-only means no Oracle configuration mutation. It does not prohibit authorized login/token renewal or local persistence of captures. Authentication remains a separate constrained subsystem; tokens, passwords, cookies and auth responses must never enter record-history storage.

Define reviewed operation metadata: stable operation ID, API version, exact method and route, effect (read/create/update/delete), permitted scope and, for reads, record extraction/identity rules. Unknown operations fail closed. HTTP POST alone cannot identify a write because CC reads use POST too.

Enforce operation policy in a central configuration-request dispatcher, below command handlers. Reads require no mutation permit. Writes require an internal permit bound to the exact operation, account/environment, scope, target, payload and consumed approval. No public arbitrary-route command or bypass option. Audit all configuration request paths, including ownership proofs, so none dispatch outside this boundary. Keep the low-level transport private to the authorized request/auth layers and test the import boundaries.

This prevents accidental CLI misuse, not malicious use of credentials outside the CLI. Where supported, Oracle-side read-only permissions and separately scoped write accounts provide the stronger boundary. Permission support must be verified, not assumed.

## Storage model

Private root under the existing per-user CC application-data directory, outside repositories. Proposed structure:

```text
records/
  <environment-company-key>/
    <scope-key>/
      <area>/<task>/
        <record-key>.json
captures/
  <capture-id>/
    response.body
    manifest.json
write-attempts/
  <attempt-id>/
    proposed.json
    manifest.json
    response.body       # if received
```

Folders use safe generated components, not unsanitized names or caller-supplied paths. Environment identity includes the server and company; scope distinguishes enterprise, location and RVC as required by each operation. Display names belong in metadata, never identity. Do not identify an object solely by its object number when hierarchy placement is part of its identity.

A record file contains:

- Schema version and product marker.
- Stable compound identity and human-readable task metadata.
- Explicit latest-observation ID (not a claim about current Oracle state).
- An ordered collection of observations, each with observation ID, timestamp, capture ID, operation/API version, requested projection/detail level, response completeness information, source hash, record hash and the complete returned record.

This is an outline, not a finalized JSON schema. Use a complete record snapshot per observation initially; no delta reconstruction or deduplication. Even unchanged reads are observations. Do not silently prune history. Growth limits and retention need a separate explicit policy; never silently discard pre-change evidence.

“Complete returned record” means all fields returned by that request, not all possible fields in Oracle. A projected record is marked partial and does not silently replace the meaning of an earlier detailed observation. Do not merge absent fields from old observations. The local reader must expose projection/detail metadata and permit selecting the latest eligible detailed observation explicitly.

Keep the original decoded response bytes once per request as source evidence. Record-history JSON is a derived representation, not byte-for-byte Oracle response data. Preserve exact numbers with the existing lossless JSON support; native parse/stringify must not round large identifiers. Preserve unknown fields, explicit nulls, arrays and nested children.

Extraction and identity rules are reviewed per task. Do not recursively split every nested object into independent rows. Collections remain collections in the raw response; each recognized top-level logical record gets a history observation. Hierarchy placement duplication, inheritance and ambiguous identity require explicit task handling. Never guess identity, overwrite a different record or fabricate a merged record. Unsupported extraction retains the raw response and fails capture. A task may not opt out and still report successful capture; new tasks must supply reviewed record metadata before exposure.

## File-first read lifecycle

1. Validate explicit request scope and reviewed read operation.
2. Pin account/environment, then apply existing authentication rules.
3. Stream the response to protected storage, with byte count/hash and bounded resource usage.
4. Validate/extract records using reviewed task rules; update each record file under its lock using atomic replacement.
5. Finalize a capture manifest listing source response, observed identities/version IDs, paths, scope, projection, API status and pagination metadata.
6. Return a compact receipt with manifest path, capture ID, scope and observed record count, plus explicit completeness/indexing status. Large record lists belong in the manifest, not stdout.

No automatic next-page request. Missing from a page/filter is not deleted. A page is not a complete dataset merely because saving succeeded. API errors and malformed/truncated bodies must not enter record history as successful observations. Protected raw error data may be retained with error status; diagnostics must not leak secrets.

A multi-record read cannot rely on filesystem-wide atomicity. Incomplete indexing must be marked failed/incomplete, never reported as fully saved. The raw response remains available for inspection. Local indexing recovery must not repeat the network request automatically or duplicate observation IDs. Specify and test the recovery protocol before implementation.

If saving fails, return failure with an accurate capture state, not an inline fallback that pretends the capture succeeded. Auth and local help/status retain their own output contracts. This is a breaking change from threshold-based network data delivery.

## Mandatory pre-change capture

Retain explicit prepare/execute, pinned write boundaries, short-lived one-use approvals and existing audit-header requirements.

### Prepare update/delete

- Validate exactly one target and operation.
- Read exact ownership and target through reviewed operations. The target must be unambiguous and appropriate for the configured scope, not a silently resolved inherited record.
- Request the reviewed detailed representation needed for that operation; a prior cached/projection-only record is insufficient.
- Persist the target observation and raw source evidence successfully before issuing approval.
- Save the exact proposed request separately and identify the observation/capture in the approval binding.
- Present an explicitly requested review of current/proposed/omitted fields. Read-only fields and response shapes are not automatically write payloads. Omission and null semantics remain operation-specific.

### Execute update/delete

- Revalidate approval, account/environment, scope, exact operation and payload.
- Reread and durably save the immediate pre-dispatch target, even when unchanged from preparation.
- Compare against the approved baseline. Changes invalidate approval and stop execution. Never silently rebase or merge.
- Persist attempt evidence and consume approval before mutation dispatch. A local failure after consumption must not re-enable it.
- Dispatch one mutation once. Persist the response/outcome separately from record history.
- Successful HTTP acknowledgment is not a newly observed record version. Only a separately authorized read can establish saved values.
- After dispatch, transport/storage failure can mean uncertain outcome. Report uncertainty; no retry, restore or compensating write.

Pre-write reads cannot eliminate changes between read and write without server-supported conditional writes. Do not claim atomic concurrency protection.

For deletion, retain explicit delete-target confirmation and action-specific approval. Capturing a parent does not capture all dependents or make cascades safe. Block operations with unresolved destructive side effects.

For creation there is no prior record to save. Preserve reviewed absence-proof response and the proposed create request, with single-use create authorization. Do not invent a previous record or silently switch between create and update.

## Local record tools

Proposed command family (exact options to be designed):

- `cc records list`: explicit company/environment, scope and area/task; bounded results with explicit local pagination.
- `cc records show`: latest observation or a specified version; selectable fields when requested.
- `cc records history`: observation IDs, timestamps, projection/detail and provenance without full record data.
- `cc records diff`: two saved observations; distinguish absent/null/value changes and array semantics. No fuzzy child matching or inheritance resolution.

These commands never contact Oracle, renew auth, mutate history or restore data. “Latest” means latest observed, not live current. They accept logical identifiers rather than arbitrary filesystem traversal paths. Direct JSON reading remains possible.

Selected local inspection can return inline data, subject to explicit size limits. Larger inspection results may be exported separately with a receipt; they must never alter the source history. Record/source paths and provenance must remain visible. Field selection is an opt-in view, not a stored field allowlist.

## Persistence and privacy requirements

- Restricted directory/file permissions on Windows and POSIX; establish protection before writing customer bytes.
- Per-record locking, atomic file replacement and defined flush/persistence ordering before mutation dispatch. Test actual platform behavior; do not promise power-loss guarantees beyond verified filesystem support.
- Reject unsafe path components, traversal and inappropriate symlink/reparse-point access.
- Consistent lock ordering across company, approvals and record storage to avoid deadlocks.
- Concurrent readers see valid old or new JSON, not partial writes. Concurrent writers do not lose observations.
- Never store Authorization headers, passwords, refresh tokens or cookies in manifests.
- Configuration responses may themselves be sensitive; preserve them privately rather than silently redact them.
- Do not copy real records into repository fixtures. No silent retention cleanup or pre-change history truncation.

## Original baseline and subsequent work

The table below records the original baseline at commit `90cb838`, not current implementation status. See progress above for completed work. No live requests were made for this design review.

| Component | Current behavior | Required change |
|---|---|---|
| `src/responses.ts` | Verbatim inline up to 16 KiB and 500 lines; protected file above either threshold | Always-file configuration delivery and capture manifest |
| `src/guarded-write.ts` | Reads ownership/target at prepare and execute; hashes current record into approval | Persist complete pre-change observations and bind their provenance |
| `src/guarded-write.ts` | Approval metadata explicitly contains no before snapshot; review data printed inline | Durable evidence and selective file-based review |
| `src/guarded-write.ts` | Single-record operations, boundary checks, delete confirmation, consume-before-dispatch | Retain and integrate with central operation policy |
| `src/requests.ts`, `src/transport.ts` | Existing query executor and general internal transport | Central effect-aware configuration dispatcher and bypass tests |
| `src/read-definitions.ts` | Reviewed named task definitions | Add reviewed record identity/extraction/projection metadata |
| `src/json.ts` | Lossless JSON helpers | Preserve exact numeric values throughout histories/diffs |
| Local CLI | Originally no record-history command family; now implemented | Wire reviewed read capture ingestion; optional field selection remains pending |
| Agent/docs contracts | State no automatic snapshots and threshold-based response output | Update together with implementation, not before behavior changes |

The mandatory pre-change capture is an intentional change to the previous no-snapshot policy. It is not a general automatic related-read workflow. Existing auth isolation, hardcoded routes and response byte preservation remain foundations.

## Proposed implementation order

1. **Contracts and policy:** finalize operation effect metadata, record identities, history schema, failure semantics and local command syntax. Inventory every configuration dispatch path.
2. **Private persistence:** implement lossless history updates, locks, atomic replacement, raw captures/manifests and failure/concurrency tests with synthetic data.
3. **File-first pilot:** one existing read family (order devices is a candidate), including partial projections and receipt behavior; then local show/history/diff/list.
4. **Write integration:** mandatory prepare/execute captures, approval binding and central fail-closed dispatch. Cover update/delete and create absence proofs; no live mutations required to test mechanics.
5. **Existing-family rollout:** apply explicit identity/extraction rules across currently supported tasks. Update help, docs, agent guide and installed-package tests together.
6. **Broader coverage roadmap:** separately inventory the rest of Oracle CC operations and implement by functional area. Do not generate executable routes directly from imported Swagger or enable unreviewed writes.

This document does not claim a completed full-API coverage matrix. That remains a separate deliverable.

## Acceptance tests before release

- Default/unknown-operation write attempts produce zero mutation requests, including POST reads correctly allowed.
- Altered, expired, consumed, wrong-account/scope/action approvals fail closed.
- Failed read, ambiguous identity, failed disk write, failed manifest finalization and corrupt history block mutation.
- Existing values remain accessible after repeated reads, updates and deletion attempts; failed writes do not become observed state.
- Concurrent history updates lose no observations; interrupted persistence cannot present a complete capture falsely.
- Null versus absent, unknown nested settings, large integers, duplicate hierarchy placements, projections and pagination retain correct semantics.
- Local tools are offline and do not refresh tokens or rewrite histories.
- Prepare/execute declarations accurately describe required reads; no hidden bulk, pagination, readback or restoration behavior.
- Test post-dispatch storage/network failures as uncertain outcomes, never safe-to-retry failures.
- Windows/POSIX private-storage checks, synthetic transport tests and installed-package/help tests pass.

## Review decisions remaining

The principles above are agreed; details still to settle include exact record schemas/identity adapters, failed multi-file capture recovery, history growth/retention, local diff array semantics, final command flags, and handling endpoints that cannot provide an adequate detailed target read. Until resolved, fail closed rather than approximate safe writes.
