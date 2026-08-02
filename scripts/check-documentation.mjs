import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const markdownFiles = await collectMarkdown(root);
const failures = [];

for (const packageName of await readdir(join(root, "packages"))) {
  try {
    await access(join(root, "packages", packageName, "README.md"));
  } catch {
    failures.push(`packages/${packageName}/README.md is missing`);
  }
}

for (const file of markdownFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    try {
      await access(resolve(dirname(file), decodeURIComponent(target)));
    } catch {
      failures.push(`${file}: broken local link ${match[1]}`);
    }
  }
}

if (failures.length > 0)
  throw new Error(`Documentation verification failed:\n${failures.join("\n")}`);
console.log(`Verified ${markdownFiles.length} Markdown files and all package READMEs.`);

async function collectMarkdown(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "coverage", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdown(path)));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}
