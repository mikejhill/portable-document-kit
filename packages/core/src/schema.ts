import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ValidationIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * A Standard Schema validator used synchronously by reducers and optimistic UI.
 * Asynchronous schemas are detected and rejected with an explicit issue.
 */
export type DocumentSchema<T> = StandardSchemaV1<unknown, T>;

/** Validates an untrusted value without binding the core to a schema vendor. */
export function validateValue<T>(schema: DocumentSchema<T>, value: unknown): ValidationResult<T> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    return {
      ok: false,
      issues: [{ message: "Document schemas must validate synchronously." }],
    };
  }
  if (result.issues) {
    return {
      ok: false,
      issues: result.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
    };
  }
  return { ok: true, value: result.value };
}
