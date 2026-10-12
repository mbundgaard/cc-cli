# Shared read controls

CcCli implements individual API tasks, not a comparison workflow. Calls/routes and request
capabilities are hardcoded in `src/read-definitions.ts`. The common builder/registration
layer uses those definitions. Neither Swagger nor observed fields can create commands.
Record fields inside filters, projections and sorts are not an allowlist.

## Generic controls

| Flag | Oracle control | Behavior |
|---|---|---|
| `--search-criteria <expression>` | searchCriteria | Server-side filter; explicit scope is AND-composed for filter-scoped tasks |
| `--order-by <expression>` | orderBy | Server-side sorting, e.g. objectNum:asc or name:desc; no local sort |
| `--include <fields>` | include | Server-side projection; unknown field names permitted |
| `--include-all basic\|detailed` | includeAll | Oracle overrides include; detailed may include option descriptions |
| `--limit <positive integer>` | limit | One explicit page size; server may return a different limit |
| `--offset <nonnegative integer>` | offset | Explicit page start; never automatically advanced |
| `--lang-ids <ids>` | langIds | v2 only; supplied value preserved |
| `--languages <codes>` | languages | v1 only; supplied value preserved |
| `--api-version v1\|v2` | Explicit route | v2 default; no runtime fallback |
| `--json <object>` / `--file <path>` | Request body | Mutually exclusive; `--file -` reads stdin once |
| `--dry-run` | None | Offline exact request, including compiled scope; no token or state mutation |
| `--quiet` / `--timeout <seconds>` | Local behavior | Existing status/notifier suppression and bounded network timeout |

No filter, sort, projection, language or page defaults are invented. Missing values retain
Oracle's defaults. hasMore never causes another request. Conflicting flags/JSON controls,
wrong-version controls and unsupported top-level body keys fail before auth renewal.
Plain field names/expressions are not translated between v1 and v2. Oracle decides which
fields and sorts are supported by the deployed endpoint; local metadata is not an allowlist.

## Scope is part of the reviewed endpoint definition

- **Acknowledgement:** hierarchy discovery requires local `--organization-wide`.
- **Body:** some calls require `hierUnitId` in the Oracle body. Use `--hier-unit-id` or JSON.
- **Criteria:** some calls have no top-level hierUnitId. Their required local
  `--hier-unit-id` compiles to `where equals(hierUnitId,ID)`; JSON must contain only Oracle's
  supported controls. An arbitrary raw filter alone does not satisfy this scope requirement.

A filter-scoped task with `--hier-unit-id 7 --search-criteria "where equals(objectNum,3)"`
sends `where (equals(hierUnitId,7) and (equals(objectNum,3)))`. The optional leading where is
removed before composition; the remaining expression/literals are preserved. Parentheses
prevent an additional OR condition from broadening the explicitly requested scope.

The scope-composition helper accepts function-style predicates with scalar arguments,
grouped AND/OR and !, numeric/bare values and single-quoted strings (doubled quotes are
preserved). Field and function names are not enumerated. Structural validation bounds
nesting to 32 levels, rejects trailing syntax, comments and backslash escapes, and keeps
the final expression within 2000 characters. It does not evaluate or type-check filters.
Oracle still determines predicate/escaping semantics; unsupported syntax is not silently
repaired. Body-scoped and acknowledgement tasks continue forwarding searchCriteria unchanged.
No client-side filtering substitutes for the server request. Dry-run exposes everything.

```sh
# Synthetic ID; example only, not authorization for a real location.
cc kds-displays list --hier-unit-id 7 --search-criteria "contains(name,'Prep')" --order-by objectNum:asc --include objectNum,name,newField --limit 20 --offset 0 --dry-run
```

## Delivery and boundaries

Responses remain byte-exact: at most 16 KiB AND 500 lines to stdout, otherwise a complete
private file plus receipt. Small responses can be shell-redirected; large-response stdout
is a receipt, not the response body, so use its reported private file. There is no comparison,
merge, normalization, cross-location orchestration, ID mapping or automated related fetch.
Unknown response fields are retained and independently learned by the metadata catalogue.
Record values never enter that catalogue. Configuration exports can be sensitive; do not
share them, put them in source control or paste credential-bearing device settings in chat.

Version checks, record queries and page advancement remain explicit owner actions. Scope
IDs are never looked up implicitly; identifier level is documented per task and Oracle
validates it. No live read authorization is inferred from implementation or a prior read.
