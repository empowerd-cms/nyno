import cluster from "cluster";
import os from "os";
import net from "net";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { normalizeDenoPermissions } from "./deno_permissions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function load_nyno_ports(pathname = "envs/ports.env") {
  const env: any = {};
  const lines = fs.readFileSync(pathname, "utf-8").split("\n");

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes("#")) line = line.split("#")[0].trim();
    if (line.includes("=")) {
      let [key, value1] = line.split("=", 2);
      key = key.trim();
      let value: any = value1.trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!isNaN(value) && value !== "") value = Number(value);
      env[key] = value;
    }
  }
  return env;
}

const repoRoot = process.cwd();
const portsFile = path.join(repoRoot, "envs/ports.env");
const ports = load_nyno_ports(portsFile);
const host = ports["HOST"] ?? ports["host"] ?? "localhost";
const PORT = ports["DN"] ?? 9073;
const VALID_API_KEY = ports["SECRET"] ?? "changeme";
const CHILD_FILE = path.resolve(__dirname, "runner_deno_child.js");

const allowDangerous = process.env.NYNO_DENO_ALLOW_DANGEROUS_PERMISSIONS === "1";
const allowExternalPaths = process.env.NYNO_DENO_ALLOW_EXTERNAL_PATHS === "1";

const extensions = new Map<string, any>();
const childProfiles = new Map<string, any>();

async function loadExtensions() {
  const manifestPath = path.join(repoRoot, "src", "extension-data.json");

  if (!fs.existsSync(manifestPath)) {
    console.warn("[Deno Runner] No extension manifest found");
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const loaded: string[] = [];

  for (const [extName, meta] of Object.entries<any>(manifest)) {
    const sourceDir = meta.sourceDir;
    if (!sourceDir) {
      console.warn(`[Deno Runner] No sourceDir for ${extName}`);
      continue;
    }

    const cmdFile = path.join(sourceDir, "command.deno.ts");
    if (!fs.existsSync(cmdFile)) continue;

    extensions.set(extName, { sourceDir, cmdFile });
    loaded.push(extName);
  }

  console.log(`[Deno Runner] Loaded ${loaded.length} extensions: ${loaded.join(", ")}`);
}

function profileKey(sourceDir: string, flags: string[]) {
  return JSON.stringify({ sourceDir: path.resolve(sourceDir), flags });
}

function startChild(profile: any) {
  const args = ["run", "--no-prompt", ...profile.flags, CHILD_FILE];
  console.log(`[Deno Runner] Starting child: deno ${args.join(" ")}`);

  const proc = spawn("deno", args, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const child = {
    proc,
    buffer: "",
    pending: new Map<string, any>(),
  };

  proc.stdout.on("data", (data) => {
    child.buffer += data.toString();
    let idx;
    while ((idx = child.buffer.indexOf("\n")) >= 0) {
      const msg = child.buffer.slice(0, idx).trim();
      child.buffer = child.buffer.slice(idx + 1);
      if (!msg) continue;

      let payload;
      try {
        payload = JSON.parse(msg);
      } catch (err) {
        console.error("[Deno Runner] Bad JSON from child:", msg);
        continue;
      }

      const resolver = child.pending.get(payload.id);
      if (resolver) {
        child.pending.delete(payload.id);
        resolver.resolve(payload.response);
      }
    }
  });

  proc.on("error", (err) => {
    for (const resolver of child.pending.values()) {
      resolver.reject(err);
    }
    child.pending.clear();
  });

  proc.on("exit", (code) => {
    childProfiles.delete(profile.key);
    for (const resolver of child.pending.values()) {
      resolver.reject(new Error(`Deno child exited with code ${code}`));
    }
    child.pending.clear();
  });

  return child;
}

function getChild(ext: any, denoOptions: any) {
  const rawPermissions = denoOptions?.permissions ?? {};
  const normalized = normalizeDenoPermissions(rawPermissions, {
    repoRoot,
    extensionDir: ext.sourceDir,
    allowDangerous,
    allowExternalPaths,
  });

  const key = profileKey(ext.sourceDir, normalized.flags);
  let child = childProfiles.get(key);

  if (!child || child.proc.killed || child.proc.exitCode !== null) {
    child = startChild({ key, flags: normalized.flags });
    childProfiles.set(key, child);
  }

  return child;
}

function runInChild(child: any, payload: any) {
  const id = payload.context?.__n_id ?? `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    child.pending.set(id, { resolve, reject });
    child.proc.stdin.write(JSON.stringify({ ...payload, id }) + "\n", (err) => {
      if (err) {
        child.pending.delete(id);
        reject(err);
      }
    });
  });
}

async function startWorker() {
  await loadExtensions();

  const server = net.createServer((socket) => {
    let authenticated = false;
    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();
      while (buffer.indexOf("\n") >= 0) {
        const line = buffer.slice(0, buffer.indexOf("\n")).trim();
        buffer = buffer.slice(buffer.indexOf("\n") + 1);
        if (!line) continue;

        const type = line[0];
        const raw = line.slice(1);
        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }

        if (type === "c") {
          if (payload.apiKey === VALID_API_KEY) {
            authenticated = true;
            socket.write(JSON.stringify({ status: "OK" }) + "\n");
          } else {
            socket.write(JSON.stringify({ status: "ERR", error: "Invalid apiKey" }) + "\n");
            socket.destroy();
          }
        } else if (!authenticated) {
          socket.write(JSON.stringify({ status: "ERR", error: "Not authenticated" }) + "\n");
          socket.destroy();
        } else if (type === "r") {
          const context = payload.context ?? {};
          const ext = extensions.get(payload.functionName);

          if (!ext) {
            socket.write(JSON.stringify({ fnError: "not exist", c: context }) + "\n");
            continue;
          }

          try {
            const child = getChild(ext, payload.options?.deno ?? {});
            const response = await runInChild(child, {
              sourceDir: ext.sourceDir,
              functionName: payload.functionName,
              args: payload.args ?? [],
              context,
            });
            socket.write(JSON.stringify(response) + "\n");
          } catch (err) {
            socket.write(JSON.stringify({ error: err.message, c: context }) + "\n");
          }
        }
      }
    });
  });

  server.listen(PORT, host, () => {
    console.log(`[Deno Worker ${process.pid}] Listening on port ${PORT}`);
  });
}

if (cluster.isPrimary) {
  const isProd = process.env.NODE_ENV === "production";
  let numCPUs = 2;
  if (isProd) {
    numCPUs = os.cpus().length * 3;
  }
  console.log(`[Deno Runner Master] Forking ${numCPUs} workers...`);
  for (let i = 0; i < numCPUs; i++) cluster.fork();

  cluster.on("exit", (worker) => {
    console.log(`[Deno Runner Master] Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  startWorker();
}
