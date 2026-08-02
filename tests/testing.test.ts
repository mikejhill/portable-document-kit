import { describe, expect, it, vi } from "vitest";
import { createCommandEnvelope } from "@mikejhill/portable-document-core";
import { FakeClock, InMemoryDocumentStore, InMemoryOutboxStore, assertSnapshotStoreConformance } from "@mikejhill/portable-document-testing";
import { definition, initialState } from "./fixture";

describe("testing reference adapters", () => {
  it("provides deterministic clocks with guarded progression", () => {
    const clock = new FakeClock(10);
    clock.advance(5);
    expect(clock.now()).toBe(15);
    expect(() => clock.advance(-1)).toThrow(/backward/);
  });

  it("passes conformance and protects stored values from mutation", async () => {
    const store = new InMemoryDocumentStore(definition, () => 10);
    await assertSnapshotStoreConformance({ store, id: "conformance", initial: initialState, replacement: { title: "Next", items: {} } });
    const created = await store.create("doc", initialState);
    (created.state.items as Record<string, string>).a = "mutated";
    expect((await store.load("doc"))?.state.items.a).toBe("A");
    expect(await store.list()).toEqual([expect.objectContaining({ id: "doc", revision: 1 })]);
    await expect(store.create("doc", initialState)).rejects.toThrow(/exists/);
    await expect(store.replace("missing", initialState, 1)).rejects.toThrow(/revision/);
  });

  it("notifies subscribers, commits idempotently, and exercises failure paths", async () => {
    const store = new InMemoryDocumentStore(definition, () => 20);
    const listener = vi.fn();
    const unsubscribe = store.subscribe("doc", listener);
    await store.create("doc", initialState);
    const command = createCommandEnvelope({ id: "one", documentId: "doc", documentType: definition.type, baseRevision: 1, command: { type: "set" as const, id: "b", value: "B" } });
    expect(await store.commit(command, "Add")).toMatchObject({ ok: true, snapshot: { revision: 2 } });
    expect(await store.commit(command)).toMatchObject({ ok: true, snapshot: { revision: 2 } });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await store.replace("doc", { title: "Replaced", items: {} }, 2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await store.listCheckpoints("doc")).toHaveLength(2);
    expect(await store.restore("doc", 2)).toMatchObject({ reason: "Add" });
    await expect(store.restore("doc", 99)).rejects.toThrow(/Checkpoint/);
    expect(await store.commit({ ...command, id: "missing", documentId: "missing" })).toMatchObject({ ok: false, failure: { code: "missing-target" } });
    expect(await store.commit({ ...command, id: "bad", command: { type: "delete", id: "missing" } })).toMatchObject({ ok: false, latest: { id: "doc" } });
  });

  it("orders and isolates in-memory outbox records", async () => {
    const outbox = new InMemoryOutboxStore<{ type: string }>();
    const record = (id: string, documentId: string, stagedAt: number) => ({
      envelope: createCommandEnvelope({ id, documentId, documentType: definition.type, baseRevision: 1, command: { type: "x" } }),
      stagedAt,
    });
    await outbox.put(record("later", "doc", 2));
    await outbox.put(record("other", "other", 0));
    await outbox.replace("later", record("earlier", "doc", 1));
    expect((await outbox.list("doc")).map((value) => value.envelope.id)).toEqual(["earlier"]);
    await outbox.delete("earlier");
    expect(await outbox.list("doc")).toEqual([]);
  });

  it("merges independent stale targets and rejects overlapping ones", async () => {
    const store = new InMemoryDocumentStore(definition);
    await store.create("doc", initialState);
    const remoteTitle = createCommandEnvelope({ id: "remote", documentId: "doc", documentType: definition.type, baseRevision: 1, command: { type: "title" as const, value: "Remote" } });
    expect(await store.commit(remoteTitle)).toMatchObject({ ok: true, snapshot: { revision: 2 } });
    const independent = createCommandEnvelope({ id: "independent", documentId: "doc", documentType: definition.type, baseRevision: 1, command: { type: "set" as const, id: "b", value: "B" } });
    expect(await store.commit(independent)).toMatchObject({ ok: true, snapshot: { revision: 3, state: { title: "Remote", items: { b: "B" } } } });
    const overlapping = createCommandEnvelope({ id: "overlap", documentId: "doc", documentType: definition.type, baseRevision: 2, command: { type: "set" as const, id: "b", value: "Local" } });
    expect(await store.commit(overlapping)).toMatchObject({ ok: false, failure: { code: "conflict" }, latest: { revision: 3 } });
  });
});
