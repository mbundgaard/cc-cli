# CcCli

Oracle Simphony Configuration and Content CLI (`@muneris/cc-cli`). Node.js 22+,
TypeScript ESM. **Private/unpublished CLI**, not a released product.

Implemented: PKCE/cookie-preserving login, BI-style ID-token authentication, isolated
company profiles, staged configuration, duplicate-login avoidance, expiry/renewal,
locked atomic persistence/recovery, safe status and explicit version checks.
`cc server-version` reads deployed Enterprise and CC API versions (v2 default, explicit v1).
Hierarchy tree/node reads require explicit organization-wide acknowledgement; menu item
master reads require an explicit hierarchy unit; KDS display reads require an explicit
location hierarchy unit. Order-device reads require an explicit RVC hierarchy unit.
Workstation reads require an explicit location hierarchy unit in the request body.
Order-type names and parameters are separate hierarchy-scoped reads.
Calls are hardcoded; record fields are extensible. Shared server-side filtering, sorting,
projection and explicit paging are documented in [Read controls](docs/READS.md).
[Single-record order-device updates](docs/ORDER-DEVICE-UPDATES.md) require a configured
location/RVC boundary, read-only preparation, one-use approval and explicit risk acknowledgement.
[KDS display CRUD](docs/KDS-CRUD.md) adds guarded single-display create/update/delete
alongside list reads. Names/IPs remain as authored; internal IDs never transfer between locations.
No automatic copy workflow, merge, snapshot, readback or retry. Other writes are absent.
Authorized logins, version/hierarchy, KDS-display and order-device reads succeeded. Live
updates, refresh and other task permissions remain unverified; permissions are endpoint-specific.

## Development

```sh
npm ci
npm test
npm run test:package
node bin/cc.js --help
```

The installed command is `cc`; on systems with a C compiler also named cc, use the
explicit package shim or `node bin/cc.js` to avoid selecting the wrong executable.

## Authentication

Use an Oracle API account of type **Simphony Configuration API**, with appropriate data
permissions. BI/STS accounts or saved tokens are not reused automatically.

```sh
node bin/cc.js auth status
node bin/cc.js auth config --auth-url https://idm.example.com --api-url https://configuration.example.com --username "<user>" --client-id "<client-id>" --org "<shortname>"
node bin/cc.js auth login --password "<password>"
node bin/cc.js company list
node bin/cc.js auth refresh
```

Replace placeholders only with authorized account details. Client IDs are opaque;
enterprise shortname is explicit, never decoded from the ID. Passwords are used for
login only, never saved. Command arguments can appear in shell history/process listings;
do not paste real credentials into examples, source, reports or screenshots.

CC uses `id_token` like BI, not STS `access_token`. PKCE uses S256 with Base64url; Oracle
cookies are retained unchanged. Authentication does not follow redirects or retry.
Live login and narrowly scoped hierarchy reads succeeded; this does not establish other
configuration-data permissions.
No credentials are required for offline tests.

State: fixed per-user `CcCli/CcCli.json`, separate from BiCli/StsCli. Registry and each
profile require `product: "cc"`; even structurally similar untagged BI profiles are
rejected on restore. No production state-directory flag or application environment
configuration. Tests use internal isolated stores, not real user state.

Configuration is staged; successful login selects/saves it, failure preserves existing
profiles. An existing same-key/same-user usable or unknown-expiry token skips login.
Company keys are exact `enterpriseShortname@lowercaseAuthHostname`. Logout clears active
tokens only; deleting the active company never auto-selects another.

Explicit refresh attempts all unexpired profiles, including inactive ones, without
cooldown. The internal future-read executor renews due profiles: success +24h, failure
+1h retaining valid tokens. Known-expired token sets are cleared, requiring fresh login;
unknown lifetime is preserved, never guessed. No daemon or automatic polling.

Token updates are locked, synced and atomically renamed. Complete recovery copies remain
on rename failure; repair state before repeating authentication with possibly rotated
credentials. Status shows local presence/expiry, not Oracle permission validation.

## Scope and safeguards

- Local/help/status commands stay offline; login/refresh are explicit network actions.
- `version --check` explicitly checks npm; never installs or sends Oracle credentials.
- Data response delivery: at most 16 KiB
  AND 500 lines inline; larger complete bodies become private files with compact receipts.
  Authentication responses never pass through data export handling.
- Requests pin company identity and validate/read input before renewal.
- No arbitrary endpoint command, automatic discovery, bulk writes, release or publication.
- Writes stay offline by default; --prepare checks ownership/existence without writing.
  --execute consumes approval before one v2 order-device update or KDS create/update/delete.
  Deletes require an additional target confirmation. No snapshots/readback are automatic.
- `cc server-version [--api-version v1|v2] [--dry-run] [--quiet]` sends one explicit read;
  no fallback. Dry-run is offline. `cc version` still means the installed CLI version.
- Explicit version reads establish a local catalogue generation. Release changes archive
  prior observations; no automatic polling. `cc catalogue import --file <swagger.json>`
  pins documentation offline. `catalogue compare <operation>` compares observed types/paths,
  not record values. Missing observations never prove missing fields or safe writes.
- Synthetic loopback tests and installed-package checks do not prove live CC access.

[CLI](docs/CLI.md) | [Authentication](docs/AUTHENTICATION.md) |
[Field catalogue](docs/CATALOGUE.md) | [Shared read controls](docs/READS.md) |
[Hierarchy](docs/HIERARCHY.md) | [KDS displays](docs/KDS-DISPLAYS.md) |
[Order devices](docs/ORDER-DEVICES.md) | [Workstations](docs/WORKSTATIONS.md) |
[Order types](docs/ORDER-TYPES.md) |
[Menu item masters](docs/MENU-ITEM-MASTERS.md) |
[Development](docs/DEVELOPMENT.md) | [Response foundation](docs/RESPONSES.md) |
[Security](SECURITY.md)

Support: support@muneris.dk.
