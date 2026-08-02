import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages");
const scopePrefix = "@mikejhill/portable-document-";
const allowedDependencies = new Map([
  ["browser", new Set(["codec"])],
  ["codec", new Set(["core"])],
  ["core", new Set()],
  ["firebase", new Set(["core"])],
  ["indexeddb", new Set(["core"])],
  ["react", new Set(["core"])],
  ["sync", new Set(["core"])],
  ["testing", new Set(["core"])],
]);
const failures = [];

for (const [packageName, allowed] of allowedDependencies) {
  const directory = join(packageRoot, packageName);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const sources = await sourceFiles(join(directory, "src"));
  const importedPackages = new Set();

  for (const file of sources) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /(?:from\s+|import\s*\()?["'](@mikejhill\/portable-document-[^"']+)["']/g,
    )) {
      const imported = match[1].slice(scopePrefix.length).split("/")[0];
      importedPackages.add(imported);
      if (!allowed.has(imported)) {
        failures.push(`${packageName}: ${file} imports forbidden package ${match[1]}`);
      }
    }
    if (
      packageName === "core" &&
      (/\b(?:window|document|localStorage|sessionStorage)\s*\.\s*[A-Za-z_$]/.test(source) ||
        /\bindexedDB\b/.test(source))
    ) {
      failures.push(`core: browser global found in ${file}`);
    }
    if (
      ["core", "codec", "browser", "indexeddb", "sync", "testing"].includes(packageName) &&
      /["']firebase\//.test(source)
    ) {
      failures.push(`${packageName}: Firebase import found in ${file}`);
    }
    if (packageName !== "react" && /["']react(?:\/|["'])/.test(source)) {
      failures.push(`${packageName}: React import found in ${file}`);
    }
  }

  const declared = new Set(
    Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
      .filter((name) => name.startsWith(scopePrefix))
      .map((name) => name.slice(scopePrefix.length)),
  );
  for (const imported of importedPackages) {
    if (!declared.has(imported))
      failures.push(`${packageName}: ${imported} is imported but undeclared`);
  }
  for (const dependency of declared) {
    if (!allowed.has(dependency))
      failures.push(`${packageName}: manifest declares forbidden package ${dependency}`);
  }

  if (manifest.private === true) failures.push(`${packageName}: package must be publishable`);
  if (manifest.sideEffects !== false) failures.push(`${packageName}: sideEffects must be false`);
  if (manifest.type !== "module") failures.push(`${packageName}: type must be module`);
  if (manifest.exports?.["."]?.types !== "./dist/index.d.ts") {
    failures.push(`${packageName}: root type export is missing or unstable`);
  }
  if (manifest.exports?.["."]?.import !== "./dist/index.js") {
    failures.push(`${packageName}: root ESM export is missing or unstable`);
  }
}

if (failures.length > 0) {
  throw new Error(`Package boundary verification failed:\n${failures.join("\n")}`);
}
console.log("Package dependency direction and manifest boundaries are valid.");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}
