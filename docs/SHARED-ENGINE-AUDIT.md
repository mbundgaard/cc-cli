# Shared-engine architecture audit

Status: original structural findings addressed in the current development source; synthetic
regression tests cover the boundaries below. This is not a claim that future code cannot
introduce regressions, or that all Oracle operations are implemented/live-verified.

## Invariant

Fixed definitions describe Oracle: operation, route, version, scope, identity, shape and
validation. Shared engines enforce our policy: capture/history, approval, dispatch and output.
Definitions cannot opt a topic out of capture, authorization or persistence.

Explicit lifecycle distinctions (read versus mutation, local inspection versus network data,
authentication versus configuration) are necessary. Topic-name defaults and optional safety
hooks are not allowed in shared configuration execution.

## Findings and resolutions

| Original finding | Resolution |
|---|---|
| Optional capture in generic request/delivery APIs | `PreparedRequest.capture` is required. Runtime checks reject omitted/mismatched context before renewal/dispatch. `ConfigurationDispatch` requires a read capture or mutation permit plus durable attempt. The optional legacy network delivery function was removed. |
| Order-device/KDS task-name branch in guarded capture | Capture metadata resolves through compiled read operations. Task modules construct guarded definitions from the compiled mutation catalogue; unknown capabilities fail, never default to another task. |
| Separate public-read and ownership-proof networking | Both call `exchangeConfiguration`, as do target reads and mutations. Ownership proofs save original response, manifest and projected history. They explicitly request placement IDs needed for indexing, then apply ownership validation to the saved response. |
| Catalogue branches on server-version name | Fixed read definitions declare the typed `catalogueRole`; generic learning uses that role. Release-establishment behavior is distinct metadata semantics, not a capture exemption. |
| Scattered operation knowledge | `readOperations` combines reviewed routes, version, task, identity and catalogue role. `mutationOperations` is the source of mutation route/read-link/scope/namespace metadata. Resource modules supply validators/risks, not competing route decisions. Exhaustive/coherence tests cover current capabilities. |
| Device-specific shared persistence naming | Names are isolated as on-disk compatibility metadata. Every write namespace uses `SHARED_WRITE_LOCK`; the legacy filename is intentionally retained so old/new clients cannot acquire different locks. There is no conditional device-specific locking policy. |
| Small mutation responses lost after inline delivery | Mutations now use the same always-file exchange. A durable attempt precedes approval consumption; dispatch/outcome status and original response reference/hash are retained. No observation is invented from acknowledgment. |

## Single lifecycle

1. Validate reviewed capability and mandatory lifecycle metadata before dispatch.
2. Public query preflight pins the account and handles authorized renewal; guarded writes retain
   their approval/account/scope locking and validation requirements.
3. `exchangeConfiguration` streams every configuration response to protected storage.
4. Successful reads, including ownership/target proofs, enter the same mandatory capture/history
   coordinator. Missing identities or indexing failure is failure, not successful raw-only output.
5. Mutations require an internal exact-request permit and durable attempt. Every response is
   retained, with HTTP outcome recorded; network/storage uncertainty is explicit.
6. Publishing a receipt is separate from receiving/persisting data. Internal proofs consume
   the saved result for validation without printing it; this is not another read implementation.

Before updates/deletes, the target's fresh history/source/proposal evidence must verify. Before
creates, reviewed absence evidence must verify. Source evidence, proposed changes, HTTP response
and observed saved state remain different concepts. No retries, restore, rollback or bulk writes.

## Tests and test-only utilities

Architectural regression tests reject missing capture context before renewal/network calls,
check every compiled capability's metadata, enforce that configuration dispatch has only one
production caller, and verify all approval namespaces share the same legacy lock. Mutation
tests cover durable small responses, missing attempt storage, lost responses, consumed approvals
and retained uncertainty. Existing capture/history corruption and storage-failure tests remain.

The unpackaged `tests/test-read.mjs` is now explicitly an auth-preflight/byte-collector fixture.
It composes the low-level collector and loopback transport to test arbitrary bytes, compression,
thresholds and cancellation. It is not registered or shipped as a production read mode and does
not inject a bypass into the production executor. Real public command tests exercise mandatory
file-first capture. Local inspection retains bounded inline output but has no network capability.

## Remaining limitations, not per-topic exceptions

- Capture indexing is bounded to 32 MiB per response; history files to 64 MiB. Exceeding a bound
  fails without skipping history or silently pruning evidence.
- No retention/cleanup/reindex-recovery command is implemented. Partial indexing may leave
  valid observations with an incomplete manifest; never claim whole-capture completion.
- File durability depends on platform/filesystem behavior; flush/rename is not an absolute
  power-loss guarantee. A disk failure may prevent writing an uncertainty update, leaving
  `dispatching` as evidence of an unresolved attempt. Do not retry blindly.
- Resource-specific Oracle null/omission/inheritance/child semantics still require reviewed
  validators. A generic engine cannot manufacture those contracts or safe restoration.
- Mandatory local policy is not an OS sandbox against modified code or stolen write credentials.
- No live deployment verification was performed for this refactor.

Future changes must preserve these invariants and update user/developer documentation and
installed-package tests together. Do not resume ad hoc per-topic lifecycle implementations.
