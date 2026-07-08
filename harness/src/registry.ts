import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./types.ts";

// Adapters are discovered, never hardcoded: any adapters/<name>/adapter.json
// is picked up automatically, so a new tool is one directory away.
export function discoverAdapters(repoRoot: string): Adapter[] {
  const base = join(repoRoot, "adapters");
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name, "adapter.json"))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => JSON.parse(readFileSync(manifest, "utf-8")) as Adapter)
    .sort((a, b) => a.name.localeCompare(b.name));
}
