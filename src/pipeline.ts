import type { Contact, SendResult } from "./types.js";
import { findLookalikes } from "./stages/ocean.js";
import { findContacts } from "./stages/prospeo.js";
import { sendEmails } from "./stages/brevo.js";

export interface PipelineOptions {
  dryRun: boolean;
  yes: boolean;
  /** Injected by index.ts after the safety checkpoint; pipeline calls this */
  onBeforeSend: (contacts: Contact[]) => Promise<boolean>;
}

export interface PipelineResult {
  companies: number;
  contacts: number;
  results: SendResult[];
}

function dedupeByEmail(contacts: Contact[]): Contact[] {
  const seen = new Set<string>();
  const unique: Contact[] = [];
  for (const c of contacts) {
    const key = c.email?.toLowerCase() ?? "";
    if (!key || seen.has(key)) {
      if (!key) console.warn(`  [pipeline] skipping contact with no email: ${c.name} (${c.domain})`);
      else console.warn(`  [pipeline] deduping duplicate email: ${c.email} (${c.name})`);
      continue;
    }
    seen.add(key);
    unique.push(c);
  }
  return unique;
}

export async function runPipeline(
  seedDomain: string,
  options: PipelineOptions
): Promise<PipelineResult> {
  const { dryRun, onBeforeSend } = options;

  // ── Stage 1: Ocean.io ──────────────────────────────────────────────────────
  console.log("\n━━━ Stage 1 / Ocean.io — finding lookalike companies ━━━");
  const companies = await findLookalikes(seedDomain);
  console.log(`  → ${companies.length} companies found`);

  // ── Stage 2: Prospeo ───────────────────────────────────────────────────────
  console.log("\n━━━ Stage 2 / Prospeo — finding decision-makers + emails ━━━");
  const contacts = await findContacts(companies);
  const dedupedContacts = dedupeByEmail(contacts);
  console.log(`  → ${dedupedContacts.length} contacts with verified emails (after dedupe)`);

  if (dedupedContacts.length === 0) {
    console.warn("  [pipeline] no contacts with emails — nothing to send");
    return { companies: companies.length, contacts: 0, results: [] };
  }

  // ── Safety checkpoint (injected from index.ts) ─────────────────────────────
  if (dryRun) {
    console.log("\n  --dry-run: stopping before send. Pipeline ran successfully.");
    return { companies: companies.length, contacts: dedupedContacts.length, results: [] };
  }

  const confirmed = await onBeforeSend(dedupedContacts);
  if (!confirmed) {
    console.log("  Aborted by user.");
    return { companies: companies.length, contacts: dedupedContacts.length, results: [] };
  }

  // ── Stage 3: Brevo ─────────────────────────────────────────────────────────
  console.log("\n━━━ Stage 3 / Brevo — sending personalized emails ━━━");
  const results = await sendEmails(dedupedContacts);

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`  → ${sent} sent, ${failed} failed`);

  return { companies: companies.length, contacts: dedupedContacts.length, results };
}
