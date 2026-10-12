# CC CLI

Authentication and explicit deployment-version, hierarchy, menu-master, KDS-display, order-device and workstation reads.
No configuration writes or arbitrary endpoints.
Use `node bin/cc.js` during development. The package installs the command `cc`.

| Command | Effect |
|---|---|
| `cc --help` | Local help |
| `cc endpoints` | Local hardcoded read inventory and v1/v2 mappings |
| `cc server-version [--api-version v1\|v2] [--dry-run] [--quiet]` | Explicit deployed Enterprise/CC API versions; default v2, no fallback |
| `cc hierarchy list --organization-wide [controls]` | One explicit hierarchy-tree page; v2 preferred, explicit v1 |
| `cc hierarchy nodes list --organization-wide [controls]` | One explicit hierarchy-node page; v2 only |
| `cc menu-item-masters list --hier-unit-id <id> [controls]` | One explicit master-record page; v2 preferred, explicit v1 |
| `cc kds-displays list --hier-unit-id <location-id> [controls]` | One explicitly scoped KDS-display page; v2 preferred, explicit v1 |
| `cc order-devices list --hier-unit-id <rvc-id> [controls]` | One explicitly scoped order-device page; v2 preferred, explicit v1 |
| `cc workstations list --hier-unit-id <location-id> [controls]` | One location's workstation page; hierUnitId is sent in JSON |
| `cc catalogue import --file <swagger.json>` | Pin documented fields locally; no network or route generation |
| `cc catalogue show` | Local documentation, generations and archives |
| `cc catalogue compare <operation> [--api-version v1\|v2] [--archive <id>]` | Documented versus observed fields |
| `cc catalogue changes <operation> --archive <id> [--api-version v1\|v2]` | Archived versus current observations; absence is not removal |
| `cc version` | Local installed version |
| `cc version --check` | Explicit five-second advisory npm lookup, no installation |
| `cc auth status` | Local token presence/expiry, active key, pending/schedule status |
| `cc auth show` | Local configuration and token summary, never token values |
| `cc auth config` | Show current configuration without network |
| `cc auth config --auth-url ... --api-url ... --username ... --client-id ... --org ...` | Stage explicit CC configuration |
| `cc auth login --password ...` | Authorized network login, or skip duplicate usable same-user login |
| `cc auth refresh` | Explicit all-profile renewal, bypassing cooldown |
| `cc auth logout` | Clear active-company tokens locally; no remote revocation |
| `cc auth restore --file ... [--force]` | Restore strictly CC-tagged state; force needed to replace configured state |
| `cc company list` | Local saved companies and token summaries |
| `cc company status` | Local active key |
| `cc company select <exact-key>` | Select exact key, discard staged config; no login |
| `cc company delete <exact-key>` | Delete local profile/tokens; confirm intent; no remote deletion |

Auth login supports `--username` override, saved only on success. Login/refresh accept
`--quiet` (suppress status diagnostics, not errors) and `--timeout` (seconds per request,
greater than zero and at most 300, default 30). Password flags can be visible in shell
history/process listings; never print actual credentials in reports.

[Authentication](AUTHENTICATION.md) documents product isolation, PKCE/cookies, renewal,
expiry, unknown lifetimes and recovery. `server-version` uses an empty JSON body and the
shared pinned-company renewal/delivery lifecycle. `--dry-run` is offline and omits tokens;
`--timeout` uses the same bounds as auth. Internal test-only commands are not packaged.

[Shared read controls](READS.md) defines server-side filtering/sorting/projection, explicit
scope transport and one-page execution. [KDS displays](KDS-DISPLAYS.md) uses location-scoped
criteria; [Order devices](ORDER-DEVICES.md) uses RVC-scoped criteria. Neither fetches
related records automatically. [Workstations](WORKSTATIONS.md) uses a required location
hierUnitId body parameter; nested device settings may be sensitive.

[Hierarchy](HIERARCHY.md) documents JSON/file/stdin, explicit paging, filters/projections,
version-specific language controls and scope acknowledgement.
[Menu item masters](MENU-ITEM-MASTERS.md) uses these controls with mandatory hierUnitId. Run `server-version` first
for the catalogue; dry-run does not need tokens or a catalogue generation.

Local successes use `{ "ok": true, "command": "...", "data": ... }`. Diagnostics and
errors go to stderr. Explicit refresh can return a summary with a nonzero exit: inspect
per-company outcomes. Status does not validate server access.

Exit codes: 0 success; 1 unexpected/storage failure; 6 usage; 7 configuration; 8 missing
tokens; 9 authentication; 10 network; 11 other HTTP; 12 state/lock failure.

`version --check` is independent of Oracle auth and sends no credentials to npm. CC is
unpublished; unavailable does not mean up to date. Successful non-quiet reads use the
once-daily advisory notifier; auth/local/help do not trigger it.

Version contract: POST `/config/sim/v2/getReleaseVersions` (preferred), or explicit
`/config/sim/v1/getReleaseVersions`. Returns `simphonyEnterpriseVersion` and `C&CVersion`.
Successful version responses establish a [catalogue](CATALOGUE.md) generation locally.
Changes archive prior observations; no implicit version lookup or specification download.
These identify application/schema compatibility and API releases, not a complete database
schema. Unknown response fields are preserved; no response-field allowlist is enforced.
