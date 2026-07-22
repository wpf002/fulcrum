// Load repo-root .env into process.env (no dotenv dep). Imported first by
// server.ts; real deployments set env vars directly and this is a no-op.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const envPath = resolve(import.meta.dirname, "../../../.env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  // no .env — rely on real environment
}
