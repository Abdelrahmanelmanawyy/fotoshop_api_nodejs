# Fotoshop API (Node.js) — engineering rules

This file mirrors **Section A — General Engineering Rules** from the repo root `CURSOR.md`, translated for this Node.js service.

## Layer mapping

| Concept (Section A) | Node.js location |
|---------------------|------------------|
| Presentation (HTTP, no business rules) | `src/presentation/` |
| Business logic | `src/domain/` |
| External I/O (APIs, DB, storage) | `src/data/` |
| Shared utilities used in 2+ places | `src/core/` |
| Env, Firebase bootstrap | `src/config/` |
| Wiring domain ↔ data | `src/composition/` |

## Rules (same intent as Section A)

1. **Architecture** — Routes only parse/validate input, call use cases from `domain` (via `composition`), and map results to HTTP. Domain does not import `firebase-admin`, `axios`, or `replicate` SDK; it receives I/O via injected dependencies from `composition`.
2. **Shared code** — Reuse via `src/core/`; do not duplicate validators/helpers across routes.
3. **Errors** — Map/transform errors at the **data** boundary where external calls happen; domain throws for rule violations; presentation maps to HTTP status without leaking internals in production (messages can stay generic).
4. **Change discipline** — Smallest fix; no unrelated refactors.
5. **Dependencies** — New packages need justification; prefer stable, maintained libraries.
6. **Security** — No hardcoded secrets; never log tokens, cookies, or raw credentials; validate and constrain external input (e.g. `order_id` shape).
7. **Testing** — Unit-test `domain/` (and data adapters where valuable); one behavior per test; deterministic (no real network/Firebase in unit tests).
8. **Workflow** — Align with team PR/review process; PR descriptions in Markdown when applicable.

## Golden test for new rules

Ask: *Would removing this rule cause mistakes on this codebase?* If not, omit it.
