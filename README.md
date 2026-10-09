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

## Security notice

The admin page currently uses a demo credential check in client-side code. This is not authentication: anyone who can access the page or source can inspect or bypass it. Do not use the admin page with real data or deploy it publicly until authentication and authorization are implemented on a trusted server. Never put production passwords, API keys, database files, or user-uploaded/private data in this repository.

## Repository hygiene

Local environment files, deployment state, generated build output, and the legacy `.migration-backup` archive are excluded by `.gitignore`. Keep real secrets in your deployment provider's secret/environment-variable settings.
