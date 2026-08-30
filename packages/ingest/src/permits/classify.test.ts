import { describe, it, expect } from "vitest";
import { classifyPermit, isResidential } from "./classify.js";

const res = { permit_class_mapped: "Residential" };

describe("classifyPermit", () => {
  it("treats repair/remodel work as pre-sale prep", () => {
    expect(classifyPermit({ ...res, work_class: "Repair", permit_type_desc: "Building Permit" })).toBe("prep");
    expect(classifyPermit({ ...res, work_class: "Remodel", permit_type_desc: "Mechanical Permit" })).toBe("prep");
    expect(classifyPermit({ ...res, work_class: "Upgrade", permit_type_desc: "Electrical Permit" })).toBe("prep");
  });

  it("treats new builds and additions as investing to stay", () => {
    expect(classifyPermit({ ...res, work_class: "New", permit_type_desc: "Building Permit" })).toBe("investment");
    expect(classifyPermit({ ...res, work_class: "Addition", permit_type_desc: "Building Permit" })).toBe("investment");
  });

  it("reads intent from the description even when work class looks like prep", () => {
    expect(classifyPermit({ ...res, work_class: "Remodel", description: "New pool and spa" })).toBe("investment");
    expect(classifyPermit({ ...res, work_class: "Remodel", description: "Accessory dwelling unit" })).toBe("investment");
  });

  it("ignores commercial permits entirely", () => {
    expect(classifyPermit({ permit_class_mapped: "Commercial", work_class: "Remodel" })).toBe("neutral");
    expect(isResidential({ permit_class_mapped: "Commercial" })).toBe(false);
  });

  it("is neutral when it can't tell", () => {
    expect(classifyPermit({ ...res, work_class: "" })).toBe("neutral");
    expect(classifyPermit({})).toBe("neutral");
  });
});
