#!/usr/bin/env node
/**
 * Local Supabase gateway.
 *
 * supabase-js talks to a single origin and appends service paths itself
 * (/auth/v1, /rest/v1, /storage/v1). The Supabase service images each listen on
 * their own port, so this gateway fronts them on one local origin exactly the
 * way a hosted project does.
 *
 * It is a thin reverse proxy: it does not authenticate, does not hold secrets,
 * and does not transform payloads. CORS is handled so the browser can call it
 * from the local app origin.
 *
 * Bound to 127.0.0.1 only. Never point this at a remote host.
 *
 * Usage: node tests/integration/gateway/server.mjs
 */
import http from "node:http";

const PORT = Number(process.env.LOCAL_GATEWAY_PORT || 54321);
const AUTH_TARGET = process.env.LOCAL_AUTH_TARGET || "http://127.0.0.1:9999";
const REST_TARGET = process.env.LOCAL_REST_TARGET || "http://127.0.0.1:3001";
const STORAGE_TARGET = process.env.LOCAL_STORAGE_TARGET || "http://127.0.0.1:5000";

// Refuse to run if someone points the gateway at a non-local host. This is the
// last line of defence against an integration run touching a real project.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);
for (const [name, target] of Object.entries({ AUTH_TARGET, REST_TARGET, STORAGE_TARGET })) {
  const host = new URL(target).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    console.error(`Refusing to start: ${name}=${target} is not a local host.`);
    process.exit(1);
  }
}

const ROUTES = [
  { prefix: "/auth/v1", target: AUTH_TARGET },
  { prefix: "/rest/v1", target: REST_TARGET },
  { prefix: "/storage/v1", target: STORAGE_TARGET }
];

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*"
};

// Upstream services send their own CORS headers; duplicating them makes browsers
// reject the response, so drop them and set ours instead.
const STRIP = new Set([
  "connection",
  "transfer-encoding",
  "content-length",
  "keep-alive",
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "access-control-max-age",
  "access-control-allow-credentials"
]);

function pickRoute(url) {
  return ROUTES.find((route) => url.startsWith(route.prefix)) || null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const route = pickRoute(req.url || "");
  if (!route) {
    res.writeHead(404, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: "Unknown route", path: req.url }));
    return;
  }

  // Strip only the service prefix; upstream expects the path without it.
  const upstreamPath = req.url.slice(route.prefix.length) || "/";
  const target = new URL(route.target);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === "host" || key === "connection" || key === "content-length") continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  let upstream;
  try {
    upstream = await fetch(new URL(upstreamPath, target.origin), {
      method: req.method,
      headers,
      body,
      redirect: "manual"
    });
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: "Upstream unreachable", target: route.target, detail: String(error) }));
    return;
  }

  const outHeaders = {};
  for (const [key, value] of upstream.headers.entries()) {
    if (!STRIP.has(key.toLowerCase())) outHeaders[key] = value;
  }
  Object.assign(outHeaders, CORS_HEADERS);

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, outHeaders);
  if (req.method === "HEAD") res.end();
  else res.end(buffer);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local Supabase gateway on http://127.0.0.1:${PORT}`);
  console.log(`  /auth/v1    -> ${AUTH_TARGET}`);
  console.log(`  /rest/v1    -> ${REST_TARGET}`);
  console.log(`  /storage/v1 -> ${STORAGE_TARGET}`);
});
