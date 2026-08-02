import type { DocumentSchema, ValidationIssue } from "./schema";
import { validateValue } from "./schema";

export type DurabilityPriority = "coalesced" | "immediate";

export type CommandMetadata = {
  readonly targets: readonly string[];
  readonly coalescingKey?: string;
  readonly durability: DurabilityPriority;
  readonly checkpointReason?: string;
  readonly conflictLabel?: string;
};

export type CommandPolicy<Command> = {
  inspect(command: Command): CommandMetadata;
  coalesce?(previous: Command, next: Command): Command | null;
};

export type ReducerRejectionCode =
  "missing-target" | "failed-precondition" | "permission-denied" | "conflict";

export type ReducerResult<State> =
  | { readonly ok: true; readonly state: State }
  | {
      readonly ok: false;
      readonly code: ReducerRejectionCode;
      readonly message: string;
      readonly recoverable?: unknown;
    };

export type DocumentMigration = {
  readonly from: number;
  readonly to: number;
  migrate(value: unknown): unknown;
};

export type DocumentDefinition<State, Command, Summary> = {
  readonly type: string;
  readonly currentSchemaVersion: number;
  readonly stateSchema: DocumentSchema<State>;
  readonly commandSchema: DocumentSchema<Command>;
  readonly migrations: readonly DocumentMigration[];
  reduce(state: State, command: Command): ReducerResult<State>;
  summarize(state: State): Summary;
  readonly commandPolicy: CommandPolicy<Command>;
};

export type DocumentDefinitionOptions<State, Command, Summary> = DocumentDefinition<
  State,
  Command,
  Summary
>;

/** Defines one consumer document contract and verifies its migration graph. */
export function defineDocument<State, Command, Summary>(
  options: DocumentDefinitionOptions<State, Command, Summary>,
): DocumentDefinition<State, Command, Summary> {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(options.type)) {
    throw new Error("Document type must be a stable lowercase identifier.");
  }
  if (!Number.isInteger(options.currentSchemaVersion) || options.currentSchemaVersion < 1) {
    throw new Error("Document schema version must be a positive integer.");
  }
  const migrations = [...options.migrations].sort((left, right) => left.from - right.from);
  for (const migration of migrations) {
    if (migration.to !== migration.from + 1) {
      throw new Error("Document migrations must advance exactly one version.");
    }
  }
  return Object.freeze({ ...options, migrations: Object.freeze(migrations) });
}

export type DocumentFailure =
  | { readonly code: "invalid-state"; readonly issues: readonly ValidationIssue[] }
  | { readonly code: "invalid-command"; readonly issues: readonly ValidationIssue[] }
  | { readonly code: "incompatible-version"; readonly version: number }
  | {
      readonly code: ReducerRejectionCode;
      readonly message: string;
      readonly recoverable?: unknown;
    };

export type ApplyResult<State> =
  | { readonly ok: true; readonly state: State }
  | { readonly ok: false; readonly failure: DocumentFailure };

/** Applies one validated semantic command and validates the reducer output. */
export function applyDocumentCommand<State, Command, Summary>(
  definition: DocumentDefinition<State, Command, Summary>,
  state: unknown,
  command: unknown,
): ApplyResult<State> {
  const parsedState = validateValue(definition.stateSchema, state);
  if (!parsedState.ok) {
    return { ok: false, failure: { code: "invalid-state", issues: parsedState.issues } };
  }
  const parsedCommand = validateValue(definition.commandSchema, command);
  if (!parsedCommand.ok) {
    return { ok: false, failure: { code: "invalid-command", issues: parsedCommand.issues } };
  }
  let reduced: ReducerResult<State>;
  try {
    reduced = definition.reduce(parsedState.value, parsedCommand.value);
  } catch {
    return {
      ok: false,
      failure: { code: "failed-precondition", message: "The command reducer failed." },
    };
  }
  if (!reduced.ok) {
    return {
      ok: false,
      failure: {
        code: reduced.code,
        message: reduced.message,
        ...(reduced.recoverable === undefined ? {} : { recoverable: reduced.recoverable }),
      },
    };
  }
  const validated = validateValue(definition.stateSchema, reduced.state);
  if (!validated.ok) {
    return { ok: false, failure: { code: "invalid-state", issues: validated.issues } };
  }
  return { ok: true, state: validated.value };
}

/** Migrates untrusted persisted state through a contiguous migration chain. */
export function migrateDocumentState<State, Command, Summary>(
  definition: DocumentDefinition<State, Command, Summary>,
  value: unknown,
  fromVersion: number,
): ApplyResult<State> {
  if (
    !Number.isInteger(fromVersion) ||
    fromVersion < 1 ||
    fromVersion > definition.currentSchemaVersion
  ) {
    return { ok: false, failure: { code: "incompatible-version", version: fromVersion } };
  }
  let migrated = value;
  for (let version = fromVersion; version < definition.currentSchemaVersion; version += 1) {
    const migration = definition.migrations.find((candidate) => candidate.from === version);
    if (!migration) {
      return { ok: false, failure: { code: "incompatible-version", version } };
    }
    try {
      migrated = migration.migrate(migrated);
    } catch {
      return { ok: false, failure: { code: "incompatible-version", version } };
    }
  }
  const validated = validateValue(definition.stateSchema, migrated);
  return validated.ok
    ? { ok: true, state: validated.value }
    : { ok: false, failure: { code: "invalid-state", issues: validated.issues } };
}
