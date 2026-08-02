import { describe, expect, it } from "vitest";
import { applyDocumentCommand } from "@mikejhill/portable-document-core";
import { initialNotebook, notebookDefinition } from "../examples/structured-notes/src/model";

describe("structured notes proof consumer", () => {
  it("adds and updates nested dynamic nodes", () => {
    const added = applyDocumentCommand(notebookDefinition, initialNotebook, {
      type: "add-node",
      node: { id: "nested", kind: "field", label: "Priority", value: "High" },
      parentId: "intro",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const updated = applyDocumentCommand(notebookDefinition, added.state, { type: "update-node", nodeId: "nested", patch: { value: "Low" } });
    expect(updated).toMatchObject({ ok: true, state: { nodes: { nested: { value: "Low" } } } });
  });

  it("moves nodes by stable identity and prevents cycles", () => {
    const moved = applyDocumentCommand(notebookDefinition, initialNotebook, { type: "move-node", nodeId: "field-1", parentId: "intro", index: 0 });
    expect(moved).toMatchObject({ ok: true, state: { rootIds: ["intro"], nodes: { intro: { childIds: ["field-1", "text-1"] } } } });
    const cycle = applyDocumentCommand(notebookDefinition, initialNotebook, { type: "move-node", nodeId: "intro", parentId: "intro", index: 0 });
    expect(cycle).toMatchObject({ ok: false, failure: { code: "failed-precondition" } });
  });

  it("deletes complete subtrees and returns recoverable stale-edit conflicts", () => {
    const deleted = applyDocumentCommand(notebookDefinition, initialNotebook, { type: "delete-node", nodeId: "intro" });
    expect(deleted).toMatchObject({ ok: true, state: { rootIds: ["field-1"], nodes: { "field-1": expect.anything() } } });
    if (!deleted.ok) return;
    expect(deleted.state.nodes["text-1"]).toBeUndefined();
    expect(applyDocumentCommand(notebookDefinition, deleted.state, { type: "update-node", nodeId: "text-1", patch: { text: "Recovered" } })).toMatchObject({
      ok: false,
      failure: { code: "missing-target", recoverable: { text: "Recovered" } },
    });
  });

  it("applies each node-specific patch and rejects mismatched fields", () => {
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "set-title", title: "Plan" })).toMatchObject({ ok: true, state: { title: "Plan" } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "update-node", nodeId: "intro", patch: { title: "Start" } })).toMatchObject({ ok: true, state: { nodes: { intro: { title: "Start" } } } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "update-node", nodeId: "field-1", patch: { label: "Owner", value: "Mike" } })).toMatchObject({ ok: true, state: { nodes: { "field-1": { label: "Owner", value: "Mike" } } } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "update-node", nodeId: "intro", patch: { value: "bad" } })).toMatchObject({ ok: false, failure: { code: "failed-precondition" } });
  });

  it("inserts at roots, bounds positions, and rejects duplicate or invalid parents", () => {
    const node = { id: "root-text", kind: "text" as const, text: "Root" };
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "add-node", node, parentId: null, index: 0 })).toMatchObject({ ok: true, state: { rootIds: ["root-text", "intro", "field-1"] } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "add-node", node, parentId: null, index: 999 })).toMatchObject({ ok: true, state: { rootIds: ["intro", "field-1", "root-text"] } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "add-node", node: initialNotebook.nodes.intro, parentId: null })).toMatchObject({ ok: false, failure: { code: "failed-precondition" } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "add-node", node, parentId: "field-1" })).toMatchObject({ ok: false, failure: { code: "missing-target" } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "move-node", nodeId: "missing", parentId: null, index: 0 })).toMatchObject({ ok: false, failure: { code: "missing-target" } });
    expect(applyDocumentCommand(notebookDefinition, initialNotebook, { type: "delete-node", nodeId: "missing" })).toMatchObject({ ok: false, failure: { code: "missing-target" } });
  });

  it("defines semantic targeting and coalescing policies", () => {
    expect(notebookDefinition.commandPolicy.inspect({ type: "set-title", title: "X" })).toMatchObject({ targets: ["title"], durability: "coalesced" });
    expect(notebookDefinition.commandPolicy.inspect({ type: "add-node", node: { id: "x", kind: "text", text: "X" }, parentId: null })).toMatchObject({ targets: ["node:x", "children:root"], durability: "immediate" });
    expect(notebookDefinition.commandPolicy.coalesce?.({ type: "set-title", title: "A" }, { type: "set-title", title: "B" })).toEqual({ type: "set-title", title: "B" });
    expect(notebookDefinition.commandPolicy.coalesce?.(
      { type: "update-node", nodeId: "field-1", patch: { label: "A" } },
      { type: "update-node", nodeId: "field-1", patch: { value: "B" } },
    )).toEqual({ type: "update-node", nodeId: "field-1", patch: { label: "A", value: "B" } });
    expect(notebookDefinition.commandPolicy.coalesce?.(
      { type: "update-node", nodeId: "field-1", patch: { value: "A" } },
      { type: "update-node", nodeId: "text-1", patch: { text: "B" } },
    )).toBeNull();
  });

  it("rejects invalid normalized graphs", () => {
    const duplicated = { ...initialNotebook, rootIds: [...initialNotebook.rootIds, "text-1"] };
    expect(notebookDefinition.stateSchema["~standard"].validate(duplicated)).toMatchObject({ issues: expect.any(Array) });
    const unreachable = { ...initialNotebook, rootIds: ["field-1"], nodes: { ...initialNotebook.nodes, intro: { ...initialNotebook.nodes.intro, childIds: [] } } };
    expect(notebookDefinition.stateSchema["~standard"].validate(unreachable)).toMatchObject({ issues: expect.any(Array) });
  });
});
