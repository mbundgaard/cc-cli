# Versioned field catalogue

Calls are hardcoded; record fields are extensible. The catalogue is evidence, not a
complete database schema, a response validator or permission to write a field.

## Commands

```sh
cc server-version --quiet
cc catalogue import --file /path/to/oracle-swagger.json
cc catalogue show
cc catalogue compare server-version --api-version v2
cc catalogue compare server-version --api-version v1 --archive <generation-id>
cc catalogue changes server-version --api-version v2 --archive <generation-id>
```

`server-version` is an explicit network read. Everything under `catalogue` is local.
There is no hidden specification download, version lookup, background discovery or polling.
Import supports Swagger 2 with local references only. It extracts request/response field
paths and declared types for implemented hardcoded calls, records the file SHA-256 and
its declared documentation version, and never creates executable routes from a schema.
The source file itself, examples, record values and credential material are not copied.
A pinned specification is NOT asserted to match the deployed versions. Re-import it when
new calls are added; existing imported snapshots are retained by hash.

## Identity and release changes

Observations are isolated by company, full configured API base URL and a hash of the
account username. Each generation records BOTH Simphony Enterprise and CC API release
strings. Each operation's v1 and v2 fields remain separate. No versions are inferred from
URLs, docs or token lifetimes. Before record reads, run `server-version` explicitly.
The catalogue shows when versions were last checked; it cannot detect an upgrade until
another explicit version read. Offline help/dry-run never detects releases.

A detected change archives the previous generation and starts empty observations. Even
returning to an earlier release starts a new generation; historical observations are not
silently reused. Concurrent observations pinned to a retired generation are rejected.
Archives remain available for documented/observed and old/current observed comparisons.

## Learning and comparison

Successful requested reads preserve original response bytes and HTTP results. A separate
streaming pass learns field paths and JSON types from the completed inline body/private
file. Arrays use `*`; numeric object keys and documented map keys use `*`. Strings and
numbers are streamed and discarded, not assembled or persisted. Explicit response field
names themselves are metadata; unexpected data-bearing object keys cannot be identified
reliably without a map schema. Keep this local catalogue private like other CC state.
No bodies, filter values, credentials or arbitrary request input are saved in the catalogue.
Ordinary large-response exports remain private files under the normal delivery policy.

Metadata records first/last seen, sample count, projection context (not filters), and
pinned documentation hashes. The field set is the union of observations, never a claim
that every record has those fields. No automatic extra requests fill gaps.

Comparisons identify:
- observed fields not in the pinned documentation;
- incompatible observed non-null JSON types;
- documented fields not yet observed, NOT confirmed missing or removed.

Null alone establishes no type. Empty arrays do not establish element fields. Integer
versus number constraints, requiredness, defaults, ranges, enum values and writability
are NOT inferred. Shared request-control validation is separate from record-field learning.

## Bounds and failures

Streaming observation supports large responses without retaining record values. Limits:
64 nested levels, 256 characters per key, 10,000 distinct field paths per contract, and
64 MiB per specification/catalogue file. Last 100 projection contexts are retained.
Malformed JSON or exceeded bounds do not save partial observations. HTTP errors are not
learned. Unsupported or missing version fields cannot replace a generation.

`catalogue.json` is separate from credential state in the fixed per-user CcCli directory.
Updates use an exclusive lock, synced temporary file and atomic rename. No automatic
stale-lock removal, archive deletion or retries. Existing state is preserved on failures.
Windows inherits user-profile security; POSIX new files/directories use 0600/0700.
Metadata failures after successful response delivery warn on stderr, even with `--quiet`,
without changing the HTTP result or retrying the read. Inspect the catalogue before further
learning. Catalogue corruption detected before a request stops that request.

## Write safety

An undocumented observed field may exist, but is not thereby writable. Documentation is
not an absolute future write allowlist either. Read/write schemas and omission/null effects
must be reviewed separately. No write command is enabled by catalogue learning or import.
