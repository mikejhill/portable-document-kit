/** Browser lifecycle events used by presence and persistence orchestration. */
export interface BrowserLifecycle {
  subscribeVisibility(listener: (visible: boolean) => void): () => void;
  subscribeExit(listener: () => void): () => void;
}

/** Explicit browser lifecycle adapter that remains safe to import during SSR. */
export class WindowLifecycle implements BrowserLifecycle {
  public constructor(
    private readonly documentPort: Pick<
      Document,
      "visibilityState" | "addEventListener" | "removeEventListener"
    >,
    private readonly windowPort: Pick<Window, "addEventListener" | "removeEventListener">,
  ) {}

  /** Reports current visibility after each browser visibility transition. */
  public subscribeVisibility(listener: (visible: boolean) => void): () => void {
    const handler = () => listener(this.documentPort.visibilityState === "visible");
    this.documentPort.addEventListener("visibilitychange", handler);
    return () => this.documentPort.removeEventListener("visibilitychange", handler);
  }

  /** Reports page exit without assuming the asynchronous callback will complete. */
  public subscribeExit(listener: () => void): () => void {
    this.windowPort.addEventListener("pagehide", listener);
    return () => this.windowPort.removeEventListener("pagehide", listener);
  }
}
