import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Versioned consent disclosures. The version string lands in
// Consent.termsVersion and the SHA-256 of the exact text in Consent.termsHash,
// so what a consumer agreed to can always be reproduced. Never edit a
// published version in place — add a new one (see docs/legal/README.md).
export const CURRENT_TERMS_VERSION = "2026-07-buyer-v1";

const LEGAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/legal");

interface LegalDoc {
  version: string;
  text: string;
  hash: string;
}

const cache = new Map<string, LegalDoc>();

export function getTerms(version = CURRENT_TERMS_VERSION): LegalDoc {
  const cached = cache.get(version);
  if (cached) return cached;
  const text = readFileSync(resolve(LEGAL_DIR, `terms-${version}.md`), "utf8");
  const doc: LegalDoc = {
    version,
    text,
    hash: createHash("sha256").update(text, "utf8").digest("hex"),
  };
  cache.set(version, doc);
  return doc;
}

/** Hash for a version, or null if we don't publish that version. */
export function termsHashFor(version: string): string | null {
  try {
    return getTerms(version).hash;
  } catch {
    return null;
  }
}
