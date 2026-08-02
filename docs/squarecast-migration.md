# Squarecast Compatibility Migration

Squarecast is the compatibility consumer. Its existing formats are immutable
inputs to the migration.

## Definition Boundary

- State: the existing validated editor state.
- Commands: the existing `EditorOperation` discriminated union.
- Reducer: the existing immutable `applyEditorOperation` behavior.
- Summary: title and storage-list metadata only.
- Command policy: existing target keys, coalescing keys, checkpoint reasons,
  and edit-after-delete recovery.

Play and launch states remain portable snapshot variants. They do not become
saved collaborative documents.

## Codec Boundary

The existing `StateCodec` remains the Squarecast payload codec. It must continue
to emit compact version-2 tuples under `#sq1:` and decode both tuples and legacy
object payloads. The generic envelope is not wrapped around Squarecast hashes,
because doing so would alter every existing link.

Required golden contracts:

- editor, launch, and play round trips;
- every editor field and placement variant;
- noncanonical schema-valid play cells;
- editor hash below 70 percent of legacy compressed JSON;
- play hash below 55 percent of legacy compressed JSON;
- malformed compression, JSON, tuple, schema, and Card references fail closed;
- legacy Boolean free-square and omitted presentation fields retain defaults.

## Repository Boundary

Configure compatibility adapters with the existing IndexedDB database and
store names, record schema version 1, checkpoint limit, pending-operation keys,
Firestore collections, rules, indexes, membership limits, and route prefixes.
Do not dual-write. Read existing records directly through validated compatibility
adapters.

## Replacement Order

1. Adapt `EditorOperation` and editor state to `DocumentDefinition` behind the
   existing controllers.
2. Replace device repository internals while retaining its public facade.
3. Replace cloud synchronization while retaining Firestore documents and rules.
4. Move route resolution and history policy from the React hook into
   `WorkspaceEngine`.
5. Replace the facade with React bindings after route, offline, collaboration,
   and history parity tests pass.

Every step must pass Squarecast's complete `npm run check`. The production app
must not consume unpublished relative filesystem packages.
