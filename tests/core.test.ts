import { describe, expect, it } from "vitest";
import {
  applyDocumentCommand,
  assessRevisionConflict,
  createCommandEnvelope,
  defineDocument,
  migrateDocumentState,
  validateValue,
} from "@mikejhill/portable-document-core";
import { definition, initialState } from "./fixture";

describe("document definition", () => {
  it("validates state, commands, and immutable reducer output", () => {
    const result = applyDocumentCommand(definition, initialState, {
      type: "set",
      id: "b",
      value: "B",
    });
    expect(result).toEqual({ ok: true, state: { title: "Initial", items: { a: "A", b: "B" } } });
    expect(initialState.items).toEqual({ a: "A" });
  });

  it("returns typed failures for invalid commands and missing targets", () => {
    expect(
      applyDocumentCommand(definition, { title: 1 }, { type: "title", value: "X" }),
    ).toMatchObject({ ok: false, failure: { code: "invalid-state" } });
    expect(applyDocumentCommand(definition, initialState, { type: "unknown" })).toMatchObject({
      ok: false,
      failure: { code: "invalid-command" },
    });
    expect(
      applyDocumentCommand(definition, initialState, { type: "delete", id: "missing" }),
    ).toEqual({
      ok: false,
      failure: { code: "missing-target", message: "Item is gone.", recoverable: "missing" },
    });
  });

  it("contains reducer exceptions and invalid reducer output", () => {
    const throwing = defineDocument({
      ...definition,
      reduce: () => {
        throw new Error("consumer failure");
      },
    });
    expect(applyDocumentCommand(throwing, initialState, { type: "title", value: "X" })).toEqual({
      ok: false,
      failure: { code: "failed-precondition", message: "The command reducer failed." },
    });
    const invalidOutput = defineDocument({
      ...definition,
      reduce: () => ({ ok: true as const, state: { title: 2, items: {} } as never }),
    });
    expect(
      applyDocumentCommand(invalidOutput, initialState, { type: "title", value: "X" }),
    ).toMatchObject({ ok: false, failure: { code: "invalid-state" } });
  });

  it("runs contiguous migrations and rejects unsupported versions", () => {
    const migratedDefinition = defineDocument({
      ...definition,
      currentSchemaVersion: 2,
      migrations: [
        {
          from: 1,
          to: 2,
          migrate: (value: unknown) => ({ ...(value as object), title: "Migrated" }),
        },
      ],
    });
    expect(migrateDocumentState(migratedDefinition, initialState, 1)).toMatchObject({
      ok: true,
      state: { title: "Migrated" },
    });
    expect(migrateDocumentState(definition, initialState, 2)).toEqual({
      ok: false,
      failure: { code: "incompatible-version", version: 2 },
    });
    const missing = defineDocument({ ...definition, currentSchemaVersion: 2 });
    expect(migrateDocumentState(missing, initialState, 1)).toMatchObject({
      ok: false,
      failure: { code: "incompatible-version", version: 1 },
    });
    const throwing = defineDocument({
      ...definition,
      currentSchemaVersion: 2,
      migrations: [
        {
          from: 1,
          to: 2,
          migrate: () => {
            throw new Error("bad migration");
          },
        },
      ],
    });
    expect(migrateDocumentState(throwing, initialState, 1)).toMatchObject({
      ok: false,
      failure: { code: "incompatible-version", version: 1 },
    });
  });

  it("rejects invalid identities and migration gaps", () => {
    expect(() => defineDocument({ ...definition, type: "Bad Type" })).toThrow(/lowercase/);
    expect(() => defineDocument({ ...definition, currentSchemaVersion: 0 })).toThrow(/positive/);
    expect(() =>
      defineDocument({
        ...definition,
        migrations: [{ from: 1, to: 3, migrate: (value) => value }],
      }),
    ).toThrow(/exactly one/);
  });

  it("rejects asynchronous Standard Schema validation", () => {
    const schema = {
      "~standard": { version: 1 as const, vendor: "test", validate: async () => ({ value: "x" }) },
    };
    expect(validateValue(schema, "x")).toEqual({
      ok: false,
      issues: [{ message: "Document schemas must validate synchronously." }],
    });
  });

  it("creates stable command envelopes", () => {
    expect(
      createCommandEnvelope({
        id: "command",
        documentId: "doc",
        documentType: "test.document",
        baseRevision: 3,
        issuedAt: 10,
        command: { type: "title", value: "Next" },
      }),
    ).toEqual({
      protocolVersion: 1,
      id: "command",
      documentId: "doc",
      documentType: "test.document",
      baseRevision: 3,
      issuedAt: 10,
      command: { type: "title", value: "Next" },
    });
  });

  it("creates generated command metadata when optional values are omitted", () => {
    const envelope = createCommandEnvelope({
      documentId: "doc",
      documentType: definition.type,
      baseRevision: 1,
      command: { type: "title", value: "Next" },
    });
    expect(envelope.id).toEqual(expect.any(String));
    expect(envelope.issuedAt).toEqual(expect.any(Number));
  });

  it("merges only provably independent one-revision changes", () => {
    expect(assessRevisionConflict(2, 2, ["title"], ["title"])).toBeNull();
    expect(assessRevisionConflict(1, 2, ["item:a"], ["title"])).toBeNull();
    expect(assessRevisionConflict(1, 2, ["title"], ["title"], "Title")).toEqual({
      code: "conflict",
      message: "Title changed remotely.",
    });
    expect(assessRevisionConflict(1, 3, ["item:a"], ["title"])).toMatchObject({ code: "conflict" });
    expect(assessRevisionConflict(3, 2, ["title"], [])).toMatchObject({
      code: "failed-precondition",
    });
  });
});
