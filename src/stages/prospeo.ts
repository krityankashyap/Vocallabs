import pLimit from "p-limit";
import { postJson } from "../lib/http.js";
import { config } from "../config.js";
import type { Company, Contact } from "../types.js";

const BASE_URL = "https://api.prospeo.io";
// Outer concurrency: simultaneous company fan-outs
const COMPANY_CONCURRENCY = 3;
// Inner concurrency: simultaneous enrich calls per batch
const ENRICH_CONCURRENCY = 5;
const MAX_PAGES = 3;

const SENIORITIES = ["C-Suite", "Vice President", "Founder/Owner", "Director"];

// ── API types ─────────────────────────────────────────────────────────────────

interface ProspeoPersonRecord {
  person: {
    person_id?: string;
    full_name?: string;
    current_job_title?: string;
    linkedin_url?: string;
  };
  company?: {
    name?: string;
    website?: string;
  };
}

interface ProspeoSearchResponse {
  error: boolean;
  message?: string;
  results?: ProspeoPersonRecord[];
  pagination?: {
    current_page: number;
    per_page: number;
    total_page: number;
    total_count: number;
  };
}

interface ProspeoEnrichResponse {
  error: boolean;
  message?: string;
  person?: {
    email?: {
      status?: string;
      revealed?: boolean;
      email?: string;
    };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders() {
  return { "X-KEY": config.prospeoApiKey };
}

function stripWww(domain: string): string {
  return domain.replace(/^www\./, "");
}

// ── Search (step 1 of 2) ──────────────────────────────────────────────────────

async function fetchPage(domain: string, page: number): Promise<ProspeoSearchResponse> {
  return postJson<ProspeoSearchResponse>(
    `${BASE_URL}/search-person`,
    {
      page,
      filters: {
        company: {
          websites: { include: [stripWww(domain)] },
        },
        person_seniority: {
          include: SENIORITIES,
        },
      },
    },
    { headers: authHeaders() }
  );
}

// ── Enrich (step 2 of 2) — get email by person_id ────────────────────────────

async function fetchEmail(personId: string): Promise<string | null> {
  try {
    const res = await postJson<ProspeoEnrichResponse>(
      `${BASE_URL}/enrich-person`,
      { data: { person_id: personId }, only_verified_email: false },
      { headers: authHeaders() }
    );

    if (res.error) {
      console.warn(`  [prospeo] enrich error for person_id ${personId}: ${res.message ?? "unknown"}`);
      return null;
    }

    const email = res.person?.email?.email;
    return email ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [prospeo] enrich failed for person_id ${personId}: ${message}`);
    return null;
  }
}

// ── Per-company pipeline ──────────────────────────────────────────────────────

async function contactsForDomain(company: Company, enrichLimit: ReturnType<typeof pLimit>): Promise<Contact[]> {
  const domain = company.domain;
  const rawRecords: ProspeoPersonRecord[] = [];

  try {
    const first = await fetchPage(domain, 1);

    if (first.error) {
      console.warn(`  [prospeo] search error for ${domain}: ${first.message ?? "unknown"}`);
      return [];
    }

    const totalPages = Math.min(first.pagination?.total_page ?? 1, MAX_PAGES);
    console.log(
      `  [prospeo] ${domain} — ${first.pagination?.total_count ?? (first.results?.length ?? 0)} match(es), ` +
        `fetching ${totalPages} page(s)`
    );

    rawRecords.push(...(first.results ?? []));

    for (let page = 2; page <= totalPages; page++) {
      const resp = await fetchPage(domain, page);
      if (resp.error) {
        console.warn(`  [prospeo] error on page ${page} for ${domain} — stopping`);
        break;
      }
      rawRecords.push(...(resp.results ?? []));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [prospeo] skipping ${domain}: ${message}`);
    return [];
  }

  // Fan-out enrich calls concurrently, skip anyone whose email can't be resolved
  const enrichTasks = rawRecords.map((record) =>
    enrichLimit(async (): Promise<Contact | null> => {
      const { person } = record;
      const { person_id, full_name, current_job_title, linkedin_url } = person;

      if (!person_id || !full_name || !current_job_title) {
        console.warn(
          `  [prospeo] skipping incomplete record for ${domain}: ` +
            `id=${person_id ?? "—"} name=${full_name ?? "—"} title=${current_job_title ?? "—"}`
        );
        return null;
      }

      const email = await fetchEmail(person_id);
      if (!email) {
        console.warn(`  [prospeo] no email resolved for ${full_name} (${domain}) — skipping`);
        return null;
      }

      return {
        name: full_name,
        title: current_job_title,
        linkedinUrl: linkedin_url ?? "",
        domain,
        email,
      };
    })
  );

  const settled = await Promise.all(enrichTasks);
  return settled.filter((c): c is Contact => c !== null);
}

// ── Stage 2 export ────────────────────────────────────────────────────────────

export async function findContacts(companies: Company[]): Promise<Contact[]> {
  const companyLimit = pLimit(COMPANY_CONCURRENCY);
  const enrichLimit = pLimit(ENRICH_CONCURRENCY);

  const results = await Promise.all(
    companies.map((c) => companyLimit(() => contactsForDomain(c, enrichLimit)))
  );

  const all = results.flat();
  console.log(
    `  [prospeo] ${all.length} contact(s) with verified emails across ${companies.length} company/companies`
  );
  return all;
}
