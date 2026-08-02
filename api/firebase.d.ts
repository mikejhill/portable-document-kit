import { Firestore, Unsubscribe } from 'firebase/firestore';
import { Auth } from 'firebase/auth';
import { FirebaseApp } from 'firebase/app';
import { SnapshotStore, DocumentCatalog, CommandCommitStore, RevisionHistoryStore, DocumentSubscription, PublicationStore, MembershipStore, PresenceStore, CapabilityManifest, DocumentDefinition, DocumentSnapshot, CommandEnvelope, CommitResult, DocumentCheckpoint, PublicationKind, Publication, Member, Presence } from '@mikejhill/portable-document-core';

type FirebasePrincipal = {
    readonly id: string;
    readonly anonymous: boolean;
    readonly verified: boolean;
    readonly displayName?: string;
};
type FirebaseRuntimeOptions = {
    readonly app: FirebaseApp;
    readonly getAuth: (app: FirebaseApp) => Auth;
    readonly getFirestore: (app: FirebaseApp) => Firestore;
    readonly initializeAppCheck?: (app: FirebaseApp) => void;
};
/** Lazily initializes Firestore and App Check; authentication remains separate. */
declare class FirebaseRuntime {
    private readonly options;
    private database;
    private authentication;
    private appCheckInitialized;
    constructor(options: FirebaseRuntimeOptions);
    auth(): Auth;
    firestore(): Firestore;
}
declare class FirebaseIdentity {
    private readonly runtime;
    constructor(runtime: FirebaseRuntime);
    subscribe(listener: (principal: FirebasePrincipal | null) => void): Unsubscribe;
    ensureAnonymous(): Promise<FirebasePrincipal>;
    signOut(): Promise<void>;
}
type FirebaseDocumentStoreOptions = {
    readonly now?: () => number;
    readonly createToken?: () => string;
    readonly getPrincipal: () => FirebasePrincipal | null;
};
/** Fixed-schema Firestore adapter for content, sharing, membership, and presence. */
declare class FirebaseDocumentStore<State, Command, Summary> implements SnapshotStore<State, Summary>, DocumentCatalog<Summary>, CommandCommitStore<State, Command, Summary>, RevisionHistoryStore<State>, DocumentSubscription<State, Summary>, PublicationStore<State, Summary>, MembershipStore, PresenceStore {
    private readonly runtime;
    private readonly definition;
    private readonly options;
    readonly manifest: CapabilityManifest;
    private readonly now;
    private readonly createToken;
    constructor(runtime: FirebaseRuntime, definition: DocumentDefinition<State, Command, Summary>, options: FirebaseDocumentStoreOptions);
    load(id: string): Promise<DocumentSnapshot<State, Summary> | null>;
    list(): Promise<ReadonlyArray<Pick<DocumentSnapshot<unknown, Summary>, "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt">>>;
    create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>>;
    replace(id: string, state: State, expectedRevision: number): Promise<DocumentSnapshot<State, Summary>>;
    delete(id: string): Promise<void>;
    commit(envelope: CommandEnvelope<Command>, checkpointReason?: string): Promise<CommitResult<State, Summary>>;
    subscribe(documentId: string, listener: (snapshot: DocumentSnapshot<State, Summary>) => void): Unsubscribe;
    listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]>;
    restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>>;
    publish(documentId: string, kind: PublicationKind, rotate?: boolean): Promise<Publication>;
    revoke(documentId: string, kind: PublicationKind): Promise<void>;
    resolve(token: string): Promise<{
        readonly publication: Publication;
        readonly snapshot: DocumentSnapshot<State, Summary>;
    } | null>;
    listMembers(documentId: string): Promise<readonly Member[]>;
    /** Converts an editor bearer token into a revocable guest session or durable account membership. */
    acceptEditorInvitation(token: string): Promise<string>;
    setMember(documentId: string, member: Member): Promise<void>;
    removeMember(documentId: string, principalId: string): Promise<void>;
    transferOwnership(documentId: string, principalId: string): Promise<void>;
    heartbeat(documentId: string, presence: Presence): Promise<void>;
    clear(documentId: string, sessionId: string): Promise<void>;
    subscribePresence(documentId: string, listener: (presence: readonly Presence[]) => void): Unsubscribe;
    private get database();
    private requirePrincipal;
    private requireVerifiedPrincipal;
    private requireCloudDocument;
    private requireLoad;
    private parseDocument;
    private assertPayloadSize;
}
declare function activePresence(entries: readonly Presence[], now?: number, ttlMs?: number): readonly Presence[];

export { FirebaseDocumentStore, type FirebaseDocumentStoreOptions, FirebaseIdentity, type FirebasePrincipal, FirebaseRuntime, type FirebaseRuntimeOptions, activePresence };
