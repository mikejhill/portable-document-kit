# Backend Author Guide

Implement only the capability ports the provider can guarantee. Publish a manifest with the exact
capability set and integrity level. Run the testing package conformance suite against the real
adapter.

Command commits must be idempotent by command ID, monotonically increment revisions, return the
latest validated snapshot, and retain enough recent IDs to suppress duplicate replay. Subscriptions
may arrive stale; consumers will ignore revisions older than the accepted head.

Server-authoritative integrity means the server validates consumer semantics, not merely an
envelope. Direct-browser databases normally report `envelope-enforced` unless their policy language
can evaluate the consumer schema and reducer.
