import { describe, expect, it, vi } from "vitest";
import { BrowserHistoryPort, FragmentRouter, NavigationPolicy, WindowLifecycle, createPortableUrl } from "@mikejhill/portable-document-browser";
import { PortableSnapshotCodec } from "@mikejhill/portable-document-codec";
import { definition, initialState } from "./fixture";

describe("browser adapters", () => {
  it("parses registered namespaces and rejects malformed identifiers", () => {
    const router = new FragmentRouter([
      { kind: "snapshot", prefix: "#pdk1:" },
      { kind: "local", prefix: "#pdkl1:", identifier: /^[a-z0-9-]{3,}$/ },
    ]);
    expect(router.parse("#pdkl1:abc")).toMatchObject({ kind: "local", value: "abc" });
    expect(router.parse("#pdkl1:x")).toBeNull();
    expect(router.hasKnownPrefix("#pdkl1:x")).toBe(true);
  });

  it("preserves navigation restoration policy", () => {
    const policy = new NavigationPolicy();
    policy.schedule("push", "#action");
    expect(policy.consume("#snapshot")).toEqual({ hash: "#action", mode: "push" });
    policy.restore();
    expect(policy.consume("#restored")).toEqual({ hash: "#restored", mode: "none" });
    expect(policy.consume("#next")).toEqual({ hash: "#next", mode: "replace" });
  });

  it("creates complete portable URLs without retaining old fragments", () => {
    const codec = new PortableSnapshotCodec({ prefix: "#test1:", definition });
    expect(createPortableUrl(codec, initialState, "https://example.test/app#old")).toMatch(/^https:\/\/example\.test\/app#test1:/);
  });

  it("rejects invalid and duplicate route registrations", () => {
    expect(() => new FragmentRouter([{ kind: "action", prefix: "new" }])).toThrow(/start with/);
    expect(() => new FragmentRouter([
      { kind: "action", prefix: "#new" },
      { kind: "snapshot", prefix: "#new" },
    ])).toThrow(/Duplicate/);
    expect(new FragmentRouter([]).parse("#unknown")).toBeNull();
  });

  it("isolates History API writes and popstate subscriptions", () => {
    const listeners = new Map<string, EventListener>();
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    const browserWindow = {
      history,
      location: { hash: "#restored" },
      addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    } as never;
    const port = new BrowserHistoryPort(browserWindow);
    port.write("#one", "none");
    port.write("#two", "push", { revision: 2 });
    port.write("#three", "replace");
    expect(history.pushState).toHaveBeenCalledWith({ revision: 2 }, "", "#two");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "#three");
    const restored = vi.fn();
    const unsubscribe = port.subscribe(restored);
    listeners.get("popstate")!({ state: { revision: 1 } } as PopStateEvent);
    expect(restored).toHaveBeenCalledWith("#restored", { revision: 1 });
    unsubscribe();
    expect(listeners.has("popstate")).toBe(false);
  });

  it("isolates visibility and exit lifecycle listeners", () => {
    const documentListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const documentPort = {
      visibilityState: "visible",
      addEventListener: (name: string, listener: EventListener) => documentListeners.set(name, listener),
      removeEventListener: (name: string) => documentListeners.delete(name),
    } as never;
    const windowPort = {
      addEventListener: (name: string, listener: EventListener) => windowListeners.set(name, listener),
      removeEventListener: (name: string) => windowListeners.delete(name),
    } as never;
    const lifecycle = new WindowLifecycle(documentPort, windowPort);
    const visibility = vi.fn();
    const exit = vi.fn();
    const unsubscribeVisibility = lifecycle.subscribeVisibility(visibility);
    const unsubscribeExit = lifecycle.subscribeExit(exit);
    documentListeners.get("visibilitychange")!(new Event("visibilitychange"));
    windowListeners.get("pagehide")!(new Event("pagehide"));
    expect(visibility).toHaveBeenCalledWith(true);
    expect(exit).toHaveBeenCalledOnce();
    unsubscribeVisibility();
    unsubscribeExit();
  });
});
