import { PropsWithChildren, ReactNode } from 'react';
import { WorkspaceEngine, WorkspaceState, CommandEnvelope, DocumentFailure } from '@mikejhill/portable-document-core';

type PortableDocumentProviderProps<State, Command, Summary> = PropsWithChildren<{
    readonly engine: WorkspaceEngine<State, Command, Summary>;
    readonly disposeOnUnmount?: boolean;
}>;
/** Optional React lifecycle binding over the headless workspace engine. */
declare function PortableDocumentProvider<State, Command, Summary>({ engine, disposeOnUnmount, children, }: PortableDocumentProviderProps<State, Command, Summary>): ReactNode;
declare function useWorkspace<State, Command, Summary>(): WorkspaceState<State, Summary>;
declare function useWorkspaceEngine<State, Command, Summary>(): WorkspaceEngine<State, Command, Summary>;
declare function useWorkspaceSelector<State, Command, Summary, Selected>(selector: (state: WorkspaceState<State, Summary>) => Selected): Selected;
declare function useWorkspaceActions<State, Command, Summary>(): {
    readonly open: (route: string) => Promise<void>;
    readonly dispatchSpeculative: (envelope: CommandEnvelope<Command>) => DocumentFailure | null;
    readonly returnToHead: () => void;
};
type WorkspaceErrorBoundaryFallback = (error: Error) => ReactNode;

export { PortableDocumentProvider, type PortableDocumentProviderProps, type WorkspaceErrorBoundaryFallback, useWorkspace, useWorkspaceActions, useWorkspaceEngine, useWorkspaceSelector };
