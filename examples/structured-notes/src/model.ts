import { defineDocument, type ReducerResult } from "@mikejhill/portable-document-core";
import { z } from "zod";

const sectionNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("section"),
  title: z.string(),
  childIds: z.array(z.string().min(1)),
});
const textNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("text"),
  text: z.string(),
});
const fieldNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("field"),
  label: z.string(),
  value: z.string(),
});
export const noteNodeSchema = z.discriminatedUnion("kind", [
  sectionNodeSchema,
  textNodeSchema,
  fieldNodeSchema,
]);
export type NoteNode = z.infer<typeof noteNodeSchema>;

export const notebookSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    rootIds: z.array(z.string().min(1)),
    nodes: z.record(z.string(), noteNodeSchema),
  })
  .superRefine((notebook, context) => {
    const referenced = [...notebook.rootIds];
    for (const node of Object.values(notebook.nodes)) {
      if (node.kind === "section") referenced.push(...node.childIds);
    }
    for (const id of referenced) {
      if (!notebook.nodes[id]) context.addIssue({ code: "custom", message: `Missing node ${id}.` });
    }
    if (new Set(referenced).size !== referenced.length) {
      context.addIssue({ code: "custom", message: "Each node must have exactly one location." });
    }
    for (const id of Object.keys(notebook.nodes)) {
      if (!referenced.includes(id))
        context.addIssue({ code: "custom", message: `Unreachable node ${id}.` });
    }
  });
export type Notebook = z.infer<typeof notebookSchema>;

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set-title"), title: z.string() }),
  z.object({
    type: z.literal("add-node"),
    node: noteNodeSchema,
    parentId: z.string().nullable(),
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("update-node"),
    nodeId: z.string(),
    patch: z.record(z.string(), z.string()),
  }),
  z.object({
    type: z.literal("move-node"),
    nodeId: z.string(),
    parentId: z.string().nullable(),
    index: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("delete-node"), nodeId: z.string() }),
]);
export type NotebookCommand = z.infer<typeof commandSchema>;
export type NotebookSummary = { readonly title: string; readonly nodeCount: number };

export const notebookDefinition = defineDocument<Notebook, NotebookCommand, NotebookSummary>({
  type: "structured-notes.notebook",
  currentSchemaVersion: 1,
  stateSchema: notebookSchema,
  commandSchema,
  migrations: [],
  summarize: (state) => ({ title: state.title, nodeCount: Object.keys(state.nodes).length }),
  commandPolicy: {
    inspect(command) {
      switch (command.type) {
        case "set-title":
          return { targets: ["title"], coalescingKey: "title", durability: "coalesced" };
        case "update-node":
          return {
            targets: [`node:${command.nodeId}`],
            coalescingKey: `node:${command.nodeId}`,
            durability: "coalesced",
            conflictLabel: "Note field",
          };
        case "add-node":
          return {
            targets: [`node:${command.node.id}`, `children:${command.parentId ?? "root"}`],
            durability: "immediate",
            checkpointReason: "Add Note",
          };
        case "move-node":
          return {
            targets: [`node:${command.nodeId}`, `children:${command.parentId ?? "root"}`],
            durability: "immediate",
            checkpointReason: "Move Note",
          };
        case "delete-node":
          return {
            targets: [`node:${command.nodeId}`],
            durability: "immediate",
            checkpointReason: "Delete Note",
            conflictLabel: "Deleted note",
          };
      }
    },
    coalesce(previous, next) {
      if (previous.type === "set-title" && next.type === "set-title") return next;
      if (
        previous.type === "update-node" &&
        next.type === "update-node" &&
        previous.nodeId === next.nodeId
      ) {
        return { ...next, patch: { ...previous.patch, ...next.patch } };
      }
      return null;
    },
  },
  reduce(state, command): ReducerResult<Notebook> {
    switch (command.type) {
      case "set-title":
        return { ok: true, state: { ...state, title: command.title } };
      case "add-node": {
        if (state.nodes[command.node.id])
          return reject("failed-precondition", "Node already exists.");
        const inserted = insertAt(state, command.parentId, command.node.id, command.index);
        if (!inserted.ok) return inserted;
        return {
          ok: true,
          state: {
            ...inserted.state,
            nodes: { ...inserted.state.nodes, [command.node.id]: command.node },
          },
        };
      }
      case "update-node": {
        const node = state.nodes[command.nodeId];
        if (!node) return reject("missing-target", "The note was deleted.", command.patch);
        const allowed =
          node.kind === "section"
            ? ["title"]
            : node.kind === "text"
              ? ["text"]
              : ["label", "value"];
        if (Object.keys(command.patch).some((key) => !allowed.includes(key)))
          return reject("failed-precondition", "Patch does not match the node type.");
        return {
          ok: true,
          state: {
            ...state,
            nodes: { ...state.nodes, [node.id]: { ...node, ...command.patch } as NoteNode },
          },
        };
      }
      case "move-node": {
        if (!state.nodes[command.nodeId]) return reject("missing-target", "The note was deleted.");
        if (
          command.parentId === command.nodeId ||
          descendants(state, command.nodeId).has(command.parentId ?? "")
        ) {
          return reject("failed-precondition", "A section cannot contain itself.");
        }
        const removed = removeLocation(state, command.nodeId);
        return insertAt(removed, command.parentId, command.nodeId, command.index);
      }
      case "delete-node": {
        if (!state.nodes[command.nodeId])
          return reject("missing-target", "The note was already deleted.");
        const ids = descendants(state, command.nodeId);
        ids.add(command.nodeId);
        const nodes = { ...state.nodes };
        for (const id of ids) delete nodes[id];
        return { ok: true, state: { ...removeLocation(state, command.nodeId), nodes } };
      }
    }
  },
});

