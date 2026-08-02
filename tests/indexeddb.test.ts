import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createCommandEnvelope } from "@mikejhill/portable-document-core";
import {
  IndexedDbDocumentStore,
  IndexedDbOutboxStore,
  IndexedDbUnavailableError,
} from "@mikejhill/portable-document-indexeddb";
import { assertSnapshotStoreConformance } from "@mikejhill/portable-document-testing";
import { definition, initialState, type TestCommand } from "./fixture";

describe("IndexedDB adapters", () => {
  it("passes snapshot store conformance", async () => {
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "conformance",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
    });
    await assertSnapshotStoreConformance({
      store,
      id: "document-1",
      initial: initialState,
      replacement: { title: "Replaced", items: {} },
    });
    store.close();
  });

  it("commits idempotent commands and stores checkpoints", async () => {
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "commands",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
      now: () => 10,
    });
    await store.create("document-1", initialState);
    const envelope = createCommandEnvelope<TestCommand>({
      id: "one",
      documentId: "document-1",
      documentType: definition.type,
      baseRevision: 1,
      issuedAt: 10,
      command: { type: "set", id: "b", value: "B" },
    });
    expect(await store.commit(envelope, "Add Item")).toMatchObject({
      ok: true,
      snapshot: { revision: 2 },
    });
    expect(await store.commit(envelope)).toMatchObject({ ok: true, snapshot: { revision: 2 } });
    expect(await store.listCheckpoints("document-1")).toHaveLength(2);
    store.close();
  });

  it("persists and atomically replaces outbox records", async () => {
    const factory = new IDBFactory();
    const outbox = new IndexedDbOutboxStore({
      databaseName: "outbox",
      indexedDB: factory,
      broadcastChannel: null,
    });
    const first = {
      envelope: createCommandEnvelope({
        id: "one",
        documentId: "doc",
        documentType: definition.type,
        baseRevision: 1,
        issuedAt: 1,
        command: { type: "title", value: "A" },
      }),
      stagedAt: 1,
    } as const;
    const second = {
      envelope: createCommandEnvelope({
        id: "two",
        documentId: "doc",
        documentType: definition.type,
        baseRevision: 1,
        issuedAt: 2,
        command: { type: "title", value: "B" },
      }),
      stagedAt: 2,
    } as const;
    await outbox.put(first);
    await outbox.replace("one", second);
    expect((await outbox.list("doc")).map((record) => record.envelope.id)).toEqual(["two"]);
    await outbox.delete("two");
    expect(await outbox.list("doc")).toEqual([]);
    outbox.close();
  });

  it("fails explicitly when IndexedDB is unavailable", async () => {
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "unavailable",
      indexedDB: null as never,
      broadcastChannel: null,
    });
    await expect(store.load("doc")).rejects.toBeInstanceOf(IndexedDbUnavailableError);
    store.close();
  });

  it("lists newest documents and notifies local subscribers", async () => {
    let time = 1;
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "catalog",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
      now: () => time++,
    });
    const events: string[] = [];
    const unsubscribe = store.subscribe("a", (snapshot) =>
      events.push(`${snapshot.id}:${snapshot.revision}`),
    );
    await store.create("a", initialState);
    await store.create("b", { title: "B", items: {} });
    await store.replace("a", { title: "A2", items: {} }, 1);
    expect(events).toEqual(["a:1", "a:2"]);
    expect((await store.list()).map((value) => value.id)).toEqual(["a", "b"]);
    unsubscribe();
    await store.replace("a", initialState, 2);
    expect(events).toHaveLength(2);
    store.close();
  });

  it("rejects duplicate creates, stale replacements, wrong types, and missing targets", async () => {
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "failures",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
    });
    await store.create("doc", initialState);
    await expect(store.create("doc", initialState)).rejects.toThrow(/exists/);
    await expect(store.replace("doc", initialState, 99)).rejects.toThrow(/revision/);
    const base = createCommandEnvelope<TestCommand>({
      id: "one",
      documentId: "doc",
      documentType: definition.type,
      baseRevision: 1,
      command: { type: "title", value: "X" },
    });
    expect(await store.commit({ ...base, documentType: "wrong" })).toMatchObject({
      ok: false,
      failure: { code: "failed-precondition" },
    });
    expect(await store.commit({ ...base, documentId: "missing" })).toMatchObject({
      ok: false,
      failure: { code: "missing-target" },
    });
    expect(
      await store.commit({ ...base, command: { type: "delete", id: "missing" } }),
    ).toMatchObject({ ok: false, latest: { id: "doc" } });
    store.close();
  });

  it("enforces checkpoint retention and restores retained revisions", async () => {
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "history",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
      checkpointLimit: 2,
    });
    await store.create("doc", initialState);
    for (let index = 0; index < 3; index += 1) {
      await store.commit(
        createCommandEnvelope<TestCommand>({
          id: `c${index}`,
          documentId: "doc",
          documentType: definition.type,
          baseRevision: index + 1,
          command: { type: "title", value: String(index) },
        }),
        `Change ${index}`,
      );
    }
    const checkpoints = await store.listCheckpoints("doc");
    expect(checkpoints.map((value) => value.revision)).toEqual([4, 3]);
    expect(await store.restore("doc", 3)).toMatchObject({ state: { title: "1" } });
    await expect(store.restore("doc", 1)).rejects.toThrow(/Checkpoint/);
    await store.delete("doc");
    expect(await store.listCheckpoints("doc")).toEqual([]);
    store.close();
  });
});
