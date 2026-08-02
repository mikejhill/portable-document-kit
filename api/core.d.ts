import { StandardSchemaV1 } from '@standard-schema/spec';

type DiagnosticLevel = "debug" | "info" | "warn" | "error";
type DiagnosticEvent = {
    readonly level: DiagnosticLevel;
    readonly code: string;
    readonly measurements?: Readonly<Record<string, number | boolean>>;
};
interface DiagnosticSink {
    emit(event: DiagnosticEvent): void;
}
declare const silentDiagnostics: DiagnosticSink;

type ValidationIssue = {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | {
        readonly key: PropertyKey;
    }>;
};
type ValidationResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly issues: readonly ValidationIssue[];
};
/**
 * A Standard Schema validator used synchronously by reducers and optimistic UI.
 * Asynchronous schemas are detected and rejected with an explicit issue.
 */
type DocumentSchema<T> = StandardSchemaV1<unknown, T>;
/** Validates an untrusted value without binding the core to a schema vendor. */
declare function validateValue<T>(schema: DocumentSchema<T>, value: unknown): ValidationResult<T>;

type DurabilityPriority = "coalesced" | "immediate";
type CommandMetadata = {
    readonly targets: readonly string[];
    readonly coalescingKey?: string;
    readonly durability: DurabilityPriority;
    readonly checkpointReason?: string;
    readonly conflictLabel?: string;
};
type CommandPolicy<Command> = {
    inspect(command: Command): CommandMetadata;
    coalesce?(previous: Command, next: Command): Command | null;
};
type ReducerRejectionCode = "missing-target" | "failed-precondition" | "permission-denied" | "conflict";
type ReducerResult<State> = {
    readonly ok: true;
    readonly state: State;
} | {
    readonly ok: false;
    readonly code: ReducerRejectionCode;
    readonly message: string;
    readonly recoverable?: unknown;
};
type DocumentMigration = {
    readonly from: number;
    readonly to: number;
    migrate(value: unknown): unknown;
};
type DocumentDefinition<State, Command, Summary> = {
    readonly type: string;
    readonly currentSchemaVersion: number;
    readonly stateSchema: DocumentSchema<State>;
    readonly commandSchema: DocumentSchema<Command>;
    readonly migrations: readonly DocumentMigration[];
    reduce(state: State, command: Command): ReducerResult<State>;
    summarize(state: State): Summary;
    readonly commandPolicy: CommandPolicy<Command>;
};
type DocumentDefinitionOptions<State, Command, Summary> = DocumentDefinition<State, Command, Summary>;
/** Defines one consumer document contract and verifies its migration graph. */
declare function defineDocument<State, Command, Summary>(options: DocumentDefinitionOptions<State, Command, Summary>): DocumentDefinition<State, Command, Summary>;
type DocumentFailure = {
    readonly code: "invalid-state";
    readonly issues: readonly ValidationIssue[];
} | {
    readonly code: "invalid-command";
    readonly issues: readonly ValidationIssue[];
} | {
    readonly code: "incompatible-version";
    readonly version: number;
} | {
    readonly code: ReducerRejectionCode;
    readonly message: string;
    readonly recoverable?: unknown;
};
type ApplyResult<State> = {
    readonly ok: true;
    readonly state: State;
} | {
    readonly ok: false;
    readonly failure: DocumentFailure;
};
/** Applies one validated semantic command and validates the reducer output. */
declare function applyDocumentCommand<State, Command, Summary>(definition: DocumentDefinition<State, Command, Summary>, state: unknown, command: unknown): ApplyResult<State>;
/** Migrates untrusted persisted state through a contiguous migration chain. */
declare function migrateDocumentState<State, Command, Summary>(definition: DocumentDefinition<State, Command, Summary>, value: unknown, fromVersion: number): ApplyResult<State>;

