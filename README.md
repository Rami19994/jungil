# Jungle Rooftop & Lounge

A responsive digital menu experience for Jungle Rooftop & Lounge, organized as a pnpm workspace. The current menu application is a Vite/React frontend in `artifacts/jungle-rooftop`.

## Requirements

- Node.js 24 or newer
- pnpm

## Getting started

From the repository root:

```sh
pnpm install
pnpm --filter @workspace/jungle-rooftop dev
```

Vite prints the local URL when the development server starts. To create a production build of the menu:

```sh
pnpm --filter @workspace/jungle-rooftop build
```

To type-check the workspace:

```sh
pnpm run typecheck
```

The workspace also contains an Express API in `artifacts/api-server`, shared database/API packages in `lib`, and a separate UI mockup in `artifacts/mockup-sandbox`. The API service uses PostgreSQL and requires `DATABASE_URL`; configure it through a local environment file that is not committed.

## Deploy on Vercel

1. Create a hosted PostgreSQL database and set `DATABASE_URL` in Vercel for Production and any Preview/Development environments that should use a database.
2. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD` (at least 12 characters; a long, unique password is recommended), and `SESSION_SECRET` (at least 32 characters) in Vercel's Environment Variables. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
3. Before the first deployment, apply the database schema from a trusted machine with `pnpm --filter @workspace/db push` and `DATABASE_URL` set in that shell. Do not run schema changes automatically during every deployment.
4. Import this repository into Vercel. `vercel.json` defines separate `api-server`, `jungle-rooftop`, and `mockup-sandbox` services. The public menu and `/admin` are served by `jungle-rooftop`; `/api/*` is routed to `api-server`, and API writes require the server-side admin session. `mockup-sandbox` remains internal unless a public rewrite is explicitly added for it.

The API stores menu image data in PostgreSQL. Vercel function requests have a 4 MB JSON limit in this project, so large backup restores or image payloads may need to be reduced. For larger media, use object storage rather than storing image data in the database.

Never commit production passwords, session secrets, database URLs, or user-uploaded/private data. Use Vercel's encrypted environment-variable settings and keep local values in an ignored `.env` file.

## Repository hygiene

Local environment files, deployment state, generated build output, and the legacy `.migration-backup` archive are excluded by `.gitignore`. `.env.example` lists the required variable names without containing secrets.
