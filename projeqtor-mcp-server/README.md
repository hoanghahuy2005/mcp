# ProjeQtOr MCP server

Independent Node.js / strict TypeScript package for local Mock Mode and the ProjeQtOr REST API. Node >=24.15.0; npm 11.12.1. No OpenAI API or LLM dependency. ProjeQtOr PHP, DB and Apache configuration are untouched.

Ten business tools are available over Streamable HTTP or stdio. HTTP supports the legacy static bearer, OAuth 2.1, or both during migration. OAuth provides Authorization Code + PKCE S256, DCR/pre-registered ChatGPT CIMD identity, discovery, persistent access/refresh token state, rotation/reuse detection and revocation. Automated acceptance uses only isolated loopback services and never writes to a live ProjeQtOr instance.

## Build and verify

From this package directory in PowerShell:

```powershell
# Only on a fresh checkout; dependencies are already installed here:
# npm.cmd ci --ignore-scripts --cache .npm-cache
npm.cmd run build
npm.cmd run verify
```

`verify` builds and runs unit tests, inherited QA helper/foundation/API-read tests, workload/workflow integration, the OAuth black-box flow and the installed Inspector CLI. It uses isolated mock state, random local listeners and synthetic credentials; it does not load `.env` or contact live ProjeQtOr. Logs and the machine-readable result are in ignored `.qa-artifacts/`.

Individual commands:

```powershell
npm.cmd test
npm.cmd run test:integration   # requires an existing dist build
npm.cmd run smoke -- --inspector
```

Installed versions: official MCP server/client 2.3.1, Node adapter 2.1.1, Inspector 2.12.0, TypeScript 5.9.3, Zod 4.6.7. The lockfile controls installation. No dependency upgrade was needed during takeover.

## Start HTTP

```powershell
$env:PROJEQTOR_MODE = 'mock'
$env:ENABLE_WRITE = 'false'
$env:MCP_AUTH_MODE = 'legacy'
$env:MCP_BEARER_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm.cmd start
```

Default address: `http://127.0.0.1:8787/mcp`. `GET /health` returns `{status:'ok',mode:'mock'}` without bearer authentication, after Host/Origin validation. Health reports local readiness, not a successful upstream login. Every `/mcp` request requires `Authorization: Bearer <token>`. Keep the token out of URLs/source control. Tokens require 32–256 URL-safe characters, non-placeholder content and at least eight distinct characters. `.env` is optional and ignored; `.env.example` deliberately contains an invalid token placeholder.

`MCP_HOST` accepts only `127.0.0.1`; public access is expected through an HTTPS reverse proxy. Host and Origin validation also allow the exact configured OAuth public origin. Missing Origin is allowed for native MCP clients. Foreign or duplicate security headers fail closed, and proxy forwarding headers do not extend trust. There is no browser CORS preflight or legacy SSE endpoint.

## Start OAuth for a remote MCP client

Keep Node bound to loopback and terminate public HTTPS in a trusted reverse proxy or ngrok. Set `MCP_AUTH_MODE=oauth` (or `both` while migrating), `OAUTH_ISSUER=https://<public-host>` and `OAUTH_RESOURCE=https://<public-host>/mcp`. The public proxy must preserve the exact Host and route all paths to this server. The authorization server publishes RFC 9728/8414 metadata, accepts ChatGPT's stable CIMD client or DCR, and returns issuer identification in callbacks.

OAuth login validates the submitted credentials with a fixed read-only ProjeQtOr API request at `OAUTH_PROJEQTOR_BASE_URL`. The API endpoint must actually enforce Basic authentication; PHP session, LDAP-specific UI and ProjeQtOr OTP challenges are not emulated by this adapter. Tokens and client registrations persist as digests/metadata under `OAUTH_STATE_DIR`; keep that directory private and backed up. See `.env.example` for every variable.

Request bodies: 65,536 bytes; headers: 16,384 bytes; request/header timeouts: 15/10 seconds. The SDK serves modern MCP and legacy stateless Streamable HTTP. Authenticated legacy GET/DELETE return 405. Ctrl+C closes the server. Fixed-field JSON logs go to stderr; stdio stdout is protocol-only.

## Start stdio and connect

```powershell
npm.cmd run start:stdio
```

An MCP host should launch `node` directly with an absolute `dist/index.js` path and `--stdio`, rather than npm. Stdio uses the local process boundary and needs no HTTP bearer token. Explicitly set `PROJEQTOR_MODE=mock`, `ENABLE_WRITE=false` in the host configuration.

[Connection guide](docs/CONNECTION_GUIDE.md) includes local examples and the remaining manual steps for hosted ChatGPT. Actual account connection is not claimed until the public HTTPS flow is exercised from the target account.

## Tools and read contract