type IntegrityLevel = "client-validated" | "envelope-enforced" | "server-authoritative";
type CapabilityName = "snapshot" | "catalog" | "commands" | "history" | "subscription" | "outbox" | "publication" | "membership" | "presence";
type CapabilityManifest = {
    readonly adapter: string;
    readonly integrity: IntegrityLevel;
    readonly capabilities: ReadonlySet<CapabilityName>;
};
type CommandEnvelope<Command> = {
    readonly protocolVersion: 1;
    readonly id: string;
    readonly documentId: string;
    readonly documentType: string;
    readonly baseRevision: number;
    readonly actorId?: string;
    readonly issuedAt: number;
    readonly command: Command;
};
type DocumentSnapshot<State, Summary> = {
    readonly id: string;
    readonly documentType: string;
    readonly schemaVersion: number;
    readonly state: State;
    readonly summary: Summary;
    readonly revision: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly appliedCommandIds: readonly string[];
    readonly lastTargets: readonly string[];
};
type DocumentCheckpoint<State> = {
    readonly documentId: string;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly state: State;
    readonly reason: string;
    readonly createdAt: number;
};
interface SnapshotStore<State, Summary> {
    load(id: string): Promise<DocumentSnapshot<State, Summary> | null>;
    create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>>;
    replace(id: string, state: State, expectedRevision: number): Promise<DocumentSnapshot<State, Summary>>;
    delete(id: string): Promise<void>;
}
interface DocumentCatalog<Summary> {
    list(): Promise<ReadonlyArray<Pick<DocumentSnapshot<unknown, Summary>, "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt">>>;
}
type CommitResult<State, Summary> = {
    readonly ok: true;
    readonly snapshot: DocumentSnapshot<State, Summary>;
} | {
    readonly ok: false;
    readonly failure: DocumentFailure;
    readonly latest?: DocumentSnapshot<State, Summary>;
};
interface CommandCommitStore<State, Command, Summary> {
    commit(envelope: CommandEnvelope<Command>, checkpointReason?: string): Promise<CommitResult<State, Summary>>;
}
/**
 * Determines whether a stale command can merge over the immediately preceding
 * revision. Older gaps fail closed because a snapshot does not carry enough
 * target history to prove that every intervening change was independent.
 */
declare function assessRevisionConflict(baseRevision: number, currentRevision: number, commandTargets: readonly string[], latestTargets: readonly string[], conflictLabel?: string): DocumentFailure | null;
interface RevisionHistoryStore<State> {
    listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]>;
    restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>>;
}
interface DocumentSubscription<State, Summary> {
    subscribe(documentId: string, listener: (snapshot: DocumentSnapshot<State, Summary>) => void): () => void;
}
type OutboxRecord<Command> = {
    readonly envelope: CommandEnvelope<Command>;
    readonly checkpointReason?: string;
    readonly coalescingKey?: string;
    readonly stagedAt: number;
};
interface OutboxStore<Command> {
    put(record: OutboxRecord<Command>): Promise<void>;
    replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void>;
    delete(commandId: string): Promise<void>;
    list(documentId: string): Promise<readonly OutboxRecord<Command>[]>;
}
type PublicationKind = "view" | "launch" | "editor";
type Publication = {
    readonly token: string;
    readonly documentId: string;
    readonly kind: PublicationKind;
    readonly revision: number;
};
interface PublicationStore<State, Summary> {
    publish(documentId: string, kind: PublicationKind, rotate?: boolean): Promise<Publication>;
    revoke(documentId: string, kind: PublicationKind): Promise<void>;
    resolve(token: string): Promise<{
        readonly publication: Publication;
        readonly snapshot: DocumentSnapshot<State, Summary>;
    } | null>;
}
type MemberRole = "owner" | "editor" | "viewer";
type Member = {
    readonly principalId: string;
    readonly role: MemberRole;
};
interface MembershipStore {
    listMembers(documentId: string): Promise<readonly Member[]>;
    setMember(documentId: string, member: Member): Promise<void>;
    removeMember(documentId: string, principalId: string): Promise<void>;
    transferOwnership(documentId: string, principalId: string): Promise<void>;
}
type Presence = {
    readonly principalId: string;
    readonly sessionId: string;
    readonly displayName: string;
    readonly lastSeen: number;
};
interface PresenceStore {
    heartbeat(documentId: string, presence: Presence): Promise<void>;
    clear(documentId: string, sessionId: string): Promise<void>;
    subscribePresence(documentId: string, listener: (presence: readonly Presence[]) => void): () => void;
}
declare function createCommandEnvelope<Command>(options: {
    readonly id?: string;
    readonly documentId: string;
    readonly documentType: string;
    readonly baseRevision: number;
    readonly actorId?: string;
    readonly issuedAt?: number;
    readonly command: Command;
}): CommandEnvelope<Command>;

