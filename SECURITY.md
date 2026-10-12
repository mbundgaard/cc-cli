# Security

Report issues privately to support@muneris.dk. Never attach passwords, auth cookies,
tokens, client account state, payment/employee data or unreviewed configuration exports.

CC is private/unpublished. Explicit version/hierarchy reads are implemented; no business
writes. One authorized login and v1 version read succeeded. Configuration-data permissions
and live refresh remain unverified; offline tests do not prove entitlement.

Stored tokens/verifiers are credential-bearing plaintext in a fixed CcCli user directory.
Protect that directory and backups; never share it or place it in source control. Passwords
are used only for login and never persisted. Password command arguments may appear in
history/process listings. Status/diagnostics omit token values; auth show exposes the
configured client ID/username/URLs, so treat its output as private configuration.

Strict CC product tags prevent accidental BI/STS/untagged state import; they do not
cryptographically establish an account's product entitlement. Never relabel foreign state.
No TLS bypass, automatic auth/data retries or redirects. Complete recovery copies may
contain newly rotated tokens; repair persistence before attempting authentication again.

Future CC configuration writes can affect operational POS settings. Treat reads and
writes separately, require explicit write authorization and never retry uncertain writes
blindly. Read commands use shared exact/private-file delivery; no raw endpoint CLI
exists. Synthetic test commands are excluded from the installed package.

The local catalogue contains field metadata, version identifiers and documentation hashes,
not record values. Field names may themselves be sensitive, especially undocumented map
keys. Keep catalogue state private. Import schemas only from trusted public documentation;
specifications never create executable routes or grant write permission. Incomplete
observations cannot establish safe update omission behavior.
