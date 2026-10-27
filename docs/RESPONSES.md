# Response delivery and mandatory captures

## Public configuration reads: always file-first

Every implemented configuration-read task uses the same mandatory capture pipeline. There
is no task-specific enable switch and no successful raw-only fallback. Fixed record metadata
supplies structure and identity; it does not decide whether capture is required.

The CLI streams the decoded response bytes to protected storage, preserving the complete
original. It then indexes the returned logical records into their history files and finalizes
a capture manifest. Stdout contains a compact JSON receipt: absolute source path/URI, bytes,
lines, SHA-256, HTTP status, capture ID, manifest path, history status and observed record count.
It does not print records, even for a small response.

History files are derived lossless JSON. Original response bytes are never reformatted,
redacted, truncated or replaced with the derived files. Authentication responses never enter
this storage layer.

## Identity, projections and incomplete captures

All supported tasks have reviewed record definitions:

| Task | Logical record identity within explicit scope |
|---|---|
| server-version | Environment singleton `release-versions` |
| hierarchy | Root `hierUnitId`, with nested nodes retained intact |
| hierarchy-nodes | Placement `hierStrucId`; repeated hierarchy-unit IDs are not merged |
| menu-item-masters, kds-displays, order-devices, workstations, order-type-parameters | `objectNum` with matching explicit `hierUnitId` |
| order-types | `lineNum` with matching explicit `hierUnitId` |

Task definitions are reviewed against Oracle's v1/v2 schemas; future tasks must provide record
metadata before being exposed. No field-value allowlist is introduced. Names never substitute
for stable identities. Returned foreign/inherited or duplicate identities are not silently
merged or guessed.

Projections must return the required identity fields. The CLI does not silently append fields
to your request. If identities are absent/ambiguous, parsing fails or indexing cannot complete,
the read returns failure and retains the original response for inspection. No record-history
success is claimed. The manifest is marked failed when storage permits; a lingering `indexing`
manifest is also incomplete. Some observations can have been saved before a multi-record
failure; this is not a filesystem-wide transaction. No automatic indexing or network retry.

A completed capture means the returned page was saved/indexed, not that the entire Oracle
dataset is present. Pagination metadata is preserved. No automatic next-page request, deletion
inference from absence, or inherited-value resolution.

The initial indexer is bounded to 32 MiB per response. Larger original responses are retained,
but capture fails rather than pretending indexing succeeded. Each record-history file is
bounded to 64 MiB; it fails without pruning older observations. Streaming indexing/retention
improvements must preserve the same mandatory behavior, not add bypass switches.

## Errors and write evidence

HTTP error responses are saved verbatim with their original exit status and a file receipt;
they do not become record observations. Failed/incomplete transfers publish no completed body
and attempt partial-file cleanup. Completed evidence persists on indexing/output failure.
Never delete a capture still referenced by approval or pre-change evidence.

Supported update/delete preparation and execution each read and save the exact target, original
response, proposed payload and source-linked record observation. An approval binds its prepared
capture. Execution verifies that evidence, repeats the read/save, checks for changes and verifies
the fresh capture before consuming approval and dispatching one mutation. Missing/corrupt evidence
or saving failure blocks the mutation. Old approvals without capture evidence require fresh
preparation. Create operations retain reviewed absence proof instead of inventing a prior record.

Internal hierarchy ownership checks use the same exchange/capture/history lifecycle as public
and target reads. Their explicit projection includes placement identity; validation consumes the
saved response. They do not print another data stream or silently traverse related records.

Mutation responses are always file-first too. A durable attempt is saved before approval
consumption; dispatch and HTTP/uncertain outcomes link the complete response and hash. If storage
fails while recording uncertainty, a remaining dispatching state must be treated as unresolved.
Only local record inspection uses the 16,384-byte/500-line inline threshold. HTTP acknowledgment never
becomes an observed version by itself. No automatic readback, retry, replay, restore or rollback.
Transport/storage/output failure after dispatch can be an uncertain outcome; consumed approval
is never restored automatically.

## Privacy and metadata

Exports use CC's fixed private application-data directory, separate from BI/STS and outside Git.
POSIX directories/files use private permissions; Windows uses current-user directory ACLs before
writing customer bytes. Record files reject linked/unsafe storage. Source records may themselves
contain sensitive settings. Keep captures private; do not publish unreviewed data.

Catalogue learning remains a separate best-effort structural observer after successful delivery.
It stores field metadata, not record values, and cannot approve writes. A catalogue save failure
does not turn a completed capture into a failed network request. Capture failure, in contrast,
is a hard failure, not an advisory warning.

See [user safety guide](SAFETY-AND-RECORD-HISTORY.md), [local inspection](RECORDS.md) and
[implementation contract](READ-ONLY-RECORD-HISTORY-DESIGN.md).
