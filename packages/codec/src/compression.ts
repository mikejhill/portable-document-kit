import LZString from "lz-string";
import type { TextCompression } from "./types";

/** URI-safe LZ String compression for compact browser fragments. */
export class LzStringUriCompression implements TextCompression {
  public readonly id = "lz-string-uri";

  public compress(value: string): string {
    return LZString.compressToEncodedURIComponent(value);
  }

  public decompress(value: string): string | null {
    return LZString.decompressFromEncodedURIComponent(value);
  }
}

/** Percent-encoding transport useful for tests and already-compressed payloads. */
export class IdentityTextCompression implements TextCompression {
  public readonly id = "identity";

  public compress(value: string): string {
    return encodeURIComponent(value);
  }

  public decompress(value: string): string | null {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
}
