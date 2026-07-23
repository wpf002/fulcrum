import { describe, it, expect } from "vitest";
import { parseCreditorNotice, parseNotices } from "./sources/public-notice.js";

const NOTICE = `NOTICE TO CREDITORS
Notice is hereby given that original Letters Testamentary for the Estate of
JOHN ALLEN SMITH, Deceased, were issued on August 12, 2025, in Cause No.
C-1-PB-25-001234, pending in the Probate Court No. 1 of Travis County, Texas,
to Mary Smith.`;

describe("parseCreditorNotice", () => {
  it("extracts decedent, cause number, court, and type", () => {
    const f = parseCreditorNotice(NOTICE)!;
    expect(f.decedentName).toBe("JOHN ALLEN SMITH");
    expect(f.causeNumber).toBe("C-1-PB-25-001234");
    expect(f.caseType).toBe("Letters Testamentary");
    expect(f.court).toMatch(/Travis County/);
    expect(f.filedAt.getUTCFullYear()).toBe(2025);
  });

  it("de-hyphenates newspaper column line-wraps in the name", () => {
    const wrapped = NOTICE.replace("JOHN ALLEN SMITH", "ROB- ERT G. DELGA- DO");
    const f = parseCreditorNotice(wrapped)!;
    expect(f.decedentName).toBe("ROBERT G. DELGADO");
  });

  it("handles Letters of Administration (intestate)", () => {
    const admin = NOTICE.replace("Letters Testamentary", "Letters of Administration");
    expect(parseCreditorNotice(admin)!.caseType).toBe("Letters of Administration");
  });

  it("returns null when there is no decedent", () => {
    expect(parseCreditorNotice("Notice of public hearing on a zoning variance.")).toBeNull();
  });
});

describe("parseNotices", () => {
  it("extracts multiple notices from a results page and de-dupes", () => {
    const second = NOTICE.replace("JOHN ALLEN SMITH", "JANE DOE").replace("001234", "005678");
    const html = `<html><body><div>${NOTICE}</div><div>${second}</div><div>${NOTICE}</div></body></html>`;
    const notices = parseNotices(html);
    const names = notices.map((n) => n.decedentName).sort();
    expect(names).toEqual(["JANE DOE", "JOHN ALLEN SMITH"]); // 3 blocks, 2 unique
  });
});
