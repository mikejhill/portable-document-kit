import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "portable-document-kit-consumer-"));

try {
  const packageRoot = join(root, "packages");
  const directories = await readdir(packageRoot, { withFileTypes: true });
  const tarballs = [];
  for (const directory of directories.filter((entry) => entry.isDirectory())) {
    const packageDirectory = join(packageRoot, directory.name);
    const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
    if (manifest.private) continue;
    runNpm(["pack", packageDirectory, "--pack-destination", temporary, "--json"]);
  }
  for (const entry of await readdir(temporary)) {
    if (entry.endsWith(".tgz")) tarballs.push(join(temporary, entry));
  }
  if (tarballs.length !== 8) throw new Error(`Expected 8 publishable packages; found ${tarballs.length}.`);

  await writeFile(join(temporary, "package.json"), JSON.stringify({ name: "pdk-install-verification", private: true, type: "module" }));
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], temporary);
  await writeFile(join(temporary, "verify.mjs"), `
    import { defineDocument } from "@mikejhill/portable-document-core";
    import { PortableSnapshotCodec } from "@mikejhill/portable-document-codec";
    await Promise.all([
      import("@mikejhill/portable-document-browser"),
      import("@mikejhill/portable-document-indexeddb"),
      import("@mikejhill/portable-document-sync"),
      import("@mikejhill/portable-document-firebase"),
      import("@mikejhill/portable-document-react"),
      import("@mikejhill/portable-document-testing"),
    ]);
    if (typeof defineDocument !== "function" || typeof PortableSnapshotCodec !== "function") process.exit(1);
  `);
  run("node", ["verify.mjs"], temporary);
  console.log("Verified 8 packed packages in an isolated consumer.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function run(command, arguments_, cwd = root) {
  const result = spawnSync(command, arguments_, { cwd, shell: false, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

function runNpm(arguments_, cwd = root) {
  if (!process.env.npm_execpath) throw new Error("npm_execpath is unavailable.");
  run(process.execPath, [process.env.npm_execpath, ...arguments_], cwd);
}
