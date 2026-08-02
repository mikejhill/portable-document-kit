import { SnapshotStore, DocumentCatalog, CommandCommitStore, RevisionHistoryStore, DocumentSubscription, DocumentDefinition, DocumentSnapshot, CommandEnvelope, CommitResult, DocumentCheckpoint, OutboxStore, OutboxRecord } from '@mikejhill/portable-document-core';

/** Deterministic clock for repositories, synchronization, and presence tests. */
declare class FakeClock {
    private value;
    constructor(value?: number);
    now: () => number;
    advance(milliseconds: number): void;
}
/** Reference adapter used by consumers and provider conformance tests. */
declare class InMemoryDocumentStore<State, Command, Summary> implements SnapshotStore<State, Summary>, DocumentCatalog<Summary>, CommandCommitStore<State, Command, Summary>, RevisionHistoryStore<State>, DocumentSubscription<State, Summary> {
    private readonly definition;
    private readonly now;
    private readonly documents;
    private readonly checkpoints;
    private readonly listeners;
    constructor(definition: DocumentDefinition<State, Command, Summary>, now?: () => number);
    load(id: string): Promise<DocumentSnapshot<State, Summary> | null>;
    list(): Promise<ReadonlyArray<Pick<DocumentSnapshot<unknown, Summary>, "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt">>>;
    create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>>;
    replace(id: string, state: State, expectedRevision: number): Promise<DocumentSnapshot<State, Summary>>;
    delete(id: string): Promise<void>;
    commit(envelope: CommandEnvelope<Command>, checkpointReason?: string): Promise<CommitResult<State, Summary>>;
    listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]>;
    restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>>;
    subscribe(documentId: string, listener: (snapshot: DocumentSnapshot<State, Summary>) => void): () => void;
    private emit;
}
declare class InMemoryOutboxStore<Command> implements OutboxStore<Command> {
    private readonly records;
    put(record: OutboxRecord<Command>): Promise<void>;
    replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void>;
    delete(commandId: string): Promise<void>;
    list(documentId: string): Promise<readonly OutboxRecord<Command>[]>;
}
declare function assertSnapshotStoreConformance<State, Summary>(options: {
    readonly store: SnapshotStore<State, Summary>;
    readonly id: string;
    readonly initial: State;
    readonly replacement: State;
}): Promise<void>;

export { FakeClock, InMemoryDocumentStore, InMemoryOutboxStore, assertSnapshotStoreConformance };
