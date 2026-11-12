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
  type OutboxRecord,
  type OutboxStore,
  type RevisionHistoryStore,
  type SnapshotStore,
} from "@mikejhill/portable-document-core";

const DOCUMENTS = "documents";
const CHECKPOINTS = "checkpoints";
const OUTBOX = "outbox";

type StoredDocument = {
  readonly id: string;
  readonly documentType: string;
  readonly schemaVersion: number;
  readonly state: unknown;
  readonly summary: unknown;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly appliedCommandIds: readonly string[];
  readonly lastTargets: readonly string[];
};

type StoredCheckpoint = DocumentCheckpoint<unknown> & { readonly key: string };

export type IndexedDbOptions = {
  readonly databaseName: string;
  readonly indexedDB?: IDBFactory;
  readonly broadcastChannel?: typeof BroadcastChannel | null;
  readonly now?: () => number;
  readonly checkpointLimit?: number;
};

export class IndexedDbUnavailableError extends Error {
  public constructor() {
    super("IndexedDB is unavailable.");
    this.name = "IndexedDbUnavailableError";
  }
}

export class IndexedDbUpgradeBlockedError extends Error {
  public constructor() {
    super("IndexedDB upgrade was blocked by another open tab.");
    this.name = "IndexedDbUpgradeBlockedError";
  }
}

class IndexedDbDatabase {
  private promise: Promise<IDBDatabase> | null = null;
  public readonly factory: IDBFactory | null;

  public constructor(private readonly options: IndexedDbOptions) {
    this.factory = options.indexedDB ?? (typeof indexedDB === "undefined" ? null : indexedDB);
  }

  public open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new IndexedDbUnavailableError());
    if (this.promise) return this.promise;
    this.promise = new Promise((resolve, reject) => {
      const request = this.factory!.open(this.options.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENTS)) {
          database.createObjectStore(DOCUMENTS, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(CHECKPOINTS)) {
          const store = database.createObjectStore(CHECKPOINTS, { keyPath: "key" });
          store.createIndex("documentId", "documentId", { unique: false });
        }
        if (!database.objectStoreNames.contains(OUTBOX)) {
          const store = database.createObjectStore(OUTBOX, { keyPath: "envelope.id" });
          store.createIndex("documentId", "envelope.documentId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      request.onblocked = () => reject(new IndexedDbUpgradeBlockedError());
    });
    return this.promise;
  }

  public close(): void {
    void this.promise?.then(
      (database) => database.close(),
      () => undefined,
    );
    this.promise = null;
  }
}

