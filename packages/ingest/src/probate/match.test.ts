import { describe, it, expect } from "vitest";
import { normalizeName } from "./match.js";

describe("normalizeName", () => {
  it("strips 'Estate of', suffixes, and single-letter middles", () => {
    const n = normalizeName("Estate of John Smith Jr");
    expect(n.tokens.sort()).toEqual(["JOHN", "SMITH"]);
  });

  it("produces an order-independent token set (court vs TCAD order)", () => {
    // TCAD stores "LAST FIRST MIDDLE"; a court notice reads "First Middle Last"
    const tcad = normalizeName("WEBER FRED O");
    const court = normalizeName("Estate of Fred O Weber");
    expect([...tcad.tokens].sort()).toEqual([...court.tokens].sort());
    expect([...court.tokens].sort()).toEqual(["FRED", "WEBER"]);
  });

  it("drops noise tokens", () => {
    expect(normalizeName("THE ESTATE OF JANE DOE, DECEASED").tokens.sort()).toEqual(["DOE", "JANE"]);
  });

  it("keeps a stable surname/given best-guess", () => {
    const n = normalizeName("Donald B Dial");
    expect(n.tokens).toContain("DONALD");
    expect(n.tokens).toContain("DIAL");
  });
});
