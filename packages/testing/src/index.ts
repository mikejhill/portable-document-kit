import {
  applyDocumentCommand,
  assessRevisionConflict,
  migrateDocumentState,
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

/** Deterministic clock for repositories, synchronization, and presence tests. */
export class FakeClock {
  public constructor(private value = 1_700_000_000_000) {}
  public now = (): number => this.value;
  public advance(milliseconds: number): void {
    if (milliseconds < 0) throw new Error("Fake clocks cannot move backward.");
    this.value += milliseconds;
  }
}

/** Reference adapter used by consumers and provider conformance tests. */
export class InMemoryDocumentStore<State, Command, Summary>
  implements
    SnapshotStore<State, Summary>,
    DocumentCatalog<Summary>,
    CommandCommitStore<State, Command, Summary>,
    RevisionHistoryStore<State>,
    DocumentSubscription<State, Summary>
{
  private readonly documents = new Map<string, DocumentSnapshot<State, Summary>>();
  private readonly checkpoints = new Map<string, DocumentCheckpoint<State>[]>();
  private readonly listeners = new Map<
    string,
    Set<(snapshot: DocumentSnapshot<State, Summary>) => void>
  >();

  public constructor(
    private readonly definition: DocumentDefinition<State, Command, Summary>,
    private readonly now: () => number = Date.now,
  ) {}

  public async load(id: string): Promise<DocumentSnapshot<State, Summary> | null> {
    return clone(this.documents.get(id) ?? null);
  }

  public async list(): Promise<
    ReadonlyArray<
      Pick<
        DocumentSnapshot<unknown, Summary>,
        "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt"
      >
    >
  > {
    return [...this.documents.values()].map(
      ({ id, documentType, summary, revision, createdAt, updatedAt }) =>
        clone({ id, documentType, summary, revision, createdAt, updatedAt }),
    );
  }

  public async create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>> {
    if (this.documents.has(id)) throw new Error("Document already exists.");
    const parsed = migrateDocumentState(
      this.definition,
      state,
      this.definition.currentSchemaVersion,
    );
    if (!parsed.ok) throw new Error("Invalid document state.");
    const now = this.now();
    const snapshot: DocumentSnapshot<State, Summary> = {
      id,
      documentType: this.definition.type,
      schemaVersion: this.definition.currentSchemaVersion,
      state: parsed.state,
      summary: this.definition.summarize(parsed.state),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      appliedCommandIds: [],
      lastTargets: [],
    };
    this.documents.set(id, clone(snapshot));
    this.checkpoints.set(id, [
      {
        documentId: id,
        revision: 1,
        schemaVersion: snapshot.schemaVersion,
        state: clone(snapshot.state),
        reason: "Document Created",
        createdAt: now,
      },
    ]);
    this.emit(snapshot);
    return clone(snapshot);
  }

  public async replace(
    id: string,
    state: State,
    expectedRevision: number,
  ): Promise<DocumentSnapshot<State, Summary>> {
    const current = this.documents.get(id);
    if (current?.revision !== expectedRevision) throw new Error("Document revision changed.");
    const parsed = migrateDocumentState(
      this.definition,
      state,
      this.definition.currentSchemaVersion,
    );
    if (!parsed.ok) throw new Error("Invalid document state.");
    const snapshot = {
      ...current,
      state: parsed.state,
      summary: this.definition.summarize(parsed.state),
      revision: current.revision + 1,
      updatedAt: this.now(),
      lastTargets: ["document"],
    };
    this.documents.set(id, clone(snapshot));
    this.emit(snapshot);
    return clone(snapshot);
  }

  public async delete(id: string): Promise<void> {
    this.documents.delete(id);
    this.checkpoints.delete(id);
  }

  public async commit(
    envelope: CommandEnvelope<Command>,
    checkpointReason?: string,
  ): Promise<CommitResult<State, Summary>> {
    const current = this.documents.get(envelope.documentId);
    if (!current)
      return {
        ok: false,
        failure: { code: "missing-target", message: "Document no longer exists." },
      };
    if (current.appliedCommandIds.includes(envelope.id))
      return { ok: true, snapshot: clone(current) };
    const result = applyDocumentCommand(this.definition, current.state, envelope.command);
    if (!result.ok) return { ok: false, failure: result.failure, latest: clone(current) };
    const metadata = this.definition.commandPolicy.inspect(envelope.command);
    const conflict = assessRevisionConflict(
      envelope.baseRevision,
      current.revision,
      metadata.targets,
      current.lastTargets,
      metadata.conflictLabel,
    );
    if (conflict) return { ok: false, failure: conflict, latest: clone(current) };
    const snapshot: DocumentSnapshot<State, Summary> = {
      ...current,
      state: result.state,
      summary: this.definition.summarize(result.state),
      revision: current.revision + 1,
      updatedAt: this.now(),
      appliedCommandIds: [...current.appliedCommandIds, envelope.id].slice(-50),
      lastTargets: metadata.targets,
    };
    this.documents.set(snapshot.id, clone(snapshot));
    if (checkpointReason) {
      const values = this.checkpoints.get(snapshot.id) ?? [];
      values.push({
        documentId: snapshot.id,
        revision: snapshot.revision,
        schemaVersion: snapshot.schemaVersion,
        state: clone(snapshot.state),
        reason: checkpointReason,
        createdAt: snapshot.updatedAt,
      });
      this.checkpoints.set(snapshot.id, values.slice(-25));
    }
    this.emit(snapshot);
    return { ok: true, snapshot: clone(snapshot) };
  }

  public async listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]> {
    return clone([...(this.checkpoints.get(documentId) ?? [])].reverse());
  }

  public async restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>> {
    const checkpoint = this.checkpoints
      .get(documentId)
      ?.find((candidate) => candidate.revision === revision);
    if (!checkpoint) throw new Error("Checkpoint no longer exists.");
    return clone(checkpoint);
  }

  public subscribe(
    documentId: string,
    listener: (snapshot: DocumentSnapshot<State, Summary>) => void,
  ): () => void {
    const values = this.listeners.get(documentId) ?? new Set();
    values.add(listener);
    this.listeners.set(documentId, values);
    return () => values.delete(listener);
  }

  private emit(snapshot: DocumentSnapshot<State, Summary>): void {
    for (const listener of this.listeners.get(snapshot.id) ?? []) listener(clone(snapshot));
  }
}

