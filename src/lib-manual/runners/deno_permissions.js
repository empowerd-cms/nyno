import path from "path";

const SAFE_PERMISSION_KEYS = {
  read: "read",
  allowRead: "read",
  write: "write",
  allowWrite: "write",
  net: "net",
  allowNet: "net",
  env: "env",
  allowEnv: "env",
  import: "import",
  allowImport: "import",
};

const DANGEROUS_PERMISSION_KEYS = {
  run: "run",
  allowRun: "run",
  ffi: "ffi",
  allowFfi: "ffi",
  sys: "sys",
  allowSys: "sys",
  hrtime: "hrtime",
  allowHrtime: "hrtime",
};

const UNSUPPORTED_ALL_PERMISSION_KEYS = new Set([
  "all",
  "allowAll",
  "allow-all",
  "A",
]);

function asList(value, key) {
  if (value === undefined || value === null || value === false) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }

  throw new Error(`Deno permission '${key}' must be a string or string array`);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeScopedPath(value, key, repoRoot, extensionDir, allowExternalPaths) {
  const resolved = path.resolve(repoRoot, value);
  const allowed =
    allowExternalPaths ||
    isInside(repoRoot, resolved) ||
    isInside(extensionDir, resolved);

  if (!allowed) {
    throw new Error(`Deno permission '${key}' path escapes repo root: ${value}`);
  }

  return resolved;
}

export function normalizeDenoPermissions(rawPermissions = {}, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const extensionDir = path.resolve(options.extensionDir ?? repoRoot);
  const allowDangerous = Boolean(options.allowDangerous);
  const allowExternalPaths = Boolean(options.allowExternalPaths);

  const normalized = {
    read: [extensionDir],
    write: [],
    net: [],
    env: [],
    import: [],
    run: [],
    ffi: [],
    sys: [],
    hrtime: [],
  };

  for (const [rawKey, rawValue] of Object.entries(rawPermissions || {})) {
    if (UNSUPPORTED_ALL_PERMISSION_KEYS.has(rawKey)) {
      throw new Error("Deno allowAll/-A permissions are not supported");
    }

    const dangerousKey = DANGEROUS_PERMISSION_KEYS[rawKey];
    if (dangerousKey) {
      if (!allowDangerous) {
        throw new Error(`Deno permission '${rawKey}' requires NYNO_DENO_ALLOW_DANGEROUS_PERMISSIONS=1`);
      }
      normalized[dangerousKey].push(...asList(rawValue, rawKey));
      continue;
    }

    const key = SAFE_PERMISSION_KEYS[rawKey];
    if (!key) {
      throw new Error(`Unknown Deno permission '${rawKey}'`);
    }

    const values = asList(rawValue, rawKey);
    if (key === "read" || key === "write") {
      normalized[key].push(
        ...values.map((value) =>
          normalizeScopedPath(value, key, repoRoot, extensionDir, allowExternalPaths)
        )
      );
    } else {
      normalized[key].push(...values);
    }
  }

  for (const key of Object.keys(normalized)) {
    normalized[key] = unique(normalized[key]);
  }

  const flags = [];
  for (const [key, values] of Object.entries(normalized)) {
    if (values.length > 0) {
      flags.push(`--allow-${key}=${values.join(",")}`);
    }
  }

  return { flags, permissions: normalized };
}
