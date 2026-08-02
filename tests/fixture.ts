import { defineDocument, type ReducerResult } from "@mikejhill/portable-document-core";
import { z } from "zod";

export const stateSchema = z.object({ title: z.string(), items: z.record(z.string(), z.string()) });
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("title"), value: z.string() }),
  z.object({ type: z.literal("set"), id: z.string(), value: z.string() }),
  z.object({ type: z.literal("delete"), id: z.string() }),
]);
export type TestState = z.infer<typeof stateSchema>;
export type TestCommand = z.infer<typeof commandSchema>;
export type TestSummary = { title: string; count: number };

export const definition = defineDocument<TestState, TestCommand, TestSummary>({
  type: "test.document",
  currentSchemaVersion: 1,
  stateSchema,
  commandSchema,
  migrations: [],
  summarize: (state) => ({ title: state.title, count: Object.keys(state.items).length }),
  reduce(state, command): ReducerResult<TestState> {
    if (command.type === "title") return { ok: true, state: { ...state, title: command.value } };
    if (command.type === "set")
      return {
        ok: true,
        state: { ...state, items: { ...state.items, [command.id]: command.value } },
      };
    if (!state.items[command.id])
      return {
        ok: false,
        code: "missing-target",
        message: "Item is gone.",
        recoverable: command.id,
      };
    const items = { ...state.items };
    delete items[command.id];
    return { ok: true, state: { ...state, items } };
  },
  commandPolicy: {
    inspect(command) {
      if (command.type === "title")
        return { targets: ["title"], coalescingKey: "title", durability: "coalesced" };
      if (command.type === "set")
        return {
          targets: [`item:${command.id}`],
          coalescingKey: `item:${command.id}`,
          durability: "coalesced",
        };
      return {
        targets: [`item:${command.id}`],
        durability: "immediate",
        checkpointReason: "Delete Item",
      };
    },
    coalesce(previous, next) {
      if (previous.type === "title" && next.type === "title") return next;
      if (previous.type === "set" && next.type === "set" && previous.id === next.id) return next;
      return null;
    },
  },
});

export const initialState: TestState = { title: "Initial", items: { a: "A" } };
