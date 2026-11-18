#!/usr/bin/env node
/**
 * Runs a browser suite against a production build: starts the production server
 * against the local stack, runs the suite, then stops the server.
 *
 * The suite defaults to e2e.suite.mjs; pass another file name to reuse the same
 * server lifecycle (e.g. `run-e2e.mjs rpc-fallback.suite.mjs`).
 *
 * The app is started with the local Supabase URL and anon key exported into the
 * environment, so it never reads .env.local and never talks to a hosted project.
 * scripts/env.mjs asserts the targets are local before anything starts.
 *
 * Usage: npm run test:integration:e2e
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT, resolveConfig } from "./env.mjs";

const config = resolveConfig();
const port = new URL(config.appUrl).port || "12000";
const suiteFile = process.argv[2] || "e2e.suite.mjs";

const server = spawn("npm", ["run", "start", "--", "-p", port], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey,
    PORT: port
  },
  stdio: ["ignore", "inherit", "inherit"],
  // Own process group, so the whole tree (npm -> sh -> next-server) can be
  // signalled at once and nothing is left holding the port or this pipe.
  detached: true
});

function stopServer() {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${config.appUrl}/admin/login`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`App did not become ready at ${config.appUrl}`);
}

try {
  await waitForServer();
  console.log(`App ready at ${config.appUrl}`);
  const suite = spawn("node", [join(REPO_ROOT, "tests", "integration", suiteFile)], {
    stdio: "inherit"
  });
  const code = await new Promise((resolve) => suite.on("exit", resolve));
  stopServer();
  process.exit(code ?? 1);
} catch (error) {
  console.error(String(error));
  stopServer();
  process.exit(1);
}
