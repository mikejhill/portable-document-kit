import { describe, expect, it, vi } from "vitest";
import { activePresence, FirebaseRuntime } from "@mikejhill/portable-document-firebase";

describe("Firebase boundaries", () => {
  it("filters stale presence and collapses sessions per principal", () => {
    expect(
      activePresence(
        [
          { principalId: "a", sessionId: "old", displayName: "A", lastSeen: 900 },
          { principalId: "a", sessionId: "new", displayName: "A", lastSeen: 1_000 },
          { principalId: "b", sessionId: "stale", displayName: "B", lastSeen: 700 },
        ],
        1_000,
        200,
      ),
    ).toEqual([{ principalId: "a", sessionId: "new", displayName: "A", lastSeen: 1_000 }]);
  });

  it("initializes App Check only before first Firestore access", () => {
    const initialize = vi.fn();
    const database = {};
    const runtime = new FirebaseRuntime({
      app: {} as never,
      getAuth: () => ({}) as never,
      getFirestore: () => database as never,
      initializeAppCheck: initialize,
    });
    runtime.auth();
    expect(initialize).not.toHaveBeenCalled();
    expect(runtime.firestore()).toBe(database);
    expect(runtime.firestore()).toBe(database);
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
