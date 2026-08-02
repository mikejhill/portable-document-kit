# Consumer Guide

## Define a Document

Use `defineDocument` with synchronous Standard Schema validators, a pure
reducer, a summary projection, and semantic command metadata. Stable entity
IDs are mandatory for mergeable nested structures.

## Select Capabilities

- URL only: core, codec, browser.
- Device library: add IndexedDB.
- Offline collaboration: add IndexedDB outbox, sync, and a remote adapter.
- Firebase collaboration: add Firebase and deploy its fixed rules and indexes.
- React: add the provider and selector hooks after composing the headless
  engine.

Do not branch on adapter names. Check the adapter capability manifest.

## Failure Policy

Decoded, migrated, reduced, and loaded values are untrusted until validated.
Show typed route and conflict failures. Never replace a failed route with a new
document. Preserve recoverable command content outside diagnostics.
