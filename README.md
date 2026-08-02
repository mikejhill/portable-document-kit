# Portable Document Kit

Portable Document Kit is a headless TypeScript platform for validated,
versioned documents that can live in URLs, IndexedDB, or collaborative cloud
repositories. Consumers define state, semantic commands, migrations, and
conflict targets. Optional packages add browser routing, synchronization,
Firebase, and React without coupling them to the core.

## Capability Sets

```text
URL only       core + codec + browser
Device local   core + indexeddb
Collaborative  core + indexeddb + sync + firebase
React          any capability set + react
```

The repository contains a structured-notes reference application. Squarecast
compatibility is maintained through consumer-owned codecs and route prefixes;
portable and stored formats are never implicitly upgraded.

## Installation

Install only the capabilities a consumer needs:

```bash
npm install @mikejhill/portable-document-core
npm install @mikejhill/portable-document-codec @mikejhill/portable-document-browser
npm install @mikejhill/portable-document-indexeddb @mikejhill/portable-document-sync
npm install @mikejhill/portable-document-firebase
npm install @mikejhill/portable-document-react react
```

Packages remain at `0.x` while the Squarecast compatibility migration and the
structured-notes proof consumer are stabilized. See the Consumer Guide before
depending on protocol or repository formats.

## Development

```bash
npm install
npm run check
npm run test:coverage
```

See [Architecture](docs/architecture.md), [Compatibility](docs/compatibility.md),
the [Consumer Guide](docs/consumer-guide.md), the
[Backend Author Guide](docs/backend-author-guide.md), the
[Squarecast Migration](docs/squarecast-migration.md), and the
[ADRs](docs/adr/README.md).

## License

MIT
