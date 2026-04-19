import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587");
const SMTP_USER = process.env.SMTP_USER ?? "info@traveluxelondon.com";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? "Traveluxe London <info@traveluxelondon.com>";

function isConfigured(): boolean {
  return !!SMTP_PASS;
}

function createTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ sent: boolean; reason?: string }> {
  if (!isConfigured()) {
    console.warn("[Email] SMTP_PASS not set — email not sent. Add SMTP credentials to activate.");
    return { sent: false, reason: "SMTP not configured — add SMTP_PASS to activate email sending" };
  }

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: SMTP_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      replyTo: opts.replyTo ?? SMTP_USER,
    });
    console.info(`[Email] Sent "${opts.subject}" → ${opts.to}`);
    return { sent: true };
  } catch (err: any) {
    console.error("[Email] Failed to send:", err?.message ?? err);
    return { sent: false, reason: err?.message ?? "Unknown error" };
  }
}