All inputs are strict objects; unknown properties and numeric strings are rejected. IDs are positive safe integers. Pagination defaults to `limit=50`, `offset=0`; ranges are 1–100 and 0–100000. Each successful result contains the same JSON in text content and `structuredContent`, including explicit `mode` (`mock` or `real`). Tool failures return `isError:true` and `{mode,error:{code,message}}` with sanitized fixed messages.

| Tool | Input | Result |
|---|---|---|
| list_projects | `{limit?,offset?}` | `{mode,projects,total,limit,offset,truncated}` |
| get_project | `{id}` | `{mode,project}`; null if absent |
| list_activities | `{projectId?,limit?,offset?}` | `{mode,activities,total,limit,offset,truncated}` |
| get_activity | `{id}` | `{mode,activity}`; null if absent |
| list_resources | `{limit?,offset?}` | `{mode,resources,total,limit,offset,truncated}` |
| list_activity_types | `{limit?,offset?}` | Visible Activity Type IDs/names for creation |
| list_statuses | `{limit?,offset?}` | Visible Status IDs/names for creation |
| analyze_workload | `{projectId}` | Resource assignment counts, work summaries and coverage warnings |
| create_activity | `{projectId,name,description?,activityTypeId?,statusId?,activityPlanningModeId?,creationDate?,startDate?,endDate?}` | Creates one Activity directly in the enabled mode; requires `mcp:write`. Real writes default planning mode to ID 1 (`as soon as possible`). Optional dates use `YYYY-MM-DD`. |
| delete_activity | `{activityId,confirmed}` | Real Mode only. With `confirmed=false`, verifies and returns the Activity plus confirmation arguments. With `confirmed=true`, deletes it and verifies it is absent; requires `mcp:write`. |

Read tools advertise read-only, non-destructive and idempotent annotations. `create_activity` writes directly. `delete_activity` is destructive, exists only in Real Mode, and enforces a confirmation round trip. Both require `mcp:write` and the local live-write gates.

Public fields:

- Project: `id,name,description,idStatus`.
- Activity: `id,name,description,idProject,idStatus,idResource,idActivityType,creationDate,plannedWork,realWork,leftWork`.
- Activity requested dates: `startDate,endDate` (mapped from ProjeQtOr `initialStartDate,initialEndDate`).
- Resource: `id,name`.
- Assignment (internal only): `id,idProject,refType,refId,idResource,plannedWork,realWork,leftWork`.

Identity/envelope errors and duplicate IDs fail the whole operation. Finite decimal numeric work becomes numbers; missing/blank/null/invalid work remains null. Work units are raw upstream units. Unknown/hidden/credential fields are omitted. Collections are capped at 10,000 rows before local pagination; exceeding the cap returns `UPSTREAM_COLLECTION_LIMIT`, never an incomplete total. `total` is the visible filtered count; `truncated` means another page exists.

## Workload semantics

`analyze_workload` first checks project visibility, then performs one bounded Activity, Assignment and Resource read. It aggregates assignments with `refType=Activity`, a matching project and a visible activity ID. Activity responsible resources and activity-wide work totals are not counted as assignments.

Each assigned resource has `activityIds`, distinct `activityCount`, `assignmentCount`, identity and three summaries: `{total,knownSubtotal,missingCount}`. If any assignment lacks a field, `total=null`; the known subtotal and missing count remain explicit. A resource missing from the visible Resource export has `name=null`, `unknownResource=true`. Decimal sums avoid common floating point addition artifacts; numeric overflow fails explicitly.

The result includes visible activity count, unassigned activity IDs, ignored-assignment count, assignments without a resource and warning codes. Only resources appearing in valid assignments are included. Coverage is limited to visible/returned records; inaccessible assignments, capacity, overload and conversions to hours cannot be inferred.

## Direct Activity creation

Writes default to disabled. To exercise synthetic mock creation, set `ENABLE_WRITE=true` in the mock server's environment before starting it. This flag cannot enable real writes.

Call `create_activity` directly with a visible project, a name (1–200 characters after trimming) and optional description (up to 4000 characters). Optional `startDate` and `endDate` use `YYYY-MM-DD`; when both are provided, `startDate` must not be after `endDate`. Real Mode also requires valid `activityTypeId`, `statusId` and `creationDate` (`YYYY-MM-DD`); `activityPlanningModeId` is optional and defaults to ID 1 (`as soon as possible`). The model can discover type/status IDs with `list_activity_types` and `list_statuses`. OAuth `mcp:write` plus the local write gates authorize creation; no proposal or CLI approval is needed.

The direct path stores an internal operation record, checks project visibility and creates in the same MCP call. Repeating the exact same Real Mode payload within 10 minutes returns the already-created Activity instead of creating a duplicate; older consumed records are pruned so a later intentional duplicate remains possible. An uncertain response is reconciled only when exactly one matching Activity appeared after the pre-submit snapshot; otherwise the retry remains blocked to prevent duplicates. Use `get_activity` or `list_activities` to read the result.

