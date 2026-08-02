import type { SnapshotSerializer } from "./types";

/** Identity JSON payload serializer for ordinary JSON-compatible state. */
export class JsonSnapshotSerializer<State> implements SnapshotSerializer<State> {
  public readonly id = "json";

  public serialize(state: State): unknown {
    return state;
  }

  public deserialize(payload: unknown): unknown {
    return payload;
  }
}
