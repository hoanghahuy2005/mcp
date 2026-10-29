# Integration suites

Updated 27/10/2026. All tests are local mock or synthetic loopback integration; they never target the live ProjeQtOr instance or discover credentials.

Run `npm.cmd run verify` for build + unit + all integration + SDK/Inspector checks. Run `npm.cmd run test:integration` against an existing build for the four suites below. Both use a clean environment and save ignored `.qa-artifacts/` evidence.

| Suite | Current result | Scope |
|---|---|---|
| harness.test.mjs | 18 PASS | Inherited independent native HTTP/JSON-RPC/SSE and fake-upstream helper self-tests only |
| run-foundation.mjs / foundation.test.mjs | 4 PASS | Inherited independent mock HTTP boundary, bearer/Host/Origin and list_projects |
| run-api-read.mjs / api-read.test.mjs | 26 PASS | Inherited independent actual REST-adapter integration, five foundational read contracts and eight-tool discovery |
| workflow.test.mjs | 3 PASS | New implementation-agent HTTP workload oracle; local CLI + competing HTTP/stdio mock create and persistence; unconditional real-write blocker |

The first three suites and support fixtures were authored before takeover by independent QA. The new workflow suite imports product entrypoints/official SDK and is not claimed as an independent QA implementation. Workload unit/integration assertions use `support/source-contract.mjs`'s original hand-calculated oracle.

Each runner starts only fresh local listeners and synthetic identities. Real Mode in API-read/workflow tests means the real adapter against a fake upstream. It does not establish actual ProjeQtOr access. `support/fake-upstream.mjs` rejects every write and records method/path/auth-match flags without credential text.

Manual isolated stages (the full runner already supplies these gates):

```powershell
node --test tests/integration/harness.test.mjs
$env:QA_RUN_M1 = '1'
node tests/integration/run-foundation.mjs
$env:QA_RUN_M2 = '1'
node tests/integration/run-api-read.mjs
node --test tests/integration/workflow.test.mjs
```

Foundation/API runners do not build or load `.env`. API-read creates its upstream internally, so no caller-specified live URL is accepted. Full verification clears inherited service credentials. Workflow tests use isolated temporary state directories, inspect/approve only synthetic proposals, start a separate stdio process, and clean only their own verified temporary paths/children.

Six read tools must advertise strict object schemas and read-only annotations. Preview/create are strict, non-read-only and non-idempotent. Preview records only local proposal state; no upstream write. Approval is a local CLI action, never a tool. All real create attempts must fail before any upstream access, regardless of the write flag.

The acceptance gates for live reads, encrypted writes, actual account connection and public/OAuth deployment remain separate. See docs/TEST_PLAN.md, docs/ACCEPTANCE_REPORT.md and docs/HANDOFF.md.
