# Response foundation

There are no production CC data endpoints yet. The internal delivery layer is ported
from BI for future explicit read commands and tested with synthetic responses only.
Authentication token responses stay on a separate internal parsing path: never exports.

At most 16,384 decoded bytes AND 500 physical lines remains byte-exact stdout. Exceeding
either limit streams the complete body to private storage with bounded memory and
backpressure. Output becomes a compact receipt with path/URI, byte/line counts, SHA-256
and HTTP status. HTTP errors follow the same rule with preserved exit codes.

No response JSON parsing, formatting, redaction, truncation, output-mode flags or agent
detection. No data retries, redirects or TLS bypass. Failed/incomplete transfers publish
no partial body/receipt; partial files are cleaned or a cleanup failure is reported.
Complete exports persist until explicitly deleted, including after stdout delivery errors.

Exports use CC's fixed per-user directory, never BI/STS storage. POSIX directories/files
are private 0700/0600. Windows creates a current-user-only response-directory ACL before
writing data. Failure to secure storage prevents delivery. Do not publish unreviewed exports.

Future endpoint code must use the shared executor/delivery boundary, not bypass it or
send credential-bearing auth responses through this layer.
