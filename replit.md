# Jungle Rooftop & Lounge

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required environment variables: `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (minimum 12 characters), and `SESSION_SECRET` (minimum 32 characters).
- Vercel setup and deployment steps are documented in `README.md`; the API runs as a serverless function configured by `vercel.json`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/jungle-rooftop` — public menu UI and admin page.
- `artifacts/api-server` — Express API, routes, and admin-session authorization.
- `lib/db` — PostgreSQL schema, Drizzle ORM, and connection pool.
- `lib/api-zod` — shared request/response validation schemas.
- `artifacts/api-server/src/vercel.ts` — Vercel API service entry point; initializes default menu data before serving API requests.
- `vercel.json` — Vercel services, per-service build settings, and public route rewrites.

## Architecture decisions

- Public menu read endpoints remain unauthenticated; all API write methods require a signed, HttpOnly admin session.
- Admin credentials and session signing secret are configured only as server environment variables.
- The Vercel serverless API uses a small PostgreSQL connection pool to reduce connections across function instances.
- Database schema changes are applied explicitly with Drizzle Kit, not during deployment.

## Security and deployment notes

- Set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in Vercel before deploying. Never commit actual values.
- Use a strong, unique admin password and generate a random session secret of at least 32 characters.
- Vercel API JSON requests are limited to 4 MB; menu image data is stored in PostgreSQL.

## Pointers

- See `README.md` for local setup and full Vercel deployment instructions.