export class InMemoryOutboxStore<Command> implements OutboxStore<Command> {
  private readonly records = new Map<string, OutboxRecord<Command>>();

  public async put(record: OutboxRecord<Command>): Promise<void> {
    this.records.set(record.envelope.id, clone(record));
  }
  public async replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void> {
    this.records.delete(previousCommandId);
    this.records.set(record.envelope.id, clone(record));
  }
  public async delete(commandId: string): Promise<void> {
    this.records.delete(commandId);
  }
  public async list(documentId: string): Promise<readonly OutboxRecord<Command>[]> {
    return [...this.records.values()]
      .filter((record) => record.envelope.documentId === documentId)
      .sort((left, right) => left.stagedAt - right.stagedAt)
      .map(clone);
  }
}

export async function assertSnapshotStoreConformance<State, Summary>(options: {
  readonly store: SnapshotStore<State, Summary>;
  readonly id: string;
  readonly initial: State;
  readonly replacement: State;
}): Promise<void> {
  const created = await options.store.create(options.id, options.initial);
  assert(created.revision === 1, "Create must produce revision 1.");
  assert((await options.store.load(options.id))?.id === options.id, "Created document must load.");
  const replaced = await options.store.replace(options.id, options.replacement, 1);
  assert(replaced.revision === 2, "Replace must increment the revision.");
  await options.store.delete(options.id);
  assert((await options.store.load(options.id)) === null, "Deleted document must not load.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Repository conformance failure: ${message}`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
