/**
 * Fulcrum embeddable buyer-intent widget.
 *
 * An agent drops this on their site:
 *   <div id="fulcrum-widget"></div>
 *   <script src="https://api.fulcrum/widget/fulcrum-widget.js"
 *           data-fulcrum-agent="AGENT_ID"></script>
 *
 * Flow: affordability calculator → mortgage-readiness → contact + inline
 * consent → POST /v1/leads. No consent, no submit. 100% first-party opt-in.
 *
 * Money is integer cents end to end (never floats over the wire).
 */

import type { BuyerLeadSubmission } from "@fulcrum/types";
import { renderStyles } from "./styles.js";

// Capture synchronously at module load — document.currentScript is null once
// any await has yielded.
const THIS_SCRIPT = document.currentScript as HTMLScriptElement | null;

interface WidgetConfig {
  agentId: string;
  agentName: string;
  primaryColor: string;
  logoUrl: string | null;
  termsVersion: string;
}

interface State {
  // affordability
  annualIncome: number;
  monthlyDebts: number;
  downPayment: number;
  rate: number;
  // readiness
  timelineMonths: number;
  preApproved: boolean;
  downPaymentSaved: boolean;
  // criteria
  targetZip: string;
  minBeds: number;
  // contact + consent
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  optEmail: boolean;
  optSms: boolean;
  optTcpa: boolean;
}

const money = (cents: number) =>
  "$" + Math.round(cents / 100).toLocaleString("en-US");

/**
 * Standard affordability: 28% front-end DTI on gross income, minus existing
 * debts, converted to a loan amount via the mortgage payment formula, plus the
 * down payment. Returns the supportable home price in cents.
 */
function affordablePriceCents(s: State): number {
  const monthlyIncome = s.annualIncome / 12;
  const maxPayment = monthlyIncome * 0.28 - s.monthlyDebts;
  if (maxPayment <= 0) return Math.max(0, s.downPayment) * 100;
  const monthlyRate = s.rate / 100 / 12;
  const n = 360; // 30-year
  const loan =
    monthlyRate > 0
      ? (maxPayment * (1 - Math.pow(1 + monthlyRate, -n))) / monthlyRate
      : maxPayment * n;
  return Math.round((loan + s.downPayment) * 100);
}

function readinessPreview(s: State): number {
  let score = 30; // completed affordability
  score += 20; // answered readiness
  if (s.preApproved) score += 20;
  if (s.downPaymentSaved) score += 10;
  if (s.timelineMonths <= 3) score += 20;
  else if (s.timelineMonths <= 6) score += 15;
  else if (s.timelineMonths <= 12) score += 10;
  else score += 5;
  return Math.min(score, 100);
}

class Widget {
  private root: HTMLElement;
  private cfg: WidgetConfig;
  private api: string;
  private step = 0;
  private submitting = false;
  private done = false;
  private s: State = {
    annualIncome: 95000,
    monthlyDebts: 450,
    downPayment: 40000,
    rate: 6.5,
    timelineMonths: 6,
    preApproved: false,
    downPaymentSaved: true,
    targetZip: "",
    minBeds: 3,
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    // Nothing is pre-checked — every channel is affirmative, unbundled opt-in.
    optEmail: false,
    optSms: false,
    optTcpa: false,
  };

  constructor(root: HTMLElement, cfg: WidgetConfig, api: string) {
    this.root = root;
    this.cfg = cfg;
    this.api = api;
    this.root.style.setProperty("--fx-accent", cfg.primaryColor);
    this.render();
  }

  private set<K extends keyof State>(k: K, v: State[K]) {
    this.s[k] = v;
  }

  private canSubmit(): boolean {
    const s = this.s;
    return (
      s.email.includes("@") &&
      s.firstName.trim().length > 0 &&
      s.optEmail // must consent to at least email contact
    );
  }

