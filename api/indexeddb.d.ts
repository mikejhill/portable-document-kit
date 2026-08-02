import { SnapshotStore, DocumentCatalog, CommandCommitStore, RevisionHistoryStore, DocumentSubscription, CapabilityManifest, DocumentDefinition, DocumentSnapshot, CommandEnvelope, CommitResult, DocumentCheckpoint, OutboxStore, OutboxRecord } from '@mikejhill/portable-document-core';

type IndexedDbOptions = {
    readonly databaseName: string;
    readonly indexedDB?: IDBFactory;
    readonly broadcastChannel?: typeof BroadcastChannel | null;
    readonly now?: () => number;
    readonly checkpointLimit?: number;
};
declare class IndexedDbUnavailableError extends Error {
    constructor();
}
declare class IndexedDbUpgradeBlockedError extends Error {
    constructor();
}
/** Validated local document repository with revision and subscription support. */
declare class IndexedDbDocumentStore<State, Command, Summary> implements SnapshotStore<State, Summary>, DocumentCatalog<Summary>, CommandCommitStore<State, Command, Summary>, RevisionHistoryStore<State>, DocumentSubscription<State, Summary> {
    private readonly definition;
    readonly manifest: CapabilityManifest;
    private readonly database;
    private readonly now;
    private readonly checkpointLimit;
    private readonly listeners;
    private readonly channel;
    constructor(definition: DocumentDefinition<State, Command, Summary>, options: IndexedDbOptions);
    load(id: string): Promise<DocumentSnapshot<State, Summary> | null>;
    list(): Promise<ReadonlyArray<Pick<DocumentSnapshot<unknown, Summary>, "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt">>>;
    create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>>;
    replace(id: string, state: State, expectedRevision: number): Promise<DocumentSnapshot<State, Summary>>;
    delete(id: string): Promise<void>;
    commit(envelope: CommandEnvelope<Command>, checkpointReason?: string): Promise<CommitResult<State, Summary>>;
    listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]>;
    restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>>;
    subscribe(documentId: string, listener: (snapshot: DocumentSnapshot<State, Summary>) => void): () => void;
    close(): void;
    private parse;
    private checkpoint;
    private changed;
    private emit;
}
/** Durable command outbox isolated from the local document repository. */
declare class IndexedDbOutboxStore<Command> implements OutboxStore<Command> {
    readonly manifest: CapabilityManifest;
    private readonly database;
    constructor(options: IndexedDbOptions);
    put(record: OutboxRecord<Command>): Promise<void>;
    replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void>;
    delete(commandId: string): Promise<void>;
    list(documentId: string): Promise<readonly OutboxRecord<Command>[]>;
    close(): void;
}

export { IndexedDbDocumentStore, type IndexedDbOptions, IndexedDbOutboxStore, IndexedDbUnavailableError, IndexedDbUpgradeBlockedError };
