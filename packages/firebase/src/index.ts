import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { FirebaseApp } from "firebase/app";
import {
  applyDocumentCommand,
  assessRevisionConflict,
  migrateDocumentState,
  type CapabilityManifest,
  type CommandCommitStore,
  type CommandEnvelope,
  type CommitResult,
  type DocumentCatalog,
  type DocumentCheckpoint,
  type DocumentDefinition,
  type DocumentSnapshot,
  type DocumentSubscription,
  type Member,
  type MembershipStore,
  type Presence,
  type PresenceStore,
  type Publication,
  type PublicationKind,
  type PublicationStore,
  type RevisionHistoryStore,
  type SnapshotStore,
} from "@mikejhill/portable-document-core";

const DOCUMENTS = "pdkDocuments";
const PUBLICATIONS = "pdkPublications";
const MAX_PAYLOAD_BYTES = 750 * 1024;
const MAX_MEMBERS = 20;
const MAX_RECENT_COMMANDS = 50;
const MAX_CHECKPOINTS = 25;

export type FirebasePrincipal = {
  readonly id: string;
  readonly anonymous: boolean;
  readonly verified: boolean;
  readonly displayName?: string;
};

export type FirebaseRuntimeOptions = {
  readonly app: FirebaseApp;
  readonly getAuth: (app: FirebaseApp) => Auth;
  readonly getFirestore: (app: FirebaseApp) => Firestore;
  readonly initializeAppCheck?: (app: FirebaseApp) => void;
};

/** Lazily initializes Firestore and App Check; authentication remains separate. */
export class FirebaseRuntime {
  private database: Firestore | null = null;
  private authentication: Auth | null = null;
  private appCheckInitialized = false;

  public constructor(private readonly options: FirebaseRuntimeOptions) {}

  public auth(): Auth {
    this.authentication ??= this.options.getAuth(this.options.app);
    return this.authentication;
  }

  public firestore(): Firestore {
    if (!this.appCheckInitialized) {
      this.options.initializeAppCheck?.(this.options.app);
      this.appCheckInitialized = true;
    }
    this.database ??= this.options.getFirestore(this.options.app);
    return this.database;
  }
}

export class FirebaseIdentity {
  public constructor(private readonly runtime: FirebaseRuntime) {}

  public subscribe(listener: (principal: FirebasePrincipal | null) => void): Unsubscribe {
    return onAuthStateChanged(this.runtime.auth(), (user) =>
      listener(user ? toPrincipal(user) : null),
    );
  }

  public async ensureAnonymous(): Promise<FirebasePrincipal> {
    const current = this.runtime.auth().currentUser;
    if (current) return toPrincipal(current);
    return toPrincipal((await signInAnonymously(this.runtime.auth())).user);
  }

  public async signOut(): Promise<void> {
    await signOut(this.runtime.auth());
  }
}

type CloudDocument = {
  readonly schemaVersion: 1;
  readonly documentType: string;
  readonly documentSchemaVersion: number;
  readonly state: unknown;
  readonly summary: unknown;
  readonly ownerId: string;
  readonly memberIds: readonly string[];
  readonly roles: Readonly<Record<string, "owner" | "editor" | "viewer">>;
  readonly revision: number;
  readonly recentCommandIds: readonly string[];
  readonly checkpointRevisions: readonly number[];
  readonly publicationTokens: Readonly<Partial<Record<PublicationKind, string>>>;
  readonly lastTargets: readonly string[];
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly updatedBy: string;
  readonly lastAcceptedToken?: string;
};

type CloudCheckpoint = {
  readonly schemaVersion: 1;
  readonly documentSchemaVersion: number;
  readonly state: unknown;
  readonly revision: number;
  readonly reason: string;
  readonly createdAt: unknown;
};

type CloudPublication = {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly kind: PublicationKind;
  readonly revision: number;
  readonly documentType: string;
  readonly documentSchemaVersion: number;
  readonly state: unknown;
  readonly summary: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
};

export type FirebaseDocumentStoreOptions = {
  readonly now?: () => number;
  readonly createToken?: () => string;
  readonly getPrincipal: () => FirebasePrincipal | null;
};

