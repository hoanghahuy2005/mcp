# QA status — 27/10/2026

The takeover agent completed and ran the local/synthetic acceptance. `npm.cmd run verify` exited 0: 81 unit + 18 inherited helper + 4 foundation + 26 API-read + 3 workload/workflow integration = 132 PASS, 0 FAIL, 0 SKIP, plus SDK HTTP/stdio legacy/modern and Inspector list/call smoke PASS.

The original independent foundation/API-read suites below were retained and executed; API discovery was updated to assert all eight implemented tools, six read annotations and no approval tool. New workload/workflow tests were authored and run by the implementation agent and are not a new independent QA review. Workload uses the original hand-calculated oracle; HTTP/stdio/CLI integration verifies cross-process single-consumption, persistence and zero real writes.

Current authority: ACCEPTANCE_REPORT.md, TEST_PLAN.md and HANDOFF.md. Live ProjeQtOr reads, project existence, real writes, actual user account connection and hosted OAuth remain unverified/deferred. No live upstream call or credentials discovery occurred in takeover.

The historical 22/10 report follows unchanged. Its awaiting-readiness and NOT RUN statements describe that earlier handoff, not the current acceptance.

---
# QA report and independent acceptance contract

Owner: Sub-agent 2, QA Engineer & Security Reviewer. Updated: 2026-10-22, Asia/Saigon.

## Current verdict

Q1 and M1: DONE, accepted by Main. Independent QA M1 HTTP foundation subset: **PASS**, 4 tests passed, 0 failed/skipped/cancelled, runner exit 0. Main reported independent `npm test` 40 PASS, smoke including Inspector + HTTP/stdio legacy/modern exit 0, and its rerun of QA foundation 4 PASS/0 skips. M2 five-read-tool test implementation is authorized and prepared; dependent M2 product execution is **NOT RUN**, awaiting concrete readiness. M3 is not authorized yet. Live authenticated ProjeQtOr reads, verification of `QLDA_Nhom9`, and real writes remain BLOCKED by the user's explicit Mock Mode choice. No credentials discovery, live ProjeQtOr API request or ProjeQtOr write was performed.

QA owns exactly `tests/integration/**` and this report. Main owns PLAN/ARCHITECTURE/TASKS/TEST_PLAN; Backend owns src/package/scripts/unit tests/fixtures. Those files are read-only to QA. No subagents are spawned.

## Immediate findings for Main and Backend

| ID | Source evidence | Required implementation/test consequence |
|---|---|---|
| API-01 | Parent `api/index.php:69-93`: Basic/Apache identity precedes an `else if (0)` branch | Upstream Basic authentication and local MCP bearer authentication are separate. Bearer/API-key and Signature upstream support must not be advertised as verified. |
| API-02 | `api/index.php:321-340`, `tool/jsonFunctions.php:483-554` | GET envelope is `{identifier:"id",items:[...]}`, including single-ID lookups; ordinary IDs, zeroes and decimals are strings. Flattened PlanningElement fields share the object level. Never treat string `"0"` as missing or string `"1"` as a resource name. |
| API-03 | `api/index.php:520-522` | `returnError()` neither sets a failure HTTP status nor safely composes JSON: `json_encode($message)` is wrapped in additional quotes. Exercise both valid HTTP-200 error envelopes and source-shaped malformed JSON. Neither can become successful empty lists or mock fallback. |
| API-04 | `api/index.php:294-308` | `/search` concatenates SQL-like path criteria. Only internally constructed criteria from validated positive integer IDs are acceptable; never expose raw SQL, arbitrary classes, URLs or query paths to tools. GET can trigger Cron actions, so HTTP GET alone is not a read-only boundary. |
| API-05 | `api/index.php:311-335` | Access restrictions are enforced upstream; Assignment is specially handled. Aggregate only assignments linked to visible, in-scope activities, and expose gaps rather than trying alternate privileged routes. |
| API-06 | `model/Assignment.php:37-42,65-68,364` | Assignments contain `idProject`, `refType`, `refId`, `idResource`, `plannedWork`, `realWork`, `leftWork`. Count distinct Activity IDs per resource while summing each distinct assignment's values. Do not substitute an Activity's responsible resource or Activity-wide work totals. |
| API-07 | `tool/jsonFunctions.php:516`, `model/GeneralWork.php:244-304` | JSON dumping does not call displayWork; UI conversion has separate configuration. Label totals raw upstream work units; no claim of hours, capacity or overload without verified configuration. |
| API-08 | `api/index.php:353-367,394-401` | Writes require AesCtr-encrypted `data` using the user's API key and configured AES length. A plain JSON POST is not established. Real create must remain blocked before sending any POST/PUT/DELETE, regardless of ENABLE_WRITE. |
| SEC-01 | Main ARCHITECTURE and TEST_PLAN | Exact Host and Origin checks must run before handling MCP GET/POST/DELETE. Untrusted Origin should produce 403; local bearer/session IDs must never reach upstream. Redirects must fail without forwarding Basic credentials. |
| SEC-02 | Main approval contract | A model-controlled `approval=true`, payload field or tool cannot grant human approval. Bind a local approval to an immutable proposal/hash, expiry and single-use atomic claim. Consumed or uncertain results must not be retried as a new write. |

