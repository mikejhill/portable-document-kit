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
interface ReplicationEngine<State, Command, Summary> {
    getSnapshot(): ReplicationState<State, Command, Summary>;
    subscribe(listener: () => void): () => void;
    dispatch(command: Command, options?: {
        readonly checkpointReason?: string;
        readonly actorId?: string;
    }): Promise<DocumentFailure | null>;
    receiveRemote(snapshot: DocumentSnapshot<State, Summary>): Promise<void>;
    restorePending(): Promise<void>;
    flush(): Promise<void>;
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
    restorePending(): Promise<void>;
    receiveRemote(snapshot: DocumentSnapshot<State, Summary>): Promise<void>;
    flush(): Promise<void>;
    dispose(): void;
    private flushQueue;
    private rebaseVisible;
    private withState;
    private publishPending;
    private scheduleFlush;
    private clearTimers;
    private setState;
}

export { OccReplicationEngine, type OccReplicationOptions, type ReplicationConflict, type ReplicationEngine, type ReplicationState, type ReplicationStatus };
