/** Route categories remain provider-neutral and consumer-configurable. */
export type RouteKind =
  "snapshot" | "local" | "private" | "view" | "launch" | "invitation" | "action";

/** Result returned for a recognized and valid fragment namespace. */
export type ParsedRoute = {
  readonly kind: RouteKind;
  readonly value: string;
  readonly raw: string;
};

/** Registers one fragment namespace and its optional identifier grammar. */
export type RouteRegistration = {
  readonly kind: RouteKind;
  readonly prefix: string;
  readonly identifier?: RegExp;
};

/** Parses consumer-defined route namespaces without interpreting providers. */
export class FragmentRouter {
  private readonly registrations: readonly RouteRegistration[];

  /** Validates and orders route registrations so longer prefixes win. */
  public constructor(registrations: readonly RouteRegistration[]) {
    const prefixes = new Set<string>();
    for (const registration of registrations) {
      if (!registration.prefix.startsWith("#")) {
        throw new Error("Route prefixes must start with #.");
      }
      if (prefixes.has(registration.prefix)) {
        throw new Error(`Duplicate route prefix: ${registration.prefix}`);
      }
      prefixes.add(registration.prefix);
    }
    this.registrations = [...registrations].sort(
      (left, right) => right.prefix.length - left.prefix.length,
    );
  }

  /** Parses a fragment or returns `null` when its namespace or identifier is invalid. */
  public parse(hash: string): ParsedRoute | null {
    for (const registration of this.registrations) {
      if (!hash.startsWith(registration.prefix)) continue;
      const value = hash.slice(registration.prefix.length);
      if (registration.identifier && !registration.identifier.test(value)) return null;
      return { kind: registration.kind, value, raw: hash };
    }
    return null;
  }

  /** Distinguishes malformed known routes from completely unknown fragments. */
  public hasKnownPrefix(hash: string): boolean {
    return this.registrations.some((registration) => hash.startsWith(registration.prefix));
  }
}