type WorkspaceSource = "url" | "device" | "cloud" | "publication" | "invitation";
type WorkspaceErrorCode = "not-found" | "unauthorized" | "revoked" | "corrupt" | "unavailable" | "incompatible";
type ResolvedWorkspace<State, Summary> = {
    readonly snapshot: DocumentSnapshot<State, Summary>;
    readonly source: WorkspaceSource;
    readonly readOnly: boolean;
};
type RouteResolution<State, Summary> = {
    readonly ok: true;
    readonly value: ResolvedWorkspace<State, Summary>;
} | {
    readonly ok: false;
    readonly code: WorkspaceErrorCode;
    readonly message: string;
};
interface WorkspaceRouteResolver<State, Summary> {
    resolve(route: string, signal: AbortSignal): Promise<RouteResolution<State, Summary>>;
}
type WorkspaceState<State, Summary> = {
    readonly status: "idle";
} | {
    readonly status: "loading";
    readonly route: string;
} | ({
    readonly status: "ready";
    readonly route: string;
    readonly historicalRevision?: number;
} & ResolvedWorkspace<State, Summary>) | {
    readonly status: "error";
    readonly route: string;
    readonly code: WorkspaceErrorCode;
    readonly message: string;
};
/**
 * Headless route and document lifecycle. Persistence and replication attach
 * through ports rather than being embedded in framework hooks.
 */
declare class WorkspaceEngine<State, Command, Summary> {
    private readonly definition;
    private readonly resolver;
    private current;
    private readonly listeners;
    private abortController;
    private currentHead;
    private headReadOnly;
    private disposed;
    constructor(definition: DocumentDefinition<State, Command, Summary>, resolver: WorkspaceRouteResolver<State, Summary>);
    getSnapshot: () => WorkspaceState<State, Summary>;
    subscribe: (listener: () => void) => (() => void);
    open(route: string): Promise<void>;
    applySpeculative(envelope: CommandEnvelope<Command>): DocumentFailure | null;
    acceptHead(snapshot: DocumentSnapshot<State, Summary>): void;
    viewHistorical(snapshot: DocumentSnapshot<State, Summary>): void;
    returnToHead(): void;
    dispose(): void;
    private setState;
}

export { type ApplyResult, type CapabilityManifest, type CapabilityName, type CommandCommitStore, type CommandEnvelope, type CommandMetadata, type CommandPolicy, type CommitResult, type DiagnosticEvent, type DiagnosticLevel, type DiagnosticSink, type DocumentCatalog, type DocumentCheckpoint, type DocumentDefinition, type DocumentDefinitionOptions, type DocumentFailure, type DocumentMigration, type DocumentSchema, type DocumentSnapshot, type DocumentSubscription, type DurabilityPriority, type IntegrityLevel, type Member, type MemberRole, type MembershipStore, type OutboxRecord, type OutboxStore, type Presence, type PresenceStore, type Publication, type PublicationKind, type PublicationStore, type ReducerRejectionCode, type ReducerResult, type ResolvedWorkspace, type RevisionHistoryStore, type RouteResolution, type SnapshotStore, type ValidationIssue, type ValidationResult, WorkspaceEngine, type WorkspaceErrorCode, type WorkspaceRouteResolver, type WorkspaceSource, type WorkspaceState, applyDocumentCommand, assessRevisionConflict, createCommandEnvelope, defineDocument, migrateDocumentState, silentDiagnostics, validateValue };
