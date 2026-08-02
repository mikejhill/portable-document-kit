import LZString from "lz-string";
import {
  migrateDocumentState,
  validateValue,
  type DocumentDefinition,
  type ValidationIssue,
} from "@mikejhill/portable-document-core";

export type SnapshotKind = "document" | "launch" | "session";

export type PortableSnapshotEnvelope = {
  readonly protocolVersion: 1;
  readonly documentType: string;
  readonly schemaVersion: number;
  readonly snapshotKind: SnapshotKind;
  readonly codec: string;
  readonly payload: unknown;
};

export interface SnapshotSerializer<State> {
  readonly id: string;
  serialize(state: State): unknown;
  deserialize(payload: unknown): unknown;
}

export interface TextCompression {
  readonly id: string;
  compress(value: string): string;
  decompress(value: string): string | null;
}

export class LzStringUriCompression implements TextCompression {
  public readonly id = "lz-string-uri";
  public compress(value: string): string {
    return LZString.compressToEncodedURIComponent(value);
  }
  public decompress(value: string): string | null {
    return LZString.decompressFromEncodedURIComponent(value);
  }
}

export class IdentityTextCompression implements TextCompression {
  public readonly id = "identity";
  public compress(value: string): string {
    return encodeURIComponent(value);
  }
  public decompress(value: string): string | null {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
}

export class JsonSnapshotSerializer<State> implements SnapshotSerializer<State> {
  public readonly id = "json";
  public serialize(state: State): unknown {
    return state;
  }
  public deserialize(payload: unknown): unknown {
    return payload;
  }
}

export type SnapshotDecodeFailure =
  | { readonly code: "wrong-prefix" }
  | { readonly code: "payload-too-large"; readonly limit: number }
  | { readonly code: "decompression-failed" }
  | { readonly code: "invalid-envelope" }
  | { readonly code: "unsupported-protocol"; readonly version: number }
  | { readonly code: "wrong-document-type"; readonly actual: string }
  | { readonly code: "unknown-codec"; readonly codec: string }
  | { readonly code: "invalid-state"; readonly issues: readonly ValidationIssue[] }
  | { readonly code: "incompatible-version"; readonly version: number }
  | { readonly code: "legacy-decode-failed" };

export type SnapshotDecodeResult<State> =
  | { readonly ok: true; readonly state: State; readonly kind: SnapshotKind; readonly legacy: boolean }
  | { readonly ok: false; readonly failure: SnapshotDecodeFailure };

export type LegacySnapshotDecoder = {
  readonly id: string;
  canDecode(value: string): boolean;
  decode(value: string): { readonly state: unknown; readonly schemaVersion: number; readonly kind: SnapshotKind } | null;
};

export type PortableSnapshotCodecOptions<State, Command, Summary> = {
  readonly prefix: string;
  readonly definition: DocumentDefinition<State, Command, Summary>;
  readonly serializers?: readonly SnapshotSerializer<State>[];
  readonly defaultSerializer?: string;
  readonly compression?: TextCompression;
  readonly legacyDecoders?: readonly LegacySnapshotDecoder[];
  readonly maxEncodedCharacters?: number;
  readonly maxDecodedCharacters?: number;
};

/** Versioned, fail-closed snapshot codec with explicit legacy decoders. */
export class PortableSnapshotCodec<State, Command, Summary> {
  private readonly serializers = new Map<string, SnapshotSerializer<State>>();
  private readonly defaultSerializer: string;
  private readonly compression: TextCompression;
  private readonly legacyDecoders: readonly LegacySnapshotDecoder[];
  private readonly maxEncodedCharacters: number;
  private readonly maxDecodedCharacters: number;

  public constructor(private readonly options: PortableSnapshotCodecOptions<State, Command, Summary>) {
    if (!options.prefix.startsWith("#") || !options.prefix.endsWith(":")) {
      throw new Error("Snapshot prefixes must start with # and end with :.");
    }
    const serializers = options.serializers ?? [new JsonSnapshotSerializer<State>()];
    for (const serializer of serializers) {
      if (this.serializers.has(serializer.id)) throw new Error(`Duplicate serializer: ${serializer.id}`);
      this.serializers.set(serializer.id, serializer);
    }
    this.defaultSerializer = options.defaultSerializer ?? serializers[0]?.id ?? "";
    if (!this.serializers.has(this.defaultSerializer)) throw new Error("Default serializer is not registered.");
    this.compression = options.compression ?? new LzStringUriCompression();
    this.legacyDecoders = options.legacyDecoders ?? [];
    this.maxEncodedCharacters = options.maxEncodedCharacters ?? 1_000_000;
    this.maxDecodedCharacters = options.maxDecodedCharacters ?? 4_000_000;
  }

