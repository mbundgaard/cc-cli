# KDS display CRUD

KDS displays are the first complete CRUD task family. One command targets **one display
at one explicit location**, never a batch or a copy/synchronization workflow.

| Task | Command | Reviewed path |
|---|---|---|
| Read | `kds-displays list` | `/config/sim/v2/devices/getKitchenDisplays` (explicit v1 also supported) |
| Create | `kds-displays create` | `/config/sim/v2/devices/kitchenDisplays` |
| Update | `kds-displays update` | `/config/sim/v2/devices/updateKitchenDisplays` |
| Delete | `kds-displays delete` | `/config/sim/v2/devices/deleteKitchenDisplays` |

All requests use POST. Writes are v2 only, no upsert command or automatic fallback.
The update endpoint is itself documented as **updated/added**, not atomic update-only.
The CLI requires an existing target before update/delete and confirmed absence before
create. These checks do not prevent a concurrent actor changing the target before POST.

## Explicit boundary and execution

Reuse the configured [write boundary](ORDER-DEVICE-UPDATES.md) for the target company,
account/environment and location. KDS writes require its **location** hierarchy ID, not
an RVC ID. A boundary can omit --rvc-hier-unit-ids for location-only writes; order-device
updates then have no permitted RVCs. Help, boundary configuration and dry-run stay offline.
All following values are synthetic examples, not instructions to change a live account.

```sh
cc write-scope set --location-number 901 --location-hier-unit-id 70 --confirm-company "Synthetic@idm.example.com" --confirm-location 901
cc kds-displays list --hier-unit-id 70 --search-criteria "equals(objectNum,4)" --include-all detailed
cc kds-displays update --hier-unit-id 70 --object-num 4 --file display.json --dry-run
cc kds-displays update --hier-unit-id 70 --object-num 4 --file display.json --prepare
# Review the complete target/action/payload, differences, omitted fields and risks first.
cc kds-displays update --hier-unit-id 70 --object-num 4 --file display.json --execute --approve "<approval>" --ack-update-risks
```

Create uses the same flags with `create` instead of `update`. Both require one authored
object containing hierUnitId, objectNum and a nonempty translated name map. Optional
settings are never filled, merged, renamed or stripped automatically. A minimal object
is NOT a safe partial-update recipe: omitted values may be cleared.

Delete needs no file: its explicit target flags construct the exact two-field identity
body, visible in dry-run. If JSON/file is provided, only those two matching fields are
accepted. Execution additionally repeats the target object number:

```sh
cc kds-displays delete --hier-unit-id 70 --object-num 4 --prepare
cc kds-displays delete --hier-unit-id 70 --object-num 4 --execute --approve "<approval>" --ack-update-risks --confirm-delete 4
```

Each preparation/execution performs exactly two prerequisite reads: validate the location
number/type against the boundary; then check the target by location hierarchy ID AND
object number. Incomplete/ambiguous/foreign responses fail closed. No hierarchy traversal,
controller lookup, dependent-record repair, deletion cascade check or automatic pagination.

The audit reference is automatic: `Muneris CC-CLI // <saved username>`. It must fit 50
printable ASCII characters, without truncation or custom overrides. Controlled KDS update
probes on CCAPI 23.8.0.1 accepted 50 and rejected 51 ASCII characters twice each.

Approval binds the action/route, boundary, complete authored payload, audit reference and
fresh target record (or confirmed absence). It expires after 15 minutes and is consumed
before dispatch. KDS stores one latest approval in `kds-display-approval.json`, distinct
from order-device approvals. Both families share the legacy-named `order-device-write.lock`
and hold the CC registry lock during checks/write. No stale-lock removal or approval replay.

## Fields and child settings

- Name translations and IP strings are submitted exactly as authored. IPs can intentionally
  match a reference location; the CLI never substitutes lab addresses, names or resolutions.
  A database location boundary is not network isolation: copied IPs could address another
  site's devices if reachable. Review this operational risk before explicit execution.
- Root hierUnitId/objectNum must match the target flags. Never submit source hierUnitObjNum
  or kdsClientId: these are nonportable read/database identities and are rejected.
- cardId/videoId are documented display/hardware settings, not kdsClientId. They may be
  submitted at the root. Nested/alternative routing identities remain forbidden.
- options is the raw bit string. optionsExt is descriptive read output and is rejected;
  there is no automatic bit decoding or conversion of Ext fields to writes.
- The documented write spelling is **toolbarObjNum**. Some live reads return **toolBarObjNum**.
  No silent alias mapping occurs. The latter is an unverified field requiring explicit
  acknowledgement; supplying both spellings is rejected. Author/review the desired spelling.
- Reviewed child arrays: panelConfiguration (unique positive panelNum), recallReviewList
  (unique positive colNum, at most six entries), prodItems (unique positive prodItemNum).
  Panels/production items have a local 100-entry bound; all values share depth-16/10,000-value/
  1 MiB body bounds. No top-level batches, unknown arrays, nested target IDs or duplicate
  child selectors. Child objects may contain acknowledged unverified non-identity fields.
- Null optional values, unverified fields and non-32-bit option strings require
  --allow-unverified-fields on preparation and execution. They are preserved, not converted
  to omission/empty arrays/zero. Known types/selectors are checked. Acknowledgement is not
  evidence of writability or safety; array replacement/null/omission semantics remain
  live-unverified. Unknown fields never grant a new executable route or wider target scope.

## Copying settings is a separate investigation workflow

Compare/export/source matching remains outside the CLI. A reference record is not a
ready-to-send request. Author the target-owned payload, handle read-only identities and
field spelling explicitly, and review the full settings. Matching object numbers of
controllers/toolbars/other references does not prove equivalent referenced configuration.
Do not delete/recreate existing displays merely to copy their settings; use reviewed
single-record updates and retain target-owned database identities. No automatic creation
or deletion reconciles extra/missing displays.

There are **no automatic before-snapshots, post-write readbacks, retries or rollbacks**.
A scoped live KDS update and audit-header boundary probes succeeded. Create/delete and
full nested omission/null/concurrency behavior remain live-unverified. HTTP success is not verified application or proof
that the resulting effective configuration matches a source. Responses retain original
bytes/HTTP status via [normal delivery](RESPONSES.md); write responses are not read-schema
observations. Uncertain outcomes consume approval and require independent reconciliation.

Sources: Oracle v2 [create](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-kitchendisplays-post.html),
[update](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-updatekitchendisplays-post.html),
[delete](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-deletekitchendisplays-post.html),
public Swagger 2026.06.15 SHA-256
`f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.
Public documentation does not establish deployment-specific compatibility or write permission.
