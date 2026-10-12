# Authentication and company lifecycle

The implementation is ported from BiCli's tested authentication/company lifecycle,
with CC-specific naming, state paths and strict product markers. STS shares the safety
principles, but CC follows Oracle's ID-token model like BI, not STS access tokens.
Authorized logins, v1/v2 release-version reads and scoped hierarchy/KDS/order-device reads
succeeded. Live updates, refresh and other task permissions remain unverified.

## Oracle flow

Requires API account type Simphony Configuration API, its opaque client ID, explicit
enterprise shortname, username/password and supplied IDM base URL. No credentials or
URLs are guessed, and BI/STS state is never imported.

1. GET `/oidc-provider/v1/oauth2/authorize` with scope openid, response_type code,
   client_id, redirect_uri apiaccount://callback, S256 code_challenge.
2. Preserve Oracle's cookie jar and POST form-encoded username/password/orgname to signin.
3. Validate the authorization callback and POST form-encoded authorization_code grant,
   client ID, verifier, redirect URI, scope and code to token.
4. Save id_token, refresh_token, PKCE verifier and obtainedAt/known expires_in only.
5. Refresh with the same token endpoint, grant_type refresh_token and refresh_token,
   preserving a rotated token even if optional expiry metadata is unusable.

Token/cookie/authorization response data is not printed or routed through response
exports. Only allowlisted machine error codes and HTTP statuses are exposed. A generic
401 does not establish password expiry; only Oracle's explicit expiry response does.
No data/auth retries, redirect following or TLS bypass. Unknown auth outcomes require
inspection before repeating login/refresh.

## Documentation discrepancies and live limits

The guide's token example uses expires_in 86400 while prose says ID tokens last 14 days
and refresh tokens 15 days. Honor returned valid expires_in, never hard-code the prose.
Numeric-string lifetimes are supported; missing/invalid lifetime stays unknown.

The sign-in example shows a relative ?code= callback; the established BI implementation
validates the full apiaccount://callback redirect. The refresh description mentions
code for the prior refresh token, while the mirrored implementation uses refresh_token.
The full callback validation succeeded during the authorized login. Refresh still requires
an authorized live test.
Do not silently try alternate credentials, redirect targets or grant forms after failure.

General auth documentation labels data calls form-encoded, but individual configuration
endpoints advertise JSON. Future data clients must follow each endpoint's contract,
not reuse auth form encoding or BI data paths by assumption.

## State and identity

Fixed state directory:
- Windows: `%USERPROFILE%\AppData\Roaming\CcCli`
- macOS: `~/Library/Application Support/CcCli`
- Linux: `~/.config/CcCli`

File: CcCli.json. No application environment-variable configuration or production
state-directory override. No passwords stored. State is credential-bearing plaintext;
protect the OS user profile and backups. POSIX directories/files are created 0700/0600;
Windows state inherits user-profile security, as in BI. Do not share its directory.

Registry schema 2 requires product cc; individual schema-1 snapshots also require
product cc. Untagged/BI/STS profiles and registries are rejected, including forced
restore. This is a compatibility safeguard, not a way to certify a manually relabeled
credential's entitlement. Never relabel another product's tokens to bypass isolation.
CC-tagged single-profile snapshots can be restored into a company registry.

Company key: explicit enterpriseShortname plus lowercase auth hostname, excluding
scheme/port/path/query/fragment. Keep configured URLs intact after validation; client
IDs retain padding and usernames retain case. Configuration changes are staged, with
no mutation to active profiles/tokens until successful login. Failed login preserves them.

Same key and username with unexpired or unknown-expiry ID token skips duplicate login
without password/network and does not change selection. Select exact keys explicitly.
To replace same-user configuration, select the exact key, log out, configure and log in.
Logout clears active tokens only, without revocation. Deleting an active profile clears
selection; no replacement is chosen. Confirm deletion intent first.

## Renewal, expiry, concurrency and recovery

Explicit auth refresh bypasses cooldown and processes all profiles, persisting each
rotation independently. Future protected reads call the internal shared executor:
validate/read input once, pin company, renew due active/inactive profiles, reload the
same company and send once with its ID token. `server-version` uses this shared lifecycle.

Success schedules +24 hours; Oracle failure schedules +1 hour, retaining still-valid
tokens. Recheck under the lock. Known-expired token sets are removed before renewal,
keeping configuration and requiring fresh login. Unknown-expiry tokens are retained;
refresh is not attempted with a guessed lifetime. No timer/daemon or automated login.

Lock -> load/validate -> mutation -> write exclusive temporary file -> sync -> atomic
rename. Failure to persist is not treated as an Oracle refresh failure. A complete
recovery copy is retained when rename fails; it may hold already-rotated credentials.
Resolve filesystem access and restore the protected copy, rather than blindly repeating
login/refresh with old tokens. No automatic stale-lock deletion or recovery-file cleanup.

`auth restore --file <private-copy> --force` explicitly replaces configured CC state;
without force it refuses to replace existing state. Import validation errors hide
credential content and parser excerpts.

References: [Authentication](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/topic_38.html),
[account type](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/topic_39.html),
[authorize](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/topic_40.html),
[sign-in](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/topic_41.html),
[token](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/topic_42.html).
