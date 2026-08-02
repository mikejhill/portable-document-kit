import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mikejhill/portable-document-core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@mikejhill/portable-document-firebase": fileURLToPath(
        new URL("./packages/firebase/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/firestore-rules.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["packages/firebase/src/**/*.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/firebase",
      thresholds: { statements: 85, lines: 85, branches: 55, functions: 80 },
    },
  },
});
