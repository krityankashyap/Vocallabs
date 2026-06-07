# CLAUDE.md — Automated Outreach Pipeline

## Project
A single-command CLI that takes ONE seed company domain and runs a fully
automated cold-outreach pipeline end to end. Zero human steps after the input,
except one safety checkpoint immediately before emails are sent. This is a
Vocallabs SDE take-home — treat it as a production-grade, shippable product, not
a throwaway script.

## Architecture note (read this)
The assignment originally specified four tools, with **Eazyreach** resolving
LinkedIn URLs into verified emails. The Vocallabs team has since confirmed they
cannot provision Eazyreach credits and instructed candidates to **use Prospeo as
the replacement** — Prospeo finds the people, their LinkedIn URLs, AND their work
emails. So this pipeline is **three stages, not four. Eazyreach is removed.**

## The pipeline (data flow)
One input, three stages. Every stage's output is the next stage's input — that
hand-off-free chain is the entire point of the assignment.

1. **Ocean.io**  — seed domain → lookalike company domains
2. **Prospeo**   — company domains → decision-makers (C-suite/VP) + LinkedIn URLs
                   + verified work emails
3. **Brevo**     — personalized outreach emails sent

Data shape through the pipeline:
`string  →  Company[]  →  Contact[] (name, title, linkedinUrl, email)  →  SendResult[]`

## Tech stack
- Language: **TypeScript** (strict mode), Node 20+, ESM
- Run: **tsx** (run .ts directly, no build step in dev)
- HTTP: native **fetch**
- Resilience: **p-retry** (exponential backoff), **p-limit** (concurrency control)
- CLI: **commander** (args/flags), **@inquirer/prompts** (confirmation gate)
- Email SDK: **@getbrevo/brevo**
- Config: **dotenv**

## Project structure
```
outreach-pipeline/
├── .env                 # real keys — gitignored, never committed
├── .env.example         # documents the shape, COMMITTED (not gitignored)
├── .gitignore           # ignores .env, node_modules, dist
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts         # CLI entry: parse domain + flags, run pipeline, checkpoint
    ├── pipeline.ts      # orchestrates the 3 stages in order
    ├── config.ts        # loads + validates env at boot (fail fast)
    ├── types.ts         # shared types (Company, Contact, SendResult)
    ├── lib/
    │   └── http.ts      # single fetch wrapper: retries, backoff, typed errors
    └── stages/
        ├── ocean.ts     # stage 1
        ├── prospeo.ts   # stage 2 — people + LinkedIn + email
        └── brevo.ts     # stage 3
```
There is NO `eazyreach.ts`.

## Conventions (non-negotiable)
- One stage = one module = one exported async function, all sharing the same
  input→output contract shape.
- ALL external HTTP goes through `lib/http.ts`. No raw `fetch` inside stages.
- Env/config validated at boot in `config.ts`; throw a clear, specific error if a
  required key is missing. Fail fast, never half-run.
- Never hardcode secrets. Read from `process.env` only.
- Per-record failures **skip-and-continue** — a missing contact, a person with no
  resolvable email, or one bad company must never crash the whole run. Log every
  skipped item.
- Dedupe contacts by email before the Brevo stage.
- Types live in `types.ts` and flow between stages.

## Stage notes & API specifics
Half the job is reading each tool's docs (auth, endpoints, request/response
shapes, limits). Notes below capture what's already known — verify the rest in
each tool's docs.

### Ocean.io  (stage 1)
- Token: Settings → API tokens.
- Auth: header `x-api-token: <token>` OR query `?apiToken=<token>`.
  **NOT** `Authorization: Bearer`. Never send both (returns a conflict error).
- Endpoint: `POST /v3/search/companies` (v2 is plan-gated on the free trial and
  returns `"Plan version not supported for this endpoint"`).
- Credits consumed per result. Pagination via `size` / `from` / `searchAfter`.
- **KNOWN ISSUE:** on the free 14-day trial, the lookalike search may be
  plan-gated. The token is valid; the endpoint is gated. The stage must catch a
  plan/403 error and fall back to a clearly-logged STUB list of domains so the
  rest of the pipeline still runs end to end. The pipeline must not be
  hard-blocked by this.

### Prospeo  (stage 2 — now does the work Eazyreach used to)
- Docs: app.prospeo.io/api-docs. Auth header: confirm exact header in docs
  (commonly `X-KEY`).
- This stage produces Contacts WITH emails. There are two possible shapes —
  **check the docs and implement whichever applies:**
  - **(A) Email inline:** if the people-search endpoint (`search-person` /
    domain-search) returns an email field directly, map it into Contact.email.
  - **(B) Two-step:** if search returns the person + LinkedIn URL but the email
    must be resolved separately, make a second Prospeo call — its email-finder
    (by name + company domain) or its LinkedIn-URL→email endpoint — to fill in
    Contact.email. This is the direct Eazyreach replacement.
- Pagination via `page`; ~25 results per page; credits charged per successful
  request/reveal. Filter to C-suite / VP seniority.
- Concurrency-limit the fan-out across companies (and across email lookups, if
  two-step) with p-limit. Skip-and-continue on any person whose email can't be
  resolved — they simply don't get emailed.
- Map each result to `Contact { name, title, linkedinUrl, domain, email }`.

### Brevo  (stage 3)
- Docs: developers.brevo.com; SDK `@getbrevo/brevo`.
- Auth: header `api-key: <key>`.
- Send via `TransactionalEmailsApi` + `SendSmtpEmail`; personalize using `params`;
  response returns a `messageId`.
- Free tier: 300 emails/day. Sender and sending domain (krityanmydomain.me) are
  already verified and authenticated (SPF/DKIM/DMARC pass).
- Verify key: `GET https://api.brevo.com/v3/account` with the `api-key` header.
- **DURING TESTING: only send to your own addresses, never the real prospects.**
  Use `--dry-run` while developing.

## Safety checkpoint (required)
Before stage 3 fires, print: recipient count, the full list (name / email /
company), and one fully-rendered sample email. Require explicit confirmation to
proceed. Flags:
- `--dry-run` — run everything up to sending, then stop.
- `--yes` — skip the confirmation prompt (for the fully-automated demo path).
This gate is explicitly graded as "good judgment."

## Evaluation criteria (optimize for these)
- Runs end to end from one domain — zero manual steps after the input.
- Auth, pagination, and error handling correct against each real API.
- Clean, modular code — one stage is one clear, separable unit.
- Resilient to messy data — missing contacts, unresolvable emails, rate limits,
  partial failures don't crash the run.
- Good judgment — safety checkpoint + sensible defaults throughout.
- Bonus — sharp, personalized email copy you'd actually open.

## Commands
- `npm run dev -- stripe.com`            → run the full pipeline
- `npm run dev -- stripe.com --dry-run`  → stop before sending
- `npm run dev -- stripe.com --yes`      → run fully automated, no prompt

## Security
- `.env` is gitignored and never committed. `.env.example` documents the shape
  and IS committed.
- If any key is ever exposed, regenerate it immediately and update `.env`.