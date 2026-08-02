import type { PortableSnapshotEnvelope } from "./types";

/** Parses only the protocol shell; document payload validation occurs later. */
export function parseEnvelope(value: unknown): PortableSnapshotEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isInteger(candidate.protocolVersion) ||
    typeof candidate.documentType !== "string" ||
    !Number.isInteger(candidate.schemaVersion) ||
    typeof candidate.snapshotKind !== "string" ||
    !["document", "launch", "session"].includes(candidate.snapshotKind) ||
    typeof candidate.codec !== "string" ||
    !("payload" in candidate)
  ) {
    return null;
  }
  return candidate as PortableSnapshotEnvelope;
}
