import type { DocumentFailure } from "./document";

export type IntegrityLevel =
  | "client-validated"
  | "envelope-enforced"
  | "server-authoritative";

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

export type CapabilityManifest = {
  readonly adapter: string;
  readonly integrity: IntegrityLevel;
  readonly capabilities: ReadonlySet<CapabilityName>;
};

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

export type DocumentCheckpoint<State> = {
  readonly documentId: string;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly state: State;
  readonly reason: string;
  readonly createdAt: number;
};

export interface SnapshotStore<State, Summary> {
  load(id: string): Promise<DocumentSnapshot<State, Summary> | null>;
  create(id: string, state: State): Promise<DocumentSnapshot<State, Summary>>;
  replace(id: string, state: State, expectedRevision: number): Promise<DocumentSnapshot<State, Summary>>;
  delete(id: string): Promise<void>;
}

export interface DocumentCatalog<Summary> {
  list(): Promise<ReadonlyArray<Pick<DocumentSnapshot<unknown, Summary>, "id" | "documentType" | "summary" | "revision" | "createdAt" | "updatedAt">>>;
}

export type CommitResult<State, Summary> =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot<State, Summary> }
  | { readonly ok: false; readonly failure: DocumentFailure; readonly latest?: DocumentSnapshot<State, Summary> };

export interface CommandCommitStore<State, Command, Summary> {
  commit(envelope: CommandEnvelope<Command>, checkpointReason?: string): Promise<CommitResult<State, Summary>>;
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
    return { code: "failed-precondition", message: "The command base revision is ahead of the document." };
  }
  if (baseRevision === currentRevision) return null;
  if (currentRevision - baseRevision > 1) {
    return { code: "conflict", message: `${conflictLabel} changed across multiple remote revisions.` };
  }
  const changed = new Set(latestTargets);
  return commandTargets.some((target) => changed.has(target))
    ? { code: "conflict", message: `${conflictLabel} changed remotely.` }
    : null;
}

export interface RevisionHistoryStore<State> {
  listCheckpoints(documentId: string): Promise<readonly DocumentCheckpoint<State>[]>;
  restore(documentId: string, revision: number): Promise<DocumentCheckpoint<State>>;
}

export interface DocumentSubscription<State, Summary> {
  subscribe(documentId: string, listener: (snapshot: DocumentSnapshot<State, Summary>) => void): () => void;
}

export type OutboxRecord<Command> = {
  readonly envelope: CommandEnvelope<Command>;
  readonly checkpointReason?: string;
  readonly coalescingKey?: string;
  readonly stagedAt: number;
};

export interface OutboxStore<Command> {
  put(record: OutboxRecord<Command>): Promise<void>;
  replace(previousCommandId: string, record: OutboxRecord<Command>): Promise<void>;
  delete(commandId: string): Promise<void>;
  list(documentId: string): Promise<readonly OutboxRecord<Command>[]>;
}

export type PublicationKind = "view" | "launch" | "editor";
export type Publication = {
  readonly token: string;
  readonly documentId: string;
  readonly kind: PublicationKind;
  readonly revision: number;
};

export interface PublicationStore<State, Summary> {
  publish(documentId: string, kind: PublicationKind, rotate?: boolean): Promise<Publication>;
  revoke(documentId: string, kind: PublicationKind): Promise<void>;
  resolve(token: string): Promise<{ readonly publication: Publication; readonly snapshot: DocumentSnapshot<State, Summary> } | null>;
}

export type MemberRole = "owner" | "editor" | "viewer";
export type Member = { readonly principalId: string; readonly role: MemberRole };

export interface MembershipStore {
  listMembers(documentId: string): Promise<readonly Member[]>;
  setMember(documentId: string, member: Member): Promise<void>;
  removeMember(documentId: string, principalId: string): Promise<void>;
  transferOwnership(documentId: string, principalId: string): Promise<void>;
}

export type Presence = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly displayName: string;
  readonly lastSeen: number;
};

export interface PresenceStore {
  heartbeat(documentId: string, presence: Presence): Promise<void>;
  clear(documentId: string, sessionId: string): Promise<void>;
  subscribePresence(documentId: string, listener: (presence: readonly Presence[]) => void): () => void;
}

export function createCommandEnvelope<Command>(options: {
  readonly id?: string;
  readonly documentId: string;
  readonly documentType: string;
  readonly baseRevision: number;
  readonly actorId?: string;
  readonly issuedAt?: number;
  readonly command: Command;
}): CommandEnvelope<Command> {
  const id = options.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto
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
