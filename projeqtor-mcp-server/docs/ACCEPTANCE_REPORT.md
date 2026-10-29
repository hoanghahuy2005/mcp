# Acceptance report

Updated 27/10/2026, Asia/Saigon. The current user request resumed the stopped handoff and authorized completing the local server. M1–M5 are accepted within the mock/synthetic scope below. Live access and production deployment remain separate.

## Final observed result

`npm.cmd run verify` exited 0. All seven stages exited 0; **132 tests passed, 0 failed, 0 skipped/cancelled**, plus successful SDK/Inspector smoke checks. Machine evidence was generated at `2026-10-26T17:01:18.819Z` (27/10/2026, Asia/Saigon) in `.qa-artifacts/verification.json`.

| Stage | Result | Evidence scope |
|---|---|---|
| Strict TypeScript build | Exit 0 | Installed sources compile |
| Unit | 81 PASS | Config/HTTP/mock/REST plus new workload and proposal/state semantics |
| Inherited QA helper harness | 18 PASS | Synthetic/protocol helpers only; not counted as separate product proof |
| Inherited QA foundation | 4 PASS | Actual authenticated loopback MCP boundary and tool invocation |
| Inherited API-read | 26 PASS | Actual Real Mode adapter against fresh synthetic upstream; five foundational read contracts and complete eight-tool discovery |
| New workload/workflow integration | 3 PASS | HTTP workload oracle; HTTP + local CLI + separate stdio process competition/persistence; unconditional real-write block |
| SDK and Inspector smoke | Exit 0; six PASS results | HTTP legacy/modern, stdio legacy/modern, Inspector tools/list and tools/call |

The final suite's real-mode endpoint was created by the tests and required only synthetic credentials. No live ProjeQtOr login or request occurred during takeover. Inherited QA suites were executed by the current agent; new tests were not independently reviewed by another QA agent.

## Changes and review

- Fixed the inherited unit fake-server cleanup to avoid closing an already closed server. The first takeover run built successfully and reported 70/71 tests, with the sole failure in cleanup, not the product adapter. Subsequent read acceptance passed.
- Added complete bounded internal Activity/Resource reads and `analyze_workload`, using visible Activity assignments, distinct counts, explicit partial/null work and exact decimal summation. The independent QA fixture/oracle matches observed totals, including resource 11 known left-work subtotal 3.25.
- Added strict activity proposal/state types, random IDs, canonical SHA-256 payload binding, expiry and a separate local CLI. Mock creation consumes approval and persists the activity in one locked atomic update. Concurrent unit calls (12) and cross-process HTTP/stdio calls (10) each produce exactly one activity. Restarted clients/processes read the same created record.
- Real create rejects before any upstream read/write even with ENABLE_WRITE=true. Real proposals cannot be approved through the CLI. No REST write implementation or approval MCP tool exists.
- Added isolated full verification, updated eight-tool smoke/discovery, connection examples and current plan/tasks/handoff. Preview is correctly annotated non-read-only because it saves local proposal state while sending no upstream write.

## Dependencies and security checks

`npm.cmd ls --depth=0` exited 0: MCP server/client 2.3.1, Node adapter 2.1.1, Inspector 2.12.0, TypeScript 5.9.3, @types/node 24.19.2, Zod 4.6.7. No dependency installation or upgrade was performed in takeover.

The initial restricted npm audit request failed to reach the registry. The approved retry `npm.cmd audit --json --cache .npm-cache --fetch-retries=0 --fetch-timeout=15000` exited 0 with no reported vulnerabilities (161 reported dependency entries). This is an advisory-database result at execution time, not a complete application security guarantee.

Source review confirms upstream requests are internally allowlisted GETs only; credentials do not enter tool inputs, public DTOs or logs; real mode cannot fall back to fixtures. Mock writes are disabled by default. Local approval trusts the local OS user; it is not a production authorization service. The bounded local state is not a production database.

## Parent source integrity

A before/after SHA256 and file-set comparison covers 5316 existing parent source files. Result: 5316 current files, 0 changed, 0 added, 0 missing. `.qa-artifacts/parent-integrity.json` records Passed=true. All edits in this takeover are inside `projeqtor-mcp-server/`; no PHP/DB/Apache changes, repository initialization or commit occurred.

## Explicitly unverified / deferred

- Live authenticated reads, actual QLDA_Nhom9 existence and upstream permissions; user's earlier Mock Mode choice remains in force.
- Real encrypted writes, API-key/AesCtr contract and explicit live-write authorization.
- Actual Codex/ChatGPT account connection. Documentation/examples were prepared; user configuration was not edited.
- Remote HTTPS/OAuth, per-user mapping/scopes, production persistence, network filesystem/power-loss behavior and public deployment.

These are release boundaries, not successful implementation claims. Current code is accepted for local Mock Mode and synthetic REST integration only. Read `PLAN.md` for the separate gates to extend that scope.
