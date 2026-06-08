import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadStepCommandLangs } from "../../src/lib-manual/functions/loadfunctiondatanyno.js";
import { normalizeDenoPermissions } from "../../src/lib-manual/runners/deno_permissions.js";

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function writeFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function testCommandDiscovery() {
  const base = makeTempDir("nyno-deno-discovery-");
  writeFile(path.join(base, "deno-step", "command.deno.ts"));
  writeFile(path.join(base, "js-step", "command.js"));
  writeFile(path.join(base, "wasm-step", "command.wasm"));
  writeFile(path.join(base, "ts-step", "command.ts"));
  writeFile(path.join(base, "priority-step", "command.js"));
  writeFile(path.join(base, "priority-step", "command.deno.ts"));

  const languages = loadStepCommandLangs(base);
  assert.equal(languages["deno-step"], "deno");
  assert.equal(languages["js-step"], "js");
  assert.equal(languages["wasm-step"], "js");
  assert.equal(languages["ts-step"], "js");
  assert.equal(languages["priority-step"], "deno");
}

function testPermissionNormalization() {
  const repoRoot = makeTempDir("nyno-deno-perms-");
  const extensionDir = path.join(repoRoot, "extensions", "hello-deno");
  fs.mkdirSync(path.join(repoRoot, "input"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "output"), { recursive: true });
  fs.mkdirSync(extensionDir, { recursive: true });

  const normalized = normalizeDenoPermissions({
    read: ["./input"],
    write: ["./output"],
    net: ["api.example.com:443"],
    env: ["API_KEY"],
    import: ["jsr.io", "deno.land"],
  }, { repoRoot, extensionDir });

  assert.ok(normalized.flags.some((flag) => flag.startsWith("--allow-read=")));
  assert.ok(normalized.flags.some((flag) => flag.includes(path.join(repoRoot, "input"))));
  assert.ok(normalized.flags.some((flag) => flag.includes(extensionDir)));
  assert.ok(normalized.flags.includes(`--allow-write=${path.join(repoRoot, "output")}`));
  assert.ok(normalized.flags.includes("--allow-net=api.example.com:443"));
  assert.ok(normalized.flags.includes("--allow-env=API_KEY"));
  assert.ok(normalized.flags.includes("--allow-import=deno.land,jsr.io"));

  assert.throws(
    () => normalizeDenoPermissions({ read: ["/etc"] }, { repoRoot, extensionDir }),
    /escapes repo root/
  );
  assert.throws(
    () => normalizeDenoPermissions({ run: ["deno"] }, { repoRoot, extensionDir }),
    /requires NYNO_DENO_ALLOW_DANGEROUS_PERMISSIONS/
  );
  assert.throws(
    () => normalizeDenoPermissions({ allowAll: true }, { repoRoot, extensionDir }),
    /allowAll\/-A/
  );
}

function runDenoChild(sourceDir, permissions, request, extraEnv = {}) {
  const childFile = path.resolve("src/lib-manual/runners/runner_deno_child.js");
  const normalized = normalizeDenoPermissions(permissions, {
    repoRoot: path.dirname(path.dirname(sourceDir)),
    extensionDir: sourceDir,
  });

  const result = spawnSync("deno", ["run", "--no-prompt", ...normalized.flags, childFile], {
    input: JSON.stringify(request) + "\n",
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, result.stdout);
  return JSON.parse(lines[0]).response;
}

function testDenoChildWhenAvailable() {
  const denoCheck = spawnSync("deno", ["--version"], { encoding: "utf8" });
  if (denoCheck.status !== 0) {
    console.log("[deno-runner-tests] deno not available; skipping child integration tests");
    return;
  }

  const repoRoot = makeTempDir("nyno-deno-child-");
  const helloDir = path.join(repoRoot, "extensions", "hello-deno");
  writeFile(path.join(helloDir, "command.deno.ts"), `
export async function hello_deno(args: unknown[], context: Record<string, unknown>) {
  context.custom_deno_var = args[0] ?? "deno";
  return 0;
}
`);

  const helloResponse = runDenoChild(helloDir, {}, {
    id: "success",
    sourceDir: helloDir,
    functionName: "hello-deno",
    args: ["John"],
    context: {},
  });
  assert.equal(helloResponse.r, 0);
  assert.equal(helloResponse.c.custom_deno_var, "John");

  const envDir = path.join(repoRoot, "extensions", "env-denied");
  writeFile(path.join(envDir, "command.deno.ts"), `
export async function env_denied(args: unknown[], context: Record<string, unknown>) {
  context.secret = Deno.env.get("API_KEY");
  return 0;
}
`);

  const deniedResponse = runDenoChild(envDir, {}, {
    id: "denied",
    sourceDir: envDir,
    functionName: "env-denied",
    args: [],
    context: {},
  }, { API_KEY: "secret" });
  assert.ok(deniedResponse.error, JSON.stringify(deniedResponse));

  const allowedResponse = runDenoChild(envDir, { env: ["API_KEY"] }, {
    id: "allowed",
    sourceDir: envDir,
    functionName: "env-denied",
    args: [],
    context: {},
  }, { API_KEY: "secret" });
  assert.equal(allowedResponse.r, 0);
  assert.equal(allowedResponse.c.secret, "secret");
}

testCommandDiscovery();
testPermissionNormalization();
testDenoChildWhenAvailable();
console.log("[deno-runner-tests] ok");
