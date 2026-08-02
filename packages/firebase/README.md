# `@mikejhill/portable-document-firebase`

Firebase Authentication, a fixed Firestore repository model, publications, invitations, membership,
presence, Security Rules, indexes, and emulator fixtures.

```bash
npm install @mikejhill/portable-document-core @mikejhill/portable-document-firebase firebase
```

`FirebaseRuntime` keeps authentication separate and initializes App Check only before the first
Firestore operation. `FirebaseIdentity` maps Firebase users to generic principals.
`FirebaseDocumentStore` implements the cloud capability ports and reports `envelope-enforced`
integrity. Deploy `rules/firestore.rules` and `rules/firestore.indexes.json`; Rules cannot validate
an arbitrary consumer reducer.

See [Testing and CI](../../docs/testing.md) before changing the provider model.
