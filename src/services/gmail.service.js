const fs = require('fs');
const { google } = require('googleapis');
const { getConfigPath } = require('../config/paths.config');

const CREDENTIALS_PATH = getConfigPath('credentials.json');
const TOKEN_PATH = getConfigPath('token.json');

// Simple rule-based priority calculator based on keywords
function detectPriority(subject, body) {
  const content = `${subject} ${body}`.toLowerCase();
  if (content.includes('urgent') || content.includes('immediately') || content.includes('emergency') || content.includes('fraud')) {
    return 'Critical';
  }
  if (content.includes('delay') || content.includes('refund') || content.includes('cancel') || content.includes('damaged') || content.includes('broken')) {
    return 'High';
  }
  if (content.includes('wrong') || content.includes('not working') || content.includes('issue') || content.includes('complaint')) {
    return 'Medium';
  }
  return 'Low';
}

// Get authenticated OAuth2 client using saved token.json
function getAuthenticatedClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('token.json not found! Please run "npm run auth:gmail" first to authenticate.');
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(tokens);

  // Auto-refresh token if expired
  oAuth2Client.on('tokens', (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...currentTokens, ...newTokens }, null, 2));
  });

  return oAuth2Client;
}

let lastGmailError = null;

const s3Service = require('./s3.service');

