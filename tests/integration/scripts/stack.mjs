#!/usr/bin/env node
/**
 * Brings the local integration stack up or down.
 *
 * Up order matters: the database starts first, the auth/storage DB roles get
 * their generated passwords, and only then do auth/rest/storage start (they
 * authenticate against the database at boot).
 *
 * Usage:
 *   node tests/integration/scripts/stack.mjs up
 *   node tests/integration/scripts/stack.mjs down
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, openSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./env.mjs";
import { setRolePasswords, waitForDb, waitForStorage } from "./bootstrap.mjs";

const COMPOSE_FILE = join(REPO_ROOT, "tests", "integration", "docker-compose.yml");
const KEYS_FILE = join(REPO_ROOT, ".local-test", "keys.env");
const GATEWAY_PID = join(REPO_ROOT, ".local-test", "gateway.pid");

function compose(args, opts = {}) {
  const result = spawnSync(
    "docker",
    ["compose", "--env-file", KEYS_FILE, "-f", COMPOSE_FILE, ...args],
    { stdio: "inherit", ...opts }
  );
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed`);
}

async function waitForGateway() {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch("http://127.0.0.1:54321/rest/v1/");
      if (response.status > 0) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Gateway did not start.");
}

function startGateway() {
  if (existsSync(GATEWAY_PID)) {
    const pid = Number(readFileSync(GATEWAY_PID, "utf8").trim());
    try {
      process.kill(pid, 0);
      console.log(`Gateway already running (pid ${pid}).`);
      return;
    } catch {
      rmSync(GATEWAY_PID, { force: true });
    }
  }
  // Detach and log to a file: inheriting stdout would keep this terminal's pipe
  // open for as long as the gateway lives.
  const logPath = join(REPO_ROOT, ".local-test", "gateway.log");
  const out = openSync(logPath, "a");
  const child = spawn("node", [join(REPO_ROOT, "tests", "integration", "gateway", "server.mjs")], {
    detached: true,
    stdio: ["ignore", out, out]
  });
  child.unref();
  writeFileSync(GATEWAY_PID, String(child.pid));
  console.log(`Gateway started (pid ${child.pid}, log ${logPath}).`);
}

function stopGateway() {
  if (!existsSync(GATEWAY_PID)) return;
  const pid = Number(readFileSync(GATEWAY_PID, "utf8").trim());
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Gateway stopped (pid ${pid}).`);
  } catch {
    // already gone
  }
  rmSync(GATEWAY_PID, { force: true });
}

const command = process.argv[2];

if (command === "up") {
  console.log("Starting database...");
  compose(["up", "-d", "db"]);
  console.log("Waiting for database...");
  await waitForDb();
  console.log("Setting auth/storage database role passwords...");
  setRolePasswords();
  console.log("Starting auth, rest and storage...");
  compose(["up", "-d", "auth", "rest", "storage"]);
  console.log("Waiting for storage migrations...");
  await waitForStorage();
  console.log("Starting gateway...");
  startGateway();
  await waitForGateway();
  console.log("Stack is up.");
} else if (command === "down") {
  console.log("Stopping gateway...");
  stopGateway();
  console.log("Stopping stack and removing its volume...");
  compose(["down", "-v", "--remove-orphans"]);
  console.log("Stack is down.");
} else {
  console.error("Usage: node tests/integration/scripts/stack.mjs up|down");
  process.exit(1);
}
