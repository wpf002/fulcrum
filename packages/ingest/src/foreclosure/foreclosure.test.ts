import { describe, it, expect } from "vitest";
import { parseForeclosureNotice, parseForeclosureNotices } from "./parse.js";
import { normalizeAddress } from "./address.js";

const NOTICE = `NOTICE OF SUBSTITUTE TRUSTEE'S SALE
Deed of Trust dated March 1, 2019. Grantor: Jane Homeowner. The property will
be sold at public auction. Date of Sale: September 2, 2026. The property to be
sold is commonly known as 1711 Crown Dr, Austin, TX 78745. TS No. LO-53743-TX.`;

describe("parseForeclosureNotice", () => {
  it("extracts address, zip, sale date, and trustee ref", () => {
    const f = parseForeclosureNotice(NOTICE)!;
    expect(f.address).toBe("1711 Crown Dr");
    expect(f.zip).toBe("78745");
    expect(f.saleDate?.getUTCFullYear()).toBe(2026);
    expect(f.ref).toBe("LO-53743-TX");
  });

  it("falls back to a bare '<addr>, Austin TX <zip>' pattern", () => {
    const f = parseForeclosureNotice(
      "Notice of Substitute Trustee's Sale ... 4708 Frontier Trl, Austin, Texas 78745 ...",
    )!;
    expect(f.address).toBe("4708 Frontier Trl");
    expect(f.zip).toBe("78745");
  });

  it("returns null with no parseable address", () => {
    expect(parseForeclosureNotice("Notice of public meeting regarding a bond election.")).toBeNull();
  });

  it("splits and de-dupes multiple notices", () => {
    const two = NOTICE + "\n" + NOTICE.replace("1711 Crown Dr", "909 Glen Oak Dr");
    const parsed = parseForeclosureNotices(two);
    expect(parsed.map((f) => f.address).sort()).toEqual(["1711 Crown Dr", "909 Glen Oak Dr"]);
  });
});

describe("normalizeAddress", () => {
  it("canonicalizes suffix + strips city/state/zip (matches TCAD situs form)", () => {
    const notice = normalizeAddress("1711 Crown Drive, Austin, TX 78745");
    const tcad = normalizeAddress("1711 CROWN DR");
    expect(notice?.full).toBe("1711 CROWN DR");
    expect(notice?.full).toBe(tcad?.full);
  });

  it("normalizes directions and drops unit markers", () => {
    expect(normalizeAddress("5811 South 1st Street Apt 4, Austin TX")?.full).toBe("5811 S 1ST ST");
  });

  it("returns null without a house number", () => {
    expect(normalizeAddress("Crown Drive")).toBeNull();
  });
});
