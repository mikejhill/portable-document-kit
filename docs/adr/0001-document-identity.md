# ADR 0001: Document Identity and Versions

Document IDs identify records. Document type IDs identify consumer semantics.
Schema versions identify semantic state. Snapshot protocol, payload codec,
route, and repository versions are independent. No version change silently
changes another layer.
