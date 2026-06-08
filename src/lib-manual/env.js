import fs from "fs";
import path from "path";

const REQUIRED_RUNTIME_ENV_KEYS = ["WF", "GU", "PY", "JS", "DN", "PE", "RB", "HOST", "SECRET"];
const RESERVED_SECRETS = new Set(["change_me", "changeme"]);

export function resolveNynoEnvPath(cwd = process.cwd(), { allowTemplate = true } = {}) {
  const envPath = path.resolve(cwd, ".env");
  if (fs.existsSync(envPath)) return envPath;

  if (allowTemplate) {
    const templatePath = path.resolve(cwd, ".env.template");
    if (fs.existsSync(templatePath)) return templatePath;
  }

  return envPath;
}

export function loadNynoEnv(options = {}) {
  let envPath;
  let requireRuntime = false;
  let allowTemplate = true;

  if (typeof options === "string") {
    envPath = options;
  } else {
    envPath = options.envPath;
    requireRuntime = options.requireRuntime === true;
    allowTemplate = options.allowTemplate !== false;
  }

  envPath = envPath ?? resolveNynoEnvPath(process.cwd(), { allowTemplate: requireRuntime ? false : allowTemplate });
  const env = {};

  if (!fs.existsSync(envPath)) {
    if (requireRuntime) throw new Error("Missing .env. Copy .env.template to .env and set a fresh SECRET.");
    return env;
  }

  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes("#")) line = line.split("#", 1)[0].trim();
    if (!line.includes("=")) continue;

    let [key, value] = line.split("=", 2);
    key = key.trim();
    value = value.trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!isNaN(value) && value !== "") value = Number(value);
    env[key] = value;
  }

  if (requireRuntime) validateNynoRuntimeEnv(env);
  return env;
}

export function validateNynoRuntimeEnv(env) {
  for (const key of REQUIRED_RUNTIME_ENV_KEYS) {
    if (env[key] === undefined || env[key] === null || String(env[key]).trim() === "") {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  const secret = String(env.SECRET).trim();
  if (RESERVED_SECRETS.has(secret.toLowerCase())) {
    throw new Error("SECRET must be a fresh high-entropy value, not a placeholder.");
  }
}
