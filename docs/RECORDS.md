# Local record inspection

`cc records` inspects saved CC record histories. It never calls Oracle, selects/renews a
company, changes history, or restores configuration. No login is needed. All commands
require explicit company/environment, task and scope; arbitrary filesystem paths are not accepted.

Every supported public read populates this store through the same mandatory capture pipeline.
Supported update/delete preparation and execution also save their fresh pre-change observations.
Task definitions supply record identities, not an enable switch. An empty local listing does
not mean Oracle contains no records. See [identity rules and capture limits](RESPONSES.md).

## Commands

All examples use placeholders; replace them with identity values from a capture. Do not guess
that a location number equals a hierarchy ID. These multiline examples use POSIX shell syntax.

```sh
cc records list \
  --company '<company-key>' --api-url 'https://<api-host>' \
  --task order-devices --scope-kind rvc --scope-id '<rvc-hierarchy-id>' \
  --limit 50 --offset 0

cc records show \
  --company '<company-key>' --api-url 'https://<api-host>' \
  --task order-devices --scope-kind rvc --scope-id '<rvc-hierarchy-id>' \
  --record-id '<record-id>' --observation latest

cc records history \
  --company '<company-key>' --api-url 'https://<api-host>' \
  --task order-devices --scope-kind rvc --scope-id '<rvc-hierarchy-id>' \
  --record-id '<record-id>'

cc records diff \
  --company '<company-key>' --api-url 'https://<api-host>' \
  --task order-devices --scope-kind rvc --scope-id '<rvc-hierarchy-id>' \
  --record-id '<record-id>' --from '<observation-id>' --to latest
```

- `list`: metadata and paths for up to 100 records; default 50. Follow `nextOffset` explicitly.
- `show`: one complete observed record and provenance. `--observation` accepts a saved UUID
  or `latest` (default). Field selection is not implemented yet.
- `history`: observation metadata without all previous record values.
- `diff`: saved representations compared by JSON pointer. Absent and null are distinct;
  arrays are compared as whole values, not matched by guessed child IDs. Different projections
  can show differences without any actual Oracle change.

Scope kinds: `environment`, `organization`, `hierarchy-unit`, `location`, `rvc`. Task IDs must
be reviewed read capabilities. Extraction adapters will establish their permitted identity
mapping; a local scope label is not proof of Oracle ownership.

## Output and provenance

Small inspections are inline JSON with `savedObservationOnly: true` and
`serverValidated: false`. Above 16 KiB or 500 lines, the selected inspection is exported
privately and a receipt returned. This export does not alter source history. Local inspection
may create an output file but never creates or updates a source observation.

A record's latest observation is chosen by capture timestamp; ties use the last appended
observation. This is not a claim about live Oracle state. Observation history retains the
order in which entries were persisted, so a late-arriving older capture need not be latest.

## Internal storage contract

One logical record uses one JSON file containing `identity`, `latestObservationId` and an
`observations` array. Each observation includes its ID, timestamp, source capture ID,
source-response hash, record hash, reviewed operation, detail/projection metadata, purpose
and complete returned record. Unknown nested fields and numeric source values are preserved.

Files are under the existing private CC application-data directory:

```text
records/<environment-company-hash>/<scope-kind>-<scope-hash>/<task>/<record-id-hash>.json
```

Hashes make paths safe and names unambiguous; readable identities are inside the files and
listing metadata. These are local integrity checks, not signatures or protection against a
user who can deliberately edit data and recompute hashes.

The internal ingestion API is not a CLI import command. It accepts reviewed provenance from
trusted capture code. The capture coordinator retains original response evidence and finalizes
a manifest. Before a write, verification checks manifest/source/proposal hashes and referenced
history observations. The storage layer alone is not proof of a completed capture.

Append operations lock one record, preserve existing observations, flush a temporary file,
and atomically replace the destination. Lock contention fails rather than retrying. Corrupt
history is not overwritten. Linked directories/files are rejected beneath the application
root. Windows ACLs or POSIX private modes protect newly stored data. This is not an OS sandbox
against an attacker controlling the same account/filesystem.

A history file is currently limited to 64 MiB. Growth beyond the bound fails without pruning
old observations. There is no automatic retention cleanup, compaction, merge, replay or
restoration. Flush/rename ordering is not a universal power-loss durability guarantee.

See [user safety guide](SAFETY-AND-RECORD-HISTORY.md) and
[implementation contract](READ-ONLY-RECORD-HISTORY-DESIGN.md).
