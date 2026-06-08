const encoder = new TextEncoder();
const decoder = new TextDecoder();
const moduleCache = new Map();

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

function pathToFileUrl(filePath) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `file://${encodedPath}`;
}

function functionNameFromStep(step) {
  return String(step).toLowerCase().replaceAll("-", "_");
}

async function writeMessage(message) {
  await Deno.stdout.write(encoder.encode(JSON.stringify(message) + "\n"));
}

async function loadModule(sourceDir) {
  const commandFile = `${sourceDir}/command.deno.ts`;
  const moduleUrl = pathToFileUrl(commandFile);
  let mod = moduleCache.get(moduleUrl);
  if (!mod) {
    mod = await import(moduleUrl);
    moduleCache.set(moduleUrl, mod);
  }
  return mod;
}

async function handleRequest(request) {
  const context = request.context ?? {};

  try {
    const mod = await loadModule(request.sourceDir);
    const fnName = functionNameFromStep(request.functionName);
    const fn = mod[fnName];

    if (typeof fn !== "function") {
      return { fnError: "not exist", c: context };
    }

    const result = await fn(request.args ?? [], context);
    return { r: result, c: context };
  } catch (err) {
    return { error: err?.message ?? String(err), c: context };
  }
}

let buffer = "";
for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk, { stream: true });

  while (buffer.includes("\n")) {
    const idx = buffer.indexOf("\n");
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;

    let request;
    try {
      request = JSON.parse(line);
    } catch (err) {
      await writeMessage({ id: null, response: { error: "invalid_json" } });
      continue;
    }

    const response = await handleRequest(request);
    await writeMessage({ id: request.id, response });
  }
}
