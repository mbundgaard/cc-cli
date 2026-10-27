# Safety and saved record history

This guide describes the current development source, not a published npm release. Safeguards
prevent accidental CLI misuse; they do not grant Oracle permissions or make changes reversible.

## Implementation status

| Capability | Status |
|---|---|
| Fixed reviewed commands/routes; shared read-only-by-default dispatch | Implemented, synthetic-tested |
| Explicit single-record boundary, preparation and one-use write approval | Implemented, synthetic-tested |
| File-first responses for every public configuration-read task | Implemented, mandatory |
| One file per logical record, with observed history inside | Implemented for every supported read task |
| Saved and verified previous values before supported updates/deletes | Implemented, mandatory at prepare and execute |
| Local records list/show/history/diff | Implemented; selected-field inspection remains planned |
| Automatic restoration, rollback, bulk operations | Not supported; not planned |
| Durable mutation attempt/outcome journal, including small responses | Implemented; unresolved dispatch remains explicit |
| Retention/cleanup/reindex-recovery commands | Not implemented |

## One shared rule, not a topic switch

Every supported configuration-read task goes through the same capture/history pipeline.
There is no opt-in or bypass per topic. Fixed task definitions describe record shape, stable
identity and scope. Generic methods handle persistence, approvals and inspection. Fixed
capabilities do not restrict returned fields: unknown fields and nested data remain intact.

New tasks must supply reviewed identity metadata before being exposed. Failure to save or
index is a failure, not successful raw-only output. The original response is retained for
investigation when possible, but incomplete capture must be reported explicitly.

## Read-only by default

Without a matching write authorization, the configuration dispatcher allows only reviewed
read operations. Unknown method/route combinations are blocked. HTTP POST alone is not a
write classification: Oracle uses it for reads too.

Read-only still allows authorized authentication/renewal and local capture files. Tokens,
passwords, cookies and auth response bodies never enter record-history storage.

There is no persistent global write unlock. Supported writes require one explicit record,
operation, configured boundary, preparation and short-lived one-use approval. Delete needs
its own target confirmation. An update approval cannot authorize another record or deletion.
A single top-level record can contain child settings; this does not guarantee its effects
are limited to one physical database row.

Use Oracle-side least-privilege/read-only permissions where available. Someone controlling
the code and holding write-capable credentials can bypass local CLI controls; this is not
an OS sandbox or a substitute for server permissions.

## Reads save files; agents choose what to inspect

Public reads save Oracle's original response bytes privately, index its logical records and
return a compact receipt with source/manifest paths, capture ID, byte count/hash and observed
record count. They do not dump records into context, even for small responses.

Each record has one JSON file with timestamped observations, returned values and provenance.
Company/server, scope and stable identity separate records; names alone do not identify them.
Record files are derived lossless JSON, not byte-for-byte copies of the original response.

- Latest means last observed, not necessarily current Oracle state.
- A captured page is not the entire dataset. No automatic next-page request.
- Missing from a filtered/page response does not mean deleted.
- Projections must return required identity fields. The CLI does not silently change your
  projection. Missing/ambiguous identity fails capture and retains raw evidence.
- Unknown fields, nulls, nested settings and exact numeric values are preserved.
- A hierarchy tree is retained as a root record with nested nodes, not recursively split.
  Flat hierarchy-node records use placement IDs so repeated unit IDs are not merged.
- A proposed update or HTTP acknowledgment is not an observed saved version.

The indexer currently has a 32 MiB response bound and history files a 64 MiB bound. Exceeding
these fails without silently skipping indexing or pruning history. A failed multi-record
capture may have saved some observations; only a finalized manifest establishes capture completion.

## Previous values before updates and deletes

Preparation reads the exact target and saves its original response, record observation and
proposed payload. **If reading or saving fails, no write approval is issued.** Old cached reads
cannot substitute for this fresh capture.

Execution verifies the prepared evidence, rereads/saves the target, compares it with the approved
baseline and verifies the fresh capture before consuming approval and dispatching one mutation.
Missing/damaged evidence, changed targets or saving failures block the write. Approvals created
before capture enforcement must be prepared again. For create, save the reviewed absence proof;
there is no previous record to invent.

The purpose is practical: if something goes wrong, we know what values Oracle returned before
we changed them. There is no restore command or automatic replay. A read representation is not
necessarily a valid write payload. Capturing a parent does not make unknown deletion cascades safe.

Pre-write checks cannot eliminate the read/write race without server-supported conditional writes.
A durable attempt is saved before approval consumption; every mutation response is retained
with an HTTP outcome, or the attempt is marked uncertain. If a storage failure prevents that
update, a remaining dispatching state is unresolved—not proof that nothing happened.
After uncertain dispatch, stop and investigate; never blindly retry. Consumed approvals remain
consumed. A separately authorized read can verify saved values; there is no automatic readback.

## Local inspection and privacy

Use [records list/show/history/diff](RECORDS.md) to select what enters context. These commands
never call Oracle, refresh credentials, rewrite history or restore configuration. Small local
results are inline; large inspections are exported privately. An empty list describes local
history only, not the Oracle estate.

Captures live under private CC application data, outside Git and separate from BI/STS. They
can contain sensitive configuration; never publish them unreviewed. Record updates use locks,
flushed temporary files and atomic replacement. Corrupt history is not overwritten. No routine
cleanup silently removes pre-change evidence. Do not delete files referenced by write approvals.

See [response/identity details](RESPONSES.md), [implementation contract](READ-ONLY-RECORD-HISTORY-DESIGN.md),
[current commands](CLI.md), [order-device controls](ORDER-DEVICE-UPDATES.md) and [KDS controls](KDS-CRUD.md).

Support: support@muneris.dk.