/** Validated local document repository with revision and subscription support. */
export class IndexedDbDocumentStore<State, Command, Summary>
  implements
    SnapshotStore<State, Summary>,
    DocumentCatalog<Summary>,
    CommandCommitStore<State, Command, Summary>,
    RevisionHistoryStore<State>,
    DocumentSubscription<State, Summary>
{
  public readonly manifest: CapabilityManifest = {
    adapter: "indexeddb",
    integrity: "client-validated",
    capabilities: new Set(["snapshot", "catalog", "commands", "history", "subscription"]),
  };
  private readonly database: IndexedDbDatabase;
  private readonly now: () => number;
  private readonly checkpointLimit: number;
  private readonly listeners = new Map<
    string,
    Set<(snapshot: DocumentSnapshot<State, Summary>) => void>
  >();
  private readonly channel: BroadcastChannel | null;

  public constructor(
    private readonly definition: DocumentDefinition<State, Command, Summary>,
    options: IndexedDbOptions,
  ) {
    this.database = new IndexedDbDatabase(options);
    this.now = options.now ?? Date.now;
    this.checkpointLimit = options.checkpointLimit ?? 25;
    const Channel =
      options.broadcastChannel === undefined
        ? typeof BroadcastChannel === "undefined"
          ? undefined
          : BroadcastChannel
        : (options.broadcastChannel ?? undefined);
    this.channel = Channel ? new Channel(`${options.databaseName}:portable-documents`) : null;
    this.channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") void this.emit(event.data, false);
    });
  }

  public async load(id: string): Promise<DocumentSnapshot<State, Summary> | null> {
    const database = await this.database.open();
    const transaction = database.transaction(DOCUMENTS, "readonly");
    const raw = await requestValue<StoredDocument | undefined>(
      transaction.objectStore(DOCUMENTS).get(id),
    );
    await transactionComplete(transaction);
    return raw ? this.parse(raw) : null;
  }

  public async list(): Promise<
    ReadonlyArray<
      Pick<
        DocumentSnapshot<unknown, Summary>,
        "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt"
      >
    >
  > {
    const database = await this.database.open();
    const transaction = database.transaction(DOCUMENTS, "readonly");
    const records = await requestValue<StoredDocument[]>(
      transaction.objectStore(DOCUMENTS).getAll(),
    );
    await transactionComplete(transaction);
    return records
      .map((record) => {
        const parsed = this.parse(record);
        return {
          id: parsed.id,
          documentType: parsed.documentType,
          summary: parsed.summary,
          revision: parsed.revision,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  public async create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>> {
    const validated = migrateDocumentState(
      this.definition,
      state,
      this.definition.currentSchemaVersion,
    );
    if (!validated.ok) throw new Error("Cannot store invalid document state.");
    const now = this.now();
    const snapshot: DocumentSnapshot<State, Summary> = {
      id,
      documentType: this.definition.type,
      schemaVersion: this.definition.currentSchemaVersion,
      state: validated.state,
      summary: this.definition.summarize(validated.state),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      appliedCommandIds: [],
      lastTargets: [],
    };
    const database = await this.database.open();
    const transaction = database.transaction([DOCUMENTS, CHECKPOINTS], "readwrite");
    const documents = transaction.objectStore(DOCUMENTS);
    if ((await requestValue(documents.getKey(id))) !== undefined) {
      transaction.abort();
      throw new Error("Document already exists.");
    }
    documents.add(snapshot);
    transaction.objectStore(CHECKPOINTS).add(this.checkpoint(snapshot, "Document Created"));
    await transactionComplete(transaction);
    await this.changed(id);
    return snapshot;
  }

  public async replace(
    id: string,
    state: State,
    expectedRevision: number,
  ): Promise<DocumentSnapshot<State, Summary>> {
    const validated = migrateDocumentState(
      this.definition,
      state,
      this.definition.currentSchemaVersion,
    );
    if (!validated.ok) throw new Error("Cannot store invalid document state.");
    const database = await this.database.open();
    const transaction = database.transaction(DOCUMENTS, "readwrite");
    const store = transaction.objectStore(DOCUMENTS);
    const raw = await requestValue<StoredDocument | undefined>(store.get(id));
    if (raw?.revision !== expectedRevision) {
      transaction.abort();
      throw new Error("Document revision changed.");
    }
    const snapshot: DocumentSnapshot<State, Summary> = {
      ...this.parse(raw),
      state: validated.state,
      summary: this.definition.summarize(validated.state),
      revision: raw.revision + 1,
      updatedAt: this.now(),
      lastTargets: ["document"],
    };
    store.put(snapshot);
    await transactionComplete(transaction);
    await this.changed(id);
    return snapshot;
  }

  public async delete(id: string): Promise<void> {
    const database = await this.database.open();
    const transaction = database.transaction([DOCUMENTS, CHECKPOINTS], "readwrite");
    transaction.objectStore(DOCUMENTS).delete(id);
    const checkpointStore = transaction.objectStore(CHECKPOINTS);
    const keys = await requestValue<IDBValidKey[]>(
      checkpointStore.index("documentId").getAllKeys(id),
    );
    for (const key of keys) checkpointStore.delete(key);
    await transactionComplete(transaction);
    await this.changed(id);
  }

  public async commit(
    envelope: CommandEnvelope<Command>,
    checkpointReason?: string,
  ): Promise<CommitResult<State, Summary>> {
    if (envelope.documentType !== this.definition.type) {
      return {
        ok: false,
        failure: { code: "failed-precondition", message: "Wrong document type." },
      };
    }
    const database = await this.database.open();
    const transaction = database.transaction([DOCUMENTS, CHECKPOINTS], "readwrite");
    const store = transaction.objectStore(DOCUMENTS);
    const raw = await requestValue<StoredDocument | undefined>(store.get(envelope.documentId));
    if (!raw) {
      transaction.abort();
      return {
        ok: false,
        failure: { code: "missing-target", message: "Document no longer exists." },
      };
    }
    const current = this.parse(raw);
    if (current.appliedCommandIds.includes(envelope.id)) {
      await transactionComplete(transaction);
      return { ok: true, snapshot: current };
    }
    const application = applyDocumentCommand(this.definition, current.state, envelope.command);
    if (!application.ok) {
      transaction.abort();
      return { ok: false, failure: application.failure, latest: current };
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
      transaction.abort();
      return { ok: false, failure: conflict, latest: current };
    }
    const snapshot: DocumentSnapshot<State, Summary> = {
      ...current,
      state: application.state,
      summary: this.definition.summarize(application.state),
      schemaVersion: this.definition.currentSchemaVersion,
      revision: current.revision + 1,
      updatedAt: this.now(),
      appliedCommandIds: [...current.appliedCommandIds, envelope.id].slice(-50),
      lastTargets: metadata.targets,
    };
    store.put(snapshot);
    if (checkpointReason) {
      const checkpoints = transaction.objectStore(CHECKPOINTS);
      checkpoints.put(this.checkpoint(snapshot, checkpointReason));
      const existing = await requestValue<StoredCheckpoint[]>(
        checkpoints.index("documentId").getAll(envelope.documentId),
      );
      for (const stale of existing
        .sort((a, b) => a.revision - b.revision)
        .slice(0, Math.max(0, existing.length - this.checkpointLimit))) {
        checkpoints.delete(stale.key);
      }
    }
    await transactionComplete(transaction);
    await this.changed(envelope.documentId);
    return { ok: true, snapshot };
  }

  public async listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]> {
    const database = await this.database.open();
    const transaction = database.transaction(CHECKPOINTS, "readonly");
    const records = await requestValue<StoredCheckpoint[]>(
      transaction.objectStore(CHECKPOINTS).index("documentId").getAll(documentId),
    );
    await transactionComplete(transaction);
    return records
      .map((record) => {
        const migrated = migrateDocumentState(this.definition, record.state, record.schemaVersion);
        if (!migrated.ok) throw new Error("Stored checkpoint is invalid.");
        return { ...record, state: migrated.state };
      })
      .sort((left, right) => right.revision - left.revision);
  }

  public async restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>> {
    const checkpoints = await this.listCheckpoints(documentId);
    const checkpoint = checkpoints.find((candidate) => candidate.revision === revision);
    if (!checkpoint) throw new Error("Checkpoint no longer exists.");
    return checkpoint;
  }

  public subscribe(
    documentId: string,
    listener: (snapshot: DocumentSnapshot<State, Summary>) => void,
  ): () => void {
    const listeners = this.listeners.get(documentId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(documentId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(documentId);
    };
  }

  public close(): void {
    this.channel?.close();
    this.listeners.clear();
    this.database.close();
  }

  private parse(record: StoredDocument): DocumentSnapshot<State, Summary> {
    if (record.documentType !== this.definition.type)
      throw new Error("Stored document has the wrong type.");
    const migrated = migrateDocumentState(this.definition, record.state, record.schemaVersion);
    if (!migrated.ok) throw new Error("Stored document is invalid or incompatible.");
    return {
      ...record,
      schemaVersion: this.definition.currentSchemaVersion,
      state: migrated.state,
      summary: this.definition.summarize(migrated.state),
    };
  }

  private checkpoint(snapshot: DocumentSnapshot<State, Summary>, reason: string): StoredCheckpoint {
    return {
      key: `${snapshot.id}:${snapshot.revision}`,
      documentId: snapshot.id,
      revision: snapshot.revision,
      schemaVersion: snapshot.schemaVersion,
      state: snapshot.state,
      reason,
      createdAt: snapshot.updatedAt,
    };
  }

  private async changed(id: string): Promise<void> {
    this.channel?.postMessage(id);
    await this.emit(id, true);
  }

  private async emit(id: string, includeLocal: boolean): Promise<void> {
    const listeners = this.listeners.get(id);
    if (!listeners?.size) return;
    const snapshot = await this.load(id);
    if (!snapshot) return;
    if (!includeLocal && !listeners.size) return;
    for (const listener of listeners) listener(snapshot);
  }
}

/** Durable command outbox isolated from the local document repository. */
export class IndexedDbOutboxStore<Command> implements OutboxStore<Command> {
  public readonly manifest: CapabilityManifest = {
    adapter: "indexeddb-outbox",
    integrity: "client-validated",
    capabilities: new Set(["outbox"]),
  };
  private readonly database: IndexedDbDatabase;

  public constructor(options: IndexedDbOptions) {
    this.database = new IndexedDbDatabase(options);
  }

  public async put(record: OutboxRecord<Command>): Promise<void> {
    const database = await this.database.open();
    const transaction = database.transaction(OUTBOX, "readwrite");
    transaction.objectStore(OUTBOX).put(record);
    await transactionComplete(transaction);
  }

  public async replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void> {
    const database = await this.database.open();
    const transaction = database.transaction(OUTBOX, "readwrite");
    const store = transaction.objectStore(OUTBOX);
    store.delete(previousCommandId);
    store.put(record);
    await transactionComplete(transaction);
  }

  public async delete(commandId: string): Promise<void> {
    const database = await this.database.open();
    const transaction = database.transaction(OUTBOX, "readwrite");
    transaction.objectStore(OUTBOX).delete(commandId);
    await transactionComplete(transaction);
  }

  public async list(documentId: string): Promise<readonly OutboxRecord<Command>[]> {
    const database = await this.database.open();
    const transaction = database.transaction(OUTBOX, "readonly");
    const records = await requestValue<OutboxRecord<Command>[]>(
      transaction.objectStore(OUTBOX).index("documentId").getAll(documentId),
    );
    await transactionComplete(transaction);
    return records.sort((left, right) => left.stagedAt - right.stagedAt);
  }

  public close(): void {
    this.database.close();
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}
