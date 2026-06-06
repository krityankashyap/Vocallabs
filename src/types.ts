// ── Stage 1 output / Stage 2 input ───────────────────────────────────────────
export interface Company {
  domain: string;
  name?: string;
}

// ── Stage 2 output / Stage 3 input ───────────────────────────────────────────
export interface Contact {
  name: string;
  title: string;
  linkedinUrl: string;
  domain: string;
  /** Populated by Stage 3 (Eazyreach) */
  email?: string;
}

// ── Stage 4 output ────────────────────────────────────────────────────────────
export type SendResult =
  | { status: "sent"; contact: Contact; messageId: string }
  | { status: "failed"; contact: Contact; error: string };
