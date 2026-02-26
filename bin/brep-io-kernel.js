#!/usr/bin/env node

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const packageJsonPath = resolve(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const args = process.argv.slice(2);

const defaults = {
  host: "127.0.0.1",
  port: 4173,
};

const contentTypeByExt = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function printHelp() {
  console.log(`${packageJson.name} ${packageJson.version}`);
  console.log("");
  console.log("Usage:");
  console.log("  npx brep-io-kernel [--host HOST] [--port PORT]");
  console.log("  npx brep-io-kernel [--help] [--version] [--example]");
  console.log("");
  console.log("Options:");
  console.log("  -h, --help      Show this help message.");
  console.log("  -v, --version   Print the installed package version.");
  console.log("  --example       Print a minimal Node.js usage example.");
  console.log(`  --host HOST     Bind host (default: ${defaults.host}).`);
  console.log(`  -p, --port N    Bind port (default: ${defaults.port}).`);
  console.log("");
  console.log("No arguments starts the full CAD app server.");
}

function printExample() {
  console.log("import { BREP, PartHistory } from 'brep-io-kernel';");
  console.log("");
  console.log("const partHistory = new PartHistory();");
  console.log("// Use BREP + PartHistory APIs here.");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    help: false,
    version: false,
    example: false,
    host: defaults.host,
    port: defaults.port,
    unknown: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      out.version = true;
      continue;
    }
    if (arg === "--example") {
      out.example = true;
      continue;
    }
    if (arg === "--host") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        out.unknown.push(arg);
      } else {
        out.host = value;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--host=")) {
      out.host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        out.unknown.push(arg);
      } else {
        out.port = Number(value);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--port=")) {
      out.port = Number(arg.slice("--port=".length));
      continue;
    }
    out.unknown.push(arg);
  }

  return out;
}

function findLandingPath(rootDir) {
  const candidates = [
    "/cad.html",
    "/index.html",
  ];
  for (const candidate of candidates) {
    const absolute = resolve(rootDir, `.${candidate}`);
    if (existsSync(absolute)) return candidate;
  }
  return null;
}

function safeResolveRequest(rootDir, pathname, landingPath) {
  let requestPath = pathname || "/";
  if (requestPath === "/") requestPath = landingPath;
  if (requestPath.endsWith("/")) requestPath = `${requestPath}index.html`;

  const candidate = resolve(rootDir, `.${requestPath}`);
  const rel = relative(rootDir, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return candidate;
}

function openStreamResponse(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  const contentType =
    contentTypeByExt[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Internal server error.");
  });
  stream.pipe(res);
}

function startStaticServer({ host, port }) {
  if (!host) fail("Invalid host value.");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail("Invalid port. Use an integer between 1 and 65535.");
  }

  const rootDir = resolve(packageRoot, "dist");
  if (!existsSync(rootDir)) {
    fail(`Missing app build at: ${rootDir}. Run 'pnpm build' before packing/publishing.`);
  }

  const landingPath = findLandingPath(rootDir);
  if (!landingPath) {
    fail(`No landing page found in: ${rootDir}`);
  }

  const server = createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || "/", "http://localhost");
      const filePath = safeResolveRequest(rootDir, reqUrl.pathname, landingPath);
      if (!filePath || !existsSync(filePath)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found.");
        return;
      }
      const fileStat = statSync(filePath);
      if (!fileStat.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found.");
        return;
      }
      openStreamResponse(res, filePath);
    } catch (error) {
      console.log("Error handling request:", error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal server error.");
    }
  });

  server.on("error", (error) => {
    const message = error && error.code === "EADDRINUSE"
      ? `Port ${port} is already in use.`
      : `Server error: ${error?.message || String(error)}`;
    fail(message);
  });

  server.listen(port, host, () => {
    const displayHost = host.includes(":") ? `[${host}]` : host;
    const baseUrl = `http://${displayHost}:${port}`;
    console.log(`${packageJson.name} ${packageJson.version}`);
    console.log("");
    console.log(`Open: ${baseUrl}${landingPath}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const parsed = parseArgs(args);
if (parsed.unknown.length) {
  console.error(`Unknown argument(s): ${parsed.unknown.join(" ")}`);
  console.error("Run `npx brep-io-kernel --help` for usage.");
  process.exit(1);
}

if (parsed.version) {
  console.log(packageJson.version);
  process.exit(0);
}

if (parsed.example) {
  printExample();
  process.exit(0);
}

if (parsed.help) {
  printHelp();
  process.exit(0);
}

startStaticServer({ host: parsed.host, port: parsed.port });