Source excerpts were read independently, not inferred from the earlier general source overview. Main verified installed versions `@modelcontextprotocol/server=2.3.1`, `@modelcontextprotocol/node=2.1.1`, Inspector `2.12.0`, and reported `npm audit --omit=dev` with 0 vulnerabilities. QA independently exercised the built HTTP server as recorded below; Inspector and dependency audit were not executed by QA.

## Independent acceptance matrix

| Gate | Cases and observable evidence | Status |
|---|---|---|
| M1 transport | Loopback startup; minimal health; real JSON-RPC initialize/initialized/tools/list/list_projects using JSON or SSE; valid session/version propagation; read-only annotation; explicit mock mode | PASS: isolated mock HTTP foundation subset; no claim both response formats occurred in product run |
| Transport security | Missing/wrong bearer; Host suffix/extra port/hostile Host; hostile, `null`, suffix and malformed Origin; forged forwarding headers; GET/POST/DELETE; invalid JSON, body limit, unknown tool, strict extra-property rejection | PASS for 6 auth and 15 hostile Host/Origin probes, unknown tool and 4 extra-property inputs; extra-port/forwarding/malformed JSON/body limits not executed by QA yet |
| Read tools | M2: five foundational reads; M3: workload. Valid/invalid IDs; project isolation; bounded output and explicit truncation; no secret/unexpected fields in structuredContent or text | M2 five-tool tests prepared; no dependent run; workload remains M3 |
| Fake upstream | Verify actual Basic header/method/path; string-valued envelope; empty lookup; 401/403/500; HTTP-200 error; malformed source error, HTML, invalid JSON, unexpected structures; delayed/large/chunked responses; redirect sink receives zero credentials/requests | M2 tests/runner prepared; helper self-tests PASS; product NOT RUN |
| No fallback | Start actual backend Real Mode against QA fake only; each upstream failure must produce tool error and mode evidence, never fixture `QLDA_Nhom9` success; zero unexpected routes/writes | M2 tests prepared; awaiting readiness |
| Workload | Shared and repeated assignments, unassigned activities, other project/class, missing resource, zero, decimals, blanks/null/missing/invalid numbers, all-missing and partial totals; assignment API failure and truncated source disclose incompleteness | Independent oracle prepared; await M3 output schema |
| Preview/write | Observe zero upstream writes on preview and blocked create; default write-off; forged approval; tampered/unknown/expired proposals; local approval integration; replay and concurrent claims; real create always hard-blocked | Await M4 contract; live writes BLOCKED |
| stdio | Official client initialization/list/call and clean newline JSON-RPC stdout; stderr redaction and graceful cleanup | Entrypoint known; QA not run; Main independently checking smoke |
| Inspector | Actual installed Inspector CLI tools/list and tools/call with authentication retained; exact commands/version/exit codes | Installed version Main-verified; Main checking CLI; QA not run |
| Handoff | Synthetic canary leakage checks on outputs/logs; `.env.example` placeholders and ignore rules; install/build/unit/integration evidence; parent source unchanged | Await implementation |

