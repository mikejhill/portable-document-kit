import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const snapshotDirectory = join(root, "api");
const update = process.argv.includes("--update");
const packageEntries = await readdir(join(root, "packages"), { withFileTypes: true });
const failures = [];

if (update) await mkdir(snapshotDirectory, { recursive: true });
for (const entry of packageEntries.filter((candidate) => candidate.isDirectory())) {
  const declarationPath = join(root, "packages", entry.name, "dist", "index.d.ts");
  const snapshotPath = join(snapshotDirectory, `${entry.name}.d.ts`);
  const declaration = normalize(await readFile(declarationPath, "utf8"));
  if (update) {
    await writeFile(snapshotPath, declaration);
    continue;
  }
  let snapshot;
  try {
    snapshot = normalize(await readFile(snapshotPath, "utf8"));
  } catch {
    failures.push(`${entry.name}: snapshot is missing`);
    continue;
  }
  if (snapshot !== declaration) failures.push(`${entry.name}: public declarations changed`);
}

if (failures.length) {
  throw new Error(
    `API snapshot verification failed:\n${failures.join("\n")}\nRun npm run api:update after reviewing the public changes.`,
  );
}
console.log(
  update
    ? `Updated API snapshots in ${basename(snapshotDirectory)}.`
    : "API snapshots match built declarations.",
);

function normalize(value) {
  return value.replaceAll("\r\n", "\n").trimEnd() + "\n";
}
