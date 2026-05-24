# CLAUDE.md

<!--
This file loads into context on EVERY message in this project.
Apply the Golden Test before adding any rule:
"Would removing this cause Claude to make mistakes?" If not — cut it.
Do not restate language defaults Claude already knows. Only write rules
that override defaults or encode decisions specific to this project.
-->

---

# Section A — General Engineering Rules

## 1) Architecture & Separation of Concerns (YOU MUST FOLLOW)
- Follow strict layer boundaries: routes/controllers → services (domain) → repositories (data)
- Controllers handle HTTP concerns ONLY: parse input, call service, format response
- Business logic lives in services — never in controllers or repositories
- Database queries and external API calls live in repositories
- Never bypass layers or mix responsibilities

## 2) Shared Code (IMPORTANT)
- Any reusable logic, utility, constant, middleware, or helper used in 2+ places goes in `src/core/`
- Check `src/core/` before creating new shared code — never duplicate across features

## 3) Error Handling
- Throw typed errors (`AppError`, `ValidationError`, `NotFoundError`, etc.) — never raw `Error`
- A single centralized error-handling middleware maps errors to HTTP responses
- Controllers do NOT format error responses themselves
- Catch errors at the boundary (data layer) — never swallow errors silently
- Never leave promises unhandled — always `await` or explicitly handle

## 4) Change Discipline
- Make the smallest change that solves the problem
- Fix root causes, not symptoms
- Don't refactor unrelated code unless explicitly requested
- Never break existing API contracts (request/response shape, status codes) unless instructed
- Read relevant code before modifying it — state assumptions when unclear

## 5) Dependencies
- Don't add new packages without justification
- Any new package must be: latest stable, well-maintained, production-grade

## 6) Security
- Never hardcode secrets, tokens, or credentials — load via env vars through ONE config module
- Never log secrets, tokens, passwords, or PII
- Validate ALL external input (body, query, params, headers) at the controller boundary
- Use parameterized queries / ORM — never string-concatenate SQL
- Apply rate limiting, helmet, and CORS rules at the app entry point
- Proactively flag security risks when spotted

## 7) Testing
- Unit tests for services and repositories (mocked dependencies)
- Integration tests for controllers via supertest or framework equivalent
- Bug fixes must include a reproducing test
- Tests must be deterministic — no flaky or timing-dependent tests
- One behavior per test case

## 8) Workflow (Mandatory)
- Before marking any task done → run the `/code-review` skill
- After task approved → run the `/create-pr` skill for branch, commit, and PR output
- PR descriptions must always be in markdown (`.md`) format

---

# Section B — Node.js / TypeScript Specific Rules

<!--
Follow standard TypeScript + ESLint + Prettier defaults.
Rules below only cover things that OVERRIDE defaults or encode project decisions.
-->

## 1) Language & Tooling
- **TypeScript only.** No plain `.js` source files (config files like `*.config.js` are fine)
- `"strict": true` in `tsconfig.json` is non-negotiable
- No `any` without an inline comment justifying it
- ES modules (`import/export`) only — no CommonJS `require` in source

## 2) Framework & Runtime
- HTTP framework: **Fastify** — do not switch to Express, Koa, or Hapi
- Node.js LTS only — version pinned in `.nvmrc` and `engines` field of `package.json`

## 3) Validation
- Use **Zod** for all runtime validation: request bodies, query params, env vars, external API responses
- Infer types from Zod schemas (`z.infer<typeof schema>`) — never duplicate type definitions

## 4) Database Access
- ORM: **Prisma** — do not use raw drivers, Knex, TypeORM, or Sequelize
- All DB access goes through repositories — services never import Prisma directly
- Migrations are version-controlled; never edit a committed migration — write a new one

## 5) Async & Concurrency
- Always `async/await` — no `.then()` chains in source code
- Use `Promise.all` for independent parallel work — never `await` in a loop when parallelism is possible
- Route handler errors flow to Fastify's error handler — don't catch and re-throw without adding value

## 6) Logging
- Use **Pino** with structured JSON logs — no `console.log` in committed code
- Include request ID and user context in request-scoped logs
- Levels: `error`, `warn`, `info`, `debug` — `info` is for state changes, not hot paths

## 7) Configuration
- All env vars loaded and validated through ONE `src/core/config/` module (Zod-validated at startup)
- No `process.env.X` reads scattered across the codebase
- App must fail to boot if required config is missing or invalid

## 8) Feature Folder Structure
- `src/features/{feature_name}/controllers/`
- `src/features/{feature_name}/services/`
- `src/features/{feature_name}/repositories/`
- `src/features/{feature_name}/schemas/`  (Zod schemas + inferred types)
- `src/core/` — shared infra (config, db client, logger, error classes, middleware, DI)

## 9) Testing Stack
- **Vitest** for unit and integration tests
- Test files co-located: `foo.service.ts` → `foo.service.test.ts`
- Use a dedicated test database or transactional rollback — never run tests against production data
