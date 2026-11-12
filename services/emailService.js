const nodemailer = require('nodemailer');
const { sendWhatsAppOTP } = require('./whatsappService');

/**
 * Dispatch an email via Gmail SMTP (Nodemailer) strictly using GMAIL_USER & GMAIL_APP_PASS
 */
async function dispatchEmail({ to, replyTo, subject, text, html, attachments = [], fromLabel = 'CricPass Support' }) {
  const webhookUrl = process.env.GMAIL_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    throw new Error('GMAIL_WEBHOOK_URL is required in environment variables for Render deployment.');
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: Array.isArray(to) ? to.join(', ') : to,
      replyTo: replyTo || 'v70524817@gmail.com',
      subject,
      html
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook email failed with status ${response.status}`);
  }

  return { provider: 'google-apps-script', id: Date.now().toString() };
}

/**
 * Send a styled 6-digit verification code to recipient email
 */
async function sendEmailOTP(recipientEmail, otpCode, purpose = 'Verification') {
  if (!recipientEmail) {
    throw new Error('Recipient contact is required');
  }

  if (!String(recipientEmail).includes('@')) {
    return await sendWhatsAppOTP(recipientEmail, otpCode, purpose);
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>CricPass Security Code</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 20px; color: #f8fafc; }
        .container { max-width: 520px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #334155; }
        .logo { font-size: 32px; display: inline-block; margin-bottom: 8px; }
        .title { color: #22c55e; font-size: 22px; font-weight: 800; margin: 0; }
        .subtitle { color: #94a3b8; font-size: 13px; margin-top: 4px; }
        .content { padding: 28px 0; text-align: center; }
        .desc { font-size: 15px; color: #cbd5e1; line-height: 1.6; margin-bottom: 24px; }
        .otp-box { background: #0f172a; border: 2px dashed #22c55e; border-radius: 12px; padding: 18px 24px; display: inline-block; margin: 0 auto; }
        .otp-code { font-size: 36px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 8px; color: #38bdf8; margin: 0; text-shadow: 0 0 10px rgba(56,189,248,0.3); }
        .validity { font-size: 13px; color: #f59e0b; margin-top: 20px; font-weight: 600; }
        .footer { text-align: center; padding-top: 24px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🏏</div>
          <h1 class="title">CricPass Verification</h1>
          <p class="subtitle">Official Cricket Registry & Transfer Protocol</p>
        </div>
        <div class="content">
          <p class="desc">
            An authorization request was initiated for <strong>${purpose}</strong>. Please use the 6-digit one-time password below to authorize this action:
          </p>
          <div class="otp-box">
            <h2 class="otp-code">${otpCode}</h2>
          </div>
          <p class="validity">⏱️ This code is valid for 5 minutes. Do not share this code with anyone.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} CricPass Platform. If you did not request this, please ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const result = await dispatchEmail({
    to: recipientEmail,
    subject: `[CricPass] ${otpCode} is your ${purpose} Verification Code`,
    text: `Your CricPass verification code for ${purpose} is: ${otpCode}. It is valid for 5 minutes.`,
    html: htmlContent,
    fromLabel: 'CricPass Verification'
  });

  return result;
}

/**
 * Send official team credentials to the team administrator via email
 */
async function sendTeamCredentialsEmail({ recipientEmail, teamId, teamName, password }) {
  if (!recipientEmail) {
    throw new Error('Recipient email is required');
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Welcome to CricPass - Official Club Credentials</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 20px; color: #f8fafc; }
        .container { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #334155; }
        .logo { font-size: 36px; display: inline-block; margin-bottom: 8px; }
        .title { color: #38bdf8; font-size: 24px; font-weight: 800; margin: 0; }
        .subtitle { color: #94a3b8; font-size: 13px; margin-top: 4px; }
        .content { padding: 24px 0; }
        .greeting { font-size: 16px; color: #f8fafc; margin-bottom: 16px; }
        .creds-card { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin: 20px 0; }
        .cred-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
        .cred-row:last-child { border-bottom: none; }
        .cred-label { color: #94a3b8; font-weight: 600; }
        .cred-val { color: #22c55e; font-weight: 700; font-family: monospace; font-size: 15px; }
        .notice-box { background: #451a03; border: 1px solid #b45309; border-radius: 10px; padding: 14px 18px; color: #fde68a; font-size: 13px; line-height: 1.5; margin: 20px 0; }
        .thanks { color: #cbd5e1; font-size: 14px; line-height: 1.6; text-align: center; margin-top: 20px; }
        .footer { text-align: center; padding-top: 24px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🏏</div>
          <h1 class="title">Welcome to CricPass!</h1>
          <p class="subtitle">Club Team Official Registration Details</p>
        </div>
        <div class="content">
          <p class="greeting">Hello Administrator,</p>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">
            Your cricket club <strong>${teamName}</strong> has been successfully enrolled into the official CricPass Registry platform. Here are your portal access credentials:
          </p>

          <div class="creds-card">
            <div class="cred-row">
              <span class="cred-label">Team ID:</span>
              <span class="cred-val">${teamId}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">Team Name / Username:</span>
              <span class="cred-val">${teamName}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">Portal Password:</span>
              <span class="cred-val">${password}</span>
            </div>
          </div>

          <div class="notice-box">
            <strong>⚠️ Security Notice:</strong> Please store your <strong>Team ID</strong>, <strong>Team Name / Username</strong>, and <strong>Password</strong> safely. Do not share your login credentials with unauthorized individuals.
          </div>

          <p class="thanks">
            Thank you for supporting us and advancing transparent, verified local cricket administration!
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} CricPass Cricket Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const result = await dispatchEmail({
    to: recipientEmail,
    subject: `[CricPass] Official Club Credentials: ${teamName} (${teamId})`,
    text: `Welcome to CricPass!\n\nYour club ${teamName} is registered.\nTeam ID: ${teamId}\nTeam Name: ${teamName}\nPassword: ${password}\n\nPlease store your credentials safely. Thank you!`,
    html: htmlContent,
    fromLabel: 'CricPass Portal'
  });

  return result;
}

/**
 * Send Contact Us / Issue Report email strictly to v70524817@gmail.com
 */
async function sendContactUsEmail({ userEmail, subject, issueDescription, attachment }) {
  // Always route directly to v70524817@gmail.com
  const contactAdminEmail = 'v70524817@gmail.com';
  const hasUserEmail = Boolean(userEmail && userEmail.trim());

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>CricPass User Support Request</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 20px; color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 32px; }
        .header { border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 20px; }
        .badge { background: #ef4444; color: #fff; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
        .title { color: #f8fafc; font-size: 20px; font-weight: bold; margin: 10px 0 0 0; }
        .meta { color: #94a3b8; font-size: 13px; margin-top: 4px; }
        .field { margin: 16px 0; }
        .field-label { color: #94a3b8; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .field-val { color: #f1f5f9; font-size: 14px; margin-top: 4px; background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; white-space: pre-wrap; }
        .attachment-note { color: #38bdf8; font-size: 12px; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="badge">Support / Contact Request</span>
          <h2 class="title">${subject || 'Issue Reported'}</h2>
          <p class="meta">Reported on: ${new Date().toLocaleString()}</p>
        </div>

        ${hasUserEmail ? `
        <div class="field">
          <div class="field-label">User / Sender Email:</div>
          <div class="field-val" style="color: #38bdf8; font-weight: 600;">${userEmail}</div>
        </div>
        ` : ''}

        <div class="field">
          <div class="field-label">Issue Subject:</div>
          <div class="field-val">${subject || 'General Inquiry / Support Request'}</div>
        </div>

        <div class="field">
          <div class="field-label">Detailed Description:</div>
          <div class="field-val">${issueDescription}</div>
        </div>

        ${attachment ? `<p class="attachment-note">📎 An attachment was provided: <strong>${attachment.filename}</strong></p>` : ''}
      </div>
    </body>
    </html>
  `;

  const result = await dispatchEmail({
    to: contactAdminEmail,
    ...(hasUserEmail ? { replyTo: userEmail.trim() } : {}),
    subject: `[CricPass Support] ${subject || 'New Issue Reported'}${hasUserEmail ? ` - from ${userEmail.trim()}` : ''}`,
    text: `Support Issue Report:\nSubject: ${subject || 'General Inquiry'}\n\nDescription:\n${issueDescription}`,
    html: htmlContent,
    attachments: attachment
      ? [
          {
            filename: attachment.filename,
            content: attachment.content,
            encoding: attachment.encoding || 'base64',
            contentType: attachment.contentType
          }
        ]
      : [],
    fromLabel: 'CricPass Support Desk'
  });

  return result;
}

module.exports = {
  sendEmailOTP,
  sendTeamCredentialsEmail,
  sendContactUsEmail
};