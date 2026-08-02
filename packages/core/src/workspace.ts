import { applyDocumentCommand, type DocumentDefinition, type DocumentFailure } from "./document";
import type { CommandEnvelope, DocumentSnapshot } from "./ports";

export type WorkspaceSource = "url" | "device" | "cloud" | "publication" | "invitation";

export type WorkspaceErrorCode =
  | "not-found"
  | "unauthorized"
  | "revoked"
  | "corrupt"
  | "unavailable"
  | "incompatible";

export type ResolvedWorkspace<State, Summary> = {
  readonly snapshot: DocumentSnapshot<State, Summary>;
  readonly source: WorkspaceSource;
  readonly readOnly: boolean;
};

export type RouteResolution<State, Summary> =
  | { readonly ok: true; readonly value: ResolvedWorkspace<State, Summary> }
  | { readonly ok: false; readonly code: WorkspaceErrorCode; readonly message: string };

export interface WorkspaceRouteResolver<State, Summary> {
  resolve(route: string, signal: AbortSignal): Promise<RouteResolution<State, Summary>>;
}

export type WorkspaceState<State, Summary> =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly route: string }
  | ({ readonly status: "ready"; readonly route: string; readonly historicalRevision?: number } & ResolvedWorkspace<State, Summary>)
  | { readonly status: "error"; readonly route: string; readonly code: WorkspaceErrorCode; readonly message: string };

/**
 * Headless route and document lifecycle. Persistence and replication attach
 * through ports rather than being embedded in framework hooks.
 */
export class WorkspaceEngine<State, Command, Summary> {
  private current: WorkspaceState<State, Summary> = { status: "idle" };
  private readonly listeners = new Set<() => void>();
  private abortController: AbortController | null = null;
  private currentHead: DocumentSnapshot<State, Summary> | null = null;
  private headReadOnly = false;
  private disposed = false;

  public constructor(
    private readonly definition: DocumentDefinition<State, Command, Summary>,
    private readonly resolver: WorkspaceRouteResolver<State, Summary>,
  ) {}

  public getSnapshot = (): WorkspaceState<State, Summary> => this.current;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public async open(route: string): Promise<void> {
    if (this.disposed) return;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.setState({ status: "loading", route });
    let resolution: RouteResolution<State, Summary>;
    try {
      resolution = await this.resolver.resolve(route, controller.signal);
    } catch {
      resolution = { ok: false, code: "unavailable", message: "The route provider failed." };
    }
    if (this.disposed || controller.signal.aborted || this.abortController !== controller) return;
    if (!resolution.ok) {
      this.setState({ status: "error", route, code: resolution.code, message: resolution.message });
      return;
    }
    this.currentHead = resolution.value.snapshot;
    this.headReadOnly = resolution.value.readOnly;
    this.setState({ status: "ready", route, ...resolution.value });
  }

  public applySpeculative(envelope: CommandEnvelope<Command>): DocumentFailure | null {
    if (this.current.status !== "ready" || this.current.readOnly) {
      return { code: "permission-denied", message: "This workspace is read-only." };
    }
    if (envelope.documentId !== this.current.snapshot.id || envelope.documentType !== this.definition.type) {
      return { code: "failed-precondition", message: "The command targets another document." };
    }
    const result = applyDocumentCommand(this.definition, this.current.snapshot.state, envelope.command);
    if (!result.ok) return result.failure;
    const snapshot = {
      ...this.current.snapshot,
      state: result.state,
      summary: this.definition.summarize(result.state),
      updatedAt: envelope.issuedAt,
    };
    this.setState({ ...this.current, snapshot });
    return null;
  }

  public acceptHead(snapshot: DocumentSnapshot<State, Summary>): void {
    if (this.current.status !== "ready" || snapshot.id !== this.current.snapshot.id) return;
    if (snapshot.revision < this.current.snapshot.revision && !this.current.historicalRevision) return;
    this.currentHead = snapshot;
    this.setState({ ...this.current, snapshot, historicalRevision: undefined });
  }

  public viewHistorical(snapshot: DocumentSnapshot<State, Summary>): void {
    if (this.current.status !== "ready" || snapshot.id !== this.current.snapshot.id) return;
    this.setState({ ...this.current, snapshot, readOnly: true, historicalRevision: snapshot.revision });
  }

  public returnToHead(): void {
    if (this.current.status !== "ready" || !this.currentHead) return;
    this.setState({ ...this.current, snapshot: this.currentHead, readOnly: this.headReadOnly, historicalRevision: undefined });
  }

  public dispose(): void {
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
    this.listeners.clear();
  }

  private setState(state: WorkspaceState<State, Summary>): void {
    this.current = state;
    for (const listener of this.listeners) listener();
  }
}
