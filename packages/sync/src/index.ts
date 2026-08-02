import {
  applyDocumentCommand,
  createCommandEnvelope,
  type CommandCommitStore,
  type CommandEnvelope,
  type DocumentDefinition,
  type DocumentFailure,
  type DocumentSnapshot,
  type OutboxRecord,
  type OutboxStore,
} from "@mikejhill/portable-document-core";

export type ReplicationStatus =
  "clean" | "staging" | "pending" | "syncing" | "offline" | "conflict" | "unavailable";

export type ReplicationConflict<Command> = {
  readonly envelope: CommandEnvelope<Command>;
  readonly failure: DocumentFailure;
  readonly recoverableCommand: Command;
};

export type ReplicationState<State, Command, Summary> = {
  readonly status: ReplicationStatus;
  readonly head: DocumentSnapshot<State, Summary>;
  readonly visible: DocumentSnapshot<State, Summary>;
  readonly pending: readonly OutboxRecord<Command>[];
  readonly conflict?: ReplicationConflict<Command>;
};

/** Replaceable replication contract implemented by OCC, CRDT, OT, or server engines. */
export interface ReplicationEngine<State, Command, Summary> {
  /** Returns the immutable current replication view. */
  getSnapshot(): ReplicationState<State, Command, Summary>;
  /** Subscribes to state transitions and returns an idempotent disposer. */
  subscribe(listener: () => void): () => void;
  /** Validates, applies, and durably stages a command before resolving. */
  dispatch(
    command: Command,
    options?: { readonly checkpointReason?: string; readonly actorId?: string },
  ): Promise<DocumentFailure | null>;
  /** Accepts a remote head without allowing stale revisions to regress visible state. */
  receiveRemote(snapshot: DocumentSnapshot<State, Summary>): Promise<void>;
  /** Restores durable pending commands after process or page restart. */
  restorePending(): Promise<void>;
  /** Serially commits all currently pending commands until blocked or conflicted. */
  flush(): Promise<void>;
  /** Stops timers and prevents further staging or network work. */
  dispose(): void;
}

export type OccReplicationOptions = {
  readonly idleDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly classifyFailure?: (error: unknown) => "offline" | "unavailable";
};

/** Durable revisioned OCC with optimistic overlays and stale-snapshot defense. */
export class OccReplicationEngine<State, Command, Summary> implements ReplicationEngine<
  State,
  Command,
  Summary
