import type { PortableSnapshotCodec, SnapshotKind } from "@mikejhill/portable-document-codec";

export type RouteKind = "snapshot" | "local" | "private" | "view" | "launch" | "invitation" | "action";

export type ParsedRoute = {
  readonly kind: RouteKind;
  readonly value: string;
  readonly raw: string;
};

export type RouteRegistration = {
  readonly kind: RouteKind;
  readonly prefix: string;
  readonly identifier?: RegExp;
};

/** Parses consumer-defined route namespaces without interpreting providers. */
export class FragmentRouter {
  private readonly registrations: readonly RouteRegistration[];

  public constructor(registrations: readonly RouteRegistration[]) {
    const prefixes = new Set<string>();
    for (const registration of registrations) {
      if (!registration.prefix.startsWith("#")) throw new Error("Route prefixes must start with #.");
      if (prefixes.has(registration.prefix)) throw new Error(`Duplicate route prefix: ${registration.prefix}`);
      prefixes.add(registration.prefix);
    }
    this.registrations = [...registrations].sort((left, right) => right.prefix.length - left.prefix.length);
  }

  public parse(hash: string): ParsedRoute | null {
    for (const registration of this.registrations) {
      if (!hash.startsWith(registration.prefix)) continue;
      const value = hash.slice(registration.prefix.length);
      if (registration.identifier && !registration.identifier.test(value)) return null;
      return { kind: registration.kind, value, raw: hash };
    }
    return null;
  }

  public hasKnownPrefix(hash: string): boolean {
    return this.registrations.some((registration) => hash.startsWith(registration.prefix));
  }
}

export type HistoryWriteMode = "push" | "replace" | "none";

export interface HistoryPort {
  write(hash: string, mode: HistoryWriteMode, state?: unknown): void;
  subscribe(listener: (hash: string, state: unknown) => void): () => void;
}

/** Browser History adapter that touches globals only when explicitly created. */
export class BrowserHistoryPort implements HistoryPort {
  public constructor(
    private readonly browserWindow: Pick<Window, "history" | "location" | "addEventListener" | "removeEventListener">,
  ) {}

  public write(hash: string, mode: HistoryWriteMode, state: unknown = null): void {
    if (mode === "none") return;
    if (mode === "push") this.browserWindow.history.pushState(state, "", hash);
    else this.browserWindow.history.replaceState(state, "", hash);
  }

  public subscribe(listener: (hash: string, state: unknown) => void): () => void {
    const onPopState = (event: Event) => {
      listener(this.browserWindow.location.hash, (event as PopStateEvent).state);
    };
    this.browserWindow.addEventListener("popstate", onPopState);
    return () => this.browserWindow.removeEventListener("popstate", onPopState);
  }
}

export class NavigationPolicy {
  private mode: HistoryWriteMode = "replace";
  private override: string | null = null;

  public schedule(mode: HistoryWriteMode, routeOverride?: string): void {
    this.mode = mode;
    this.override = routeOverride ?? null;
  }

  public restore(): void {
    this.mode = "none";
    this.override = null;
  }

  public consume(snapshotHash: string): { readonly hash: string; readonly mode: HistoryWriteMode } {
    const result = { hash: this.override ?? snapshotHash, mode: this.mode };
    this.mode = "replace";
    this.override = null;
    return result;
  }
}

export function createPortableUrl<State, Command, Summary>(
  codec: PortableSnapshotCodec<State, Command, Summary>,
  state: State,
  currentHref: string,
  kind: SnapshotKind = "document",
): string {
  return `${currentHref.split("#", 1)[0]}${codec.encode(state, kind)}`;
}

export interface BrowserLifecycle {
  subscribeVisibility(listener: (visible: boolean) => void): () => void;
  subscribeExit(listener: () => void): () => void;
}

export class WindowLifecycle implements BrowserLifecycle {
  public constructor(
    private readonly documentPort: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
    private readonly windowPort: Pick<Window, "addEventListener" | "removeEventListener">,
  ) {}

  public subscribeVisibility(listener: (visible: boolean) => void): () => void {
    const handler = () => listener(this.documentPort.visibilityState === "visible");
    this.documentPort.addEventListener("visibilitychange", handler);
    return () => this.documentPort.removeEventListener("visibilitychange", handler);
  }

  public subscribeExit(listener: () => void): () => void {
    this.windowPort.addEventListener("pagehide", listener);
    return () => this.windowPort.removeEventListener("pagehide", listener);
  }
}
