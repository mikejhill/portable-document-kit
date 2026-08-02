// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEngine, createCommandEnvelope } from "@mikejhill/portable-document-core";
import { PortableDocumentProvider, useWorkspace, useWorkspaceActions, useWorkspaceEngine, useWorkspaceSelector } from "@mikejhill/portable-document-react";
import { definition, initialState } from "./fixture";

afterEach(cleanup);

describe("React bindings", () => {
  it("subscribes to the headless engine", async () => {
    const snapshot = {
      id: "doc", documentType: definition.type, schemaVersion: 1, state: initialState,
      summary: definition.summarize(initialState), revision: 1, createdAt: 1, updatedAt: 1,
      appliedCommandIds: [], lastTargets: [],
    };
    const engine = new WorkspaceEngine(definition, {
      resolve: async () => ({ ok: true as const, value: { snapshot, source: "url" as const, readOnly: false } }),
    });
    function Status() {
      const workspace = useWorkspace();
      return <span>{workspace.status}</span>;
    }
    render(<PortableDocumentProvider engine={engine}><Status /></PortableDocumentProvider>);
    expect(screen.getByText("idle")).toBeTruthy();
    await engine.open("#snapshot");
    expect(await screen.findByText("ready")).toBeTruthy();
  });

  it("exposes selectors and stable workspace actions", async () => {
    const snapshot = {
      id: "doc", documentType: definition.type, schemaVersion: 1, state: initialState,
      summary: definition.summarize(initialState), revision: 1, createdAt: 1, updatedAt: 1,
      appliedCommandIds: [], lastTargets: [],
    };
    const engine = new WorkspaceEngine(definition, { resolve: async () => ({ ok: true as const, value: { snapshot, source: "device" as const, readOnly: false } }) });
    function Controls() {
      const state = useWorkspaceSelector((value) => value.status);
      const actions = useWorkspaceActions<typeof initialState, Parameters<typeof definition.reduce>[1], ReturnType<typeof definition.summarize>>();
      return <button onClick={() => void actions.open("#local")}>{state}</button>;
    }
    render(<PortableDocumentProvider engine={engine}><Controls /></PortableDocumentProvider>);
    await act(async () => screen.getByRole("button").click());
    expect(await screen.findByText("ready")).toBeTruthy();
  });

  it("fails outside a provider and disposes only when requested", () => {
    function Invalid() { useWorkspaceEngine(); return null; }
    expect(() => render(<Invalid />)).toThrow(/PortableDocumentProvider/);
    const engine = new WorkspaceEngine(definition, { resolve: async () => ({ ok: false as const, code: "not-found" as const, message: "Missing" }) });
    const dispose = vi.spyOn(engine, "dispose");
    const view = render(<PortableDocumentProvider engine={engine} disposeOnUnmount><span>child</span></PortableDocumentProvider>);
    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("dispatches speculative commands and returns to the current head", async () => {
    const snapshot = {
      id: "doc", documentType: definition.type, schemaVersion: 1, state: initialState,
      summary: definition.summarize(initialState), revision: 1, createdAt: 1, updatedAt: 1,
      appliedCommandIds: [], lastTargets: [],
    };
    const engine = new WorkspaceEngine(definition, { resolve: async () => ({ ok: true as const, value: { snapshot, source: "device" as const, readOnly: false } }) });
    let actions!: ReturnType<typeof useWorkspaceActions<typeof initialState, Parameters<typeof definition.reduce>[1], ReturnType<typeof definition.summarize>>>;
    function Capture() { actions = useWorkspaceActions(); return null; }
    render(<PortableDocumentProvider engine={engine}><Capture /></PortableDocumentProvider>);
    await act(() => engine.open("#local"));
    const envelope = createCommandEnvelope({ id: "one", documentId: "doc", documentType: definition.type, baseRevision: 1, issuedAt: 2, command: { type: "title" as const, value: "Local" } });
    act(() => { expect(actions.dispatchSpeculative(envelope)).toBeNull(); });
    expect(engine.getSnapshot()).toMatchObject({ snapshot: { state: { title: "Local" } } });
    act(() => actions.returnToHead());
    expect(engine.getSnapshot()).toMatchObject({ snapshot: { state: { title: "Initial" } } });
  });
});
