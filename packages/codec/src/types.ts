import type { DocumentDefinition, ValidationIssue } from "@mikejhill/portable-document-core";

/** Semantic purpose of a portable snapshot. */
export type SnapshotKind = "document" | "launch" | "session";

/** Protocol envelope whose versions are independent from consumer schemas. */
export type PortableSnapshotEnvelope = {
  readonly protocolVersion: 1;
  readonly documentType: string;
  readonly schemaVersion: number;
  readonly snapshotKind: SnapshotKind;
  readonly codec: string;
  readonly payload: unknown;
};

/** Converts validated state to and from one registered transport representation. */
export interface SnapshotSerializer<State> {
  readonly id: string;
  serialize(state: State): unknown;
  deserialize(payload: unknown): unknown;
}

/** Reversible text compression used after envelope serialization. */
export interface TextCompression {
  readonly id: string;
  compress(value: string): string;
  decompress(value: string): string | null;
}

/** Structured reasons a snapshot was rejected at a trust boundary. */
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

/** Validated decode result that never throws for untrusted input. */
export type SnapshotDecodeResult<State> =
  | {
      readonly ok: true;
      readonly state: State;
      readonly kind: SnapshotKind;
      readonly legacy: boolean;
    }
  | { readonly ok: false; readonly failure: SnapshotDecodeFailure };

/** Explicit adapter for a snapshot format that predates the portable envelope. */
export type LegacySnapshotDecoder = {
  readonly id: string;
  canDecode(value: string): boolean;
  decode(value: string): {
    readonly state: unknown;
    readonly schemaVersion: number;
    readonly kind: SnapshotKind;
  } | null;
};

/** Construction policy for a bounded portable snapshot codec. */
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
