import { DocumentDefinition, ValidationIssue } from '@mikejhill/portable-document-core';

/** Semantic purpose of a portable snapshot. */
type SnapshotKind = "document" | "launch" | "session";
/** Protocol envelope whose versions are independent from consumer schemas. */
type PortableSnapshotEnvelope = {
    readonly protocolVersion: 1;
    readonly documentType: string;
    readonly schemaVersion: number;
    readonly snapshotKind: SnapshotKind;
    readonly codec: string;
    readonly payload: unknown;
};
/** Converts validated state to and from one registered transport representation. */
interface SnapshotSerializer<State> {
    readonly id: string;
    serialize(state: State): unknown;
    deserialize(payload: unknown): unknown;
}
/** Reversible text compression used after envelope serialization. */
interface TextCompression {
    readonly id: string;
    compress(value: string): string;
    decompress(value: string): string | null;
}
/** Structured reasons a snapshot was rejected at a trust boundary. */
type SnapshotDecodeFailure = {
    readonly code: "wrong-prefix";
} | {
    readonly code: "payload-too-large";
    readonly limit: number;
} | {
    readonly code: "decompression-failed";
} | {
    readonly code: "invalid-envelope";
} | {
    readonly code: "unsupported-protocol";
    readonly version: number;
} | {
    readonly code: "wrong-document-type";
    readonly actual: string;
} | {
    readonly code: "unknown-codec";
    readonly codec: string;
} | {
    readonly code: "invalid-state";
    readonly issues: readonly ValidationIssue[];
} | {
    readonly code: "incompatible-version";
    readonly version: number;
} | {
    readonly code: "legacy-decode-failed";
};
/** Validated decode result that never throws for untrusted input. */
type SnapshotDecodeResult<State> = {
    readonly ok: true;
    readonly state: State;
    readonly kind: SnapshotKind;
    readonly legacy: boolean;
} | {
    readonly ok: false;
    readonly failure: SnapshotDecodeFailure;
};
/** Explicit adapter for a snapshot format that predates the portable envelope. */
type LegacySnapshotDecoder = {
    readonly id: string;
    canDecode(value: string): boolean;
    decode(value: string): {
        readonly state: unknown;
        readonly schemaVersion: number;
        readonly kind: SnapshotKind;
    } | null;
};
/** Construction policy for a bounded portable snapshot codec. */
type PortableSnapshotCodecOptions<State, Command, Summary> = {
    readonly prefix: string;
    readonly definition: DocumentDefinition<State, Command, Summary>;
    readonly serializers?: readonly SnapshotSerializer<State>[];
    readonly defaultSerializer?: string;
    readonly compression?: TextCompression;
    readonly legacyDecoders?: readonly LegacySnapshotDecoder[];
    readonly maxEncodedCharacters?: number;
    readonly maxDecodedCharacters?: number;
};

/** URI-safe LZ String compression for compact browser fragments. */
declare class LzStringUriCompression implements TextCompression {
    readonly id = "lz-string-uri";
    compress(value: string): string;
    decompress(value: string): string | null;
}
/** Percent-encoding transport useful for tests and already-compressed payloads. */
declare class IdentityTextCompression implements TextCompression {
    readonly id = "identity";
    compress(value: string): string;
    decompress(value: string): string | null;
}

/** Versioned, bounded, fail-closed snapshot codec with explicit legacy decoders. */
declare class PortableSnapshotCodec<State, Command, Summary> {
    private readonly options;
    private readonly serializers;
    private readonly defaultSerializer;
    private readonly compression;
    private readonly legacyDecoders;
    private readonly maxEncodedCharacters;
    private readonly maxDecodedCharacters;
    /** Validates registrations and freezes the codec's transport policy. */
    constructor(options: PortableSnapshotCodecOptions<State, Command, Summary>);
    /** Validates state and emits one self-describing portable fragment. */
    encode(state: State, kind?: SnapshotKind, serializerId?: string): string;
    /** Decodes untrusted input into validated state or a structured failure. */
    decode(value: string): SnapshotDecodeResult<State>;
    private decodeLegacy;
    private toMigrationFailure;
}

/** Identity JSON payload serializer for ordinary JSON-compatible state. */
declare class JsonSnapshotSerializer<State> implements SnapshotSerializer<State> {
    readonly id = "json";
    serialize(state: State): unknown;
    deserialize(payload: unknown): unknown;
}

export { IdentityTextCompression, JsonSnapshotSerializer, type LegacySnapshotDecoder, LzStringUriCompression, PortableSnapshotCodec, type PortableSnapshotCodecOptions, type PortableSnapshotEnvelope, type SnapshotDecodeFailure, type SnapshotDecodeResult, type SnapshotKind, type SnapshotSerializer, type TextCompression };
