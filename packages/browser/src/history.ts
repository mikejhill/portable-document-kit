/** Controls whether the next route write creates, replaces, or preserves history. */
export type HistoryWriteMode = "push" | "replace" | "none";

/** Browser-independent history contract used by workspace composition roots. */
export interface HistoryPort {
  write(hash: string, mode: HistoryWriteMode, state?: unknown): void;
  subscribe(listener: (hash: string, state: unknown) => void): () => void;
}

/** Browser History adapter that touches globals only when explicitly created. */
export class BrowserHistoryPort implements HistoryPort {
  public constructor(
    private readonly browserWindow: Pick<
      Window,
      "history" | "location" | "addEventListener" | "removeEventListener"
    >,
  ) {}

  /** Applies one explicit History API write and preserves `none` restorations. */
  public write(hash: string, mode: HistoryWriteMode, state: unknown = null): void {
    if (mode === "none") return;
    if (mode === "push") this.browserWindow.history.pushState(state, "", hash);
    else this.browserWindow.history.replaceState(state, "", hash);
  }

  /** Subscribes to Back/Forward restoration and returns an idempotent disposer. */
  public subscribe(listener: (hash: string, state: unknown) => void): () => void {
    const onPopState = (event: Event) => {
      listener(this.browserWindow.location.hash, (event as PopStateEvent).state);
    };
    this.browserWindow.addEventListener("popstate", onPopState);
    return () => this.browserWindow.removeEventListener("popstate", onPopState);
  }
}

/** Stateful policy for the next browser-history transition. */
export class NavigationPolicy {
  private mode: HistoryWriteMode = "replace";
  private override: string | null = null;

  /** Schedules the next history mode and optional route override. */
  public schedule(mode: HistoryWriteMode, routeOverride?: string): void {
    this.mode = mode;
    this.override = routeOverride ?? null;
  }

  /** Marks the next render as a restoration that must not rewrite history. */
  public restore(): void {
    this.mode = "none";
    this.override = null;
  }

  /** Consumes the pending transition and resets routine writes to `replace`. */
  public consume(snapshotHash: string): { readonly hash: string; readonly mode: HistoryWriteMode } {
    const result = { hash: this.override ?? snapshotHash, mode: this.mode };
    this.mode = "replace";
    this.override = null;
    return result;
  }
}
