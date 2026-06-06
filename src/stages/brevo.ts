import pLimit from "p-limit";
import {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
  SendSmtpEmail,
  SendSmtpEmailSender,
  SendSmtpEmailToInner,
} from "@getbrevo/brevo";
import { config } from "../config.js";
import type { Contact, SendResult } from "../types.js";

const CONCURRENCY = 5;

// ── Email template ─────────────────────────────────────────────────────────────

export function renderEmailHtml(contact: Contact, senderName: string): string {
  const firstName = contact.name.split(" ")[0] ?? contact.name;
  const companyName = contact.domain.replace(/^www\./, "").split(".")[0] ?? contact.domain;
  const capitalised = companyName.charAt(0).toUpperCase() + companyName.slice(1);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:580px;margin:0 auto;padding:32px 16px">
  <p>Hi ${firstName},</p>

  <p>
    I've been following ${capitalised}'s work — the way you're approaching
    [specific pain point in their space] stands out.
  </p>

  <p>
    I'm ${senderName}, and at Vocallabs we help ${contact.title}-level leaders
    cut the time between "idea" and "live product" dramatically — without growing
    the team. A few companies similar to yours have shaved weeks off their
    release cycles in the first month.
  </p>

  <p>
    Worth a 15-minute call to see if there's a fit? I'll keep it tight and
    come with something concrete for ${capitalised} specifically.
  </p>

  <p>
    Happy to work around your schedule — just reply and I'll send a link.
  </p>

  <p>
    Best,<br>
    <strong>${senderName}</strong>
  </p>
</body>
</html>`;
}

export function renderEmailText(contact: Contact, senderName: string): string {
  const firstName = contact.name.split(" ")[0] ?? contact.name;
  const companyName = contact.domain.replace(/^www\./, "").split(".")[0] ?? contact.domain;
  const capitalised = companyName.charAt(0).toUpperCase() + companyName.slice(1);

  return [
    `Hi ${firstName},`,
    ``,
    `I've been following ${capitalised}'s work — the way you're approaching`,
    `[specific pain point in their space] stands out.`,
    ``,
    `I'm ${senderName}, and at Vocallabs we help ${contact.title}-level leaders`,
    `cut the time between "idea" and "live product" dramatically — without growing`,
    `the team. A few companies similar to yours have shaved weeks off their`,
    `release cycles in the first month.`,
    ``,
    `Worth a 15-minute call to see if there's a fit? I'll keep it tight and`,
    `come with something concrete for ${capitalised} specifically.`,
    ``,
    `Happy to work around your schedule — just reply and I'll send a link.`,
    ``,
    `Best,`,
    senderName,
  ].join("\n");
}

// ── Stage 4 ────────────────────────────────────────────────────────────────────

export async function sendEmails(contacts: Contact[]): Promise<SendResult[]> {
  const api = new TransactionalEmailsApi();
  api.setApiKey(TransactionalEmailsApiApiKeys.apiKey, config.brevoApiKey);

  const sender = new SendSmtpEmailSender();
  sender.name = config.brevoSenderName;
  sender.email = config.brevoSenderEmail;

  const limit = pLimit(CONCURRENCY);

  const tasks = contacts.map((contact) =>
    limit(async (): Promise<SendResult> => {
      if (!contact.email) {
        console.warn(`  [brevo] skipping ${contact.name} — no email address`);
        return { status: "failed", contact, error: "no email address" };
      }

      try {
        const to = new SendSmtpEmailToInner();
        to.email = contact.email;
        to.name = contact.name;

        const email = new SendSmtpEmail();
        email.sender = sender;
        email.to = [to];
        email.subject = `Quick question about ${contact.domain}`;
        email.htmlContent = renderEmailHtml(contact, config.brevoSenderName);
        email.textContent = renderEmailText(contact, config.brevoSenderName);
        email.params = {
          FIRSTNAME: contact.name.split(" ")[0] ?? contact.name,
          TITLE: contact.title,
          DOMAIN: contact.domain,
        };
        email.tags = ["outreach-pipeline"];

        const { body } = await api.sendTransacEmail(email);
        const messageId = body.messageId ?? body.messageIds?.[0] ?? "unknown";

        console.log(`  [brevo] sent → ${contact.name} <${contact.email}> (${messageId})`);
        return { status: "sent", contact, messageId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [brevo] failed → ${contact.name} <${contact.email}>: ${message}`);
        return { status: "failed", contact, error: message };
      }
    })
  );

  return Promise.all(tasks);
}
