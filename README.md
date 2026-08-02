# Portable Document Kit

Portable Document Kit is a browser-first TypeScript platform for validated, versioned, local-first
structured documents. A consumer defines its state, semantic commands, migrations, summary, and
conflict policy once. Optional packages add URL snapshots, IndexedDB persistence, optimistic
replication, Firebase collaboration, and React bindings.

The packages contain no product UI, analytics, remote logging, or application-specific terminology.
URL-only consumers do not load Firebase, IndexedDB, or React.

## Choose Capabilities

| Need                                           | Packages                    |
| ---------------------------------------------- | --------------------------- |
| Validated document model and workspace         | `core`                      |
| Portable URL fragments                         | `core`, `codec`, `browser`  |
| Device-local library and durable outbox        | `core`, `indexeddb`         |
| Optimistic concurrency and offline replay      | `core`, `sync`, `indexeddb` |
| Firebase identity and collaboration            | `core`, `firebase`          |
| React providers and hooks                      | `core`, `react`             |
| Adapter conformance and fault-controlled tests | `core`, `testing`           |

All published packages use the scope `@mikejhill/portable-document-*`.

## Install

Install only the capabilities used by the consumer:

```bash
npm install @mikejhill/portable-document-core
npm install @mikejhill/portable-document-codec @mikejhill/portable-document-browser
npm install @mikejhill/portable-document-indexeddb @mikejhill/portable-document-sync
npm install @mikejhill/portable-document-firebase firebase
npm install @mikejhill/portable-document-react react
```

Node 20.19 or newer is required for development and package tooling. Runtime packages are ESM and
browser-first. Browser adapters delay access to browser globals until an adapter is constructed.

## Minimal Document

Zod implements the Standard Schema contract, but consumers may use any synchronous Standard
Schema-compatible validator.

```ts
import { defineDocument } from "@mikejhill/portable-document-core";
import { z } from "zod";

const noteSchema = z.object({ title: z.string(), body: z.string() });
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rename"), title: z.string() }),
  z.object({ type: z.literal("edit-body"), body: z.string() }),
]);

export const noteDocument = defineDocument({
  type: "example.note",
  currentSchemaVersion: 1,
  stateSchema: noteSchema,
  commandSchema,
  migrations: [],
  reduce(state, command) {
    if (command.type === "rename") return { ok: true, state: { ...state, title: command.title } };
    return { ok: true, state: { ...state, body: command.body } };
  },
  summarize: (state) => ({ title: state.title }),
  commandPolicy: {
    inspect: (command) => ({
      targets: [command.type === "rename" ? "title" : "body"],
      coalescingKey: command.type,
      durability: "coalesced",
      conflictLabel: command.type === "rename" ? "Title" : "Body",
    }),
  },
});
```

Continue with [Getting Started](docs/getting-started.md) for URL, IndexedDB, synchronization,
Firebase, and React composition.

## Documentation

- [Getting Started](docs/getting-started.md): runnable capability recipes.
- [Package Guide](docs/packages.md): package responsibilities and dependency direction.
- [Architecture](docs/architecture.md): layers, trust boundaries, and lifecycle.
- [Design Principles](docs/design-principles.md): invariants and extension philosophy.
- [Consumer Guide](docs/consumer-guide.md): document and failure-policy guidance.
- [Backend Author Guide](docs/backend-author-guide.md): implementing provider ports.
- [Testing and CI](docs/testing.md): local gates, emulators, coverage, and release evidence.
- [Compatibility](docs/compatibility.md): independently versioned formats.
- [Squarecast Migration](docs/squarecast-migration.md): compatibility-preserving adoption.
- [ADRs](docs/adr/README.md): durable architecture decisions.

Public declarations are snapshot-tested in [`api/`](api/). Each package README documents its primary
classes and links to the relevant guides.

## Repository Development

```bash
npm ci
npm run quality
npm run test:coverage
npm run check
```

`npm run check` verifies formatting, linting, Markdown and local links, package boundaries, strict
TypeScript, unit tests, Firestore Rules integration tests, production builds, API snapshots, and
isolated packed-package installation.

Packages remain at `0.x` while Squarecast compatibility and the structured-notes proof consumer are
stabilized. Stored formats and public protocols require explicit migrations even before `1.0`.

## License

MIT
