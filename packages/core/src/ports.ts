import type { DocumentFailure } from "./document";

/** Strength of the invariants enforced outside a consumer's own process. */
export type IntegrityLevel = "client-validated" | "envelope-enforced" | "server-authoritative";

export type CapabilityName =
  | "snapshot"
  | "catalog"
  | "commands"
  | "history"
  | "subscription"
  | "outbox"
  | "publication"
  | "membership"
  | "presence";

/** Runtime declaration of supported ports; orchestrators must not infer this from adapter names. */
export type CapabilityManifest = {
  readonly adapter: string;
  readonly integrity: IntegrityLevel;
  readonly capabilities: ReadonlySet<CapabilityName>;
};

/** Immutable, idempotent semantic command with revision and actor context. */
export type CommandEnvelope<Command> = {
  readonly protocolVersion: 1;
  readonly id: string;
  readonly documentId: string;
  readonly documentType: string;
  readonly baseRevision: number;
  readonly actorId?: string;
  readonly issuedAt: number;
  readonly command: Command;
};

/** Validated document head returned by persistence and replication ports. */
export type DocumentSnapshot<State, Summary> = {
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

/** Immutable named historical state. Restoring it must create a new head revision. */
export type DocumentCheckpoint<State> = {
  readonly documentId: string;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly state: State;
  readonly reason: string;
  readonly createdAt: number;
};

/** CRUD port for document heads with optimistic replacement. */
export interface SnapshotStore<State, Summary> {
  /** Returns the current validated head, or `null` when the identifier is absent. */
  load(id: string): Promise<DocumentSnapshot<State, Summary> | null>;
  /** Creates revision zero and rejects an existing identifier. */
  create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>>;
  /** Replaces the head only when `expectedRevision` matches. */
  replace(
    id: string,
    state: State,
    expectedRevision: number,
  ): Promise<DocumentSnapshot<State, Summary>>;
  /** Permanently removes the document according to adapter authorization policy. */
  delete(id: string): Promise<void>;
}

/** Lists lightweight document metadata without loading durable state. */
export interface DocumentCatalog<Summary> {
  list(): Promise<
    ReadonlyArray<
      Pick<
        DocumentSnapshot<unknown, Summary>,
        "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt"
      >
    >
  >;
}

/** Result of an atomic semantic command commit. */
export type CommitResult<State, Summary> =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot<State, Summary> }
  | {
      readonly ok: false;
      readonly failure: DocumentFailure;
      readonly latest?: DocumentSnapshot<State, Summary>;
    };

/** Atomically validates and applies semantic commands against current revisions. */
export interface CommandCommitStore<State, Command, Summary> {
  commit(
    envelope: CommandEnvelope<Command>,
    checkpointReason?: string,
  ): Promise<CommitResult<State, Summary>>;
}

/**
 * Determines whether a stale command can merge over the immediately preceding
 * revision. Older gaps fail closed because a snapshot does not carry enough
 * target history to prove that every intervening change was independent.
 */
export function assessRevisionConflict(
  baseRevision: number,
  currentRevision: number,
  commandTargets: readonly string[],
  latestTargets: readonly string[],
  conflictLabel = "Document field",
): DocumentFailure | null {
  if (baseRevision > currentRevision) {
    return {
      code: "failed-precondition",
      message: "The command base revision is ahead of the document.",
    };
  }
  if (baseRevision === currentRevision) return null;
  if (currentRevision - baseRevision > 1) {
    return {
      code: "conflict",
      message: `${conflictLabel} changed across multiple remote revisions.`,
    };
  }
  const changed = new Set(latestTargets);
  return commandTargets.some((target) => changed.has(target))
    ? { code: "conflict", message: `${conflictLabel} changed remotely.` }
    : null;
}

/** Named checkpoint lookup and restoration source. */
export interface RevisionHistoryStore<State> {
  /** Lists retained checkpoints in adapter-defined stable order. */
  listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]>;
  /** Loads a checkpoint; this method does not mutate the document head. */
  restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>>;
}

/** Push subscription to monotonically newer validated document heads. */
export interface DocumentSubscription<State, Summary> {
  subscribe(
    documentId: string,
    listener: (snapshot: DocumentSnapshot<State, Summary>) => void,
  ): () => void;
}

/** Durable pending command used for crash-safe replay. */
export type OutboxRecord<Command> = {
  readonly envelope: CommandEnvelope<Command>;
  readonly checkpointReason?: string;
  readonly coalescingKey?: string;
  readonly stagedAt: number;
};

/** Durable ordered queue for commands not yet acknowledged by a remote store. */
export interface OutboxStore<Command> {
  /** Appends a command after making it locally durable. */
  put(record: OutboxRecord<Command>): Promise<void>;
  /** Atomically replaces a coalesced command while preserving queue position semantics. */
  replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void>;
  /** Removes an acknowledged or explicitly discarded command. */
  delete(commandId: string): Promise<void>;
  /** Returns commands for one document in semantic replay order. */
  list(documentId: string): Promise<readonly OutboxRecord<Command>[]>;
}

export type PublicationKind = "view" | "launch" | "editor";
/** Bearer publication metadata; tokens are credentials and must never be logged. */
export type Publication = {
  readonly token: string;
  readonly documentId: string;
  readonly kind: PublicationKind;
  readonly revision: number;
};

/** Creates, revokes, and resolves explicit view, launch, or editor publications. */
export interface PublicationStore<State, Summary> {
  publish(documentId: string, kind: PublicationKind, rotate?: boolean): Promise<Publication>;
  revoke(documentId: string, kind: PublicationKind): Promise<void>;
  resolve(token: string): Promise<{
    readonly publication: Publication;
    readonly snapshot: DocumentSnapshot<State, Summary>;
  } | null>;
}

export type MemberRole = "owner" | "editor" | "viewer";
export type Member = { readonly principalId: string; readonly role: MemberRole };

/** Membership administration kept independent from authentication. */
export interface MembershipStore {
  listMembers(documentId: string): Promise<readonly Member[]>;
  setMember(documentId: string, member: Member): Promise<void>;
  removeMember(documentId: string, principalId: string): Promise<void>;
  transferOwnership(documentId: string, principalId: string): Promise<void>;
}

/** Ephemeral session presence. `lastSeen` is interpreted using adapter TTL policy. */
export type Presence = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly displayName: string;
  readonly lastSeen: number;
};

/** Optional TTL-based collaboration presence, separate from durable content. */
export interface PresenceStore {
  heartbeat(documentId: string, presence: Presence): Promise<void>;
  clear(documentId: string, sessionId: string): Promise<void>;
  subscribePresence(
    documentId: string,
    listener: (presence: readonly Presence[]) => void,
  ): () => void;
}

/** Creates a protocol-v1 envelope with injectable identity and time for deterministic tests. */
export function createCommandEnvelope<Command>(options: {
  readonly id?: string;
  readonly documentId: string;
  readonly documentType: string;
  readonly baseRevision: number;
  readonly actorId?: string;
  readonly issuedAt?: number;
  readonly command: Command;
}): CommandEnvelope<Command> {
  const id =
    options.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  return {
    protocolVersion: 1,
    id,
    documentId: options.documentId,
    documentType: options.documentType,
    baseRevision: options.baseRevision,
    actorId: options.actorId,
    issuedAt: options.issuedAt ?? Date.now(),
    command: options.command,
  };
}
