# Legal review pack — buyer consent

> **This is not legal advice.** The documents here are engineering drafts that
> implement the *technical* requirements of consent capture. A licensed
> attorney must review and approve them (and the widget copy) before any real
> consumer data is collected. Nothing in this repo has been reviewed by counsel.

## What engineering has done

| Requirement | Implementation |
|---|---|
| Prove **what** the consumer agreed to | Terms are versioned (`termsVersion`) and content-hashed (`termsHash`, SHA-256). The exact text served is reproducible from `docs/legal/`. |
| Prove **when** and **from where** | `Consent.capturedAt`, `Consent.ip`, `Consent.userAgent`. |
| Prove **which channels** | `Consent.channelOptIns` = `{ email, sms, tcpa }`, captured as **separate, unbundled, default-off** checkboxes (TCPA is never bundled with email/SMS). |
| Consent is **required** | `BuyerLead.consentId` is a non-null FK — a lead cannot exist without a consent row. |
| Consent is **immutable** | Consent rows are only ever created, never updated, by application code. |
| Consumer can see it | The disclosure and links are rendered inline in the widget before submit. |

## What counsel must review

1. **TCPA** — the autodialer/prerecorded-call disclosure wording, and whether
   your intended calling/texting behavior requires **one-to-one** consent
   naming the specific agent/business. Confirm the current per-agent framing
   is sufficient, and confirm revocation handling.
2. **CAN-SPAM / email** — sender identification, physical postal address in
   marketing email, and unsubscribe mechanics (not yet built — see gaps).
3. **State privacy laws** — TX (Data Privacy & Security Act), CA (CCPA/CPRA),
   plus CO/VA/CT/OR/UT as applicable: notice at collection, purpose limitation,
   and the consumer rights workflow (access/delete/opt-out).
4. **Real-estate/brokerage rules** — any state-specific advertising or
   solicitation disclosures required of a licensed agent.
5. **Data retention** — how long buyer PII is kept, and deletion on request.
6. **Seller-side data** — confirm the public-records-only posture (no FCRA
   credit data, no bank data) is documented to counsel's satisfaction.

## Known gaps (engineering, not yet built)

- No **revocation / unsubscribe** endpoint or suppression list.
- No **consumer rights** (access / delete) workflow.
- No **retention policy** enforcement or automated purge.
- Terms/privacy are drafts and are **not** displayed as a separate,
  independently-linkable public page yet (they're served by the API and linked
  from the widget).

## Versioning

Each disclosure file is named `<doc>-<version>.md`. The version string in the
filename is what lands in `Consent.termsVersion`; the SHA-256 of the file's
contents is what lands in `Consent.termsHash`. Never edit a published version
in place — add a new one, so old consents keep proving what was actually shown.
