# ProjeQtOr MCP Server — current plan

Updated 27/10/2026, Asia/Saigon. The user resumed implementation on 26/10 and asked the current agent to take over the handoff and finish the server.

## Authorized scope

Complete an independent local Node.js/strict TypeScript MCP package. Preserve the ProjeQtOr distribution, database, Apache authentication and production data. Use loopback HTTP/stdio, explicit Mock Mode and synthetic upstream tests. No OpenAI API is needed.

The previous stop instruction was for the handoff turn and is superseded by the resume request. Earlier Main/Backend/QA role assignments are historical. The current agent implements, reviews and runs the inherited QA suites in one session; new tests are not claimed as an independent QA review. No additional agents were used.

Live reads and real project verification remain blocked by the user's earlier Mock Mode choice. Live writes require separately verified encryption/permissions and explicit authorization. OAuth is implemented and locally verified; public hosting and actual ChatGPT account acceptance remain manual deployment work.

## Completed milestones

| Milestone | Final deliverable | Acceptance |
|---|---|---|
| M1 Foundation | Official installed MCP SDK, strict build, mock, HTTP/stdio, health, bearer/Host/Origin boundary | Rechecked in final verification; inherited foundation 4 PASS and modern/legacy smoke PASS |
| M2 API integration | Five strict read tools; Basic-auth read adapter, allowlisted GETs, normalization, response/time/collection limits, sanitized failures | 26 inherited API-read integration tests PASS; REST unit tests PASS; synthetic upstream only |
| M3 Workload | Sixth read tool; distinct Activity counts, Assignment sums, project visibility/scope, null/partial totals, unknown resources and coverage warnings | 4 workload unit tests plus HTTP oracle integration PASS |
| M4 Mock write workflow | Local expiring preview, human CLI approval bound to payload hash, enabled-only mock creation, atomic persistent state and single consumption | 6 workflow unit tests and HTTP/stdio/CLI integration PASS; 12 in-process and 10 cross-process competing calls each create one activity |
| M5 QA and handoff | One verification command, Inspector proof, security/error regression, connection examples, updated plan/tasks/handoff/acceptance | 132 tests PASS, no fail/skip; six smoke results PASS; npm audit 0 reported vulnerabilities; all 5316 parent source files unchanged |

Implementation order followed M2 verification before workload, then M3 verification before mock writes, then the combined final verification. The takeover first found and fixed a test-helper double-close error; the product read suite already passed its simulated integration.

## Release boundaries and next work

| ID | State | What is required |
|---|---|---|
| L1 live reads | BLOCKED | User elects to enable a specific authorized live endpoint and provides credentials securely; verify visible project and compare read results |
| L2 real create | BLOCKED | Review installed AesCtr/API-key write contract, permissions, approval/replay/uncertain-result behavior; obtain explicit live-write authorization before any POST/PUT/DELETE |
| C1 actual host connection | UNVERIFIED | Apply the provided local connection example in the intended user's host and test discovery/tool calls; no account configuration was changed |
| P1 hosted/production deployment | PARTIAL | OAuth/discovery/state implemented; deploy HTTPS, validate the real login endpoint and complete real ChatGPT refresh acceptance |

OAuth access tokens now carry a user subject and scopes, with persistent rotating refresh tokens. The current upstream account is still configured per server process, so OAuth identity does not yet delegate ProjeQtOr data access as that user. Public deployment must not reuse loopback acceptance as evidence of production readiness.

## Reproduction

Run `npm.cmd run verify` inside the MCP package. It rebuilds and executes the complete local/synthetic suite, generating ignored `.qa-artifacts/verification.json` and individual logs. No credentials discovery, `.env` loading or live API call occurs in the verification runner.

See README for contracts, `ARCHITECTURE.md` for module boundaries, `CONNECTION_GUIDE.md` for host setup and `ACCEPTANCE_REPORT.md` for actual evidence. Parent distribution is not a Git repository; it was not initialized or staged.
