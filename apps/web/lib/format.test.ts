import { describe, it, expect } from "vitest";
import { titleCase } from "./format";

describe("titleCase", () => {
  it("title-cases county ALL-CAPS addresses", () => {
    expect(titleCase("4708 FRONTIER TRL")).toBe("4708 Frontier Trl");
    expect(titleCase("2722 BARTON SKWY")).toBe("2722 Barton Skwy");
  });

  it("keeps entity forms uppercase", () => {
    expect(titleCase("DREAM11 TEJAS INVESTMENTS LLC")).toBe("Dream11 Tejas Investments LLC");
    expect(titleCase("A WHIDDON CONSTRUCTION LLC")).toBe("A Whiddon Construction LLC");
  });

  it("keeps unit letters and directionals uppercase", () => {
    expect(titleCase("1315 SOUTHPORT DR C")).toBe("1315 Southport Dr C");
    expect(titleCase("811 W JOHANNA ST")).toBe("811 W Johanna St");
  });

  it("keeps suffixes and ordinals readable", () => {
    expect(titleCase("PORTER TOM BROOKS JR")).toBe("Porter Tom Brooks JR");
    expect(titleCase("5811 S 1ST ST")).toBe("5811 S 1st St");
  });

  it("handles hyphens, apostrophes and empties", () => {
    expect(titleCase("O'BRIEN-SMITH")).toBe("O'Brien-Smith");
    expect(titleCase(null)).toBe("");
    expect(titleCase("")).toBe("");
  });
});
