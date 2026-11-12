import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCommandEnvelope, defineDocument } from "@mikejhill/portable-document-core";
import {
  IndexedDbDocumentStore,
  IndexedDbOutboxStore,
  IndexedDbUnavailableError,
  IndexedDbUpgradeBlockedError,
} from "@mikejhill/portable-document-indexeddb";
import { assertSnapshotStoreConformance } from "@mikejhill/portable-document-testing";
import { definition, initialState, type TestCommand, type TestState } from "./fixture";

type OpenRequestStub = {
  error: DOMException | null;
  onblocked?: () => void;
  onerror?: () => void;
};

const stubFactory = (settle: (request: OpenRequestStub) => void): IDBFactory =>
  ({
    open() {
      const request: OpenRequestStub = { error: null };
      queueMicrotask(() => settle(request));
      return request;
    },
  }) as unknown as IDBFactory;

const openDatabase = (factory: IDBFactory, name: string, version: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

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

  it("rejects blocked upgrades and failed opens with explicit errors", async () => {
    const blocked = new IndexedDbDocumentStore(definition, {
      databaseName: "blocked",
      indexedDB: stubFactory((request) => request.onblocked?.()),
      broadcastChannel: null,
    });
    const blockedError = await blocked.load("doc").catch((error: unknown) => error);
    expect(blockedError).toBeInstanceOf(IndexedDbUpgradeBlockedError);
    expect(blockedError).toMatchObject({
      name: "IndexedDbUpgradeBlockedError",
      message: expect.stringMatching(/blocked/),
    });
    blocked.close();

    const failed = new IndexedDbOutboxStore({
      databaseName: "failed",
      indexedDB: stubFactory((request) => request.onerror?.()),
    });
    await expect(failed.list("doc")).rejects.toThrow("IndexedDB open failed.");
    failed.close();

    const factory = new IDBFactory();
    (await openDatabase(factory, "newer", 2)).close();
    const newer = new IndexedDbDocumentStore(definition, {
      databaseName: "newer",
      indexedDB: factory,
      broadcastChannel: null,
    });
    await expect(newer.load("doc")).rejects.toMatchObject({ name: "VersionError" });
    newer.close();
  });

  it("refuses to store states that fail validation", async () => {
    const store = new IndexedDbDocumentStore(definition, {
      databaseName: "invalid-writes",
      indexedDB: new IDBFactory(),
      broadcastChannel: null,
    });
    const invalid = { title: 1, items: {} } as unknown as TestState;
    await expect(store.create("doc", invalid)).rejects.toThrow(/invalid document state/);
    await store.create("doc", initialState);
    await expect(store.replace("doc", invalid, 1)).rejects.toThrow(/invalid document state/);
    expect(await store.load("doc")).toMatchObject({ revision: 1, state: initialState });
    store.close();
  });

  it("refuses stored records that the current definition cannot read", async () => {
    const factory = new IDBFactory();
    const writer = new IndexedDbDocumentStore(definition, {
      databaseName: "shared-records",
      indexedDB: factory,
      broadcastChannel: null,
    });
    await writer.create("doc", initialState);
    writer.close();

    const otherType = new IndexedDbDocumentStore(
      defineDocument({ ...definition, type: "other.document" }),
      { databaseName: "shared-records", indexedDB: factory, broadcastChannel: null },
    );
    await expect(otherType.load("doc")).rejects.toThrow(/wrong type/);
    otherType.close();

    const stricter = new IndexedDbDocumentStore(
      defineDocument({
        ...definition,
        stateSchema: z.object({
          title: z.string().min(50),
          items: z.record(z.string(), z.string()),
        }),
      }),
      { databaseName: "shared-records", indexedDB: factory, broadcastChannel: null },
    );
    await expect(stricter.load("doc")).rejects.toThrow(/invalid or incompatible/);
    await expect(stricter.listCheckpoints("doc")).rejects.toThrow(/checkpoint is invalid/);
    stricter.close();
  });

  it("returns outbox records in staging order", async () => {
    const outbox = new IndexedDbOutboxStore({
      databaseName: "outbox-order",
      indexedDB: new IDBFactory(),
    });
    const record = (id: string, stagedAt: number) => ({
      envelope: createCommandEnvelope<TestCommand>({
        id,
        documentId: "doc",
        documentType: definition.type,
        baseRevision: 1,
        command: { type: "title", value: id },
      }),
      stagedAt,
    });
    await outbox.put(record("a", 3));
    await outbox.put(record("b", 1));
    await outbox.put(record("c", 2));
    expect((await outbox.list("doc")).map((value) => value.envelope.id)).toEqual(["b", "c", "a"]);
    outbox.close();
  });

  it("notifies subscribers in other tabs through BroadcastChannel", async () => {
    const factory = new IDBFactory();
    const writer = new IndexedDbDocumentStore(definition, {
      databaseName: "tabs",
      indexedDB: factory,
      broadcastChannel: BroadcastChannel,
    });
    const reader = new IndexedDbDocumentStore(definition, {
      databaseName: "tabs",
      indexedDB: factory,
    });
    const received: string[] = [];
    const listener = vi.fn((snapshot: { id: string; revision: number }) =>
      received.push(`${snapshot.id}:${snapshot.revision}`),
    );
    reader.subscribe("doc", listener);

    const foreign = new BroadcastChannel("tabs:portable-documents");
    foreign.postMessage({ id: "doc" });
    await writer.create("doc", initialState);
    await vi.waitFor(() => expect(received).toEqual(["doc:1"]));

    await writer.delete("doc");
    await writer.create("other", initialState);
    await vi.waitFor(async () => expect(await reader.load("other")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual(["doc:1"]);

    foreign.close();
    writer.close();
    reader.close();
  });
});
