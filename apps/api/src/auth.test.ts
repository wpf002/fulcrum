import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./auth.js";

describe("password hashing (scrypt)", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  });

  it("produces a unique salt per hash", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toEqual(b); // random salt
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("rejects null / malformed stored hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$deadbeef$cafe")).toBe(false);
  });
});
