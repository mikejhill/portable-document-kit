# `@mikejhill/portable-document-react`

Optional React provider, workspace hooks, selectors, actions, and lifecycle integration over the
headless core engine.

```bash
npm install @mikejhill/portable-document-core @mikejhill/portable-document-react react
```

Wrap a composed `WorkspaceEngine` in `PortableDocumentProvider`. Read state with `useWorkspace` or
`useWorkspaceSelector`; issue headless actions with `useWorkspaceActions`. Consumer UI owns labels,
dialogs, conflicts, and recovery presentation.
