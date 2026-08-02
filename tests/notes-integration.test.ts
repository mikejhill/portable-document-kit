import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createCommandEnvelope } from "@mikejhill/portable-document-core";
import { PortableSnapshotCodec } from "@mikejhill/portable-document-codec";
import { IndexedDbDocumentStore } from "@mikejhill/portable-document-indexeddb";
import { OccReplicationEngine } from "@mikejhill/portable-document-sync";
import { InMemoryDocumentStore, InMemoryOutboxStore } from "@mikejhill/portable-document-testing";
import {
  initialNotebook,
  notebookDefinition,
  type NotebookCommand,
} from "../examples/structured-notes/src/model";

describe("structured notes integration scenarios", () => {
  it("round trips URL snapshots and durable nested checkpoints", async () => {
    const codec = new PortableSnapshotCodec({ prefix: "#pdn1:", definition: notebookDefinition });
    expect(codec.decode(codec.encode(initialNotebook))).toEqual({
      ok: true,
      state: initialNotebook,
      kind: "document",
      legacy: false,
    });
    const store = new IndexedDbDocumentStore(notebookDefinition, {
      databaseName: "notes-proof",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
    });
    await store.create(initialNotebook.id, initialNotebook);
    const moved = createCommandEnvelope<NotebookCommand>({
      id: "move",
      documentId: initialNotebook.id,
      documentType: notebookDefinition.type,
      baseRevision: 1,
      command: { type: "move-node", nodeId: "field-1", parentId: "intro", index: 0 },
    });
    expect(await store.commit(moved, "Nested Move")).toMatchObject({
      ok: true,
      snapshot: { revision: 2 },
    });
    expect(await store.restore(initialNotebook.id, 2)).toMatchObject({
      state: { nodes: { intro: { childIds: ["field-1", "text-1"] } } },
    });
    store.close();
  });

  it("merges independent node edits and retains same-field conflicts", async () => {
    const remote = new InMemoryDocumentStore(notebookDefinition);
    const initial = await remote.create(initialNotebook.id, initialNotebook);
    const title = createCommandEnvelope<NotebookCommand>({
      id: "title",
      documentId: initial.id,
      documentType: notebookDefinition.type,
      baseRevision: 1,
      command: { type: "set-title", title: "Remote title" },
    });
    expect(await remote.commit(title)).toMatchObject({ ok: true, snapshot: { revision: 2 } });
    const independent = createCommandEnvelope<NotebookCommand>({
      id: "field",
      documentId: initial.id,
      documentType: notebookDefinition.type,
      baseRevision: 1,
      command: { type: "update-node", nodeId: "field-1", patch: { value: "Published" } },
    });
    expect(await remote.commit(independent)).toMatchObject({
      ok: true,
      snapshot: {
        revision: 3,
        state: { title: "Remote title", nodes: { "field-1": { value: "Published" } } },
      },
    });
    const overlap = createCommandEnvelope<NotebookCommand>({
      id: "field-overlap",
      documentId: initial.id,
      documentType: notebookDefinition.type,
      baseRevision: 2,
      command: { type: "update-node", nodeId: "field-1", patch: { value: "Local" } },
    });
    expect(await remote.commit(overlap)).toMatchObject({
      ok: false,
      failure: { code: "conflict" },
      latest: { state: { nodes: { "field-1": { value: "Published" } } } },
    });
  });

  it("replays offline notes from a durable outbox after restart", async () => {
    const backing = new InMemoryDocumentStore(notebookDefinition);
    const initial = await backing.create(initialNotebook.id, initialNotebook);
    const outbox = new InMemoryOutboxStore<NotebookCommand>();
    const unavailable = { commit: vi.fn().mockRejectedValue(new Error("offline")) };
    const first = new OccReplicationEngine(notebookDefinition, initial, unavailable, outbox, {
      classifyFailure: () => "offline",
      idleDelayMs: 100_000,
      maxDelayMs: 100_000,
      createId: () => "offline-note",
    });
    await first.dispatch({
      type: "update-node",
      nodeId: "text-1",
      patch: { text: "Written offline" },
    });
    await first.flush();
    expect(first.getSnapshot().status).toBe("offline");
    first.dispose();

    const restarted = new OccReplicationEngine(notebookDefinition, initial, backing, outbox);
    await restarted.restorePending();
    expect(restarted.getSnapshot()).toMatchObject({
      status: "clean",
      head: { state: { nodes: { "text-1": { text: "Written offline" } } } },
    });
    restarted.dispose();
  });
});
