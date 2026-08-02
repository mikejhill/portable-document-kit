import { PortableSnapshotCodec, SnapshotKind } from '@mikejhill/portable-document-codec';

type RouteKind = "snapshot" | "local" | "private" | "view" | "launch" | "invitation" | "action";
type ParsedRoute = {
    readonly kind: RouteKind;
    readonly value: string;
    readonly raw: string;
};
type RouteRegistration = {
    readonly kind: RouteKind;
    readonly prefix: string;
    readonly identifier?: RegExp;
};
/** Parses consumer-defined route namespaces without interpreting providers. */
declare class FragmentRouter {
    private readonly registrations;
    constructor(registrations: readonly RouteRegistration[]);
    parse(hash: string): ParsedRoute | null;
    hasKnownPrefix(hash: string): boolean;
}
type HistoryWriteMode = "push" | "replace" | "none";
interface HistoryPort {
    write(hash: string, mode: HistoryWriteMode, state?: unknown): void;
    subscribe(listener: (hash: string, state: unknown) => void): () => void;
}
/** Browser History adapter that touches globals only when explicitly created. */
declare class BrowserHistoryPort implements HistoryPort {
    private readonly browserWindow;
    constructor(browserWindow: Pick<Window, "history" | "location" | "addEventListener" | "removeEventListener">);
    write(hash: string, mode: HistoryWriteMode, state?: unknown): void;
    subscribe(listener: (hash: string, state: unknown) => void): () => void;
}
declare class NavigationPolicy {
    private mode;
    private override;
    schedule(mode: HistoryWriteMode, routeOverride?: string): void;
    restore(): void;
    consume(snapshotHash: string): {
        readonly hash: string;
        readonly mode: HistoryWriteMode;
    };
}
declare function createPortableUrl<State, Command, Summary>(codec: PortableSnapshotCodec<State, Command, Summary>, state: State, currentHref: string, kind?: SnapshotKind): string;
interface BrowserLifecycle {
    subscribeVisibility(listener: (visible: boolean) => void): () => void;
    subscribeExit(listener: () => void): () => void;
}
declare class WindowLifecycle implements BrowserLifecycle {
    private readonly documentPort;
    private readonly windowPort;
    constructor(documentPort: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">, windowPort: Pick<Window, "addEventListener" | "removeEventListener">);
    subscribeVisibility(listener: (visible: boolean) => void): () => void;
    subscribeExit(listener: () => void): () => void;
}

export { BrowserHistoryPort, type BrowserLifecycle, FragmentRouter, type HistoryPort, type HistoryWriteMode, NavigationPolicy, type ParsedRoute, type RouteKind, type RouteRegistration, WindowLifecycle, createPortableUrl };