/** Fixed-schema Firestore adapter for content, sharing, membership, and presence. */
export class FirebaseDocumentStore<State, Command, Summary>
  implements
    SnapshotStore<State, Summary>,
    DocumentCatalog<Summary>,
    CommandCommitStore<State, Command, Summary>,
    RevisionHistoryStore<State>,
    DocumentSubscription<State, Summary>,
    PublicationStore<State, Summary>,
    MembershipStore,
    PresenceStore
{
  public readonly manifest: CapabilityManifest = {
    adapter: "firebase-firestore",
    integrity: "envelope-enforced",
    capabilities: new Set([
      "snapshot",
      "catalog",
      "commands",
      "history",
      "subscription",
      "publication",
      "membership",
      "presence",
    ]),
  };
  private readonly now: () => number;
  private readonly createToken: () => string;

  public constructor(
    private readonly runtime: FirebaseRuntime,
    private readonly definition: DocumentDefinition<State, Command, Summary>,
    private readonly options: FirebaseDocumentStoreOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ?? randomToken;
  }

  public async load(id: string): Promise<DocumentSnapshot<State, Summary> | null> {
    const snapshot = await getDoc(doc(this.database, DOCUMENTS, id));
    return snapshot.exists() ? this.parseDocument(id, snapshot.data() as CloudDocument) : null;
  }

  public async list(): Promise<
    ReadonlyArray<
      Pick<
        DocumentSnapshot<unknown, Summary>,
        "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt"
      >
    >
  > {
    const principal = this.requirePrincipal();
    const snapshots = await getDocs(
      query(
        collection(this.database, DOCUMENTS),
        where("memberIds", "array-contains", principal.id),
        orderBy("updatedAt", "desc"),
      ),
    );
    return snapshots.docs.map((snapshot) => {
      const parsed = this.parseDocument(snapshot.id, snapshot.data() as CloudDocument);
      return {
        id: parsed.id,
        documentType: parsed.documentType,
        summary: parsed.summary,
        revision: parsed.revision,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
      };
    });
  }

  public async create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>> {
    const principal = this.requireVerifiedPrincipal();
    const parsed = migrateDocumentState(
      this.definition,
      state,
      this.definition.currentSchemaVersion,
    );
    if (!parsed.ok) throw new Error("Cannot store invalid document state.");
    this.assertPayloadSize(parsed.state);
    const reference = doc(this.database, DOCUMENTS, id);
    const record: CloudDocument = {
      schemaVersion: 1,
      documentType: this.definition.type,
      documentSchemaVersion: this.definition.currentSchemaVersion,
      state: parsed.state,
      summary: this.definition.summarize(parsed.state),
      ownerId: principal.id,
      memberIds: [principal.id],
      roles: { [principal.id]: "owner" },
      revision: 1,
      recentCommandIds: [],
      checkpointRevisions: [1],
      publicationTokens: {},
      lastTargets: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: principal.id,
    };
    const batch = writeBatch(this.database);
    batch.set(reference, record);
    batch.set(doc(reference, "checkpoints", "1"), {
      schemaVersion: 1,
      documentSchemaVersion: this.definition.currentSchemaVersion,
      state: parsed.state,
      revision: 1,
      reason: "Document Created",
      createdAt: serverTimestamp(),
    } satisfies CloudCheckpoint);
    await batch.commit();
    return this.requireLoad(id);
  }

  public async replace(
    id: string,
    state: State,
    expectedRevision: number,
  ): Promise<DocumentSnapshot<State, Summary>> {
    const principal = this.requirePrincipal();
    const parsed = migrateDocumentState(
      this.definition,
      state,
      this.definition.currentSchemaVersion,
    );
    if (!parsed.ok) throw new Error("Cannot store invalid document state.");
    this.assertPayloadSize(parsed.state);
    const reference = doc(this.database, DOCUMENTS, id);
    await runTransaction(this.database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists() || snapshot.data().revision !== expectedRevision)
        throw new Error("Document revision changed.");
      transaction.update(reference, {
        state: parsed.state,
        summary: this.definition.summarize(parsed.state),
        documentSchemaVersion: this.definition.currentSchemaVersion,
        revision: expectedRevision + 1,
        lastTargets: ["document"],
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
    });
    return this.requireLoad(id);
  }

  public async delete(id: string): Promise<void> {
    const principal = this.requirePrincipal();
    const current = await this.requireCloudDocument(id);
    if (current.ownerId !== principal.id)
      throw new Error("Only the owner can delete this document.");
    const batch = writeBatch(this.database);
    for (const name of ["checkpoints", "presence", "editorSessions"]) {
      const children = await getDocs(collection(this.database, DOCUMENTS, id, name));
      for (const child of children.docs) batch.delete(child.ref);
    }
    for (const token of Object.values(current.publicationTokens)) {
      if (token) batch.delete(doc(this.database, PUBLICATIONS, token));
    }
    batch.delete(doc(this.database, DOCUMENTS, id));
    await batch.commit();
  }

  public async commit(
    envelope: CommandEnvelope<Command>,
    checkpointReason?: string,
  ): Promise<CommitResult<State, Summary>> {
    const principal = this.requirePrincipal();
    if (envelope.documentType !== this.definition.type) {
      return {
        ok: false,
        failure: { code: "failed-precondition", message: "Wrong document type." },
      };
    }
    const reference = doc(this.database, DOCUMENTS, envelope.documentId);
    let rejected: CommitResult<State, Summary> | null = null;
    await runTransaction(this.database, async (transaction) => {
      const cloudSnapshot = await transaction.get(reference);
      if (!cloudSnapshot.exists()) {
        rejected = {
          ok: false,
          failure: { code: "missing-target", message: "Document no longer exists." },
        };
        return;
      }
      const record = cloudSnapshot.data() as CloudDocument;
      const current = this.parseDocument(envelope.documentId, record);
      if (record.recentCommandIds.includes(envelope.id)) return;
      const application = applyDocumentCommand(this.definition, current.state, envelope.command);
      if (!application.ok) {
        rejected = { ok: false, failure: application.failure, latest: current };
        return;
      }
      const metadata = this.definition.commandPolicy.inspect(envelope.command);
      const conflict = assessRevisionConflict(
        envelope.baseRevision,
        current.revision,
        metadata.targets,
        current.lastTargets,
        metadata.conflictLabel,
      );
      if (conflict) {
        rejected = { ok: false, failure: conflict, latest: current };
        return;
      }
      this.assertPayloadSize(application.state);
      const revision = record.revision + 1;
      const checkpointRevisions = checkpointReason
        ? [...record.checkpointRevisions, revision].slice(-MAX_CHECKPOINTS)
        : record.checkpointRevisions;
      transaction.update(reference, {
        state: application.state,
        summary: this.definition.summarize(application.state),
        documentSchemaVersion: this.definition.currentSchemaVersion,
        revision,
        recentCommandIds: [...record.recentCommandIds, envelope.id].slice(-MAX_RECENT_COMMANDS),
        checkpointRevisions,
        lastTargets: metadata.targets,
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
      for (const [kind, token] of Object.entries(record.publicationTokens)) {
        if (!token) continue;
        transaction.update(doc(this.database, PUBLICATIONS, token), {
          state: application.state,
          summary: this.definition.summarize(application.state),
          documentSchemaVersion: this.definition.currentSchemaVersion,
          revision,
          kind,
          updatedAt: serverTimestamp(),
        });
      }
      if (checkpointReason) {
        transaction.set(doc(reference, "checkpoints", String(revision)), {
          schemaVersion: 1,
          documentSchemaVersion: this.definition.currentSchemaVersion,
          state: application.state,
          revision,
          reason: checkpointReason,
          createdAt: serverTimestamp(),
        } satisfies CloudCheckpoint);
      }
    });
    if (rejected) return rejected;
    return { ok: true, snapshot: await this.requireLoad(envelope.documentId) };
  }

  public subscribe(
    documentId: string,
    listener: (snapshot: DocumentSnapshot<State, Summary>) => void,
  ): Unsubscribe {
    return onSnapshot(doc(this.database, DOCUMENTS, documentId), (snapshot) => {
      if (snapshot.exists())
        listener(this.parseDocument(snapshot.id, snapshot.data() as CloudDocument));
    });
  }

  public async listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]> {
    const snapshots = await getDocs(
      query(
        collection(this.database, DOCUMENTS, documentId, "checkpoints"),
        orderBy("revision", "desc"),
      ),
    );
    return snapshots.docs.map((snapshot) => {
      const record = snapshot.data() as CloudCheckpoint;
      const migrated = migrateDocumentState(
        this.definition,
        record.state,
        record.documentSchemaVersion,
      );
      if (!migrated.ok) throw new Error("Cloud checkpoint is invalid.");
      return {
        documentId,
        revision: record.revision,
        schemaVersion: this.definition.currentSchemaVersion,
        state: migrated.state,
        reason: record.reason,
        createdAt: timestampMilliseconds(record.createdAt),
      };
    });
  }

  public async restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>> {
    const snapshot = await getDoc(
      doc(this.database, DOCUMENTS, documentId, "checkpoints", String(revision)),
    );
    if (!snapshot.exists()) throw new Error("Checkpoint no longer exists.");
    const record = snapshot.data() as CloudCheckpoint;
    const migrated = migrateDocumentState(
      this.definition,
      record.state,
      record.documentSchemaVersion,
    );
    if (!migrated.ok) throw new Error("Cloud checkpoint is invalid.");
    return {
      documentId,
      revision,
      schemaVersion: this.definition.currentSchemaVersion,
      state: migrated.state,
      reason: record.reason,
      createdAt: timestampMilliseconds(record.createdAt),
    };
  }

  public async publish(
    documentId: string,
    kind: PublicationKind,
    rotate = false,
  ): Promise<Publication> {
    const principal = this.requirePrincipal();
    const cloud = await this.requireCloudDocument(documentId);
    if (cloud.ownerId !== principal.id) throw new Error("Only the owner can manage publications.");
    const existingToken = cloud.publicationTokens[kind];
    const token = !rotate && existingToken ? existingToken : this.createToken();
    const snapshot = this.parseDocument(documentId, cloud);
    await runTransaction(this.database, async (transaction) => {
      transaction.set(doc(this.database, PUBLICATIONS, token), {
        schemaVersion: 1,
        documentId,
        kind,
        revision: snapshot.revision,
        documentType: snapshot.documentType,
        documentSchemaVersion: snapshot.schemaVersion,
        state: snapshot.state,
        summary: snapshot.summary,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies CloudPublication);
      transaction.update(doc(this.database, DOCUMENTS, documentId), {
        publicationTokens: { ...cloud.publicationTokens, [kind]: token },
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
      if (rotate && existingToken)
        transaction.delete(doc(this.database, PUBLICATIONS, existingToken));
    });
    return { token, documentId, kind, revision: snapshot.revision };
  }

  public async revoke(documentId: string, kind: PublicationKind): Promise<void> {
    const principal = this.requirePrincipal();
    const cloud = await this.requireCloudDocument(documentId);
    if (cloud.ownerId !== principal.id) throw new Error("Only the owner can manage publications.");
    const token = cloud.publicationTokens[kind];
    if (!token) return;
    const publicationTokens = { ...cloud.publicationTokens };
    delete publicationTokens[kind];
    const batch = writeBatch(this.database);
    batch.delete(doc(this.database, PUBLICATIONS, token));
    batch.update(doc(this.database, DOCUMENTS, documentId), {
      publicationTokens,
      updatedAt: serverTimestamp(),
      updatedBy: principal.id,
    });
    await batch.commit();
  }

  public async resolve(token: string): Promise<{
    readonly publication: Publication;
    readonly snapshot: DocumentSnapshot<State, Summary>;
  } | null> {
    const snapshot = await getDoc(doc(this.database, PUBLICATIONS, token));
    if (!snapshot.exists()) return null;
    const record = snapshot.data() as CloudPublication;
    const migrated = migrateDocumentState(
      this.definition,
      record.state,
      record.documentSchemaVersion,
    );
    if (!migrated.ok || record.documentType !== this.definition.type)
      throw new Error("Published document is invalid.");
    const time = timestampMilliseconds(record.updatedAt);
    return {
      publication: {
        token,
        documentId: record.documentId,
        kind: record.kind,
        revision: record.revision,
      },
      snapshot: {
        id: record.documentId,
        documentType: record.documentType,
        schemaVersion: this.definition.currentSchemaVersion,
        state: migrated.state,
        summary: this.definition.summarize(migrated.state),
        revision: record.revision,
        createdAt: timestampMilliseconds(record.createdAt),
        updatedAt: time,
        appliedCommandIds: [],
        lastTargets: [],
      },
    };
  }

  public async listMembers(documentId: string): Promise<readonly Member[]> {
    const record = await this.requireCloudDocument(documentId);
    return record.memberIds.map((principalId) => ({
      principalId,
      role: record.roles[principalId] ?? "viewer",
    }));
  }

  /** Converts an editor bearer token into a revocable guest session or durable account membership. */
  public async acceptEditorInvitation(token: string): Promise<string> {
    const principal = this.requirePrincipal();
    const publicationSnapshot = await getDoc(doc(this.database, PUBLICATIONS, token));
    if (!publicationSnapshot.exists()) throw new Error("Editor invitation is missing or revoked.");
    const publication = publicationSnapshot.data() as CloudPublication;
    if (publication.kind !== "editor") throw new Error("The token is not an editor invitation.");
    if (principal.anonymous) {
      await setDoc(
        doc(this.database, DOCUMENTS, publication.documentId, "editorSessions", principal.id),
        {
          schemaVersion: 1,
          token,
          principalId: principal.id,
          createdAt: serverTimestamp(),
        },
      );
      return publication.documentId;
    }
    const reference = doc(this.database, DOCUMENTS, publication.documentId);
    await runTransaction(this.database, async (transaction) => {
      const documentSnapshot = await transaction.get(reference);
      if (!documentSnapshot.exists()) throw new Error("Document no longer exists.");
      const record = documentSnapshot.data() as CloudDocument;
      if (record.memberIds.includes(principal.id)) return;
      if (record.memberIds.length >= MAX_MEMBERS) throw new Error("Member limit reached.");
      transaction.update(reference, {
        memberIds: [...record.memberIds, principal.id],
        roles: { ...record.roles, [principal.id]: "editor" },
        lastAcceptedToken: token,
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
    });
    return publication.documentId;
  }

  public async setMember(documentId: string, member: Member): Promise<void> {
    if (member.role === "owner") throw new Error("Use transferOwnership to change the owner.");
    const principal = this.requirePrincipal();
    const reference = doc(this.database, DOCUMENTS, documentId);
    await runTransaction(this.database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error("Document no longer exists.");
      const record = snapshot.data() as CloudDocument;
      if (record.ownerId !== principal.id) throw new Error("Only the owner can manage members.");
      const memberIds = record.memberIds.includes(member.principalId)
        ? record.memberIds
        : [...record.memberIds, member.principalId];
      if (memberIds.length > MAX_MEMBERS) throw new Error("Member limit reached.");
      transaction.update(reference, {
        memberIds,
        roles: { ...record.roles, [member.principalId]: member.role },
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
    });
  }

  public async removeMember(documentId: string, principalId: string): Promise<void> {
    const principal = this.requirePrincipal();
    const reference = doc(this.database, DOCUMENTS, documentId);
    await runTransaction(this.database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error("Document no longer exists.");
      const record = snapshot.data() as CloudDocument;
      if (record.ownerId !== principal.id && principal.id !== principalId)
        throw new Error("Member removal is not permitted.");
      if (record.ownerId === principalId)
        throw new Error("Transfer ownership before removing the owner.");
      const roles = { ...record.roles };
      delete roles[principalId];
      transaction.update(reference, {
        memberIds: record.memberIds.filter((id) => id !== principalId),
        roles,
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
    });
  }

  public async transferOwnership(documentId: string, principalId: string): Promise<void> {
    const principal = this.requireVerifiedPrincipal();
    const reference = doc(this.database, DOCUMENTS, documentId);
    await runTransaction(this.database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error("Document no longer exists.");
      const record = snapshot.data() as CloudDocument;
      if (record.ownerId !== principal.id || record.roles[principalId] !== "editor") {
        throw new Error("Ownership can transfer only to an existing editor.");
      }
      transaction.update(reference, {
        ownerId: principalId,
        roles: { ...record.roles, [principal.id]: "editor", [principalId]: "owner" },
        updatedAt: serverTimestamp(),
        updatedBy: principal.id,
      });
    });
  }

  public async heartbeat(documentId: string, presence: Presence): Promise<void> {
    const principal = this.requirePrincipal();
    if (presence.principalId !== principal.id) throw new Error("Presence identity mismatch.");
    await setDoc(doc(this.database, DOCUMENTS, documentId, "presence", presence.sessionId), {
      ...presence,
      lastSeen: serverTimestamp(),
    });
  }

  public async clear(documentId: string, sessionId: string): Promise<void> {
    await deleteDoc(doc(this.database, DOCUMENTS, documentId, "presence", sessionId));
  }

  public subscribePresence(
    documentId: string,
    listener: (presence: readonly Presence[]) => void,
  ): Unsubscribe {
    return onSnapshot(collection(this.database, DOCUMENTS, documentId, "presence"), (snapshot) => {
      listener(
        activePresence(
          snapshot.docs.map((entry) => {
            const value = entry.data();
            return {
              principalId: String(value.principalId),
              sessionId: entry.id,
              displayName: String(value.displayName),
              lastSeen: timestampMilliseconds(value.lastSeen),
            };
          }),
          this.now(),
        ),
      );
    });
  }

  private get database(): Firestore {
    return this.runtime.firestore();
  }

  private requirePrincipal(): FirebasePrincipal {
    const principal = this.options.getPrincipal();
    if (!principal) throw new Error("Authentication is required.");
    return principal;
  }

  private requireVerifiedPrincipal(): FirebasePrincipal {
    const principal = this.requirePrincipal();
    if (principal.anonymous || !principal.verified)
      throw new Error("A verified account is required.");
    return principal;
  }

  private async requireCloudDocument(id: string): Promise<CloudDocument> {
    const snapshot = await getDoc(doc(this.database, DOCUMENTS, id));
    if (!snapshot.exists()) throw new Error("Document no longer exists.");
    return snapshot.data() as CloudDocument;
  }

  private async requireLoad(id: string): Promise<DocumentSnapshot<State, Summary>> {
    const snapshot = await this.load(id);
    if (!snapshot) throw new Error("Document no longer exists.");
    return snapshot;
  }

  private parseDocument(id: string, record: CloudDocument): DocumentSnapshot<State, Summary> {
    if (record.schemaVersion !== 1 || record.documentType !== this.definition.type)
      throw new Error("Cloud document is incompatible.");
    const migrated = migrateDocumentState(
      this.definition,
      record.state,
      record.documentSchemaVersion,
    );
    if (!migrated.ok) throw new Error("Cloud document is invalid.");
    return {
      id,
      documentType: record.documentType,
      schemaVersion: this.definition.currentSchemaVersion,
      state: migrated.state,
      summary: this.definition.summarize(migrated.state),
      revision: record.revision,
      createdAt: timestampMilliseconds(record.createdAt),
      updatedAt: timestampMilliseconds(record.updatedAt),
      appliedCommandIds: record.recentCommandIds,
      lastTargets: record.lastTargets,
    };
  }

  private assertPayloadSize(state: State): void {
    if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_PAYLOAD_BYTES) {
      throw new Error("Document exceeds the Firebase payload limit.");
    }
  }
}

export function activePresence(
  entries: readonly Presence[],
  now = Date.now(),
  ttlMs = 120_000,
): readonly Presence[] {
  const latest = new Map<string, Presence>();
  for (const entry of entries) {
    if (entry.lastSeen < now - ttlMs) continue;
    const current = latest.get(entry.principalId);
    if (!current || entry.lastSeen > current.lastSeen) latest.set(entry.principalId, entry);
  }
  return [...latest.values()].sort((left, right) => right.lastSeen - left.lastSeen);
}

function toPrincipal(user: User): FirebasePrincipal {
  return {
    id: user.uid,
    anonymous: user.isAnonymous,
    verified: user.emailVerified,
    displayName: user.displayName ?? undefined,
  };
}

function timestampMilliseconds(value: unknown): number {
  if (hasToMillis(value)) return value.toMillis();
  return 0;
}

function hasToMillis(value: unknown): value is { toMillis(): number } {
  return (
    value !== null &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  );
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
