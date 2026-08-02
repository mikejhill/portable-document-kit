export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticEvent = {
  readonly level: DiagnosticLevel;
  readonly code: string;
  readonly measurements?: Readonly<Record<string, number | boolean>>;
};

export interface DiagnosticSink {
  emit(event: DiagnosticEvent): void;
}

export const silentDiagnostics: DiagnosticSink = { emit: () => undefined };
