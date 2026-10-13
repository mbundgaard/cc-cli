# Security

Report issues privately to support@muneris.dk. Never attach passwords, auth cookies,
tokens, client account state, payment/employee data or unreviewed configuration exports.

CC is private/unpublished. Explicit reviewed reads and guarded single-record order-device
updates and KDS display CRUD are implemented. Authorized login/version/hierarchy/KDS/order-device reads succeeded.
Live updates, refresh and other task permissions remain unverified; offline tests do not
prove entitlement, omission/null behavior or concurrency safety.

Stored tokens/verifiers are credential-bearing plaintext in a fixed CcCli user directory.
Protect that directory and backups; never share it or place it in source control. Passwords
are used only for login and never persisted. Password command arguments may appear in
history/process listings. Status/diagnostics omit token values; auth show exposes the
configured client ID/username/URLs, so treat its output as private configuration.

Strict CC product tags prevent accidental BI/STS/untagged state import; they do not
cryptographically establish an account's product entitlement. Never relabel foreign state.
No TLS bypass, automatic auth/data retries or redirects. Complete recovery copies may
contain newly rotated tokens; repair persistence before attempting authentication again.

Configuration writes can affect operational POS settings. [Order-device updates](docs/ORDER-DEVICE-UPDATES.md)
require an explicit account/environment/location/RVC boundary, ownership and existence checks,
a reviewed one-use approval and risk acknowledgement. Ordinary account changes are locked
out during checks/write. No automatic snapshots, readback, merge, rollback or retries.
Approvals are consumed before sending; uncertain outcomes require independent reconciliation.
Omitted fields may clear values; preflight is not atomic with POST. Unverified fields are
opt-in and cannot be proven harmless. CLI guards do not replace Oracle permission controls
and cannot constrain another client or deliberate local-state tampering.
[KDS CRUD](docs/KDS-CRUD.md) shares these protections, checks absence for create and
existence for update/delete, and requires an extra delete confirmation. Its update API
may add records: preflight is not a transactional update-only guarantee. Nested child
arrays may replace data. Source database IDs and descriptive optionsExt are not writable
copy targets; names/IPs are deliberately not changed by the CLI. No automatic cascades,
reference repairs or location synchronization.
Data responses use shared exact/private-file delivery; no raw endpoint CLI exists.
Synthetic test commands are excluded from the installed package.

The local catalogue contains field metadata, version identifiers and documentation hashes,
not record values. Field names may themselves be sensitive, especially undocumented map
keys. Keep catalogue state private. Import schemas only from trusted public documentation;
specifications never create executable routes or grant write permission. Incomplete
observations cannot establish safe update omission behavior.
