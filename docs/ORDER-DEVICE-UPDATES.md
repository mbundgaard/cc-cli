# Guarded order-device updates

`cc order-devices update` implements **one explicit v2 object** at
`POST /config/sim/v2/devices/updateOrderDevices`. It is an offline review by default.
Only `--execute` can send an update. No batch, v1 fallback, automatic merge, discovery,
pagination, inheritance calculation, restoration, readback, rollback or retry is performed.
Fresh pre-change evidence is saved and verified before updates.
This is a CLI guard, not an Oracle permission boundary or protection against other clients.
Use least-privilege Oracle permissions as an independent safeguard.

## Configure an explicit local boundary

Select the intended company first. All identifiers below are synthetic placeholders:

```sh
cc write-scope set --location-number 901 --location-hier-unit-id 70 --rvc-hier-unit-ids 71,72 --confirm-company "Synthetic@idm.example.com" --confirm-location 901
cc write-scope show
cc write-scope disable
```

The boundary pins the selected company, API URL and auth configuration fingerprint,
location number/hierarchy ID and an explicit RVC ID set. Configuration is offline, not
server verification. Replacing it requires `--replace` and both confirmations; this
invalidates old approvals. Disabled boundaries require deliberate replacement to re-enable.
Never derive a write boundary from reference-site exports or automatically move it on
company selection. Restore/select/reconfigure of another account cannot inherit permission.
Keep `write-scope.json` private in the fixed CC state directory. It contains no tokens.
Do not copy actual customer boundaries into source or tests.

## Prepare, review, explicitly execute

Author a single payload for the **target** record. Never send a reference-site export or
an API collection envelope. Both target identities must agree with the explicit flags.
The five documented required fields are hierUnitId, objectNum, deviceType,
menuItemPrinting and condimentSortType. This minimal synthetic example is NOT a safe
partial-update recipe: absent optional fields may be cleared.

```json
{"hierUnitId":71,"objectNum":3,"deviceType":1,"menuItemPrinting":1,"condimentSortType":1}
```

```sh
cc order-devices update --hier-unit-id 71 --object-num 3 --file update.json --dry-run
cc order-devices update --hier-unit-id 71 --object-num 3 --file update.json --prepare
# Review the full payload, differences, missing fields and risks before approving.
cc order-devices update --hier-unit-id 71 --object-num 3 --file update.json --execute --approve "<approval-from-prepare>" --ack-update-risks
```

JSON/file/stdin is read once per invocation, before renewal. Dry-run stays offline and
omits authorization. Prepare and execute each perform three mandatory scoped reads:

1. Verify the location hierarchy ID resolves to the configured location number/type.
2. Verify every returned placement of the RVC ID/type is directly beneath that location.
   Duplicate placements under the same location are permitted, not separate update targets.
   Mixed or unrecognized parents fail closed; the command does not resolve their inheritance.
3. Fetch exactly the target object at the RVC with detailed fields. Require one matching,
   existing record; reject missing, foreign, inherited, ambiguous or incomplete results.

The proof reads are bounded to 1 MiB each; no paging or alternate lookup is attempted.
They are internal safety checks, not independently delivered data exports, and do not
learn record values into the catalogue. Preflight failures never send an update.
Requests are spaced by at least 1.1 seconds between completed preflight calls and the write.

Prepare displays the exact submitted body, changed top-level fields including their
nested before/proposed values, top-level fields absent from the payload, and risks.
It stores only approval metadata/hashes in `order-device-approval.json`: no before-record
values or request payload inside the approval file. Instead it binds a separate capture manifest,
original target response, record-history observation and proposed payload. Missing/corrupt evidence
or failure to save the fresh execution capture blocks dispatch. One pending approval is retained, expires after 15 minutes,
and is replaced by the next preparation. Execution rechecks the boundary, ownership,
record content, target, payload and audit reference. Any difference requires preparation
and review again. Auth token rotation alone does not invalidate the account binding.

Execution consumes the approval durably **before** sending a single update. No retry uses
it again, even after a crash, timeout, connection loss or output failure. The CC registry
and write-operation locks prevent cooperating CLI account/boundary changes during checks
and the write. Locks are not auto-removed when stale. A failed/uncertain write must be
reconciled independently before deliberately preparing another; do not blindly retry.

## Fields and limits

- Calls and identity rules are hardcoded; documentation does not create executable routes.
- Payload is limited to 1 MiB, 10,000 visited values and depth 16. Arrays/batches are rejected.
- Root hierUnitId/objectNum must match flags. Additional/nested identities, identity aliases,
  routing fields, collection envelopes and prototype keys are rejected, including copied
  read-only hierUnitObjNum. Known numeric/type controls are validated before network use.
- Unknown non-identity fields are not silently removed. Explicit `--allow-unverified-fields`
  is required at preparation and execution. This does NOT prove their meaning, writability
  or safety; unreviewed fields cannot be guaranteed harmless. Explicit null strings also
  require this acknowledgement. Required identities/fields cannot be null; known nested
  objects/types must retain their documented shapes. No guessed null-to-omission conversion.
- Exact numeric JSON text is retained for unverified fields. No renaming, bit decoding,
  response normalization or automatic insertion of missing fields occurs.
- Audit reference is generated as `Muneris CC-CLI // <saved username>` from the pinned
  account. It is shown in dry-run/preparation and bound into approval. No --audit-ref override.
  Require printable ASCII and at most 50 characters (username at most 32 characters).
  Never truncate/normalize the username; invalid or overlong references fail before networking.
  The 50/51 ASCII boundary was live-confirmed for KDS updates on CCAPI 23.8.0.1; the CLI
  applies this conservative cap to all writes, not a claim about every Oracle deployment.
  `--timeout` is a per-request 0 < seconds <= 300 bound. Safety warnings remain with --quiet.

## Limits of the guarantee

Oracle warns that omitted optional fields may be cleared. A detailed read is not proof
of a complete writable record. This command submits exactly the authored object, NOT PATCH,
and does not manufacture a supposedly safe read/merge/write. Caller review is essential.
There is no documented ETag/conditional-write guarantee in the reviewed contract: even a
matching fresh preflight cannot prevent another actor changing/deleting a record before
POST. v1 describes update/add behavior and is deliberately not exposed by this command.
One top-level record does not mean only one underlying database row changes.

Saving before-values is mandatory; post-update readback is not automatic. HTTP success is not
verified application or proof of the resulting effective configuration. The update response
is saved verbatim with a compact file receipt and durable attempt/outcome reference; error
bodies and HTTP exit codes are preserved. No small-response inline exception exists for mutations. Write responses are not learned as read schemas.
Live update permission, omission/null behavior and concurrent-change behavior remain
**unverified**. Synthetic tests do not establish deployment compatibility.

Source: [Oracle v2 Update Order Devices](https://docs.oracle.com/en/industries/food-beverage/simphony/ccapi/op-config-sim-v2-devices-updateorderdevices-post.html),
public Swagger version 2026.06.15, SHA-256
`f12ae90ea45a1e2c2896f4ddbbddd8949e6a179541870e85896864c852024289`.
[Read task](ORDER-DEVICES.md) | [CLI](CLI.md) | [Security](../SECURITY.md)
