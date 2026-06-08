import { loadNynoEnv } from "../lib-manual/env.js";

const ports = loadNynoEnv({ requireRuntime: true });
console.log('[tcp load]',ports);

export default async function authTcp(data) {
  
  if (!data || !data.apiKey) return null;

  const SECRET = ports['SECRET'] ?? '';
  if (SECRET && data.apiKey === SECRET) return true;
  else return null; // auth failed
}
