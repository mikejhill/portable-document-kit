# ADR 0004: Integrity and Privacy

Adapters declare client-validated, envelope-enforced, or server-authoritative integrity.
Direct-browser Firestore can enforce access and envelope invariants but cannot validate arbitrary
consumer reducers. Diagnostics contain typed codes and numeric metadata only, never document content
or credentials.
