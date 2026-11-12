import { describe, expect, it, vi } from "vitest";
import { createCommandEnvelope, type OutboxRecord } from "@mikejhill/portable-document-core";
import { OccReplicationEngine } from "@mikejhill/portable-document-sync";
import {
  FakeClock,
  InMemoryDocumentStore,
  InMemoryOutboxStore,
} from "@mikejhill/portable-document-testing";
import { definition, initialState } from "./fixture";

describe("OCC replication", () => {
  it("stages, coalesces, commits, and acknowledges semantic commands", async () => {
    const clock = new FakeClock();
    const remote = new InMemoryDocumentStore(definition, clock.now);
    const initial = await remote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    let sequence = 0;
    const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
      now: clock.now,
      createId: () => `command-${++sequence}`,
      idleDelayMs: 100_000,
      maxDelayMs: 100_000,
    });
    await engine.dispatch({ type: "title", value: "First" });
    await engine.dispatch({ type: "title", value: "Second" });
    expect(engine.getSnapshot().pending).toHaveLength(1);
    expect(engine.getSnapshot().visible.state.title).toBe("Second");
    await engine.flush();
    expect(engine.getSnapshot()).toMatchObject({
      status: "clean",
      head: { revision: 2, state: { title: "Second" } },
    });
    engine.dispose();
  });

  it("does not regress on stale remote snapshots", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const engine = new OccReplicationEngine(definition, initial, remote, new InMemoryOutboxStore());
    await engine.receiveRemote({
      ...initial,
      revision: 0,
      state: { ...initialState, title: "Stale" },
    });
    expect(engine.getSnapshot().head.state.title).toBe("Initial");
    engine.dispose();
  });

  it("retains recoverable edit-after-delete conflicts", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", { title: "X", items: {} });
    const engine = new OccReplicationEngine(definition, initial, remote, new InMemoryOutboxStore());
    const failure = await engine.dispatch({ type: "delete", id: "missing" });
    expect(failure).toEqual({
      code: "missing-target",
      message: "Item is gone.",
      recoverable: "missing",
    });
    engine.dispose();
  });

  it("restores durable pending commands after restart", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    const envelope = createCommandEnvelope({
      id: "restored",
      documentId: "doc",
      documentType: definition.type,
      baseRevision: 1,
      issuedAt: 2,
      command: { type: "set" as const, id: "b", value: "B" },
    });
    await outbox.put({ envelope, stagedAt: 2 });
    const engine = new OccReplicationEngine(definition, initial, remote, outbox);
    await engine.restorePending();
    expect(engine.getSnapshot()).toMatchObject({
      status: "clean",
      head: { revision: 2, state: { items: { b: "B" } } },
      pending: [],
    });
    expect(await outbox.list("doc")).toEqual([]);
    engine.dispose();
  });

  it("classifies transport failures without dropping durable commands", async () => {
    const remote = { commit: vi.fn().mockRejectedValue(new Error("offline")) };
    const baseRemote = new InMemoryDocumentStore(definition);
    const initial = await baseRemote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
      classifyFailure: () => "offline",
      idleDelayMs: 100_000,
      maxDelayMs: 100_000,
    });
    await engine.dispatch({ type: "title", value: "Pending" });
    await engine.flush();
    expect(engine.getSnapshot()).toMatchObject({
      status: "offline",
      pending: [{ envelope: { command: { value: "Pending" } } }],
    });
    expect(await outbox.list("doc")).toHaveLength(1);
    engine.dispose();
  });

  it("rolls back speculative state when durable staging fails", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const outbox = {
      put: vi.fn().mockRejectedValue(new Error("quota exceeded")),
      replace: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };
    const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
      classifyFailure: () => "unavailable",
    });

    await expect(engine.dispatch({ type: "title", value: "Not Durable" })).resolves.toEqual({
      code: "failed-precondition",
      message: "The command could not be stored durably.",
      recoverable: { type: "title", value: "Not Durable" },
    });
    expect(engine.getSnapshot()).toMatchObject({
      status: "unavailable",
      visible: { state: initialState },
      pending: [],
    });
    engine.dispose();
  });

  it("serializes concurrent staging in semantic dispatch order", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
      idleDelayMs: 100_000,
      maxDelayMs: 100_000,
    });

    await Promise.all([
      engine.dispatch({ type: "set", id: "b", value: "First" }),
      engine.dispatch({ type: "set", id: "c", value: "Second" }),
    ]);

    expect(engine.getSnapshot().visible.state.items).toMatchObject({ b: "First", c: "Second" });
    expect((await outbox.list("doc")).map((record) => record.envelope.command)).toEqual([
      { type: "set", id: "b", value: "First" },
      { type: "set", id: "c", value: "Second" },
    ]);
    engine.dispose();
  });

  it("surfaces remote semantic conflicts with recoverable commands", async () => {
    const baseRemote = new InMemoryDocumentStore(definition);
    const initial = await baseRemote.create("doc", initialState);
    const remote = {
      commit: vi.fn().mockResolvedValue({
        ok: false,
        failure: { code: "conflict", message: "Same target changed." },
        latest: initial,
      }),
    };
    const engine = new OccReplicationEngine(
      definition,
      initial,
      remote,
      new InMemoryOutboxStore(),
      { idleDelayMs: 100_000, maxDelayMs: 100_000 },
    );
    await engine.dispatch({ type: "title", value: "Local" });
    await engine.flush();
    expect(engine.getSnapshot()).toMatchObject({
      status: "conflict",
      conflict: { recoverableCommand: { type: "title", value: "Local" } },
    });
    engine.dispose();
  });

  it("rebases pending commands, filters acknowledgements, and notifies subscribers", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
      idleDelayMs: 100_000,
      maxDelayMs: 100_000,
      createId: () => "pending",
    });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    await engine.dispatch({ type: "set", id: "b", value: "Local" });
    await engine.receiveRemote({
      ...initial,
      revision: 2,
      state: { ...initialState, title: "Remote" },
      summary: { title: "Remote", count: 1 },
      appliedCommandIds: [],
    });
    expect(engine.getSnapshot()).toMatchObject({
      visible: { state: { title: "Remote", items: { b: "Local" } } },
    });
    await engine.receiveRemote({ ...initial, revision: 3, appliedCommandIds: ["pending"] });
    expect(engine.getSnapshot()).toMatchObject({ status: "clean", pending: [] });
    expect(await outbox.list("doc")).toEqual([]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const calls = listener.mock.calls.length;
    await engine.receiveRemote({ ...initial, revision: 4 });
    expect(listener).toHaveBeenCalledTimes(calls);
    engine.dispose();
  });

  it("contains replay conflicts and ignores work after disposal", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    const stale: OutboxRecord<Parameters<typeof definition.reduce>[1]> = {
      envelope: createCommandEnvelope({
        id: "stale",
        documentId: "doc",
        documentType: definition.type,
        baseRevision: 1,
        command: { type: "delete", id: "missing" },
      }),
      stagedAt: 1,
    };
    await outbox.put(stale);
    const engine = new OccReplicationEngine(definition, initial, remote, outbox);
    await engine.restorePending();
    expect(engine.getSnapshot()).toMatchObject({
      status: "conflict",
      conflict: { failure: { code: "missing-target" } },
    });
    engine.dispose();
    expect(await engine.dispatch({ type: "title", value: "ignored" })).toMatchObject({
      code: "failed-precondition",
    });
    await engine.restorePending();
    await engine.flush();
    await engine.receiveRemote({ ...initial, revision: 9 });
    expect(engine.getSnapshot()).toMatchObject({ status: "conflict" });
  });

  it("generates unique command ids by default", async () => {
    const remote = new InMemoryDocumentStore(definition);
    const initial = await remote.create("doc", initialState);
    const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
    const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
      idleDelayMs: 100_000,
      maxDelayMs: 100_000,
    });
    await engine.dispatch({ type: "set", id: "b", value: "B" });
    await engine.dispatch({ type: "set", id: "c", value: "C" });
    const ids = engine.getSnapshot().pending.map((record) => record.envelope.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[\w-]{8,}$/);
    engine.dispose();
  });

  it("flushes after the idle delay and caps continuous edits at the max delay", async () => {
    vi.useFakeTimers();
    try {
      const remote = new InMemoryDocumentStore(definition);
      const initial = await remote.create("doc", initialState);
      const outbox = new InMemoryOutboxStore<Parameters<typeof definition.reduce>[1]>();
      let sequence = 0;
      const engine = new OccReplicationEngine(definition, initial, remote, outbox, {
        createId: () => `command-${++sequence}`,
        idleDelayMs: 100,
        maxDelayMs: 250,
      });

      await engine.dispatch({ type: "title", value: "Idle" });
      await vi.advanceTimersByTimeAsync(99);
      expect(engine.getSnapshot().status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(engine.getSnapshot()).toMatchObject({ status: "clean", head: { revision: 2 } });

      for (let index = 0; index < 3; index += 1) {
        await engine.dispatch({ type: "title", value: `Burst ${index}` });
        await vi.advanceTimersByTimeAsync(80);
      }
      expect(engine.getSnapshot()).toMatchObject({ status: "pending", head: { revision: 2 } });
      await vi.advanceTimersByTimeAsync(10);
      expect(engine.getSnapshot()).toMatchObject({
        status: "clean",
        head: { revision: 3, state: { title: "Burst 2" } },
      });
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