export const initialNotebook: Notebook = {
  id: "welcome-notebook",
  title: "Structured Notes",
  rootIds: ["intro", "field-1"],
  nodes: {
    intro: { id: "intro", kind: "section", title: "Overview", childIds: ["text-1"] },
    "text-1": {
      id: "text-1",
      kind: "text",
      text: "This document is portable, nested, and command-driven.",
    },
    "field-1": { id: "field-1", kind: "field", label: "Status", value: "Draft" },
  },
};

function insertAt(
  state: Notebook,
  parentId: string | null,
  nodeId: string,
  index = Number.MAX_SAFE_INTEGER,
): ReducerResult<Notebook> {
  if (parentId === null) {
    const rootIds = [...state.rootIds];
    rootIds.splice(Math.min(index, rootIds.length), 0, nodeId);
    return { ok: true, state: { ...state, rootIds } };
  }
  const parent = state.nodes[parentId];
  if (parent?.kind !== "section")
    return reject("missing-target", "Parent section no longer exists.");
  const childIds = [...parent.childIds];
  childIds.splice(Math.min(index, childIds.length), 0, nodeId);
  return {
    ok: true,
    state: { ...state, nodes: { ...state.nodes, [parentId]: { ...parent, childIds } } },
  };
}

function removeLocation(state: Notebook, nodeId: string): Notebook {
  const nodes = { ...state.nodes };
  for (const [id, node] of Object.entries(nodes)) {
    if (node.kind === "section" && node.childIds.includes(nodeId))
      nodes[id] = { ...node, childIds: node.childIds.filter((value) => value !== nodeId) };
  }
  return { ...state, rootIds: state.rootIds.filter((id) => id !== nodeId), nodes };
}

function descendants(state: Notebook, nodeId: string): Set<string> {
  const result = new Set<string>();
  const node = state.nodes[nodeId];
  if (node?.kind === "section") {
    for (const child of node.childIds) {
      result.add(child);
      for (const nested of descendants(state, child)) result.add(nested);
    }
  }
  return result;
}

function reject(
  code: "missing-target" | "failed-precondition",
  message: string,
  recoverable?: unknown,
): ReducerResult<never> {
  return { ok: false, code, message, recoverable };
}
