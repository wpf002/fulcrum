import { describe, it, expect } from "vitest";
import { parseLine, type FieldSpec } from "./layout.js";

describe("parseLine (fixed-width extraction)", () => {
  const fields: FieldSpec[] = [
    { name: "id", start: 1, end: 5 },
    { name: "type", start: 6, end: 6 },
    { name: "name", start: 7, end: 26 },
  ];

  it("slices 1-indexed inclusive fields and trims", () => {
    const line = "00042R" + "DJB INVESTMENT LLC  ";
    const rec = parseLine(line, fields);
    expect(rec.id).toBe("00042");
    expect(rec.type).toBe("R");
    expect(rec.name).toBe("DJB INVESTMENT LLC");
  });

  it("returns empty strings for blank fields", () => {
    const rec = parseLine("00001R" + " ".repeat(20), fields);
    expect(rec.name).toBe("");
  });
});
