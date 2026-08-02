# `@mikejhill/portable-document-browser`

SSR-safe fragment routing, History API isolation, navigation policy, lifecycle subscriptions, and
URL creation.

```bash
npm install @mikejhill/portable-document-core @mikejhill/portable-document-codec @mikejhill/portable-document-browser
```

Use `FragmentRouter` to register independent route namespaces. Construct `BrowserHistoryPort` and
`WindowLifecycle` only in a browser composition root. `NavigationPolicy` prevents restored history
entries from being immediately rewritten.
