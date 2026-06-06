import { postJson, HttpError } from "../lib/http.js";
import { config } from "../config.js";
import type { Company } from "../types.js";

const BASE_URL = "https://api.ocean.io";
// Fetch up to 10 lookalikes — enough for a targeted outreach run without burning credits
const LOOKALIKE_SIZE = 10;

// Domains to use when the API is unavailable on the current plan
const FALLBACK_DOMAINS: Company[] = [
  { domain: "razorpay.com",   name: "Razorpay" },
  { domain: "adyen.com",      name: "Adyen" },
  { domain: "braintree.com",  name: "Braintree" },
  { domain: "klarna.com",     name: "Klarna" },
  { domain: "mollie.com",     name: "Mollie" },
];

interface OceanCompanyRecord {
  company: { domain?: string; name?: string };
  relevance?: string;
}

interface OceanSearchResponse {
  detail: string;
  total?: number;
  creditsUsed?: number;
  searchAfter?: string;
  companies?: OceanCompanyRecord[];
}

function authHeaders() {
  return { "x-api-token": config.oceanApiToken };
}

function isPlanError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes("plan version not supported") ||
    lower.includes("not allowed to access") ||
    lower.includes("upgrade") ||
    lower.includes("subscription")
  );
}

async function searchV3(seedDomain: string): Promise<Company[]> {
  const resp = await postJson<OceanSearchResponse>(
    `${BASE_URL}/v3/search/companies`,
    {
      companiesFilters: { lookalikeDomains: [seedDomain] },
      size: LOOKALIKE_SIZE,
      fields: ["domain", "name"],
    },
    { headers: authHeaders() }
  );

  if (resp.detail !== "OK") {
    if (isPlanError(resp.detail)) throw new PlanGatedError(resp.detail);
    throw new Error(`Ocean.io v3 error: ${resp.detail}`);
  }

  const companies: Company[] = (resp.companies ?? []).flatMap((r) => {
    if (!r.company.domain) return [];
    const c: Company = { domain: r.company.domain };
    if (r.company.name) c.name = r.company.name;
    return [c];
  });

  console.log(
    `  [ocean] v3 returned ${companies.length} lookalikes ` +
      `(${resp.total ?? "?"} total, ${resp.creditsUsed ?? "?"} credits used)`
  );
  return companies;
}

class PlanGatedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PlanGatedError";
  }
}

export async function findLookalikes(seedDomain: string): Promise<Company[]> {
  // Try v3 (works on trial plan as of current testing)
  try {
    return await searchV3(seedDomain);
  } catch (err) {
    if (err instanceof PlanGatedError) {
      console.warn(`  [ocean] v3 is plan-gated: ${err.message}`);
    } else if (err instanceof HttpError && err.status === 403) {
      console.warn(`  [ocean] v3 returned 403 — plan restriction`);
    } else {
      // Unexpected error — log it and fall through to stub
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [ocean] unexpected error from v3: ${message}`);
    }
  }

  // Fall back to a hand-picked stub list so the pipeline still runs end-to-end
  console.warn(
    `  [ocean] falling back to stub company list — ` +
      `replace with a real Ocean.io plan to get live lookalikes`
  );
  return FALLBACK_DOMAINS;
}