  private async submit() {
    if (!this.canSubmit() || this.submitting) return;
    this.submitting = true;
    this.render();

    const price = affordablePriceCents(this.s);
    const payload: BuyerLeadSubmission = {
      agentId: this.cfg.agentId,
      source: "affordability-widget",
      consent: {
        termsVersion: this.cfg.termsVersion,
        channelOptIns: {
          email: this.s.optEmail,
          sms: this.s.optSms,
          tcpa: this.s.optTcpa,
        },
      },
      contact: {
        firstName: this.s.firstName.trim(),
        lastName: this.s.lastName.trim() || undefined,
        email: this.s.email.trim(),
        phone: this.s.phone.trim() || undefined,
      },
      criteria: {
        priceBandMinCents: String(Math.round(price * 0.85)),
        priceBandMaxCents: String(price),
        targetGeographies: this.s.targetZip ? [this.s.targetZip.trim()] : [],
        minBeds: this.s.minBeds,
        propertyType: "residential",
      },
      readiness: {
        affordabilityResultCents: String(price),
        mortgageReadinessAnswers: {
          preApproved: this.s.preApproved,
          downPaymentSaved: this.s.downPaymentSaved,
        },
        timelineMonths: this.s.timelineMonths,
      },
    };

    try {
      const res = await fetch(`${this.api}/v1/leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      this.done = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "submit failed";
    } finally {
      this.submitting = false;
      this.render();
    }
  }

  private error = "";

  private field(label: string, input: string, hint = ""): string {
    return `<label class="fx-field"><span>${label}</span>${input}${
      hint ? `<em>${hint}</em>` : ""
    }</label>`;
  }

  private render() {
    const s = this.s;
    const price = affordablePriceCents(s);
    const accent = this.cfg.primaryColor;

    let body = "";

    if (this.done) {
      body = `
        <div class="fx-done">
          <div class="fx-check">✓</div>
          <h3>You're all set, ${s.firstName || "buyer"}.</h3>
          <p>${this.cfg.agentName} will reach out with homes up to <b>${money(price)}</b> that match what you're looking for.</p>
          <div class="fx-readiness">Readiness score <b>${readinessPreview(s)}</b>/100</div>
        </div>`;
    } else {
      const steps = ["Buying power", "Readiness", "Get matched"];
      const nav = `<div class="fx-steps">${steps
        .map(
          (t, i) =>
            `<span class="${i === this.step ? "on" : i < this.step ? "past" : ""}">${
              i + 1
            }. ${t}</span>`,
        )
        .join("")}</div>`;

      if (this.step === 0) {
        body = `${nav}
          <div class="fx-result">
            <span>Estimated buying power</span>
            <strong>${money(price)}</strong>
          </div>
          ${this.field("Annual household income", `<input type="range" min="30000" max="400000" step="5000" data-k="annualIncome" value="${s.annualIncome}" /><output>$${s.annualIncome.toLocaleString()}</output>`)}
          ${this.field("Monthly debt payments", `<input type="range" min="0" max="4000" step="50" data-k="monthlyDebts" value="${s.monthlyDebts}" /><output>$${s.monthlyDebts.toLocaleString()}/mo</output>`)}
          ${this.field("Down payment saved", `<input type="range" min="0" max="200000" step="5000" data-k="downPayment" value="${s.downPayment}" /><output>$${s.downPayment.toLocaleString()}</output>`)}
          ${this.field("Interest rate", `<input type="range" min="3" max="9" step="0.125" data-k="rate" value="${s.rate}" /><output>${s.rate.toFixed(3)}%</output>`)}
          <button class="fx-next" data-next>See if you're ready →</button>`;
      } else if (this.step === 1) {
        const chip = (k: keyof State, label: string, on: boolean) =>
          `<button class="fx-chip ${on ? "on" : ""}" data-toggle="${k}">${label}</button>`;
        body = `${nav}
          ${this.field("When do you want to buy?", `
            <select data-k="timelineMonths">
              <option value="3" ${s.timelineMonths === 3 ? "selected" : ""}>Within 3 months</option>
              <option value="6" ${s.timelineMonths === 6 ? "selected" : ""}>3–6 months</option>
              <option value="12" ${s.timelineMonths === 12 ? "selected" : ""}>6–12 months</option>
              <option value="24" ${s.timelineMonths === 24 ? "selected" : ""}>Just exploring</option>
            </select>`)}
          <div class="fx-field"><span>Where you stand</span>
            <div class="fx-chips">
              ${chip("preApproved", "Mortgage pre-approved", s.preApproved)}
              ${chip("downPaymentSaved", "Down payment saved", s.downPaymentSaved)}
            </div>
          </div>
          ${this.field("Target zip (optional)", `<input type="text" inputmode="numeric" maxlength="5" data-k="targetZip" value="${s.targetZip}" placeholder="78704" />`)}
          ${this.field("Minimum bedrooms", `<select data-k="minBeds">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${s.minBeds === n ? "selected" : ""}>${n}+</option>`).join("")}</select>`)}
          <div class="fx-row">
            <button class="fx-back" data-back>← Back</button>
            <button class="fx-next" data-next>Continue →</button>
          </div>`;
      } else {
        body = `${nav}
          <div class="fx-summary">Your buying power: <b>${money(price)}</b> · readiness <b>${readinessPreview(s)}</b>/100</div>
          <div class="fx-grid">
            ${this.field("First name", `<input type="text" data-k="firstName" value="${s.firstName}" />`)}
            ${this.field("Last name", `<input type="text" data-k="lastName" value="${s.lastName}" />`)}
          </div>
          ${this.field("Email", `<input type="email" data-k="email" value="${s.email}" placeholder="you@email.com" />`)}
          ${this.field("Phone (optional)", `<input type="tel" data-k="phone" value="${s.phone}" placeholder="(512) 555-0134" />`)}
          <div class="fx-consent">
            <label><input type="checkbox" data-k="optEmail" ${s.optEmail ? "checked" : ""} /> Email me matching homes and updates from ${this.cfg.agentName}. <b>(required)</b></label>
            <label><input type="checkbox" data-k="optSms" ${s.optSms ? "checked" : ""} /> Text me (SMS). Message &amp; data rates may apply; reply STOP to stop.</label>
            <label><input type="checkbox" data-k="optTcpa" ${s.optTcpa ? "checked" : ""} /> I expressly consent to receive calls and/or texts from ${this.cfg.agentName} at the number I provided using an <b>automatic telephone dialing system and/or an artificial or prerecorded voice</b>. This is <b>not a condition of purchase</b>, and I can revoke it at any time.</label>
            <p class="fx-terms">
              Each choice above is separate and optional except email. Your info goes only to ${this.cfg.agentName} — never sold.
              We don't pull your credit or access your bank.
              <a href="${this.api}/v1/legal/terms" target="_blank" rel="noopener">Terms &amp; privacy</a> (v${this.cfg.termsVersion}).
            </p>
          </div>
          ${this.error ? `<div class="fx-error">Couldn't submit: ${this.error}. Try again.</div>` : ""}
          <div class="fx-row">
            <button class="fx-back" data-back>← Back</button>
            <button class="fx-next" data-submit ${this.canSubmit() && !this.submitting ? "" : "disabled"}>${this.submitting ? "Sending…" : "Get matched →"}</button>
          </div>`;
      }
    }

    this.root.innerHTML = `<div class="fx-card" style="--fx-accent:${accent}">
      <div class="fx-head">
        <span class="fx-brand">${this.cfg.agentName}</span>
        <span class="fx-badge">Buying power</span>
      </div>
      ${body}
    </div>`;
    this.wire();
  }

  private wire() {
    const q = <T extends Element>(sel: string) => Array.from(this.root.querySelectorAll<T>(sel));

    q<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((el) => {
      const k = el.getAttribute("data-k") as keyof State;
      const ev = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
      el.addEventListener(ev, () => {
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          this.set(k, el.checked as never);
          this.render();
        } else if (el instanceof HTMLInputElement && el.type === "range") {
          this.set(k, Number(el.value) as never);
          const out = el.nextElementSibling as HTMLOutputElement | null;
          if (out) {
            // live-update the readout without a full re-render (keeps slider grab)
            const v = Number(el.value);
            out.textContent =
              k === "rate" ? `${v.toFixed(3)}%` : k === "monthlyDebts" ? `$${v.toLocaleString()}/mo` : `$${v.toLocaleString()}`;
            const res = this.root.querySelector(".fx-result strong");
            if (res) res.textContent = money(affordablePriceCents(this.s));
          }
        } else {
          const val = k === "timelineMonths" || k === "minBeds" ? Number(el.value) : el.value;
          this.set(k, val as never);
          if (k === "optEmail") this.render();
        }
      });
    });

    q<HTMLButtonElement>("[data-toggle]").forEach((el) => {
      el.addEventListener("click", () => {
        const k = el.getAttribute("data-toggle") as keyof State;
        this.set(k, !this.s[k] as never);
        this.render();
      });
    });

    const next = this.root.querySelector<HTMLButtonElement>("[data-next]:not([data-submit])");
    next?.addEventListener("click", () => {
      this.step = Math.min(2, this.step + 1);
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => {
      this.step = Math.max(0, this.step - 1);
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-submit]")?.addEventListener("click", () => this.submit());
  }
}

async function boot() {
  const script = THIS_SCRIPT;
  const mount = document.getElementById("fulcrum-widget");
  if (!mount) return;

  const agentId = script?.getAttribute("data-fulcrum-agent") ?? "";
  // API origin: explicit attr, else the origin the script was served from.
  const explicit = script?.getAttribute("data-fulcrum-api");
  const api =
    explicit && explicit.length
      ? explicit
      : script?.src
        ? new URL(script.src).origin
        : "";

  renderStyles(mount);

  try {
    const res = await fetch(`${api}/v1/widget/config?agentId=${encodeURIComponent(agentId)}`);
    const cfg = (await res.json()) as WidgetConfig;
    new Widget(mount, cfg, api);
  } catch {
    mount.innerHTML = `<div style="padding:16px;font-family:system-ui;color:#a33">Fulcrum widget failed to load.</div>`;
  }
}

boot();