State defaults to `.mcp-state/` beside `package.json`; `MCP_STATE_DIR` may select a private absolute directory. It contains only the internal idempotency journal and mock activities, with no bearer or upstream credentials. Legacy pending/approved proposals are discarded on migration. In-flight legacy writes are retained as uncertain operations to prevent accidental duplicates.

A directory lock serializes server processes, and atomic state replacement records operation transitions. After an abrupt process kill, a remaining `.lock` intentionally blocks updates. Stop every process using that state directory, back up `state.json`, verify no writer remains, then remove only the empty `.lock` directory. Corrupt state fails closed.

## Real adapter and live-write gates

Real reads require `PROJEQTOR_MODE=real`, nonempty `PROJEQTOR_USERNAME/PASSWORD` and an authorized endpoint. The existing default API address is `http://localhost:8080/projeqtor/api/`; tests always replace it with a newly created fake listener. Current user choice keeps live access blocked.

Only absolute HTTP(S) directory URLs are allowed, without embedded credentials/query/fragment. Plain HTTP is loopback-only. Upstream Basic authentication is separate from the MCP bearer; MCP authorization/session headers are never forwarded. Upstream bearer/signature authentication is disabled in this installed ProjeQtOr source. Timeouts cover headers and full body (default 5000 ms, range 10–60000); byte limits cover declared, streamed and decompressed responses (default 1 MiB, range 256 bytes–16 MiB).

GET allowlist: `Project/all`, `Project/{id}`, `Activity/all`, `Activity/{id}`, `Activity/search/idProject=N`, `Resource/all`, `ActivityType/all`, `Status/all`, `Assignment/all`, `Assignment/search/idProject=N`. Local filtering verifies project scope. Redirects, HTTP errors, HTTP-200 error envelopes, HTML, malformed JSON and unexpected structures fail closed. There are no arbitrary URLs/classes/SQL, retries, mock fallback or `index.php?uri=` routing.

Real Activity creation and deletion are disabled unless every independent gate is present. After configuration and restart, ChatGPT can mutate an Activity when its OAuth grant includes `mcp:write`:

```powershell
$env:PROJEQTOR_MODE = 'real'
$env:ENABLE_WRITE = 'true'
$env:ENABLE_REAL_WRITE = 'true'
$env:PROJEQTOR_API_KEY = '<32-hex API key for PROJEQTOR_USERNAME>'
$env:PROJEQTOR_AES_KEY_LENGTH = '256' # must match ProjeQtOr: 128, 192 or 256
```

The API key must belong to the same Basic-authenticated user. Keep it in a secret store or ignored `.env`, never source control or logs. Direct creation requires valid `activityTypeId`, `statusId` and `creationDate` (`YYYY-MM-DD`). Example prompt:

```text
Tạo Activity “Thiết kế cơ sở dữ liệu” trong project 1, dùng Activity Type ID 2,
Status ID 1, ngày tạo 2026-10-28.
```

`create_activity` atomically records the operation before issuing `POST /api/Activity`. The JSON is encrypted in the exact ProjeQtOr/Chris Veness AES-CTR wire format and sent as URL-encoded `data`; Basic authentication identifies the API-key owner. Success requires exactly one `apiResult:"OK"` item with a positive ID and a follow-up `GET Activity/{id}` matching project, name, type, status and creation date. Description is not compared because ProjeQtOr may normalize rich text.

An explicit `apiResult:"KO"` means ProjeQtOr rolled back the transaction and the operation can be attempted again. A timeout, connection loss, malformed response, verification mismatch, or crash after submission leaves an internal uncertain operation. The next identical request automatically reconciles it only when exactly one matching Activity is visible; otherwise it returns `OPERATION_OUTCOME_UNKNOWN` to prevent duplicates.

## Confirmed Activity deletion

`delete_activity` is not exposed in Mock Mode and always requires an explicit `confirmed` boolean. In Real Mode, call it first with `{activityId,confirmed:false}` to validate the positive ID, check visibility/existence, and return the Activity details plus `confirmationArguments`. Show those details to the user and ask for explicit confirmation. Only after confirmation call it again with the returned arguments `{activityId,confirmed:true}`.

The confirmed call repeats the existence check, sends encrypted `{id}` through `DELETE /api/Activity`, requires exactly one `apiResult:"OK"` item, then performs `GET Activity/{id}`. Success returns `{deleted:true,verified:true}` only when the Activity is no longer visible. Explicit access/API rejection returns `UPSTREAM_DELETE_REJECTED`; a transport or verification failure returns a bounded safe error. Inaccessible and absent records both return `ACTIVITY_NOT_FOUND` to avoid claiming existence outside the configured account's visibility.

OAuth scopes protect MCP operations, but the real adapter still uses the server's configured upstream account; per-user upstream credential delegation remains separate work.