  public encode(state: State, kind: SnapshotKind = "document", serializerId = this.defaultSerializer): string {
    const validated = validateValue(this.options.definition.stateSchema, state);
    if (!validated.ok) throw new Error("Cannot encode invalid document state.");
    const serializer = this.serializers.get(serializerId);
    if (!serializer) throw new Error(`Unknown snapshot serializer: ${serializerId}`);
    const envelope: PortableSnapshotEnvelope = {
      protocolVersion: 1,
      documentType: this.options.definition.type,
      schemaVersion: this.options.definition.currentSchemaVersion,
      snapshotKind: kind,
      codec: serializer.id,
      payload: serializer.serialize(validated.value),
    };
    const encoded = this.compression.compress(JSON.stringify(envelope));
    if (encoded.length > this.maxEncodedCharacters) throw new Error("Encoded snapshot exceeds its configured limit.");
    return `${this.options.prefix}${encoded}`;
  }

  public decode(value: string): SnapshotDecodeResult<State> {
    if (!value.startsWith(this.options.prefix)) {
      for (const legacy of this.legacyDecoders) {
        if (!legacy.canDecode(value)) continue;
        const decoded = legacy.decode(value);
        if (!decoded) return { ok: false, failure: { code: "legacy-decode-failed" } };
        const migrated = migrateDocumentState(this.options.definition, decoded.state, decoded.schemaVersion);
        return migrated.ok
          ? { ok: true, state: migrated.state, kind: decoded.kind, legacy: true }
          : { ok: false, failure: this.toMigrationFailure(migrated.failure) };
      }
      return { ok: false, failure: { code: "wrong-prefix" } };
    }
    const encoded = value.slice(this.options.prefix.length);
    if (encoded.length > this.maxEncodedCharacters) {
      return { ok: false, failure: { code: "payload-too-large", limit: this.maxEncodedCharacters } };
    }
    const raw = this.compression.decompress(encoded);
    if (raw === null) return { ok: false, failure: { code: "decompression-failed" } };
    if (raw.length > this.maxDecodedCharacters) {
      return { ok: false, failure: { code: "payload-too-large", limit: this.maxDecodedCharacters } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, failure: { code: "invalid-envelope" } };
    }
    const envelope = parseEnvelope(parsed);
    if (!envelope) return { ok: false, failure: { code: "invalid-envelope" } };
    if (envelope.protocolVersion !== 1) {
      return { ok: false, failure: { code: "unsupported-protocol", version: envelope.protocolVersion } };
    }
    if (envelope.documentType !== this.options.definition.type) {
      return { ok: false, failure: { code: "wrong-document-type", actual: envelope.documentType } };
    }
    const serializer = this.serializers.get(envelope.codec);
    if (!serializer) return { ok: false, failure: { code: "unknown-codec", codec: envelope.codec } };
    let state: unknown;
    try {
      state = serializer.deserialize(envelope.payload);
    } catch {
      return { ok: false, failure: { code: "invalid-envelope" } };
    }
    const migrated = migrateDocumentState(this.options.definition, state, envelope.schemaVersion);
    return migrated.ok
      ? { ok: true, state: migrated.state, kind: envelope.snapshotKind, legacy: false }
      : { ok: false, failure: this.toMigrationFailure(migrated.failure) };
  }

  private toMigrationFailure(failure: { readonly code: string; readonly [key: string]: unknown }): SnapshotDecodeFailure {
    if (failure.code === "incompatible-version") {
      return { code: "incompatible-version", version: Number(failure.version) };
    }
    if (failure.code === "invalid-state") {
      return { code: "invalid-state", issues: failure.issues as readonly ValidationIssue[] };
    }
    return { code: "invalid-envelope" };
  }
}

function parseEnvelope(value: unknown): PortableSnapshotEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.protocolVersion) || typeof candidate.documentType !== "string" ||
      !Number.isInteger(candidate.schemaVersion) || typeof candidate.snapshotKind !== "string" ||
      !["document", "launch", "session"].includes(candidate.snapshotKind) || typeof candidate.codec !== "string" ||
      !("payload" in candidate)) return null;
  return candidate as PortableSnapshotEnvelope;
}
