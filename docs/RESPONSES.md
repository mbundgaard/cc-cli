# Response foundation

Explicit reads, order-device updates and single-record KDS CRUD writes use the shared delivery layer
ported from BI. Authorized version/hierarchy/KDS/order-device reads succeeded; live
updates remain unverified. Internal write-ownership checks are bounded validation reads,
not data exports or snapshots.
Authentication token responses stay on a separate internal parsing path: never exports.

At most 16,384 decoded bytes AND 500 physical lines remains byte-exact stdout. Exceeding
either limit streams the complete body to private storage with bounded memory and
backpressure. Output becomes a compact receipt with path/URI, byte/line counts, SHA-256
and HTTP status. HTTP errors follow the same rule with preserved exit codes.

No response parsing/formatting changes delivered bytes: no redaction, truncation,
output-mode flags or agent detection. A separate post-delivery streaming observer learns
field metadata from successful read responses (not update responses); it never rewrites output or stores record values
in the catalogue. Metadata failure warns without changing the HTTP result. No data retries, redirects or TLS bypass. Failed/incomplete transfers publish
no partial body/receipt; partial files are cleaned or a cleanup failure is reported.
Complete exports persist until explicitly deleted, including after stdout delivery errors.
Write transport/delivery failures warn that the outcome may be uncertain. An approval
consumed before dispatch is never restored by an HTTP, transport or output failure.
No automatic write retry, snapshot or post-update readback is performed.

Exports use CC's fixed per-user directory, never BI/STS storage. POSIX directories/files
are private 0700/0600. Windows creates a current-user-only response-directory ACL before
writing data. Failure to secure storage prevents delivery. Do not publish unreviewed exports.

Endpoint code must use the shared executor/delivery boundary, not bypass it or
send credential-bearing auth responses through this layer.
