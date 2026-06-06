# CLAUDE.md — Automated Outreach Pipeline

## Project
A single-command CLI that takes ONE seed company domain and runs a fully
automated cold-outreach pipeline end to end. Zero human steps after the input,
except one safety checkpoint immediately before emails are sent. This is a
Vocallabs SDE take-home — treat it as a production-grade, shippable product, not
a throwaway script.

## The pipeline (data flow)
One input, four stages. Every stage's output is the next stage's input — that
hand-off-free chain is the entire point of the assignment.

1. **Ocean.io**   — seed domain → lookalike company domains
2. **Prospeo**    — company domains → decision-makers (C-suite / VP) + LinkedIn URLs
3. **Eazyreach**  — LinkedIn URLs → verified work emails
4. **Brevo**      — personalized outreach emails sent

Data shape through the pipeline:
`string  →  Company[]  →  Contact[]  →  Contact[] (with email)  →  SendResult[]`

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
├── .env.example         # documents the shape, committed
├── .gitignore           # must ignore .env, node_modules, dist
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts         # CLI entry: parse domain + flags, run pipeline, checkpoint
    ├── pipeline.ts      # orchestrates the 4 stages in order
    ├── config.ts        # loads + validates env at boot (fail fast)
    ├── types.ts         # shared types (Company, Contact, SendResult)
    ├── lib/
    │   └── http.ts      # single fetch wrapper: retries, backoff, typed errors
    └── stages/
        ├── ocean.ts     # stage 1
        ├── prospeo.ts   # stage 2
        ├── eazyreach.ts # stage 3
        └── brevo.ts     # stage 4
```

## Conventions (non-negotiable)
- One stage = one module = one exported async function, all sharing the same
  input→output contract shape.
- ALL external HTTP goes through `lib/http.ts`. No raw `fetch` inside stages.
- Env/config validated at boot in `config.ts`; throw a clear, specific error if a
  required key is missing. Fail fast, never half-run.
- Never hardcode secrets. Read from `process.env` only.
- Per-record failures **skip-and-continue** — a missing contact or one bad
  company must never crash the whole run. Log every skipped item.
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
- Endpoint: `POST /v2/search/companies`, body
  `{ size, companiesFilters: { lookalikeDomains: [...] }, fields: [...] }`.
- Credits consumed per result. Pagination via `size` / `from` / `searchAfter`.
- **KNOWN ISSUE:** on the free 14-day trial this endpoint returns
  `"Plan version not supported for this endpoint"`. The token is valid; the
  endpoint is plan-gated. Mitigation: try the lookalike **preview** endpoint
  (see app.ocean.io/docs), and if it's also unavailable, the stage must fall back
  to a clearly-logged STUB list of domains so the rest of the pipeline still runs
  end to end. The pipeline must not be hard-blocked by this.

### Prospeo  (stage 2)
- Docs: app.prospeo.io/api-docs (search-person, search-company).
- Verify the exact auth header in the docs before coding.
- Pagination via `page`; 25 results per page; 1 credit per request that returns
  at least one result.
- Filter by company website/domain + seniority / jobTitles to surface
  C-suite/VP. Map each result to `Contact { name, title, linkedinUrl, domain }`.

### Eazyreach  (stage 3)
- No public API docs; access is provisioned manually (via WhatsApp) and the
  account currently has 0 credits.
- **STUB this stage for now**: return each contact with a deterministic
  placeholder email so the pipeline runs end to end. Keep the function signature
  identical to the real one so dropping the live call in later is trivial.
- When live: LinkedIn URL → verified work email; credit charged only on success.

### Brevo  (stage 4)
- Docs: developers.brevo.com; SDK `@getbrevo/brevo`.
- Auth: header `api-key: <key>`.
- Send via `TransactionalEmailsApi` + `SendSmtpEmail`; personalize using `params`;
  response returns a `messageId`.
- Free tier: 300 emails/day. Sender and sending domain (krityanmydomain.me) are
  already verified and authenticated (SPF/DKIM/DMARC pass).
- Verify key: `GET https://api.brevo.com/v3/account` with the `api-key` header.
- **DURING TESTING: only send to your own addresses, never the real prospects.**

## Safety checkpoint (required)
Before stage 4 fires, print: recipient count, the full list (name / email /
company), and one fully-rendered sample email. Require explicit confirmation to
proceed. Flags:
- `--dry-run` — run everything up to sending, then stop.
- `--yes` — skip the confirmation prompt (for the fully-automated demo path).
This gate is explicitly graded as "good judgment."

## Evaluation criteria (optimize for these)
- Runs end to end from one domain — zero manual steps after the input.
- Auth, pagination, and error handling correct against each real API.
- Clean, modular code — one stage is one clear, separable unit.
- Resilient to messy data — missing contacts, rate limits, partial failures don't
  crash the run.
- Good judgment — safety checkpoint + sensible defaults throughout.
- Bonus — sharp, personalized email copy you'd actually open.

## Commands
- `npm run dev -- stripe.com`            → run the full pipeline
- `npm run dev -- stripe.com --dry-run`  → stop before sending
- `npm run dev -- stripe.com --yes`      → run fully automated, no prompt

## Security
- `.env` is gitignored and never committed. `.env.example` documents the shape.
- If any key is ever exposed, regenerate it immediately and update `.env`.