> {
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly idleDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly classifyFailure: (error: unknown) => "offline" | "unavailable";
  private state: ReplicationState<State, Command, Summary>;
  private queue: OutboxRecord<Command>[] = [];
  private inFlight: OutboxRecord<Command> | null = null;
  private flushPromise: Promise<void> | null = null;
  private stagingTail: Promise<void> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  public constructor(
    private readonly definition: DocumentDefinition<State, Command, Summary>,
    initial: DocumentSnapshot<State, Summary>,
    private readonly remote: CommandCommitStore<State, Command, Summary>,
    private readonly outbox: OutboxStore<Command>,
    options: OccReplicationOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      (() =>
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    this.idleDelayMs = options.idleDelayMs ?? 1_500;
    this.maxDelayMs = options.maxDelayMs ?? 5_000;
    this.classifyFailure =
      options.classifyFailure ??
      (() => (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unavailable"));
    this.state = { status: "clean", head: initial, visible: initial, pending: [] };
  }

  public getSnapshot = (): ReplicationState<State, Command, Summary> => this.state;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public async dispatch(
    command: Command,
    options: { readonly checkpointReason?: string; readonly actorId?: string } = {},
  ): Promise<DocumentFailure | null> {
    return this.serializeStaging(() => this.stageCommand(command, options));
  }

  private async stageCommand(
    command: Command,
    options: { readonly checkpointReason?: string; readonly actorId?: string },
  ): Promise<DocumentFailure | null> {
    if (this.disposed)
      return { code: "failed-precondition", message: "Replication engine is disposed." };
    const application = applyDocumentCommand(this.definition, this.state.visible.state, command);
    if (!application.ok) return application.failure;
    const policy = this.definition.commandPolicy.inspect(command);
    const envelope = createCommandEnvelope({
      id: this.createId(),
      documentId: this.state.head.id,
      documentType: this.definition.type,
      baseRevision: this.state.head.revision,
      actorId: options.actorId,
      issuedAt: this.now(),
      command,
    });
    let record: OutboxRecord<Command> = {
      envelope,
      checkpointReason: options.checkpointReason ?? policy.checkpointReason,
      coalescingKey: policy.coalescingKey,
      stagedAt: this.now(),
    };
    const previousIndex =
      policy.durability === "coalesced" && policy.coalescingKey
        ? this.queue.findIndex((candidate) => candidate.coalescingKey === policy.coalescingKey)
        : -1;
    const stableState = this.state;
    this.setState({
      ...this.state,
      status: "staging",
      visible: this.withState(this.state.visible, application.state, envelope.issuedAt),
    });
    try {
      if (previousIndex >= 0 && this.definition.commandPolicy.coalesce) {
        const previous = this.queue[previousIndex]!;
        const combined = this.definition.commandPolicy.coalesce(previous.envelope.command, command);
        if (combined) {
          record = { ...record, envelope: { ...envelope, command: combined } };
          await this.outbox.replace(previous.envelope.id, record);
          this.queue.splice(previousIndex, 1, record);
        } else {
          await this.outbox.put(record);
          this.queue.push(record);
        }
      } else {
        await this.outbox.put(record);
        this.queue.push(record);
      }
    } catch (error) {
      this.setState({
        ...stableState,
        status: this.classifyFailure(error),
        pending: [...this.queue],
      });
      return {
        code: "failed-precondition",
        message: "The command could not be stored durably.",
        recoverable: command,
      };
    }
    this.publishPending("pending");
    if (policy.durability === "immediate") void this.flush();
    else this.scheduleFlush();
    return null;
  }

  public async restorePending(): Promise<void> {
    if (this.disposed) return;
    this.queue = [...(await this.outbox.list(this.state.head.id))];
    this.rebaseVisible();
    if (this.queue.length) {
      this.publishPending("pending");
      await this.flush();
    }
  }

  public async receiveRemote(snapshot: DocumentSnapshot<State, Summary>): Promise<void> {
    if (
      this.disposed ||
      snapshot.id !== this.state.head.id ||
      snapshot.revision < this.state.head.revision
    )
      return;
    const acknowledged = new Set(snapshot.appliedCommandIds);
    const removed = this.queue.filter((record) => acknowledged.has(record.envelope.id));
    this.queue = this.queue.filter((record) => !acknowledged.has(record.envelope.id));
    await Promise.all(removed.map((record) => this.outbox.delete(record.envelope.id)));
    this.state = { ...this.state, head: snapshot, conflict: undefined };
    this.rebaseVisible();
    this.publishPending(this.queue.length || this.inFlight ? "pending" : "clean");
  }

  public async flush(): Promise<void> {
    if (this.disposed) return;
    this.clearTimers();
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushQueue();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
  }

  private async flushQueue(): Promise<void> {
    while (!this.disposed && this.queue.length) {
      const record = this.queue[0]!;
      this.inFlight = record;
      this.publishPending("syncing");
      try {
        const envelope = { ...record.envelope, baseRevision: this.state.head.revision };
        const result = await this.remote.commit(envelope, record.checkpointReason);
        if (!result.ok) {
          this.inFlight = null;
          this.setState({
            ...this.state,
            status: "conflict",
            pending: [...this.queue],
            conflict: {
              envelope: record.envelope,
              failure: result.failure,
              recoverableCommand: record.envelope.command,
            },
          });
          return;
        }
        await this.outbox.delete(record.envelope.id);
        this.queue.shift();
        this.inFlight = null;
        await this.receiveRemote(result.snapshot);
      } catch (error) {
        this.inFlight = null;
        this.publishPending(this.classifyFailure(error));
        return;
      }
    }
    this.publishPending("clean");
  }

  /** Serializes durable outbox mutations so command order cannot follow I/O completion order. */
  private async serializeStaging<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = this.stagingTail;
    let release = (): void => undefined;
    this.stagingTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private rebaseVisible(): void {
    let visible = this.state.head;
    for (const record of this.queue) {
      const result = applyDocumentCommand(this.definition, visible.state, record.envelope.command);
      if (!result.ok) {
        this.setState({
          ...this.state,
          visible,
          status: "conflict",
          pending: [...this.queue],
          conflict: {
            envelope: record.envelope,
            failure: result.failure,
            recoverableCommand: record.envelope.command,
          },
        });
        return;
      }
      visible = this.withState(visible, result.state, record.envelope.issuedAt);
    }
    this.state = { ...this.state, visible };
  }

  private withState(
    snapshot: DocumentSnapshot<State, Summary>,
    state: State,
    updatedAt: number,
  ): DocumentSnapshot<State, Summary> {
    return { ...snapshot, state, summary: this.definition.summarize(state), updatedAt };
  }

  private publishPending(status: ReplicationStatus): void {
    this.setState({ ...this.state, status, pending: [...this.queue] });
  }

  private scheduleFlush(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.flush();
    }, this.idleDelayMs);
    this.maxTimer ??= setTimeout(() => {
      this.maxTimer = null;
      void this.flush();
    }, this.maxDelayMs);
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
  }

  private setState(state: ReplicationState<State, Command, Summary>): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
