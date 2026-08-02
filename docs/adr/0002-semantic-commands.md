# ADR 0002: Semantic Commands and OCC

Consumers express durable intent as validated semantic commands over stable entity IDs. V1 uses
revisioned optimistic concurrency, durable outboxes, and consumer-defined conflict targets.
Replication is an interface so CRDT, OT, or server-authoritative engines can replace OCC without
changing document models.
