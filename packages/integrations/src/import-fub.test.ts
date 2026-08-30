import { describe, it, expect } from "vitest";
import { planImport } from "./import-fub.js";

const base = { id: 1, name: "Jane Buyer", emails: [{ value: "jane@example.com" }], phones: [{ value: "512-555-0100" }] };

describe("planImport — consent is never invented", () => {
  it("permits email and sms when FUB reports no opt-out", () => {
    const p = planImport(base as never);
    expect(p.channels).toEqual({ email: true, sms: true, tcpa: false });
    expect(p.skip).toBeNull();
  });

  it("NEVER infers TCPA consent, even for a clean contact", () => {
    expect(planImport(base as never).channels.tcpa).toBe(false);
  });

  it("honors FUB opt-out flags", () => {
    const p = planImport({ ...base, emailsOptedOut: true, smsOptedOut: true } as never);
    expect(p.channels.email).toBe(false);
    expect(p.channels.sms).toBe(false);
    expect(p.skip).toBe("opted out of every channel");
  });

  it("skips contacts with no way to reach them", () => {
    expect(planImport({ id: 2, name: "No Contact" } as never).skip).toBe("no email or phone");
  });

  it("does not permit a channel it has no address for", () => {
    const p = planImport({ id: 3, name: "Email Only", emails: [{ value: "a@b.com" }] } as never);
    expect(p.channels.email).toBe(true);
    expect(p.channels.sms).toBe(false);
  });

  it("carries budget through as integer cents", () => {
    const p = planImport({ ...base, price: { max: 450000 } } as never);
    expect(p.priceMaxCents).toBe(45000000n);
  });
});
