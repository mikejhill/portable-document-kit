import { PortableSnapshotCodec, SnapshotKind } from '@mikejhill/portable-document-codec';

/** Controls whether the next route write creates, replaces, or preserves history. */
type HistoryWriteMode = "push" | "replace" | "none";
/** Browser-independent history contract used by workspace composition roots. */
interface HistoryPort {
    write(hash: string, mode: HistoryWriteMode, state?: unknown): void;
    subscribe(listener: (hash: string, state: unknown) => void): () => void;
}
/** Browser History adapter that touches globals only when explicitly created. */
declare class BrowserHistoryPort implements HistoryPort {
    private readonly browserWindow;
    constructor(browserWindow: Pick<Window, "history" | "location" | "addEventListener" | "removeEventListener">);
    /** Applies one explicit History API write and preserves `none` restorations. */
    write(hash: string, mode: HistoryWriteMode, state?: unknown): void;
    /** Subscribes to Back/Forward restoration and returns an idempotent disposer. */
    subscribe(listener: (hash: string, state: unknown) => void): () => void;
}
/** Stateful policy for the next browser-history transition. */
declare class NavigationPolicy {
    private mode;
    private override;
    /** Schedules the next history mode and optional route override. */
    schedule(mode: HistoryWriteMode, routeOverride?: string): void;
    /** Marks the next render as a restoration that must not rewrite history. */
    restore(): void;
    /** Consumes the pending transition and resets routine writes to `replace`. */
    consume(snapshotHash: string): {
        readonly hash: string;
        readonly mode: HistoryWriteMode;
    };
}

/** Browser lifecycle events used by presence and persistence orchestration. */
interface BrowserLifecycle {
    subscribeVisibility(listener: (visible: boolean) => void): () => void;
    subscribeExit(listener: () => void): () => void;
}
/** Explicit browser lifecycle adapter that remains safe to import during SSR. */
declare class WindowLifecycle implements BrowserLifecycle {
    private readonly documentPort;
    private readonly windowPort;
    constructor(documentPort: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">, windowPort: Pick<Window, "addEventListener" | "removeEventListener">);
    /** Reports current visibility after each browser visibility transition. */
    subscribeVisibility(listener: (visible: boolean) => void): () => void;
    /** Reports page exit without assuming the asynchronous callback will complete. */
    subscribeExit(listener: () => void): () => void;
}

/** Route categories remain provider-neutral and consumer-configurable. */
type RouteKind = "snapshot" | "local" | "private" | "view" | "launch" | "invitation" | "action";
/** Result returned for a recognized and valid fragment namespace. */
type ParsedRoute = {
    readonly kind: RouteKind;
    readonly value: string;
    readonly raw: string;
};
/** Registers one fragment namespace and its optional identifier grammar. */
type RouteRegistration = {
    readonly kind: RouteKind;
    readonly prefix: string;
    readonly identifier?: RegExp;
};
/** Parses consumer-defined route namespaces without interpreting providers. */
declare class FragmentRouter {
    private readonly registrations;
    /** Validates and orders route registrations so longer prefixes win. */
    constructor(registrations: readonly RouteRegistration[]);
    /** Parses a fragment or returns `null` when its namespace or identifier is invalid. */
    parse(hash: string): ParsedRoute | null;
    /** Distinguishes malformed known routes from completely unknown fragments. */
    hasKnownPrefix(hash: string): boolean;
}

/** Creates a complete URL after removing any existing fragment. */
declare function createPortableUrl<State, Command, Summary>(codec: PortableSnapshotCodec<State, Command, Summary>, state: State, currentHref: string, kind?: SnapshotKind): string;

export { BrowserHistoryPort, type BrowserLifecycle, FragmentRouter, type HistoryPort, type HistoryWriteMode, NavigationPolicy, type ParsedRoute, type RouteKind, type RouteRegistration, WindowLifecycle, createPortableUrl };