## Independent workload oracle

QA dataset lives only in `tests/integration/support/source-contract.mjs`. It is synthetic, including its project named `QLDA_Nhom9`; that name is not live verification. Visible project 9 has activities 101, 102, 103. Activity 103 has a responsible resource but no assignments and must remain unassigned.

- Resource 11: assignments 201/202 to activity 101 and 203 to activity 102; distinct activity count 2, assignment count 3; planned known subtotal 4 with one missing, real total 0.75 with none missing, left known subtotal 3.25 with one missing. Complete planned/left totals must not be represented as 4/3.25 without an explicit partial-data marker.
- Resource 12: assignment 204 to activity 101; count 1; planned/real/left = 4/1/3. Activity 101's synthetic work totals 999 must not enter either resource total.
- Resource 13: valid assignments 208/209 to 102, absent from resource list; preserve resource ID, count 1, and mark unknown name. Work fields are all missing/invalid, so known subtotal 0 and total null, not a complete zero.
- Ignore 205 (other project/activity), 206 (`Meeting` with a colliding refId), and 207 (unseen Activity). Missing workload includes blank strings, null, omitted fields and invalid nonnumeric values. Do not derive missing plannedWork from realWork + leftWork.

## Handoff contract required before dependent execution

Backend/Main should provide: M1 readiness; locked package/Inspector version; build command and HTTP/stdio entrypoints; exact environment names for mock/real, bearer, Host/Origin, port and base URL; health shape and tool input/output schemas; expected session behavior. Later provide timeout/response-size controls, pagination/truncation output, preview proposal fields/TTL and human-only approval command/store. QA will adapt only QA-owned tests. Initial foundation tests are explicitly opt-in (`QA_RUN_M1=1`) and must not be called accepted merely because they skip.

Main's additional source finding: ActivityMain requires `name`, `idProject`, `idActivityType`, `idStatus`, `creationDate`. Preview must show these supplied or resolved fields and validate visible project/type/status references; a preview of only name/project cannot establish a valid future write payload. QA data includes these fields on scoped activities. Zero upstream POST/PUT/DELETE is the required assertion for preview and hard-blocked Real Mode create.

## Commands and evidence

Read PLAN, ARCHITECTURE, TASKS and TEST_PLAN fully. Independently read parent API, jsonDumpObj, Assignment and GeneralWork source. Node observed: v24.15.0. Only helper self-tests may execute before M1; product integration is intentionally pending. No npm installation or backend script changes are performed by QA in this initial task.

Executed initial QA verification:

| Command/check | Result | Evidence scope |
|---|---|---|
| `node --test tests/integration/harness.test.mjs` | Exit 0; 16 tests passed, 0 failed/skipped/cancelled; 381.4247 ms | Independent fake upstream, string envelopes, route/auth recording, failure scenarios, bounds/timeout, non-followed redirect, JSON/SSE helper and session negotiation only |
| `node --check tests/integration/foundation.test.mjs` | Exit 0 | Syntax check only; foundation tests were not executed against Backend |
| Rehash three selected parent source files | All three match the recorded baseline | No changes to these selected files; no assertion about a full parent-tree snapshot |

M1 schema assertions explicitly check the advertised object schema has `additionalProperties: false` and independently reject each of `qaUnexpectedProperty`, `rawSql`, `upstreamUrl`, `approval`; the suite is still gated and unexecuted against Backend. Resource 11's prose/oracle now both use left known subtotal **3.25** (2 + 1.25).

