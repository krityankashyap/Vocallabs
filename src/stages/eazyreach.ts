import type { Contact } from "../types.js";

// Stage 3 stub — Eazyreach account has 0 credits until provisioned via WhatsApp.
// The real call is: LinkedIn URL → verified work email (credit charged on success only).
// To go live: replace the body of enrichContact() with the actual API call.
// Function signature and surrounding skip-and-continue logic stay identical.

const BASE_URL = "https://api.eazyreach.io"; // placeholder — confirm when provisioned
void BASE_URL;

async function enrichContact(contact: Contact): Promise<Contact> {
  // --- LIVE IMPLEMENTATION (drop in when credits are provisioned) ---
  // const res = await postJson<{ email?: string }>(
  //   `${BASE_URL}/v1/enrich`,
  //   { linkedin_url: contact.linkedinUrl },
  //   { headers: { Authorization: `Bearer ${config.eazyreachApiKey}` } }
  // );
  // if (!res.email) throw new Error("no email returned");
  // return { ...contact, email: res.email };
  // -----------------------------------------------------------------

  const domain = contact.domain.replace(/\./g, "_");
  const slug = contact.name.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z.]/g, "");
  return { ...contact, email: `${slug}@${domain}.stub` };
}

export async function enrichWithEmails(contacts: Contact[]): Promise<Contact[]> {
  const enriched: Contact[] = [];

  for (const contact of contacts) {
    try {
      enriched.push(await enrichContact(contact));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [eazyreach] skipping ${contact.name} (${contact.domain}): ${message}`);
    }
  }

  return enriched;
}