// Helper to recursively extract attachments from Gmail MIME payload
async function extractAttachments(payload, gmail, messageId, ticketId) {
  const attachments = [];
  const partsToProcess = [];

  function collectParts(parts) {
    if (!parts || !Array.isArray(parts)) return;
    for (const p of parts) {
      if (p.filename && p.filename.trim().length > 0 && p.body) {
        partsToProcess.push(p);
      }
      if (p.parts) {
        collectParts(p.parts);
      }
    }
  }

  if (payload.parts) {
    collectParts(payload.parts);
  } else if (payload.filename && payload.filename.trim().length > 0 && payload.body) {
    partsToProcess.push(payload);
  }

  for (const part of partsToProcess) {
    try {
      let fileBuffer = null;
      if (part.body.attachmentId) {
        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: messageId,
          id: part.body.attachmentId
        });
        if (attRes.data && attRes.data.data) {
          fileBuffer = Buffer.from(attRes.data.data, 'base64url');
        }
      } else if (part.body.data) {
        fileBuffer = Buffer.from(part.body.data, 'base64url');
      }

      if (fileBuffer) {
        let fileUrl = null;
        let s3Key = null;

        // Upload to AWS S3 if configured
        if (s3Service && s3Service.isConfigured) {
          try {
            const s3Res = await s3Service.uploadAttachment({
              ticketId,
              fileName: part.filename,
              contentType: part.mimeType,
              fileBuffer
            });
            if (s3Res.success) {
              fileUrl = s3Res.downloadUrl;
              s3Key = s3Res.key;
            }
          } catch (s3Err) {
            console.error('[AWS S3 Attachment Upload Error]:', s3Err.message);
          }
        }

        // Fallback to base64 Data URL if S3 is not available
        if (!fileUrl) {
          const mime = part.mimeType || 'image/jpeg';
          fileUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`;
        }

        const isImage = (part.mimeType && part.mimeType.startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(part.filename);

        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || fileBuffer.length,
          url: fileUrl,
          s3Key: s3Key,
          isImage
        });
      }
    } catch (attErr) {
      console.error(`[Gmail Service] Could not download attachment "${part.filename}":`, attErr.message);
    }
  }

  return attachments;
}

// Fetch complaint emails from inbox
async function fetchComplaintEmails(maxResults = 30) {
  try {
    const auth = getAuthenticatedClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Look for emails in inbox
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults: maxResults
    });

    lastGmailError = null;
    const messages = listResponse.data.messages || [];
    const normalizedComplaints = [];

    for (const item of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: item.id,
          format: 'full'
        });

        const headers = detail.data.payload.headers || [];
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
        let subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        const dateHeader = headers.find(h => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

        // Extract body snippet
        const snippet = detail.data.snippet || '(No text preview)';
        if (!subjectHeader || subjectHeader.trim() === '' || subjectHeader === '(No Subject)') {
          subjectHeader = snippet ? snippet.substring(0, 50) : '(No Subject)';
        }

        const ticketId = `GMAIL-${item.id.substring(0, 6).toUpperCase()}`;

        // Extract any attachments (photos, PDFs, screenshots) & upload to S3
        const attachments = await extractAttachments(detail.data.payload, gmail, item.id, ticketId);

        const complaintTicket = {
          ticketId,
          channel: 'gmail',
          channelMessageId: item.id,
          sender: fromHeader,
          subject: subjectHeader,
          message: snippet,
          timestamp: dateHeader,
          priority: detectPriority(subjectHeader, snippet),
          status: 'New',
          attachments: attachments
        };

        normalizedComplaints.push(complaintTicket);
      } catch (msgErr) {
        console.error(`Error reading message ${item.id}:`, msgErr.message);
      }
    }

    return normalizedComplaints;
  } catch (err) {
    lastGmailError = err.message || 'Authentication error';
    if (err.message && err.message.includes('invalid_grant')) {
      lastGmailError = 'OAuth2 token expired (run "npm run auth:gmail" to re-authenticate)';
    }
    throw err;
  }
}

// Helper to RFC-2047 encode non-ASCII MIME headers (e.g. emojis in Subject)
function encodeMimeHeader(text = '') {
  if (/[^\x00-\x7F]/.test(text)) {
    return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
  }
  return text;
}

function formatSubject(subject = '') {
  let cleanSub = (subject || 'Support Request').trim();
  if (!cleanSub.toLowerCase().startsWith('re:')) {
    cleanSub = `Re: ${cleanSub}`;
  }
  return encodeMimeHeader(cleanSub);
}

// Convert markdown to clean HTML email body
function markdownToHtml(md = '') {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-family:monospace;font-weight:600;color:#0f172a;">$1</code>')
    .replace(/\n\n/g, '</p><p style="margin: 12px 0; line-height: 1.6; color: #1e293b;">')
    .replace(/\n/g, '<br/>');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
      <p style="margin: 0 0 12px 0; line-height: 1.6; color: #1e293b; font-size: 14px;">
        ${html}
      </p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <div style="font-size: 11px; color: #64748b;">
        CCMRS Omnichannel Support Desk &bull; Automated Customer Resolution System
      </div>
    </div>
  `.trim();
}

// Send an email reply back to the customer with proper MIME UTF-8 headers and multipart content
async function sendEmailReply(toEmail, subject, replyBody, threadId) {
  const auth = getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const cleanSubject = formatSubject(subject);
  const htmlContent = markdownToHtml(replyBody);
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  const rawMessage = [
    `To: ${toEmail}`,
    `Subject: ${cleanSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(replyBody, 'utf-8').toString('base64'),
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(htmlContent, 'utf-8').toString('base64'),
    '',
    `--${boundary}--`
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendParams = {
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      ...(threadId ? { threadId } : {})
    }
  };

  const response = await gmail.users.messages.send(sendParams);
  return response.data;
}

function getGmailStatus() {
  const credsExist = fs.existsSync(CREDENTIALS_PATH);
  const tokenExist = fs.existsSync(TOKEN_PATH);
  const isConnected = credsExist && tokenExist && !lastGmailError;

  return {
    configured: credsExist,
    connected: isConnected,
    authenticated: tokenExist,
    credentialsFound: credsExist,
    tokenFound: tokenExist,
    error: !credsExist 
      ? 'credentials.json missing' 
      : (!tokenExist 
          ? 'token.json missing (run npm run auth:gmail)' 
          : (lastGmailError || null))
  };
}

module.exports = {
  fetchComplaintEmails,
  sendEmailReply,
  getGmailStatus
};
