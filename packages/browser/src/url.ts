import type { PortableSnapshotCodec, SnapshotKind } from "@mikejhill/portable-document-codec";

/** Creates a complete URL after removing any existing fragment. */
export function createPortableUrl<State, Command, Summary>(
  codec: PortableSnapshotCodec<State, Command, Summary>,
  state: State,
  currentHref: string,
  kind: SnapshotKind = "document",
): string {
  return `${currentHref.split("#", 1)[0]}${codec.encode(state, kind)}`;
}
