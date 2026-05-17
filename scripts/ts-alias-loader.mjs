import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const withoutAlias = specifier.slice(2);
    const candidates = [
      join(root, withoutAlias),
      join(root, `${withoutAlias}.ts`),
      join(root, `${withoutAlias}.tsx`),
      join(root, withoutAlias, "index.ts"),
      join(root, withoutAlias, "index.tsx"),
    ];
    const match = candidates.find((candidate) => existsSync(candidate));
    if (match) {
      return {
        shortCircuit: true,
        url: pathToFileURL(match).href,
      };
    }
  }

  return nextResolve(specifier, context);
}
