import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import type {
  CommandEnvelope,
  DocumentFailure,
  WorkspaceEngine,
  WorkspaceState,
} from "@mikejhill/portable-document-core";

type UnknownEngine = WorkspaceEngine<unknown, unknown, unknown>;
const WorkspaceContext = createContext<UnknownEngine | null>(null);

export type PortableDocumentProviderProps<State, Command, Summary> = PropsWithChildren<{
  readonly engine: WorkspaceEngine<State, Command, Summary>;
  readonly disposeOnUnmount?: boolean;
}>;

/** Optional React lifecycle binding over the headless workspace engine. */
export function PortableDocumentProvider<State, Command, Summary>({
  engine,
  disposeOnUnmount = false,
  children,
}: PortableDocumentProviderProps<State, Command, Summary>): ReactNode {
  useEffect(
    () => () => {
      if (disposeOnUnmount) engine.dispose();
    },
    [disposeOnUnmount, engine],
  );
  return createElement(WorkspaceContext.Provider, { value: engine as UnknownEngine }, children);
}

export function useWorkspace<State, Command, Summary>(): WorkspaceState<State, Summary> {
  const engine = useWorkspaceEngine<State, Command, Summary>();
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

export function useWorkspaceEngine<State, Command, Summary>(): WorkspaceEngine<
  State,
  Command,
  Summary
> {
  const engine = useContext(WorkspaceContext);
  if (!engine) throw new Error("useWorkspaceEngine requires PortableDocumentProvider.");
  return engine as WorkspaceEngine<State, Command, Summary>;
}

export function useWorkspaceSelector<State, Command, Summary, Selected>(
  selector: (state: WorkspaceState<State, Summary>) => Selected,
): Selected {
  return selector(useWorkspace<State, Command, Summary>());
}

export function useWorkspaceActions<State, Command, Summary>(): {
  readonly open: (route: string) => Promise<void>;
  readonly dispatchSpeculative: (envelope: CommandEnvelope<Command>) => DocumentFailure | null;
  readonly returnToHead: () => void;
} {
  const engine = useWorkspaceEngine<State, Command, Summary>();
  const open = useCallback((route: string) => engine.open(route), [engine]);
  const dispatchSpeculative = useCallback(
    (envelope: CommandEnvelope<Command>) => engine.applySpeculative(envelope),
    [engine],
  );
  const returnToHead = useCallback(() => engine.returnToHead(), [engine]);
  return useMemo(
    () => ({ open, dispatchSpeculative, returnToHead }),
    [dispatchSpeculative, open, returnToHead],
  );
}

export type WorkspaceErrorBoundaryFallback = (error: Error) => ReactNode;
