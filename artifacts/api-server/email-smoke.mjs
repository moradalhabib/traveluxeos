import nodemailer from "nodemailer";
const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587");
const USER = process.env.SMTP_USER ?? "notifications@traveluxelondon.com";
const PASS = process.env.SMTP_PASS ?? "";
console.log(`[smoke] host=${SMTP_HOST} port=${SMTP_PORT} user=${USER} pass_set=${!!PASS} pass_len=${PASS.length}`);
if (!PASS) { console.error("[smoke] SMTP_PASS not set"); process.exit(1); }
const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: USER, pass: PASS }});
try {
  const v = await t.verify();
  console.log("[smoke] verify() OK →", v);
} catch (e) {
  console.error("[smoke] verify() FAILED:", e?.message ?? e);
  process.exit(2);
}
