# Getting Started

This guide composes the kit from the smallest URL-only configuration through offline cloud
replication. Start with the document definition in the root README.

## URL-Only Document

```ts
import { createPortableUrl, FragmentRouter } from "@mikejhill/portable-document-browser";
import { PortableSnapshotCodec } from "@mikejhill/portable-document-codec";
import { noteDocument } from "./note-document.js";

const codec = new PortableSnapshotCodec({
  prefix: "#note1:",
  definition: noteDocument,
  maxEncodedCharacters: 32_000,
  maxDecodedCharacters: 128_000,
});

const hash = codec.encode({ title: "Plan", body: "Draft" });
const decoded = codec.decode(hash);
if (!decoded.ok) throw new Error(`Snapshot rejected: ${decoded.failure.code}`);

const router = new FragmentRouter([{ kind: "snapshot", prefix: "#note1:" }]);
const route = router.parse(hash);
const shareUrl = createPortableUrl(codec, decoded.state, window.location.href);
```

The codec validates before encoding, bounds compressed and decompressed input, validates the
envelope, migrates the document schema, and validates the resulting state. Do not replace typed
decode failures with a new document silently.

## Device-Local Documents

```ts
import {
  IndexedDbDocumentStore,
  IndexedDbOutboxStore,
} from "@mikejhill/portable-document-indexeddb";

const options = { databaseName: "structured-notes" };
const documents = new IndexedDbDocumentStore(noteDocument, options);
const outbox = new IndexedDbOutboxStore(options);

await documents.create("note-01", { title: "Plan", body: "Draft" });
const saved = await documents.load("note-01");
```

Call `close()` when the application lifetime ends. Treat `IndexedDbUpgradeBlockedError` as a
recoverable state that asks the user to close another tab; do not delete the database.

## Optimistic Replication

```ts
import { OccReplicationEngine } from "@mikejhill/portable-document-sync";

if (!saved) throw new Error("The note is missing.");
const replication = new OccReplicationEngine(noteDocument, saved, remoteCommitStore, outbox);
await replication.restorePending();
await replication.dispatch({ type: "rename", title: "Published Plan" });
```

`remoteCommitStore` implements the narrow `CommandCommitStore` port. The engine persists a command
before considering it pending, serializes commits per document, rebases pending commands over remote
snapshots, and retains recoverable conflicts.

## Workspace Routing

Implement `WorkspaceRouteResolver` for the route namespaces used by the consumer, then construct a
headless `WorkspaceEngine`. Resolution failures are explicit and recoverable.

```ts
import { WorkspaceEngine } from "@mikejhill/portable-document-core";

const workspace = new WorkspaceEngine(noteDocument, resolver);
workspace.subscribe(() => render(workspace.getSnapshot()));
await workspace.open(window.location.hash);
```

## React

```tsx
import { PortableDocumentProvider, useWorkspace } from "@mikejhill/portable-document-react";

function NoteStatus() {
  const workspace = useWorkspace();
  return <output>{workspace.status}</output>;
}

root.render(
  <PortableDocumentProvider engine={workspace} disposeOnUnmount>
    <NoteStatus />
  </PortableDocumentProvider>,
);
```

Keep labels, dialogs, promotion prompts, and conflict presentation in the consumer.

## Firebase

Deploy the fixed rules and indexes shipped by the Firebase package. Construct `FirebaseRuntime` with
the modular Firebase SDK functions and provide the current principal to `FirebaseDocumentStore`. App
Check initialization is deferred until the first Firestore access; URL-only and IndexedDB-only
sessions do not initialize it.

See the [Backend Author Guide](backend-author-guide.md) for provider guarantees and
[Testing and CI](testing.md) for emulator requirements.
