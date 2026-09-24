const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const { getConfigPath } = require('../config/paths.config');

const CREDENTIALS_PATH = getConfigPath('credentials.json');
const TOKEN_PATH = getConfigPath('token.json');
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
];

async function authenticate() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ Error: credentials.json not found in config/ or project root.');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n======================================================');
  console.log('🔗 AUTHORIZATION REQUIRED');
  console.log('Open this link in your browser to sign in to your Gmail:');
  console.log('------------------------------------------------------');
  console.log(authUrl);
  console.log('======================================================\n');

  // Start temporary local server to capture the redirect callback
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/oauth2callback')) {
        const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
        const code = qs.get('code');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
              <h2 style="color: #2e7d32;">✅ Authentication Successful!</h2>
              <p>Your Gmail account has been linked to CCMRS.</p>
              <p>You can close this browser tab and return to the terminal.</p>
            </div>
          `);

          const { tokens } = await oAuth2Client.getToken(code);
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          console.log(`✅ token.json has been created successfully at ${TOKEN_PATH}!`);

          server.close(() => {
            console.log('Server closed. You can now start the main backend server (npm start).');
            process.exit(0);
          });
        }
      }
    } catch (e) {
      console.error('Authentication callback error:', e);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Authentication failed. Check terminal output.');
      server.close(() => process.exit(1));
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for authorization callback on http://localhost:${PORT}/oauth2callback ...`);
  });
}

authenticate();
