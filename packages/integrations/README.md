# Follow Up Boss integration

Two directions:

| Script | Direction | What it does |
|---|---|---|
| `sync:fub` | Fulcrum → FUB | Pushes a buyer + their matched likely-to-list homes into FUB as a Person + Note |
| `import:fub` | FUB → Fulcrum | Brings your existing contacts in as BuyerLeads so the match layer has real demand |

## Getting a Follow Up Boss API key

1. Log in to Follow Up Boss as an **account owner** (admins can't always see this).
2. Go to **Admin → API** — direct link: `https://app.followupboss.com/2/api`
3. Click **Create API Key**, name it `Fulcrum`, and copy the key. It's shown once.
4. Export it before running:

```bash
export FUB_API_KEY="your-key-here"
```

The key is account-wide and read/write, so treat it like a password — it stays in your
shell or a secrets manager, never in the repo.

## Importing your contacts

Always dry-run first — it prints exactly what would be written and changes nothing:

```bash
# see the plan
FUB_API_KEY=… pnpm --filter @fulcrum/integrations import:fub \
  --agent <agentId> --stage "Lead" --limit 50 --dry-run

# then do it
FUB_API_KEY=… pnpm --filter @fulcrum/integrations import:fub \
  --agent <agentId> --stage "Lead" --limit 50
```

Find your `agentId` with `GET /v1/me` (or the seeded demo agent in the database).
`--stage` is optional and filters to a FUB stage (e.g. `Lead`, `Active Client`).

## How consent is handled

These people never filled out a Fulcrum form, so **we do not mint a Fulcrum consent
receipt for them.** Instead each imported lead gets a Consent row recording where the
relationship actually came from:

- `termsVersion: "imported:followupboss"` — plainly not one of our terms versions
- `toolSource: "followupboss:person:<id>"` — provenance back to the FUB record
- `ip: "imported"` — no browser capture, and we don't pretend otherwise

Channel permissions are **safe-by-default**:

- **Email / SMS** — permitted only if the contact has that address *and* FUB doesn't
  report an opt-out. Unknown is treated as not permitted.
- **TCPA** (autodialer / prerecorded calls) — **never** inferred. It requires express
  written consent, which a CRM record doesn't establish. Always imported as `false`.
- Contacts with no reachable channel are skipped and reported, not imported.

Readiness is imported as `0` — Fulcrum only scores readiness from answers a buyer gave,
and an imported contact hasn't given any. It rises when they use one of your tools.

Re-running is idempotent: a FUB person already imported is skipped, never duplicated.

> Importing contacts doesn't grant you consent you didn't already have. You're
> responsible for the permissions attached to your own CRM records; this tool records
> them faithfully rather than upgrading them.
