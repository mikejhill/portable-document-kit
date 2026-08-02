import { describe, expect, it } from "vitest";
import { IdentityTextCompression, JsonSnapshotSerializer, LzStringUriCompression, PortableSnapshotCodec } from "@mikejhill/portable-document-codec";
import { definition, initialState } from "./fixture";

describe("portable snapshot codec", () => {
  it("round trips validated state and mode", () => {
    const codec = new PortableSnapshotCodec({ prefix: "#test1:", definition });
    const encoded = codec.encode(initialState, "launch");
    expect(encoded.startsWith("#test1:")).toBe(true);
    expect(codec.decode(encoded)).toEqual({ ok: true, state: initialState, kind: "launch", legacy: false });
  });

  it("fails closed for prefix, corruption, type, codec, and limits", () => {
    const codec = new PortableSnapshotCodec({ prefix: "#test1:", definition, compression: new IdentityTextCompression(), maxEncodedCharacters: 500 });
    expect(codec.decode("#other:x")).toEqual({ ok: false, failure: { code: "wrong-prefix" } });
    expect(codec.decode("#test1:%zz")).toEqual({ ok: false, failure: { code: "decompression-failed" } });
    const wrongType = encodeURIComponent(JSON.stringify({ protocolVersion: 1, documentType: "other", schemaVersion: 1, snapshotKind: "document", codec: "json", payload: initialState }));
    expect(codec.decode(`#test1:${wrongType}`)).toEqual({ ok: false, failure: { code: "wrong-document-type", actual: "other" } });
    const unknownCodec = encodeURIComponent(JSON.stringify({ protocolVersion: 1, documentType: definition.type, schemaVersion: 1, snapshotKind: "document", codec: "nope", payload: initialState }));
    expect(codec.decode(`#test1:${unknownCodec}`)).toEqual({ ok: false, failure: { code: "unknown-codec", codec: "nope" } });
    expect(codec.decode(`#test1:${"x".repeat(501)}`)).toEqual({ ok: false, failure: { code: "payload-too-large", limit: 500 } });
  });

  it("uses explicit legacy decoders", () => {
    const codec = new PortableSnapshotCodec({
      prefix: "#test1:", definition, serializers: [new JsonSnapshotSerializer()],
      legacyDecoders: [{ id: "old", canDecode: (value) => value.startsWith("#old:"), decode: () => ({ state: initialState, schemaVersion: 1, kind: "document" }) }],
    });
    expect(codec.decode("#old:value")).toEqual({ ok: true, state: initialState, kind: "document", legacy: true });
  });

  it("validates codec registration, source state, and output budgets", () => {
    expect(() => new PortableSnapshotCodec({ prefix: "test:", definition })).toThrow(/prefixes/);
    expect(() => new PortableSnapshotCodec({ prefix: "#test1:", definition, serializers: [] })).toThrow(/Default serializer/);
    const serializer = new JsonSnapshotSerializer();
    expect(() => new PortableSnapshotCodec({ prefix: "#test1:", definition, serializers: [serializer, serializer] })).toThrow(/Duplicate/);
    expect(() => new PortableSnapshotCodec({ prefix: "#test1:", definition, defaultSerializer: "missing" })).toThrow(/Default serializer/);
    const codec = new PortableSnapshotCodec({ prefix: "#test1:", definition, compression: new IdentityTextCompression(), maxEncodedCharacters: 20 });
    expect(() => codec.encode({ title: 1, items: {} } as never)).toThrow(/invalid/);
    expect(() => codec.encode(initialState)).toThrow(/configured limit/);
    const normal = new PortableSnapshotCodec({ prefix: "#test1:", definition });
    expect(() => normal.encode(initialState, "document", "missing")).toThrow(/Unknown/);
  });

  it("rejects malformed envelopes, protocols, decoded limits, and invalid serializer output", () => {
    const compression = new IdentityTextCompression();
    const codec = new PortableSnapshotCodec({ prefix: "#test1:", definition, compression, maxDecodedCharacters: 10 });
    expect(codec.decode(`#test1:${compression.compress("not json")}`)).toMatchObject({ ok: false, failure: { code: "invalid-envelope" } });
    expect(codec.decode(`#test1:${compression.compress("12345678901")}`)).toMatchObject({ ok: false, failure: { code: "payload-too-large", limit: 10 } });

    const unlimited = new PortableSnapshotCodec({ prefix: "#test1:", definition, compression });
    const envelope = (overrides: object) => `#test1:${compression.compress(JSON.stringify({
      protocolVersion: 1, documentType: definition.type, schemaVersion: 1,
      snapshotKind: "document", codec: "json", payload: initialState, ...overrides,
    }))}`;
    expect(unlimited.decode(envelope({ protocolVersion: 2 }))).toMatchObject({ failure: { code: "unsupported-protocol", version: 2 } });
    expect(unlimited.decode(envelope({ snapshotKind: "invalid" }))).toMatchObject({ failure: { code: "invalid-envelope" } });
    expect(unlimited.decode(envelope({ schemaVersion: 2 }))).toMatchObject({ failure: { code: "incompatible-version", version: 2 } });
    expect(unlimited.decode(envelope({ payload: { title: 1, items: {} } }))).toMatchObject({ failure: { code: "invalid-state" } });
    const throwing = { id: "throws", serialize: (state: typeof initialState) => state, deserialize: () => { throw new Error("bad"); } };
    const throwingCodec = new PortableSnapshotCodec({ prefix: "#test1:", definition, compression, serializers: [throwing] });
    expect(throwingCodec.decode(envelope({ codec: "throws" }))).toMatchObject({ failure: { code: "invalid-envelope" } });
  });

  it("round trips compression implementations and reports legacy failures", () => {
    const lz = new LzStringUriCompression();
    const value = "portable document payload";
    expect(lz.decompress(lz.compress(value))).toBe(value);
    const codec = new PortableSnapshotCodec({
      prefix: "#test1:", definition,
      legacyDecoders: [
        { id: "bad", canDecode: (candidate) => candidate === "#bad", decode: () => null },
        { id: "future", canDecode: (candidate) => candidate === "#future", decode: () => ({ state: initialState, schemaVersion: 3, kind: "session" }) },
      ],
    });
    expect(codec.decode("#bad")).toMatchObject({ failure: { code: "legacy-decode-failed" } });
    expect(codec.decode("#future")).toMatchObject({ failure: { code: "incompatible-version", version: 3 } });
  });
});