Initial QA files: `tests/integration/README.md`, `foundation.test.mjs`, `harness.test.mjs`, `support/mcp-http.mjs`, `support/fake-upstream.mjs`, `support/source-contract.mjs`, and this report. Next action: await Main's concrete M1 handoff before dependent execution. No actual product defect or product PASS is asserted from harness self-tests.

Main independently reran all 16 harness self-tests (0 failures/skips), reviewed the artifacts and accepted Q1 DONE. Subsequent skeleton handoff establishes mock environment names and `node dist/index.js` / `--stdio` entrypoints, but Main explicitly has not authorized dependent test execution yet. `tests/integration/run-foundation.mjs` is prepared as an optional gated launcher using an isolated token/port and exact loopback Origin. It forces Mock Mode and `ENABLE_WRITE=false`, never inherits upstream credentials or loads `.env`, performs no build/install and cleans up only children it started. No additional helper expansion or dependent execution is performed. Actual runner startup/cleanup remains unverified until Main's readiness gate.

Preparation checks after skeleton handoff: `node --check tests/integration/run-foundation.mjs` and `node --check tests/integration/foundation.test.mjs`, both exit 0 (syntax only). Foundation response assertions now match Main's concrete `{mode,projects,total,limit,offset,truncated}` contract with default limit 50/offset 0. No dependent test was run.

## Authorized M1 HTTP execution evidence

Main subsequently authorized the isolated product run after `dist` existed, explicitly as M1 pre-acceptance verification, not an M2 gate. Backend ownership had transferred from Hilbert to Mendel without overlapping backend writers. QA did not change backend source/package/scripts or rebuild/install anything.

Executed from the MCP project root:

```powershell
$env:QA_RUN_M1 = '1'
node tests/integration/run-foundation.mjs
```

Observed isolated endpoint: `http://127.0.0.1:58391`. Runner generated its own token, forced `PROJEQTOR_MODE=mock`, one exact loopback Origin and `ENABLE_WRITE=false`, and launched the existing `dist/index.js` directly without loading `.env` or inheriting upstream credentials.

```text
M1 blackbox transport and boundary acceptance
  PASS missing/wrong bearer rejected on POST, GET and DELETE
  PASS hostile Host/Origin rejected before MCP processing
  PASS initialize, list tools and call list_projects over actual HTTP
tests 4; pass 4; fail 0; skipped 0; cancelled 0; todo 0
test duration_ms 239.1768
runner command exit code 0; wall time 2.7807346 seconds
```

The three nested cases and parent case yield Node's 4-test total. Boundary loops exercised 6 missing/wrong-token probes and 15 hostile Host/Origin probes across POST/GET/DELETE. Protocol assertions covered initialize/initialized, discovery, read-only annotation, strict advertised object schema, successful mock project list, default limit 50/offset 0, total/projects/truncated shape, unknown tool and individual `qaUnexpectedProperty`, `rawSql`, `upstreamUrl`, `approval` argument rejection. Health and tool output did not contain the generated bearer token. The HTTP helper propagates negotiated version/session if supplied; this run does not independently establish both JSON and SSE product response formats or all possible stateful behaviors.

Cleanup diagnostic after runner exit:

```powershell
$qaListeners = @(Get-NetTCPConnection -LocalPort 58391 -State Listen -ErrorAction SilentlyContinue)
[pscustomobject]@{Port=58391; ListeningAfterRunner=$qaListeners.Count} | ConvertTo-Json -Compress
```

Result: `{"Port":58391,"ListeningAfterRunner":0}`, exit 0. The runner terminated its backend child; no listener remained on that isolated port.

Defects found in the executed M1 subset: **none**. No product code changes or test-assertion relaxations were needed. Remaining coverage is explicitly pending in the acceptance matrix; Inspector/stdio/build/unit evidence belongs to Main's independent run. Await Main's milestone verdict and subsequent authorization before M2-dependent integration.

## M2 preparation after Main accepted M1

