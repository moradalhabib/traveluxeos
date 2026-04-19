import nodemailer, { type Transporter } from "nodemailer";

// ─────────────────────────────────────────────────────────────────────────────
// Two-account SMTP configuration.
//
//   • 'invoice' account  → notifications@traveluxelondon.com
//     Used strictly for client-facing transactional emails:
//     booking confirmations, invoices, payment receipts.
//
//   • 'system' account   → info@traveluxelondon.com
//     Used for everything else: backups, daily digests, internal
//     operator notifications, anything to do with the app.
//
// Replies on every email are routed to info@traveluxelondon.com so the
// monitored inbox always receives client responses.
// ─────────────────────────────────────────────────────────────────────────────

const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587");
const SMTP_REPLY_TO = process.env.SMTP_REPLY_TO ?? "info@traveluxelondon.com";

// Invoice (notifications@) account
const SMTP_USER_INVOICE = process.env.SMTP_USER ?? "notifications@traveluxelondon.com";
const SMTP_PASS_INVOICE = process.env.SMTP_PASS ?? "";
const SMTP_FROM_INVOICE =
  process.env.SMTP_FROM ?? "Traveluxe London <notifications@traveluxelondon.com>";

// System (info@) account
const SMTP_USER_SYSTEM = process.env.SMTP_USER_INFO ?? "info@traveluxelondon.com";
const SMTP_PASS_SYSTEM = process.env.SMTP_PASS_INFO ?? "";
const SMTP_FROM_SYSTEM =
  process.env.SMTP_FROM_INFO ?? "Traveluxe London <info@traveluxelondon.com>";

export type EmailAccount = "invoice" | "system";

function accountConfig(account: EmailAccount) {
  return account === "invoice"
    ? { user: SMTP_USER_INVOICE, pass: SMTP_PASS_INVOICE, from: SMTP_FROM_INVOICE }
    : { user: SMTP_USER_SYSTEM, pass: SMTP_PASS_SYSTEM, from: SMTP_FROM_SYSTEM };
}

function isConfigured(account: EmailAccount): boolean {
  return !!accountConfig(account).pass;
}

const transporters: Partial<Record<EmailAccount, Transporter>> = {};

function getTransporter(account: EmailAccount): Transporter {
  const cached = transporters[account];
  if (cached) return cached;
  const cfg = accountConfig(account);
  const t = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  transporters[account] = t;
  return t;
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  /**
   * Which mailbox to send FROM.
   *   • 'invoice' → notifications@ (client-facing invoices/receipts/confirmations)
   *   • 'system'  → info@ (backups, digests, internal app notifications)
   * Defaults to 'system' to err on the side of the monitored mailbox.
   */
  account?: EmailAccount;
}

export async function sendEmail(
  opts: SendEmailOptions,
): Promise<{ sent: boolean; reason?: string }> {
  const account: EmailAccount = opts.account ?? "system";

  if (!isConfigured(account)) {
    const envKey = account === "invoice" ? "SMTP_PASS" : "SMTP_PASS_INFO";
    console.warn(
      `[Email] ${envKey} not set — '${account}' account email not sent. Add SMTP credentials to activate.`,
    );
    return {
      sent: false,
      reason: `SMTP '${account}' account not configured — add ${envKey} to activate`,
    };
  }

  try {
    const transporter = getTransporter(account);
    const cfg = accountConfig(account);
    await transporter.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo ?? SMTP_REPLY_TO,
      attachments: opts.attachments,
    });
    console.info(`[Email:${account}] Sent "${opts.subject}" → ${opts.to}`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[Email:${account}] Failed to send:`, err?.message ?? err);
    return { sent: false, reason: err?.message ?? "Unknown error" };
  }
}
