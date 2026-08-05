/**
 * Foreclosure / substitute-trustee-sale feed.
 *
 * Texas requires a Notice of Substitute Trustee's Sale to be posted/published
 * before a non-judicial foreclosure (Property Code §51.002). It names the
 * property being sold and the sale date — a strong "about to change hands"
 * signal (the NOD_PREFORECLOSURE prior is the second-highest in the model).
 * Unlike probate (matched by decedent NAME), these are matched by ADDRESS.
 */

export interface ForeclosureFiling {
  address: string; // street address of the property to be sold
  zip: string | null; // 5-digit if present in the notice
  saleDate: Date | null; // scheduled sale date
  source: string; // provenance
  ref: string | null; // trustee file / TS number if present
}
