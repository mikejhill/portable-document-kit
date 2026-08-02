import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const packageSource = (name: string, extension = "ts") =>
  fileURLToPath(new URL(`./packages/${name}/src/index.${extension}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mikejhill/portable-document-core": packageSource("core"),
      "@mikejhill/portable-document-codec": packageSource("codec"),
      "@mikejhill/portable-document-browser": packageSource("browser"),
      "@mikejhill/portable-document-indexeddb": packageSource("indexeddb"),
      "@mikejhill/portable-document-sync": packageSource("sync"),
      "@mikejhill/portable-document-firebase": packageSource("firebase"),
      "@mikejhill/portable-document-react": packageSource("react", "tsx"),
      "@mikejhill/portable-document-testing": packageSource("testing")
    }
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "packages/{browser,codec,core,indexeddb,react,sync,testing}/src/**/*.{ts,tsx}",
        "examples/structured-notes/src/model.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: { statements: 85, lines: 85, branches: 80, functions: 90 }
    }
  }
});
