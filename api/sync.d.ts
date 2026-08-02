import { DocumentSnapshot, OutboxRecord, CommandEnvelope, DocumentFailure, DocumentDefinition, CommandCommitStore, OutboxStore } from '@mikejhill/portable-document-core';

type ReplicationStatus = "clean" | "staging" | "pending" | "syncing" | "offline" | "conflict" | "unavailable";
type ReplicationConflict<Command> = {
    readonly envelope: CommandEnvelope<Command>;
    readonly failure: DocumentFailure;
    readonly recoverableCommand: Command;
};
type ReplicationState<State, Command, Summary> = {
    readonly status: ReplicationStatus;
    readonly head: DocumentSnapshot<State, Summary>;
    readonly visible: DocumentSnapshot<State, Summary>;
    readonly pending: readonly OutboxRecord<Command>[];
    readonly conflict?: ReplicationConflict<Command>;
};
/** Replaceable replication contract implemented by OCC, CRDT, OT, or server engines. */
interface ReplicationEngine<State, Command, Summary> {
    /** Returns the immutable current replication view. */
    getSnapshot(): ReplicationState<State, Command, Summary>;
    /** Subscribes to state transitions and returns an idempotent disposer. */
    subscribe(listener: () => void): () => void;
    /** Validates, applies, and durably stages a command before resolving. */
    dispatch(command: Command, options?: {
        readonly checkpointReason?: string;
        readonly actorId?: string;
    }): Promise<DocumentFailure | null>;
    /** Accepts a remote head without allowing stale revisions to regress visible state. */
    receiveRemote(snapshot: DocumentSnapshot<State, Summary>): Promise<void>;
    /** Restores durable pending commands after process or page restart. */
    restorePending(): Promise<void>;
    /** Serially commits all currently pending commands until blocked or conflicted. */
    flush(): Promise<void>;
    /** Stops timers and prevents further staging or network work. */
    dispose(): void;
}
type OccReplicationOptions = {
    readonly idleDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly now?: () => number;
    readonly createId?: () => string;
    readonly classifyFailure?: (error: unknown) => "offline" | "unavailable";
};
/** Durable revisioned OCC with optimistic overlays and stale-snapshot defense. */
declare class OccReplicationEngine<State, Command, Summary> implements ReplicationEngine<State, Command, Summary> {
    private readonly definition;
    private readonly remote;
    private readonly outbox;
    private readonly listeners;
    private readonly now;
    private readonly createId;
    private readonly idleDelayMs;
    private readonly maxDelayMs;
    private readonly classifyFailure;
    private state;
    private queue;
    private inFlight;
    private flushPromise;
    private stagingTail;
    private idleTimer;
    private maxTimer;
    private disposed;
    constructor(definition: DocumentDefinition<State, Command, Summary>, initial: DocumentSnapshot<State, Summary>, remote: CommandCommitStore<State, Command, Summary>, outbox: OutboxStore<Command>, options?: OccReplicationOptions);
    getSnapshot: () => ReplicationState<State, Command, Summary>;
    subscribe: (listener: () => void) => (() => void);
    dispatch(command: Command, options?: {
        readonly checkpointReason?: string;
        readonly actorId?: string;
    }): Promise<DocumentFailure | null>;
    private stageCommand;
    restorePending(): Promise<void>;
    receiveRemote(snapshot: DocumentSnapshot<State, Summary>): Promise<void>;
    flush(): Promise<void>;
    dispose(): void;
    private flushQueue;
    /** Serializes durable outbox mutations so command order cannot follow I/O completion order. */
    private serializeStaging;
    private rebaseVisible;
    private withState;
    private publishPending;
    private scheduleFlush;
    private clearTimers;
    private setState;
}

export { OccReplicationEngine, type OccReplicationOptions, type ReplicationConflict, type ReplicationEngine, type ReplicationState, type ReplicationStatus };
