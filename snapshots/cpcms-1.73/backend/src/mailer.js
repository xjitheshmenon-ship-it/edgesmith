// Email via SMTP — designed for the mailbox that comes with the Hostinger plan
// (create e.g. noreply@edgesmith.in in hPanel → Emails, put its credentials in
// .env). Any standard SMTP works the same way. If SMTP_* is not set, mail
// features stay off and the app falls back to hand-over passwords.
import nodemailer from "nodemailer";

export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transport = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const APP_URL = () => (process.env.APP_URL || "https://cpcms.edgesmith.in").replace(/\/$/, "");
const FROM = () => process.env.MAIL_FROM || `Edgesmith CPCMS <${process.env.SMTP_USER}>`;

const shell = (title, body, cta, link) => `
<div style="font-family:'IBM Plex Sans','Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:28px 8px;color:#12161C">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
    <span style="display:inline-block;width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#4C6BFF 0%,#2F4BD8 55%,#6E3BE0 100%);color:#fff;text-align:center;line-height:34px;font-weight:700;font-size:18px">e</span>
    <span style="font-size:17px;font-weight:600">edgesmith<span style="color:#6E3BE0">.</span> <span style="font-size:11px;letter-spacing:.08em;color:#6B7583">CPCMS</span></span>
  </div>
  <div style="border:1px solid #E2E6EC;border-radius:12px;padding:24px 26px">
    <div style="font-size:18px;font-weight:600;margin-bottom:10px">${title}</div>
    <div style="font-size:14px;line-height:1.65;color:#3D4653">${body}</div>
    <a href="${link}" style="display:inline-block;margin-top:18px;padding:11px 20px;border-radius:7px;background:linear-gradient(135deg,#4C6BFF 0%,#2F4BD8 55%,#6E3BE0 100%);color:#fff;font-size:14px;font-weight:600;text-decoration:none">${cta}</a>
    <div style="font-size:12px;color:#8A93A1;margin-top:16px;line-height:1.6">If the button does not work, open this link:<br><span style="font-family:monospace;font-size:11.5px;word-break:break-all">${link}</span></div>
  </div>
  <div style="font-size:11.5px;color:#8A93A1;margin-top:14px">Edgesmith Tooling India · Production Cycle Management</div>
</div>`;

export async function sendInvite(email, name, token) {
  const link = `${APP_URL()}/set-password?t=${token}`;
  await transport().sendMail({
    from: FROM(), to: email,
    subject: "Your Edgesmith CPCMS account",
    html: shell("You've been added to the Edgesmith Console",
      `Hi ${name || "there"},<br>An account has been created for you on the Edgesmith production system. Set your password to activate it — the link works for 48 hours.`,
      "Set my password", link),
  });
}

export async function sendReset(email, name, token) {
  const link = `${APP_URL()}/reset-password?t=${token}`;
  await transport().sendMail({
    from: FROM(), to: email,
    subject: "Reset your Edgesmith CPCMS password",
    html: shell("Password reset",
      `Hi ${name || "there"},<br>A password reset was requested for your account. The link works for 1 hour. If you didn't ask for this, ignore this email — your password is unchanged.`,
      "Choose a new password", link),
  });
}
