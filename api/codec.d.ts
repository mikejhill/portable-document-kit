import { DocumentDefinition, ValidationIssue } from '@mikejhill/portable-document-core';

type SnapshotKind = "document" | "launch" | "session";
type PortableSnapshotEnvelope = {
    readonly protocolVersion: 1;
    readonly documentType: string;
    readonly schemaVersion: number;
    readonly snapshotKind: SnapshotKind;
    readonly codec: string;
    readonly payload: unknown;
};
interface SnapshotSerializer<State> {
    readonly id: string;
    serialize(state: State): unknown;
    deserialize(payload: unknown): unknown;
}
interface TextCompression {
    readonly id: string;
    compress(value: string): string;
    decompress(value: string): string | null;
}
declare class LzStringUriCompression implements TextCompression {
    readonly id = "lz-string-uri";
    compress(value: string): string;
    decompress(value: string): string | null;
}
declare class IdentityTextCompression implements TextCompression {
    readonly id = "identity";
    compress(value: string): string;
    decompress(value: string): string | null;
}
declare class JsonSnapshotSerializer<State> implements SnapshotSerializer<State> {
    readonly id = "json";
    serialize(state: State): unknown;
    deserialize(payload: unknown): unknown;
}
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
type SnapshotDecodeResult<State> = {
    readonly ok: true;
    readonly state: State;
    readonly kind: SnapshotKind;
    readonly legacy: boolean;
} | {
    readonly ok: false;
    readonly failure: SnapshotDecodeFailure;
};
type LegacySnapshotDecoder = {
    readonly id: string;
    canDecode(value: string): boolean;
    decode(value: string): {
        readonly state: unknown;
        readonly schemaVersion: number;
        readonly kind: SnapshotKind;
    } | null;
};
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
/** Versioned, fail-closed snapshot codec with explicit legacy decoders. */
declare class PortableSnapshotCodec<State, Command, Summary> {
    private readonly options;
    private readonly serializers;
    private readonly defaultSerializer;
    private readonly compression;
    private readonly legacyDecoders;
    private readonly maxEncodedCharacters;
    private readonly maxDecodedCharacters;
    constructor(options: PortableSnapshotCodecOptions<State, Command, Summary>);
    encode(state: State, kind?: SnapshotKind, serializerId?: string): string;
    decode(value: string): SnapshotDecodeResult<State>;
    private toMigrationFailure;
}

export { IdentityTextCompression, JsonSnapshotSerializer, type LegacySnapshotDecoder, LzStringUriCompression, PortableSnapshotCodec, type PortableSnapshotCodecOptions, type PortableSnapshotEnvelope, type SnapshotDecodeFailure, type SnapshotDecodeResult, type SnapshotKind, type SnapshotSerializer, type TextCompression };
