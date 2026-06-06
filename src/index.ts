import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { config } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { renderEmailText } from "./stages/brevo.js";
import type { Contact } from "./types.js";

// Suppress dotenv noise — config.ts already loaded it
void config;

async function checkpointBeforeSend(
  contacts: Contact[],
  autoYes: boolean
): Promise<boolean> {
  console.log("\n" + "═".repeat(60));
  console.log("  SAFETY CHECKPOINT — review before sending");
  console.log("═".repeat(60));
  console.log(`\n  Recipients (${contacts.length}):\n`);

  for (const c of contacts) {
    console.log(`  • ${c.name} — ${c.title}`);
    console.log(`    ${c.email}  (${c.domain})`);
  }

  const sample = contacts[0];
  if (sample) {
    console.log("\n  ── Sample email (first recipient) ──────────────────\n");
    console.log(`  Subject: Quick question about ${sample.domain}\n`);
    renderEmailText(sample, config.brevoSenderName)
      .split("\n")
      .forEach((l) => console.log("  " + l));
  }

  console.log("\n" + "═".repeat(60));

  if (autoYes) {
    console.log("  --yes flag set — proceeding automatically.\n");
    return true;
  }

  return confirm({ message: `Send to all ${contacts.length} recipient(s)?` });
}

const program = new Command();

program
  .name("outreach-pipeline")
  .description("Automated cold-outreach: Ocean.io → Prospeo → Eazyreach → Brevo")
  .argument("<domain>", "Seed company domain (e.g. stripe.com)")
  .option("--dry-run", "Run all stages but skip sending", false)
  .option("--yes", "Skip the confirmation prompt before sending", false)
  .action(async (domain: string, opts: { dryRun: boolean; yes: boolean }) => {
    console.log(`\n  Outreach Pipeline`);
    console.log(`  Seed domain : ${domain}`);
    console.log(`  Dry run     : ${opts.dryRun}`);
    console.log(`  Auto-confirm: ${opts.yes}`);

    try {
      const result = await runPipeline(domain, {
        dryRun: opts.dryRun,
        yes: opts.yes,
        onBeforeSend: (contacts: Contact[]) =>
          checkpointBeforeSend(contacts, opts.yes),
      });

      console.log("\n━━━ Pipeline complete ━━━");
      console.log(`  Companies   : ${result.companies}`);
      console.log(`  Contacts    : ${result.contacts}`);
      console.log(`  With emails : ${result.enriched}`);
      console.log(`  Sent        : ${result.results.filter((r) => r.status === "sent").length}`);
      console.log(`  Failed      : ${result.results.filter((r) => r.status === "failed").length}\n`);
    } catch (err) {
      if (err instanceof Error) {
        console.error("\n  [error]", err.message);
      } else {
        console.error("\n  [error]", err);
      }
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
