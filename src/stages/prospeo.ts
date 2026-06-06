import pLimit from "p-limit";
import { postJson } from "../lib/http.js";
import { config } from "../config.js";
import type { Company, Contact } from "../types.js";

const BASE_URL = "https://api.prospeo.io";
const CONCURRENCY = 3;
// Max pages per domain — keeps credit spend predictable (3 × 25 = 75 contacts max per company)
const MAX_PAGES = 3;

const SENIORITIES = ["C-Suite", "Vice President", "Founder/Owner", "Director"];

interface ProspeoPersonRecord {
  person: {
    name?: string;
    title?: string;
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

function authHeaders() {
  return { "X-KEY": config.prospeoApiKey };
}

function stripWww(domain: string): string {
  return domain.replace(/^www\./, "");
}

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

async function contactsForDomain(company: Company): Promise<Contact[]> {
  const domain = company.domain;
  const contacts: Contact[] = [];

  try {
    // Fetch first page to learn total_page count
    const first = await fetchPage(domain, 1);

    if (first.error) {
      console.warn(`  [prospeo] API error for ${domain}: ${first.message ?? "unknown"}`);
      return [];
    }

    const records = first.results ?? [];
    const totalPages = Math.min(first.pagination?.total_page ?? 1, MAX_PAGES);

    console.log(
      `  [prospeo] ${domain} — ${first.pagination?.total_count ?? records.length} total match(es), ` +
        `fetching ${totalPages} page(s)`
    );

    for (const record of records) {
      const contact = toContact(record, domain);
      if (contact) contacts.push(contact);
    }

    // Fetch remaining pages sequentially (avoid hammering rate limits)
    for (let page = 2; page <= totalPages; page++) {
      const resp = await fetchPage(domain, page);
      if (resp.error) {
        console.warn(`  [prospeo] error on page ${page} for ${domain} — stopping pagination`);
        break;
      }
      for (const record of resp.results ?? []) {
        const contact = toContact(record, domain);
        if (contact) contacts.push(contact);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [prospeo] skipping ${domain}: ${message}`);
  }

  return contacts;
}

function toContact(record: ProspeoPersonRecord, domain: string): Contact | null {
  const { person } = record;
  if (!person.name || !person.title || !person.linkedin_url) {
    console.warn(
      `  [prospeo] skipping incomplete record for ${domain}: ` +
        `name=${person.name ?? "—"} title=${person.title ?? "—"} linkedin=${person.linkedin_url ?? "—"}`
    );
    return null;
  }
  return {
    name: person.name,
    title: person.title,
    linkedinUrl: person.linkedin_url,
    domain,
  };
}

export async function findContacts(companies: Company[]): Promise<Contact[]> {
  const limit = pLimit(CONCURRENCY);

  const results = await Promise.all(
    companies.map((c) =>
      limit(() => contactsForDomain(c))
    )
  );

  const all = results.flat();
  console.log(`  [prospeo] ${all.length} contact(s) found across ${companies.length} company/companies`);
  return all;
}
