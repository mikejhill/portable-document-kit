# Design Principles

## Validate at Every Trust Boundary

Decoded payloads, repository records, migration outputs, commands, and reducer outputs are untrusted
until validated. Reducers are synchronous, deterministic, side-effect-free, and immutable.

## Model Intent, Not Storage Writes

Commands describe domain intent and target stable entity IDs. Command policy derives conflict
targets, coalescing, durability, checkpoint reasons, and labels. Providers persist envelopes; they
do not interpret consumer terminology.

## Use Capability-Sliced Ports

Consumers depend on the smallest port they need. Adapter manifests report supported capabilities and
integrity. Provider names never substitute for capability discovery.

## Keep Versions Independent

Application schema, snapshot protocol, serializer, repository record, and route prefix versions
change independently. A breaking stored-format change requires a migration or an explicit
compatibility decision.

## Fail Visibly and Preserve Recovery

Missing, corrupt, unauthorized, revoked, incompatible, and unavailable routes remain distinct.
Conflict values retain the rejected command or recoverable content. Libraries never silently create
a replacement document.

## Keep Diagnostics Content-Free

Diagnostic events contain event names, component names, status codes, counts, revisions, and
durations only. They never include document state, commands, snapshots, tokens, routes, clipboard
contents, or file contents.

## Prefer Composition over Provider Branches

The document definition, workspace, persistence ports, replication engine, browser adapter, and UI
binding are independently replaceable. Future backends and CRDT engines implement ports rather than
adding conditional logic to core.
