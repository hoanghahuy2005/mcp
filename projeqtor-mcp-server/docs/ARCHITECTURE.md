# Architecture

Updated 27/10/2026, Asia/Saigon. This describes the implemented local server.

## Data path and modules

MCP host → HTTP bearer/Host/Origin boundary or stdio process boundary → strict tool schemas → read/workload/activity services → explicit mock client or allowlisted REST client → existing ProjeQtOr API.

| Module | Responsibility |
|---|---|
| `src/config.ts` | Validated immutable environment configuration; mock by default, writes disabled, bounded tokens/URLs/timeouts/response sizes |
| `src/index.ts` | Process startup, HTTP/stdio choice and graceful shutdown |
| `src/server.ts` | Read tools plus direct create when a workflow is supplied; strict Zod schemas, annotations, matching text/structured outputs and sanitized errors |
| `src/transports/http.ts` | Loopback listener, exact Host/Origin, per-request bearer, size/time bounds, health and SDK transport |
| `src/clients/read.ts` | Common normalization, duplicate identity/collection checks, local filtering and pagination; complete bounded internal reads for workload |
| `src/clients/rest.ts` | Fixed read routes plus encrypted Activity POST/DELETE, upstream Basic Auth, full-body timeout, streamed/decompressed bounds, no redirects/retry/fallback |
| `src/clients/mock.ts` | Synthetic fixtures plus persisted locally created mock activities |
| `src/domain/*` | Public DTOs, raw work conversion, fixed safe errors, strict operation/state schemas and canonical payload hashing |
| `src/services/workload.ts` | Visible project/Activity/Assignment aggregation, exact decimal summation, partial-data and coverage reporting |
| `src/services/state.ts` | Bounded local state, cross-process directory lock, atomic state replacement |
| `src/services/activity-workflow.ts` | Direct creation, confirmed Real Mode deletion, verification and uncertain-result reconciliation |
| `src/logging.ts` | Fixed-field JSON events on stderr only |

Both process entrypoints expose the same write-tool catalog. The exported server factory omits write tools when used without a workflow; `delete_activity` is additionally omitted outside Real Mode. Both actual transports share the configured client/workflow across handler instances; state persists independently across processes.

## Authentication and upstream access

HTTP MCP uses a configured static bearer independent of upstream Basic credentials. Hash comparison is timing-safe. Host and Origin checks precede handling, including health. Stdio trusts the local host's process boundary and requires no HTTP token. A single upstream account is configured per process; there is no user database, login/session endpoint, OAuth or role/scope service.

REST permits only Project, Activity, Resource and Assignment GET routes. Numeric selections are built internally from validated IDs. Upstream API identity/permissions remain authoritative. No direct database access, authentication changes or ProjeQtOr modifications are needed. Redirects and malformed/error responses fail closed; Real Mode never substitutes fixtures. An upstream failure aborts workload rather than presenting missing permission as an empty complete result.

Only positive safe IDs identify rows. Unknown fields are stripped; optional invalid/blank values become null. Public names/descriptions are data and never instructions or logs. Collections are capped at 10000 rows before pagination; duplicate IDs fail instead of double-counting.

## Workload

`analyze_workload{projectId}` checks project visibility, then fetches bounded visible activities, assignments for that project and resources. Only assignments linked to visible activities with matching project and `refType=Activity` contribute. Count distinct activities per resource while summing each distinct assignment's raw work. Activity responsible-resource IDs and activity-level work are never substitutes.

Report assigned resources only, explicit unassigned activity IDs, missing-resource assignments, ignored references and coverage warnings. Each work summary has `total`, `knownSubtotal`, `missingCount`; any missing field makes the total null. Resource identities omitted from the Resource export retain an unknown name. Decimal representations are summed before conversion; overflow fails explicitly. No capacity/overload inference or conversion to hours occurs. Inaccessible assignments cannot be reconstructed.

Installed-source evidence from the original survey remains applicable: `jsonDumpObj` does not run the UI work-unit conversion in GeneralWork; Assignment save calculations do not authorize reconstruction of missing exported fields.

## Direct creation and persistence

`create_activity` validates the visible project and strict creation payload, including optional requested `startDate`/`endDate` values, then performs the write in the same authenticated MCP call. Real payloads additionally require activity type, status and creation date. There is no preview tool, proposal state, expiry or local approval command.

Mock create checks the startup write setting and atomically persists a synthetic activity. Real create requires both write gates and AES/API-key configuration. Before POST it records a hash-bound `submitting` operation to serialize identical calls. It encrypts and posts one Activity, verifies the returned positive ID through GET, then marks the operation consumed. Repeated identical calls return the verified Activity. Ambiguous outcomes are reconciled automatically only when exactly one matching Activity is visible; otherwise they remain blocked to prevent duplicates.

## Confirmed deletion

`delete_activity` is Real Mode only and requires `mcp:write`, both live-write gates, and the configured AES/API key. An unconfirmed call validates visibility and returns the Activity without mutation. A confirmed call rechecks existence, sends an encrypted ID to `DELETE /api/Activity`, and reads the same ID afterward. It reports success only when the Activity is absent. The tool is annotated destructive and rejects invalid IDs, invisible/missing records, explicit API rejection, and unverifiable outcomes with fixed safe errors.

State uses trusted local configuration, defaults to package `.mcp-state/`, contains no credentials and has caps of 1000 operation records/1000 created activities/16 MiB. Version-1 pending/approved proposals are discarded during migration; in-flight records become uncertain operations. Atomic rename/locking is not a production database or a guarantee against power failure. A stale lock is not automatically stolen; recovery instructions are in README.

## Deferred boundaries

Real encrypted Activity POST and DELETE are implemented and tested only against isolated loopback doubles plus the installed AES compatibility vector; no automated test mutates live ProjeQtOr. Live permissions, operator authorization, backup/recovery and reconciliation of uncertain results remain deployment responsibilities. PUT, per-user upstream identity, public TLS, rate limits and production-grade operational storage remain deferred. Host account configuration and actual ChatGPT/Codex connection are outside this package change.