Main accepted M1 with its independent 40-unit-test build run, Inspector/HTTP/stdio smoke and 4-test rerun of QA foundation. Main then authorized implementing independent M2 tests, while withholding dependent product execution until Backend is ready. Five tools are in scope: `list_projects`, `get_project{id}`, `list_activities{projectId?,limit?,offset?}`, `get_activity{id}`, `list_resources{limit?,offset?}`. Workload belongs to M3; write/approval methods must not exist at M2.

Added QA-owned `api-read.test.mjs`, `run-api-read.mjs`, and `support/m2-process.mjs`; extended only QA's fake upstream and its independent self-tests. No Backend files or Main documents were edited. The gated runner is `QA_RUN_M2=1` then `node tests/integration/run-api-read.mjs`. It creates the upstream itself on a random loopback port, supplies fixed synthetic Basic credentials to the actual Real Mode adapter, generates a separate MCP bearer and forces `ENABLE_WRITE=false`. No live URL/credentials are accepted from caller environment; no `.env` is loaded and no build/install is performed.

Prepared blackbox assertions:

- Exactly five read-only tools, strict object schemas, default 50/0 pagination, supplied list/get envelope shapes, string numeric IDs/status/project IDs normalized and Unicode preserved.
- Observe actual GET/allowlisted path/exact Basic auth; project filter before pagination, total/truncated consistency, empty lists and absent records. No invented upstream pagination query contract.
- Validate IDs including unsafe integers, project filter strings, pagination and individual model-controlled fields before any upstream request.
- Strip secret/hidden/unexpected fields from both structured and text output; scan captured backend logs and health using synthetic canaries (MCP token, upstream username/password, Basic token and injected secret).
- For every read tool: 401/403/500; HTTP-200 error and source-malformed error; HTML/invalid JSON/wrong envelope/identifier/item; secret-bearing error; delayed headers/body; valid but oversized regular/chunked JSON; redirect/disconnect; final connection-refused state. Require tool errors without successful mock fixture records.
- Redirect sink receives zero requests; all fake-upstream observations must remain authenticated allowlisted GET. Oversized payload uses unknown padding on valid records so stripping extra fields cannot hide missing byte limits. Teardown closes client before backend, scans logs and cleans fake/sink even after assertion failures.

Pending exact-contract reconciliation: test environment uses timeout 250 ms and max response 8192 bytes; Backend should confirm accepted ranges. Tool records assume normalized source-style `id`, `idStatus`, `idProject`. Until final not-found contract is documented, the test accepts either an explicit null record in a real-mode envelope or a tool error for an unknown ID; it never accepts a fabricated record. No product code defect is asserted before implementation review/run.

Preparation verification actually executed:

| Command | Result | Scope |
|---|---|---|
| `node --test tests/integration/harness.test.mjs` | Exit 0; **18 PASS, 0 FAIL, 0 SKIP**, 367.0973 ms | QA fake/protocol helper self-tests only; includes new adversarial envelope/canary, chunked bytes, slow body and disconnect sources |
| `node --check` on `api-read.test.mjs`, `run-api-read.mjs`, `support/m2-process.mjs`, `support/fake-upstream.mjs` | All exit 0 | Syntax only; no backend started |

M2 product execution and verdict: **NOT RUN — awaiting readiness**, as explicitly instructed by Main. Live ProjeQtOr remains BLOCKED; M3 work has not started.

Source baseline SHA256 (before QA changes; selected read-only files, not a full parent-tree integrity proof):

```text
api/index.php          9CBB36F5A2E6ABDCD46F2060A0E7515796D4E240299BBFC02471DAE7B7CA3450
tool/jsonFunctions.php 8669D9EA7CF59CEC73B6EBBA55AA2902BCD269366C63B4FD3E02DA67C27BC5BE
model/Assignment.php   1933B5E38B5E8D98AC83DA7182A934730270DB2536C8839BBBE3C1872D1F1ABA
```

Protocol research: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), checked 2026-10-22. Initial harness sends the negotiated version, supports JSON and SSE results, propagates a returned session ID, and treats protocol failure separately from tool `isError`. These probes complement, rather than replace, Main's official SDK and real Inspector checks.

