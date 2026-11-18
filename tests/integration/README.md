# Integration tests

These suites exercise product management against a **real local Supabase stack**:
real GoTrue auth, real PostgREST requests, real Postgres RLS and real Storage.
They are the layer that unit tests cannot cover.

Three suites live here:

| Suite | File | What it checks |
|---|---|---|
| RLS / authorization | `rls.suite.mjs` | Every read/write policy for products and profiles |
| Atomicity / concurrency | `transactions.suite.mjs` | The inventory RPCs commit all-or-nothing, failed operations leave no trace, FEFO spans batches, and concurrent stock-outs cannot oversell |
| Sold screen | `sold.suite.mjs` | The sellable-availability helpers list only sellable products with the right quantity, expired stock is excluded, and a sale deducts through the stock-out RPC (FEFO, atomic, authorized) |
| Browser E2E | `e2e.suite.mjs` | The admin console UI end to end in a real browser, including the Sold screen |

## Safety: local only

These tests **cannot target production**. Before any request is made,
`scripts/env.mjs` resolves every target and refuses to continue unless its host
is `127.0.0.1`, `localhost`, `::1` or `0.0.0.0`. The gateway
(`gateway/server.mjs`) applies the same check to its upstream targets.

The tests start their own throwaway database (a Docker volume) and use keys
generated at runtime. They do not read `.env.local` and never touch a hosted
Supabase project.

## Prerequisites

- Node.js 20 or later
- Docker with the `docker compose` plugin
- The Playwright browser (installed once):

  ```bash
  npx playwright install chromium
  ```

## Run everything

```bash
# 1. One-time: generate local keys and start + seed the stack
npm run test:integration:setup

# 2. Unit tests (no stack needed)
npm test

# 3. RLS / authorization suite
npm run test:integration:rls

# 4. Atomicity / concurrency suite
npm run test:integration:transactions

# 5. Sold screen suite
npm run test:integration:sold

# 6. Inventory query suite (pushed-down search, filtering, paging, metrics)
npm run test:integration:inventory

# 7. Browser E2E suite (starts and stops the app itself)
npm run build
npm run test:integration:e2e
```

`test:integration:e2e` needs a production build (`npm run build`) because it
runs `next start`.

## What `setup` does

`npm run test:integration:setup` runs, in order:

1. `scripts/generate-keys.mjs` — writes `.local-test/keys.env` (gitignored) with
   a fixed local JWT secret and freshly signed anon/service keys.
2. `scripts/stack.mjs up` — starts Postgres, waits for it, sets the auth/storage
   database role passwords, then starts auth, rest and storage.
3. `scripts/bootstrap.mjs` — applies `supabase/schema.sql` and every file in
   `supabase/migrations/` (in order), grants the API roles access, creates the
   two test accounts and seeds a small catalogue.

It is idempotent, so re-running is safe.

## Test accounts

| Role | Email | Password |
|---|---|---|
| Super Admin | `super@b3.test` | `TestPass123!` |
| Staff | `staff@b3.test` | `TestPass123!` |

These exist only in the local stack. The passwords are test fixtures, not
secrets, and the accounts are created in the throwaway database.

## Local endpoints

The stack publishes to loopback only:

| Service | URL |
|---|---|
| Supabase gateway (app entry point) | `http://127.0.0.1:54321` |
| Postgres | `127.0.0.1:55432` |
| GoTrue | `127.0.0.1:9999` |
| PostgREST | `127.0.0.1:3001` |
| Storage API | `127.0.0.1:5000` |
| App (started by the E2E runner) | `http://127.0.0.1:12000` |

`supabase-js` talks to a single origin and appends service paths itself, so the
gateway fronts all services on `54321` the way a hosted project does.

## Stop and clean up

```bash
npm run test:integration:down
```

This stops the containers and removes the throwaway database volume.

## Troubleshooting

- **"Missing .local-test/keys.env"** — run `npm run test:integration:setup`.
- **Auth or storage containers exit at startup** — their database role
  passwords were not set before they started. `stack.mjs up` handles the order;
  if you started them by hand, run `npm run test:integration:setup` again.
- **E2E fails to reach the app** — make sure `npm run build` has run and that
  nothing else is using port 12000.
- **Playwright cannot find a browser** — run
  `npx playwright install chromium`.
