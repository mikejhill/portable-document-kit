import { describe, expect, it, vi } from "vitest";
import { WorkspaceEngine, createCommandEnvelope, type DocumentSnapshot, type RouteResolution } from "@mikejhill/portable-document-core";
import { definition, initialState, type TestState, type TestSummary } from "./fixture";

const snapshot: DocumentSnapshot<TestState, TestSummary> = {
  id: "document-1",
  documentType: definition.type,
  schemaVersion: 1,
  state: initialState,
  summary: definition.summarize(initialState),
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  appliedCommandIds: [],
  lastTargets: [],
};

describe("workspace engine", () => {
  it("exposes recoverable route errors without replacement documents", async () => {
    const engine = new WorkspaceEngine(definition, {
      resolve: async (): Promise<RouteResolution<TestState, TestSummary>> => ({ ok: false, code: "not-found", message: "Missing" }),
    });
    await engine.open("#missing");
    expect(engine.getSnapshot()).toEqual({ status: "error", route: "#missing", code: "not-found", message: "Missing" });
  });

  it("applies speculative commands and restores historical heads", async () => {
    const engine = new WorkspaceEngine(definition, {
      resolve: async () => ({ ok: true as const, value: { snapshot, source: "device" as const, readOnly: false } }),
    });
    await engine.open("#local");
    const failure = engine.applySpeculative(createCommandEnvelope({ id: "one", documentId: snapshot.id, documentType: definition.type, baseRevision: 1, issuedAt: 2, command: { type: "title" as const, value: "Next" } }));
    expect(failure).toBeNull();
    expect(engine.getSnapshot()).toMatchObject({ status: "ready", snapshot: { state: { title: "Next" } } });
    engine.viewHistorical({ ...snapshot, revision: 0 });
    expect(engine.getSnapshot()).toMatchObject({ readOnly: true, historicalRevision: 0 });
    engine.returnToHead();
    expect(engine.getSnapshot()).toMatchObject({ readOnly: false, snapshot: { revision: 1 } });
  });

  it("ignores superseded asynchronous route resolutions", async () => {
    const resolvers = new Map<string, (value: RouteResolution<TestState, TestSummary>) => void>();
    const engine = new WorkspaceEngine(definition, {
      resolve: (route) => new Promise((resolve) => resolvers.set(route, resolve)),
    });
    const first = engine.open("#first");
    const second = engine.open("#second");
    resolvers.get("#second")!({ ok: false, code: "revoked", message: "Revoked" });
    await second;
    resolvers.get("#first")!({ ok: true, value: { snapshot, source: "url", readOnly: false } });
    await first;
    expect(engine.getSnapshot()).toMatchObject({ status: "error", route: "#second", code: "revoked" });
  });

  it("contains resolver failures and notifies only active subscribers", async () => {
    const engine = new WorkspaceEngine(definition, { resolve: async () => { throw new Error("provider"); } });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    await engine.open("#broken");
    expect(engine.getSnapshot()).toMatchObject({ status: "error", code: "unavailable" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await engine.open("#again");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects writes in idle, read-only, and mismatched workspaces", async () => {
    const engine = new WorkspaceEngine(definition, { resolve: async () => ({ ok: true as const, value: { snapshot, source: "publication" as const, readOnly: true } }) });
    const envelope = createCommandEnvelope({ id: "one", documentId: snapshot.id, documentType: definition.type, baseRevision: 1, command: { type: "title" as const, value: "Next" } });
    expect(engine.applySpeculative(envelope)).toMatchObject({ code: "permission-denied" });
    await engine.open("#view");
    expect(engine.applySpeculative(envelope)).toMatchObject({ code: "permission-denied" });
    const writable = new WorkspaceEngine(definition, { resolve: async () => ({ ok: true as const, value: { snapshot, source: "device" as const, readOnly: false } }) });
    await writable.open("#local");
    expect(writable.applySpeculative({ ...envelope, documentId: "other" })).toMatchObject({ code: "failed-precondition" });
    expect(writable.applySpeculative({ ...envelope, command: { type: "delete", id: "missing" } })).toMatchObject({ code: "missing-target" });
  });

  it("accepts current heads, rejects stale or unrelated heads, and disposes pending work", async () => {
    let resolve!: (value: RouteResolution<TestState, TestSummary>) => void;
    const engine = new WorkspaceEngine(definition, { resolve: () => new Promise((done) => { resolve = done; }) });
    const opening = engine.open("#local");
    engine.dispose();
    resolve({ ok: true, value: { snapshot, source: "device", readOnly: false } });
    await opening;
    expect(engine.getSnapshot()).toMatchObject({ status: "loading" });
    await engine.open("#ignored");

    const active = new WorkspaceEngine(definition, { resolve: async () => ({ ok: true as const, value: { snapshot, source: "device" as const, readOnly: false } }) });
    await active.open("#local");
    active.acceptHead({ ...snapshot, revision: 0 });
    active.acceptHead({ ...snapshot, id: "other", revision: 2 });
    expect(active.getSnapshot()).toMatchObject({ snapshot: { revision: 1 } });
    active.acceptHead({ ...snapshot, revision: 2, state: { ...initialState, title: "Remote" } });
    expect(active.getSnapshot()).toMatchObject({ snapshot: { revision: 2, state: { title: "Remote" } } });
    active.viewHistorical({ ...snapshot, id: "other", revision: 0 });
    expect(active.getSnapshot()).toMatchObject({ historicalRevision: undefined });
  });
});
