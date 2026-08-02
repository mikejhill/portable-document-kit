# ADR 0003: Capability-Sliced Providers

Persistence, history, subscriptions, outboxes, publication, membership, and presence are separate
ports. Adapters publish a runtime capability manifest. Callers never branch on provider names.
