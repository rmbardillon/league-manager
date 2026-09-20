# Basketball League Management System

Monorepo for the Basketball League Management System.

## Structure

- `src/` — Node.js + TypeScript + Express backend (API, services, pure domain logic, repositories).
  - `src/db/` — PostgreSQL access layer via Drizzle ORM and migration tooling.
- `web/` — React + TypeScript frontend (Vite).
- `drizzle/` — generated SQL migrations (created by `npm run db:generate`).

## Tech stack

- Backend: Node.js, TypeScript, Express
- Database: PostgreSQL via Drizzle ORM
- Frontend: React, TypeScript, Vite
- Testing: Vitest (unit/integration) + fast-check (property-based)
- Tooling: ESLint (flat config) + Prettier

## Getting started

```bash
npm install
cp .env.example .env   # set DATABASE_URL (defaults already match docker-compose)
```

## Run locally

Requires Docker + Docker Compose and Node 22.

```bash
# 1. Start PostgreSQL (waits until healthy). Matches DATABASE_URL in .env.
#    Host port is 5433 (mapped to the container's 5432) to avoid clashing with
#    a native Postgres on 5432.
docker compose up -d

# 2. Apply migrations.
npm run db:migrate

# 3. Create the first admin user (idempotent — safe to re-run).
npm run db:seed

# 4. Start the backend API (http://localhost:3000).
npm run dev
```

Environment is loaded from `.env` at startup via Node's built-in
`process.loadEnvFile()` (see `src/loadEnv.ts`), so `DATABASE_URL`, `PORT`, and
the `SEED_ADMIN_*` variables are all honored without any extra dependency.

### Seeded admin credentials

`npm run db:seed` creates an `Administrator` user from `SEED_ADMIN_USERNAME`
(default `admin`) and `SEED_ADMIN_PASSWORD` (default `admin123`). Change the
password after first sign-in, or set `SEED_ADMIN_PASSWORD` in `.env` before
seeding.

### Verify sign-in

```bash
curl -s http://localhost:3000/health
# -> {"status":"ok"}

# Sign in, saving the session cookie to cookies.txt
curl -s -c cookies.txt -X POST http://localhost:3000/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# Resolve the current principal using the saved cookie
curl -s -b cookies.txt http://localhost:3000/auth/me
```

### Run the web app against the API

The SPA sends `credentials: 'include'` and resolves requests against
`VITE_API_BASE_URL` (defaulting to same-origin). To avoid cross-origin cookie
issues in development, either:

- Point the web app directly at the API by setting `VITE_API_BASE_URL=http://localhost:3000`
  in `web/.env`, or
- Add a dev proxy in `web/vite.config.ts` that forwards `/auth`, `/teams`, etc.
  to `http://localhost:3000` (keeps requests same-origin).

Then run the web dev server:

```bash
npm run dev --workspace web   # http://localhost:5173
```

To stop the database: `docker compose down` (data persists) or
`docker compose down -v` (deletes all data).

## Common scripts (run from repo root)

| Command | Description |
| --- | --- |
| `npm run typecheck` | Type-check backend and web |
| `npm run build` | Build backend and web |
| `npm test` | Run backend tests (Vitest) |
| `npm test --workspace web` | Run frontend tests (Vitest) |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |
| `npm run dev` | Run the backend in watch mode |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Create the first admin user (idempotent) |
