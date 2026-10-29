# Test plan and executed coverage

Updated 27/10/2026, Asia/Saigon. Tests operate only on mock data or synthetic loopback upstreams. `npm.cmd run verify` is the final acceptance command; it clears inherited service credentials and does not read `.env`.

## Runner and evidence

The runner builds first, runs unit/harness/foundation/API-read/workflow suites sequentially, then executes official SDK and installed Inspector smoke checks. It records commands, exit codes, durations and per-step logs in ignored `.qa-artifacts/`. A failed step stops the run and marks the summary FAIL. `npm.cmd run test:integration` executes the four integration/helper stages against an existing build.

Inherited foundation/API-read probes were authored independently before takeover. Current agent reviewed/ran them and updated discovery expectations from five to eight tools. New workload/workflow tests are written and run by the implementation agent; they are not an independent external QA verdict.

## Coverage matrix

| Area | Required assertions | Current evidence |
|---|---|---|
| Configuration | Loopback only, exact origins, valid token/IDs/URLs/limits, immutable config, default mock/writes off, bounded proposal TTL/state path | Unit suite PASS |
| HTTP boundary | Missing/wrong/duplicate bearer; hostile/duplicate Host/Origin; method handling; unknown route/query token; malformed JSON; declared/chunked oversized bodies; safe health/errors | Unit plus 4 inherited foundation tests PASS |
| MCP protocol | Strict advertised schemas, eight tools, six read annotations, no remote approval tool, text/structured result equality, invalid/unknown tool rejection | API-read, workflow and SDK/Inspector smoke PASS |
| Upstream reads | Source string envelopes and normalization, Unicode, filtering before pagination, null not-found, allowlisted Basic GET; no bearer/session forwarding | REST unit plus inherited API-read PASS |
| Upstream failures | 401/403/404/500/503 where applicable; HTTP-200 errors; source-malformed errors; HTML/invalid envelope/identity; duplicates; redirects; refusal/disconnect; headers/body timeout; declared/chunked/decompressed bounds | REST unit and 26 inherited API-read tests PASS; no mock fallback or secret output |
| Workload | Independent hand-calculated QA oracle; shared activity/multiple assignments; distinct counts; raw units; partial/all-missing/zero/decimal work; hidden/unknown resource; cross-class/project/visibility references; missing resource assignment; duplicate IDs and sum overflow | 4 workload unit tests and actual HTTP integration PASS |
| Preview | Strict fields, canonical payload/hash/expiry, visible project, no new activity, real preview only GET | Workflow unit and actual HTTP integration PASS |
| Approval/create | Default disabled; separate local CLI; wrong hash; unapproved/unknown/expired/tampered/consumed proposal; rejection of approval=true/replacement payload; atomic duplicate protection; persisted mock reads after restart | 6 workflow unit tests and HTTP/stdio/CLI integration PASS |
| Concurrency | Independent workflow instances and HTTP process competing with a separate stdio process | 12 unit attempts create once; 10 cross-process calls create once |
| Real-write gate | Create blocks before even upstream reads regardless of enabled write flag; local CLI cannot approve real proposal | Unit and synthetic-upstream HTTP/CLI integration PASS; zero upstream writes |
| Secrets and logs | Fixed sanitized errors/events, synthetic credential/token/hidden-field canaries, stderr JSON and clean stdio stdout | Inherited API-read and SDK smoke PASS |
| Parent integrity | Snapshot parent sources before takeover implementation, compare hashes and path set after | 5316/5316 unchanged; no additions or removals |
| Dependencies | Installed versions and npm advisory database check | npm ls exit 0; npm audit exit 0, 0 reported vulnerabilities |

## Baseline and historical evidence

The original 22/10 survey recorded 5316 files in api/model/tool/view/db/report/sso/plugin plus index.php/readme.txt/license.txt, with manifest digest `0624651F05CF5125F163AB8FAF1C17A940A03D128CF613D00543B6845770BAE2`.

The 26–27/10 takeover captured its own individual absolute-path/SHA256 baseline in `.qa-artifacts/parent-baseline.json` before product-source changes, then compared every file and the path set. `.qa-artifacts/parent-integrity.json` reports 5316 baseline/current files, zero changed/added files and Passed=true. It is a direct before/after integrity check, not a claim that the old manifest's serialization was reproduced.

## Remaining verification gates

No live login/read/project verification, live encrypted write, actual host account connection, remote OAuth or public hosting was tested. Power-loss recovery, network filesystem locking, multiple untrusted local OS users, production concurrency/storage and complete operational hardening are outside local mock acceptance. Do not replace missing verification with inferred success.
