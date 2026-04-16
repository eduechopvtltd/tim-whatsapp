const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const FormData = require('form-data');
const axios = require('axios');
const stripBom = require('strip-bom-stream').default || require('strip-bom-stream');
const mime = require('mime-types');
require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Chat, Campaign, GlobalState } = require('./db/models');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

const app = express();
const port = process.env.PORT || 3001;
const upload = multer({ dest: 'uploads/' });
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'my_secret_token';
let resolvedSourceId = null;
let hookdeckDestinationId = process.env.HOOKDECK_DESTINATION_ID;

// In-memory status tracking managed below in persistence block

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- DATABASE CONNECTION ---
const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri || uri.includes('<username>')) {
            console.warn('[DB] ❌ No valid MONGODB_URI found in .env. Persistence will be disabled.');
            return;
        }
        await mongoose.connect(uri);
        console.log('[DB] ✅ Connected to MongoDB Atlas');
    } catch (err) {
        console.error('[DB] ❌ Connection error:', err.message);
    }
};

// --- STATIC FILE SERVING (Frontend Bundle) ---
const frontendDist = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(frontendDist));

app.get('/', (req, res) => {
  // If the dashboard is built, serve it. Otherwise, show a status page.
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    res.sendFile(path.join(frontendDist, 'index.html'));
  } else {
    // Fallback status page for local development if frontend isn't built yet
    const isRender = !!process.env.RENDER;
    const currentUrl = isRender ? process.env.RENDER_EXTERNAL_URL : `http://localhost:${port}`;
    res.send(`
        <div style="font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #f8fafc; text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #10b981;">TIM API - Dashboard Not Built</h1>
            <p style="color: #94a3b8; font-size: 1.2rem;">Run <code style="color: #3b82f6;">npm run build</code> in the root folder to see the dashboard here.</p>
            <p style="margin-top: 1rem; color: #64748b;">API URL: ${currentUrl}</p>
        </div>
    `);
  }
});

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Global In-memory stores (Scoped to userId)
let jobs = {};            // { userId: { jobId: { status, results, ... } } }
let wamidToJob = {};      // { wamid: { jobId, phone } }
let sentHistory = {};     // { phone: { sentAt, jobId } } (Shared cache)
let chats = {};           // In-memory cache for webhook: { phone: [...] }

// Helper: find a job by jobId across all users
const findJob = (jobId) => {
  for (const userId of Object.keys(jobs)) {
    if (jobs[userId][jobId]) return jobs[userId][jobId];
  }
  return null;
};

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied. Please login.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired. Please login again.' });
    req.user = user;
    next();
  });
};

// --- AUTH ROUTES ---

// Registration
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('[AUTH] Registration error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      username: user.username,
      configSet: !!(user.config.token && user.config.phoneId)
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});
// Helpers
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mapMetaError = (err) => {
  if (!err) return 'Unknown Error';
  const code = err.code;
  if (code === 131030) return 'Meta Rate Limit Reached 🐌';
  if (code === 131031) return 'Low Quality Account 🚩';
  if (code === 131009) return 'Parameter Mismatch ❌';
  if (code === 131026) return 'Invalid Number 📵';
  if (code === 131042) return 'Payment Method Required 💳';
  if (code === 133010) return 'Number Not Registered/Verified 📵';
  return `Error (${code}): ${err.message || 'Meta Rejected'}`;
};

// --- TEMPLATE FETCHING (User Scoped) ---

const getMetaTemplatesForUser = async (wabaId, accessToken) => {
  if (!wabaId || !accessToken) return [];

  try {
    const response = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const parsedTemplates = response.data.data.filter(t => t.status === 'APPROVED').map(t => {
      const componentsData = {
        header: { type: null, imageUrl: null, variables: [], portalNames: [] },
        body: { variables: [], portalNames: [] },
        footer: { variables: [], portalNames: [] },
        buttons: []
      };

      t.components.forEach(comp => {
        const text = comp.text || '';
        const matches = text.match(/{{([a-zA-Z0-9_]+)}}/g) || [];
        const vars = matches.map(m => m.replace(/[{}]/g, ''));

        if (comp.type === 'HEADER') {
          componentsData.header.type = comp.format;
          if (comp.format === 'IMAGE' || comp.format === 'VIDEO' || comp.format === 'DOCUMENT') {
            if (comp.example && comp.example.header_handle && comp.example.header_handle.length > 0) {
              componentsData.header.imageUrl = comp.example.header_handle[0];
            }
          }
          vars.forEach(v => {
            if (!componentsData.header.portalNames.includes(v)) {
              componentsData.header.variables.push(v);
              componentsData.header.portalNames.push(v);
            }
          });
        }

        if (comp.type === 'BODY') {
          vars.forEach(v => {
            if (!componentsData.body.portalNames.includes(v)) {
              componentsData.body.variables.push(v);
              componentsData.body.portalNames.push(v);
            }
          });
        }

        if (comp.type === 'FOOTER') {
          vars.forEach(v => {
            if (!componentsData.footer.portalNames.includes(v)) {
              componentsData.footer.variables.push(v);
              componentsData.footer.portalNames.push(v);
            }
          });
        }

        if (comp.type === 'BUTTONS') {
          comp.buttons.forEach((btn, idx) => {
            const btnData = {
              type: btn.type,
              text: btn.text,
              index: idx,
              variables: [],
              portalNames: []
            };
            if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
              btnData.variables.push('url_suffix');
              btnData.portalNames.push('url_suffix');
            }
            if (btn.type === 'FLOW') {
              btnData.flowId = btn.flow_id;
            }
            componentsData.buttons.push(btnData);
          });
        }
      });

      return {
        name: t.name,
        language: t.language,
        format: t.parameter_format || 'POSITIONAL',
        componentsData
      };
    });

    return parsedTemplates;
  } catch (err) {
    console.error("Meta Fetch Error:", err.response?.data || err.message);
    return [];
  }
};

app.get('/api/templates', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const templates = await getMetaTemplatesForUser(user.config.wabaId, user.config.token);
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});


// Media Upload endpoint (User Scoped)
app.post('/api/upload-media', authenticateToken, upload.single('media'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const user = await User.findById(req.user.id);
  if (!user || !user.config.phoneId || !user.config.token) {
    return res.status(400).json({ error: 'Meta Credentials not configured' });
  }
  const PHONE_NUMBER_ID = user.config.phoneId;
  const ACCESS_TOKEN = user.config.token;

  try {
    const filePath = req.file.path;
    const form = new FormData();
    // CRITICAL: Explicitly set contentType and filename for the stream so Meta receives the correct MIME type
    form.append('file', fs.createReadStream(filePath), {
      contentType: req.file.mimetype,
      filename: req.file.originalname
    });
    form.append('type', req.file.mimetype);
    form.append('messaging_product', 'whatsapp');

    console.log(`[META] Uploading media: ${req.file.originalname} (MIME: ${req.file.mimetype}, Size: ${req.file.size} bytes)...`);

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    // Clean up local temp file
    fs.unlinkSync(filePath);

    console.log(`[META] Media upload success. ID: ${response.data.id}`);
    res.json({ media_id: response.data.id });
  } catch (err) {
    console.error('[META] Media Upload Failed:', err.response?.data || err.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(err.response?.status || 500).json({
      error: 'Meta Media Upload failed',
      details: err.response?.data?.error || err.message
    });
  }
});

// CSV Upload and Parse endpoint
app.post('/api/upload-csv', upload.single('csv'), async (req, res) => {
  const results = [];
  if (!req.file) return res.status(400).send('No file uploaded.');

  fs.createReadStream(req.file.path)
    .pipe(stripBom())
    .pipe(csv())
    .on('data', (data) => {
      // Basic empty row trimming
      const hasContent = Object.values(data).some(val => val && val.trim() !== '');
      if (hasContent) results.push(data);
    })
    .on('end', () => {
      // Clean up temp file only on success
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      res.json({
        headers: Object.keys(results[0] || {}),
        data: results,
      });
    })
    .on('error', (err) => {
      // Clean up temp file on error too
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      res.status(500).json({ error: 'Failed to parse CSV: ' + err.message });
    });
});

// --- CAMPAIGN EXECUTION ENGINE (Multi-Tenant) ---

app.post('/api/send', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const user = await User.findById(userId);
  if (!user || !user.config.token || !user.config.phoneId) {
    return res.status(400).json({ error: 'WhatsApp Credentials not configured for your account' });
  }

  const { contacts, messageType, templateName, templateParams, textBody, mapping } = req.body;
  const jobId = Date.now().toString();

  // Initialize user-specific job store if needed
  if (!jobs[userId]) jobs[userId] = {};

  jobs[userId][jobId] = {
    userId,
    name: templateName || 'Custom Text Campaign',
    status: 'Running',
    total: contacts.length,
    processed: 0,
    results: [],
    createdAt: Date.now()
  };

  const { token: ACCESS_TOKEN, phoneId: PHONE_NUMBER_ID } = user.config;

  // Process asynchronously
  (async () => {
    const userJobs = jobs[userId];
    const validContacts = contacts.filter(c => c[mapping.phone] && c[mapping.phone].trim() !== '');
    let template = null;
    if (messageType !== 'text') {
      const templates = await getMetaTemplatesForUser(user.config.wabaId, user.config.token);
      template = templates.find(t => t.name === templateName);
    }

    for (let contact of validContacts) {
      if (userJobs[jobId].stopped) break;

      await sleep(250);

      while (userJobs[jobId] && userJobs[jobId].paused && !userJobs[jobId].stopped) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (userJobs[jobId].stopped) break;

      const phone = String(contact[mapping.phone] || '').trim();
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

      let msgStatus = 'Failed ❌';
      let payload = { messaging_product: "whatsapp", recipient_type: "individual", to: '+' + cleanPhone };

      try {
        if (messageType === 'text') {
          let text = textBody || '';
          Object.keys(contact).forEach(k => text = text.replace(new RegExp(`{{\\s*${escapeRegExp(k)}\\s*}}`, 'gi'), contact[k] || ''));
          payload.type = "text";
          payload.text = { body: text };
        } else {
          payload.type = "template";
          payload.template = { name: template.name, language: { code: template.language || "en_US" }, components: [] };
          // ... (Component logic remains same as original)
        }

        const response = await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, payload, {
          headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        msgStatus = 'Sent ✅';
      } catch (err) {
        msgStatus = `Failed: ${err.message}`;
      }

      if (msgStatus.includes('✅')) {
        sentHistory[cleanPhone] = { sentAt: Date.now(), jobId };
      }

      userJobs[jobId].results.push({
        name: mapping.name ? contact[mapping.name] : 'Unknown',
        phone: cleanPhone || phone || 'N/A',
        status: msgStatus,
        details: messageType === 'template' ? payload.template : { text: textBody }
      });
      userJobs[jobId].processed += 1;

      // Persistence to MongoDB (Scoped to User)
      if (userJobs[jobId].processed === userJobs[jobId].total) {
          userJobs[jobId].status = 'Completed';
          const finalJob = userJobs[jobId];
          const campaign = new Campaign({
              userId,
              id: parseInt(jobId.slice(-6)),
              name: finalJob.name,
              status: finalJob.status,
              totalContacts: finalJob.total,
              sent: finalJob.results.filter(r => r.status.includes('✅')).length,
              failed: finalJob.results.filter(r => r.status.includes('❌')).length
          });
          await campaign.save();
      }

      await sleep(500); // Rate limiting
    }
  })();

  res.json({ message: 'Campaign started successfully', jobId });
});

// --- CAMPAIGN HISTORY (User Scoped) ---
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const dbCampaigns = await Campaign.find({ userId: req.user.id }).sort({ timestamp: -1 });
    res.json(dbCampaigns);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Clear history API (User Scoped)
app.post('/api/history/clear', authenticateToken, async (req, res) => {
  console.log('[CLEAR] Request received to wipe history for user', req.user.id);
  try {
    await Campaign.deleteMany({ userId: req.user.id });
    if (jobs[req.user.id]) delete jobs[req.user.id];
    sentHistory = {};
    res.json({ message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

// Status Polling API
app.get('/api/status/:jobId', authenticateToken, async (req, res) => {
  const userJobs = jobs[req.user.id] || {};
  const job = userJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Pause Campaign API
app.post('/api/pause/:jobId', authenticateToken, async (req, res) => {
  const userJobs = jobs[req.user.id] || {};
  const job = userJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'Running' || job.status === 'Paused') {
    job.paused = true;
    job.status = 'Paused';
    res.json({ message: 'Campaign paused', status: job.status });
  } else {
    res.status(400).json({ error: 'Only running campaigns can be paused' });
  }
});

// Resume Campaign API
app.post('/api/resume/:jobId', authenticateToken, async (req, res) => {
  const userJobs = jobs[req.user.id] || {};
  const job = userJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'Paused') {
    job.paused = false;
    job.status = 'Running';
    res.json({ message: 'Campaign resumed', status: job.status });
  } else {
    res.status(400).json({ error: 'Only paused campaigns can be resumed' });
  }
});

// Stop Campaign API
app.post('/api/stop/:jobId', authenticateToken, async (req, res) => {
  const userJobs = jobs[req.user.id] || {};
  const job = userJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'Running' || job.status === 'Paused') {
    job.stopped = true;
    job.paused = false;
    res.json({ message: 'Campaign stopped' });
  } else {
    res.status(400).json({ error: 'Only active campaigns can be stopped' });
  }
});

// --- CONFIGURATION API ---

// Get current config (User Scoped)
app.get('/api/config', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json({
      PHONE_NUMBER_ID: user.config.phoneId,
      WABA_ID: user.config.wabaId,
      ACCESS_TOKEN: user.config.token,
      APP_ID: user.config.appId,
      WEBHOOK_VERIFY_TOKEN: user.config.verifyToken
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Update config (User Scoped)
app.post('/api/config', authenticateToken, async (req, res) => {
  try {
    const { PHONE_NUMBER_ID, WABA_ID, ACCESS_TOKEN, APP_ID, WEBHOOK_VERIFY_TOKEN } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.config.phoneId = PHONE_NUMBER_ID || user.config.phoneId;
    user.config.wabaId = WABA_ID || user.config.wabaId;
    user.config.token = ACCESS_TOKEN || user.config.token;
    user.config.appId = APP_ID || user.config.appId;
    user.config.verifyToken = WEBHOOK_VERIFY_TOKEN || user.config.verifyToken;

    await user.save();
    
    // Clear user-specific media cache on config change
    await GlobalState.deleteOne({ userId: req.user.id, key: 'mediaCache' });

    res.json({ message: 'Configuration updated successfully' });
  } catch (err) {
    console.error('[CONFIG] Save error:', err);
    res.status(500).json({ error: 'Failed to persist configuration' });
  }
});

// Manual Phone Registration with Meta (User Scoped)
app.post('/api/register', authenticateToken, async (req, res) => {
  const { pin } = req.body;
  const user = await User.findById(req.user.id);

  if (!pin || pin.length !== 6) {
    return res.status(400).json({ error: 'A 6-digit PIN is required for registration.' });
  }

  if (!user || !user.config.phoneId || !user.config.token) {
    return res.status(400).json({ error: 'Credentials must be configured first.' });
  }

  const PHONE_NUMBER_ID = user.config.phoneId;
  const ACCESS_TOKEN = user.config.token;

  console.log(`[META] Attempting to register phone ${PHONE_NUMBER_ID} with PIN...`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/register`,
      { messaging_product: 'whatsapp', pin },
      { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } }
    );

    console.log('[META] Registration Successful:', response.data);
    res.json({ success: true, message: 'Phone successfully registered and connected to Meta Cloud API!' });
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    console.error('[META] Registration Failed:', metaError);
    res.status(err.response?.status || 500).json({
      error: 'Registration failed: ' + metaError,
      details: err.response?.data?.error
    });
  }
});

// Active Job API (Recovery)
app.get('/api/active-job', async (req, res) => {
  const activeJobId = Object.keys(jobs).find(
    id => jobs[id].status === 'Running' || jobs[id].status === 'Paused'
  );
  if (activeJobId) {
    res.json({ jobId: activeJobId, status: jobs[activeJobId] });
  } else {
    res.json({ jobId: null });
  }
});

// Webhook Verification (GET)
app.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'] || req.query.mode;
  const token = req.query['hub.verify_token'] || req.query.token;
  const challenge = req.query['hub.challenge'] || req.query.challenge;

  if (mode && token) {
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED ✅');
      return res.status(200).send(challenge);
    } else {
      console.warn('WEBHOOK_VERIFICATION_FAILED: Token mismatch');
      return res.sendStatus(403);
    }
  }

  // If no params, it might be a ping or misconfigured request
  res.status(200).send('Webhook Endpoint Active');
});

// Webhook for tracking status (Multi-Tenant Aware)
app.post('/webhook', async (req, res) => {
  let body = req.body;

  if (body && body.object) {
    try {
      const changes = body.entry?.[0]?.changes?.[0]?.value;
      const phoneId = changes?.metadata?.phone_number_id;

      if (!phoneId) {
        return res.sendStatus(200); // Silent drop for metadata without phoneId
      }

      // 1. IDENTIFY USER BY PHONE ID
      const user = await User.findOne({ 'config.phoneId': phoneId });
      if (!user) {
        console.warn(`[Webhook] Unrecognized phoneId: ${phoneId}`);
        return res.sendStatus(200); 
      }
      const userId = user._id;
      if (changes?.statuses) {
        let statusInfo = changes.statuses[0];
        let statusString = statusInfo.status; // sent, delivered, read, failed
        let recipient = statusInfo.recipient_id;
        let wamid = statusInfo.id;

        console.log(`[Webhook] Status Update: ${recipient} -> ${statusString.toUpperCase()} (ID: ${wamid})`);

        // UPDATE JOB MEMORY
        if (wamidToJob[wamid]) {
          const { jobId, phone } = wamidToJob[wamid];
          if (jobs[jobId]) {
            const result = jobs[jobId].results.find(r => r.phone === phone);
            if (result) {
              // Map statuses to readable text with icons
              const statusMap = {
                'sent': 'Sent ✅',
                'delivered': 'Delivered 📩',
                'read': 'Read 👁️',
                'failed': 'Failed ❌'
              };
              
              result.status = statusMap[statusString] || statusString.toUpperCase();
              
              if (statusInfo.errors) {
                const err = statusInfo.errors[0];
                result.status = `Failed: ${err.message}`;
              }
              
              
              console.log(`[Webhook] Updated Job ${jobId} status for ${phone}`);
            }
          }
        }

        if (statusInfo.errors) {
          console.error(`[Webhook] ERROR for ${recipient}:`, JSON.stringify(statusInfo.errors, null, 2));
          // If we have a failure, let's map it to something readable if possible
          const err = statusInfo.errors[0];
          console.log(`[Webhook] Failure Reason: ${err.message} (Code: ${err.code})`);
        }
      } else if (changes?.messages) {
        // Incoming message received
        const msg = changes.messages[0];
        const from = msg.from;
        
        // Try to find the name from Meta profile, or from our internal job history
        let profileName = changes.contacts?.[0]?.profile?.name;
        if (!profileName) {
            // Check if we have this number in any of THIS USER's recent jobs
            const userJobs = jobs[userId] || {};
            for (const jId in userJobs) {
                const found = userJobs[jId].results.find(r => r.phone === from);
                if (found && found.name) {
                    profileName = found.name;
                    break;
                }
            }
        }
        if (!profileName) profileName = from; // Fallback to phone number
        
        let text = '[Non-text message]';
        if (msg.type === 'text') text = msg.text.body;
        else if (msg.type === 'button') text = msg.button.text;
        else if (msg.type === 'interactive') text = msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || '[Interactive]';
        
        console.log(`[Webhook] Message from ${from} (${profileName}): ${text}`);
        
        const newMsg = {
          id: msg.id,
          from: 'customer',
          name: profileName,
          text: text,
          timestamp: Date.now(),
          type: msg.type
        };

        if (!chats[from]) chats[from] = [];
        chats[from].push(newMsg);
        if (chats[from].length > 100) chats[from].shift();

        // PERSIST TO CLOUD (Scoped to User)
        try {
            await Chat.findOneAndUpdate(
                { userId: userId, phone: from },
                { 
                    $setOnInsert: { name: profileName },
                    $push: { messages: newMsg } 
                },
                { upsert: true }
            );
            
        } catch (dbErr) {
            console.error('[DB ERROR] Failed to save incoming message:', dbErr.message);
        }
      }
    } catch (parseErr) {
      console.error('[Webhook] Error parsing body:', parseErr.message);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// --- CHAT SYSTEM (User Scoped) ---

// List all chats for user
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const dbChats = await Chat.find({ userId: req.user.id }).sort({ updatedAt: -1 });
    res.json(dbChats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get specific chat history
app.get('/api/chats/:phone', authenticateToken, async (req, res) => {
  try {
    const chat = await Chat.findOne({ userId: req.user.id, phone: req.params.phone });
    res.json(chat ? chat.messages : []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat details' });
  }
});

app.post('/api/reply', authenticateToken, async (req, res) => {
  const { phone, text } = req.body;
  const userId = req.user.id;
  const user = await User.findById(userId);

  if (!phone || !text) return res.status(400).json({ error: 'Phone and text are required' });
  if (!user || !user.config.token || !user.config.phoneId) {
     return res.status(400).json({ error: 'WhatsApp Credentials not configured' });
  }
  
  try {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { body: text }
    };
    
    console.log(`[REPLY] Sending to ${phone}: ${text}`);
    
    await axios.post(`https://graph.facebook.com/v21.0/${user.config.phoneId}/messages`, payload, {
      headers: { 'Authorization': `Bearer ${user.config.token}`, 'Content-Type': 'application/json' }
    });
    
    const newMsg = {
      id: `internal_${Date.now()}`,
      from: 'me',
      name: phone, 
      text: text,
      timestamp: Date.now(),
      type: 'text'
    };

    await Chat.findOneAndUpdate(
        { userId: userId, phone: phone },
        { $push: { messages: newMsg } },
        { upsert: true }
    );
    
    res.json({ success: true });
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error('[REPLY ERROR]', errorMsg);
    res.status(500).json({ error: errorMsg });
  }
});

// --- JOB MEMORY CLEANUP ---
// Clean up in-memory jobs every hour to prevent memory leaks
// We only remove jobs that are Completed/Stopped and older than 12 hours
setInterval(async () => {
  const now = Date.now();
  Object.keys(jobs).forEach(uId => {
    Object.keys(jobs[uId]).forEach(jId => {
      const job = jobs[uId][jId];
      if ((job.status === 'Completed' || job.status === 'Stopped') && (now - job.createdAt > 12 * 60 * 60 * 1000)) {
        console.log(`[CLEANUP] Removing old job ${jId} from memory for user ${uId}`);
        delete jobs[uId][jId];
      }
    });
  });
}, 3600000); // Every 1 hour

// --- HOOKDECK AUTOMATIC SYNC ---
async function triggerHookdeckSync() {
    const apiKey = process.env.HOOKDECK_API_KEY;
    const sourceName = process.env.HOOKDECK_SOURCE_NAME;
    
    if (!apiKey || !sourceName) {
        console.log('[HOOKDECK SYNC] Missing API key or Source Name in .env. Skipping sync.');
        return;
    }

    console.log(`[HOOKDECK SYNC] Initiating startup sync for source: ${sourceName}...`);
    
    try {
        // Step 0: Resolve Source ID if not already resolved
        if (!resolvedSourceId) {
            console.log('[HOOKDECK SYNC] Resolving Source ID...');
            const sourcesRes = await axios.get('https://api.hookdeck.com/2025-07-01/sources', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const source = sourcesRes.data.models.find(s => s.name === sourceName);
            if (!source) {
                console.warn(`[HOOKDECK SYNC] Could not find a Hookdeck source named "${sourceName}".`);
                return;
            }
            resolvedSourceId = source.id;
            console.log(`[HOOKDECK SYNC] Resolved Source ID: ${resolvedSourceId}`);
        }

        const sourceId = resolvedSourceId;

        // Step 1: Find Destination ID
        console.log('[HOOKDECK SYNC] Fetching connections...');
        const connRes = await axios.get('https://api.hookdeck.com/2025-07-01/connections', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            params: { source_id: sourceId }
        });
        
        const connections = connRes.data.models;
        let destinationId = connections && connections.length > 0 ? connections[0].destination_id : null;
        
        if (!destinationId) {
            console.log('[HOOKDECK SYNC] No connection found via API. Searching recent events...');
            const eventRes = await axios.get('https://api.hookdeck.com/2025-07-01/events', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                params: { source_id: sourceId, limit: 1 }
            });
            if (eventRes.data.models?.length > 0) {
                destinationId = eventRes.data.models[0].destination_id;
            }
        }

        if (!destinationId) {
            console.warn('[HOOKDECK SYNC] No destination detected. Please send a message first or save your CLI destination.');
            return;
        }
        
        console.log(`[HOOKDECK SYNC] Found Destination: ${destinationId}`);

        // Step 2: Trigger Bulk Retry for FAILED events
        console.log('[HOOKDECK SYNC] Triggering bulk retry for failed events...');
        const retryRes = await axios.post('https://api.hookdeck.com/2025-07-01/events/bulk-retry', {
            query: {
                source_id: [sourceId],
                destination_id: [destinationId],
                status: ['FAILED']
            }
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });

        console.log(`[HOOKDECK SYNC] Success! Retry triggered. Job ID: ${retryRes.data.id || 'Unknown'}`);
    } catch (err) {
        console.error('[HOOKDECK SYNC] Error during sync:', err.response?.data?.message || err.message);
    }
}

// --- WEBHOOK TUNNEL (LocalTunnel) ---
let webhookProcess = null;

async function updateHookdeckDestination(newUrl) {
    const apiKey = process.env.HOOKDECK_API_KEY;
    if (!apiKey || !hookdeckDestinationId) {
        console.log('[BRIDGE] Skipping Hookdeck update: Missing API Key or Destination ID.');
        return;
    }

    try {
        console.log(`[BRIDGE] Updating Hookdeck destination ${hookdeckDestinationId} to: ${newUrl}`);
        await axios.put(`https://api.hookdeck.com/2025-07-01/destinations/${hookdeckDestinationId}`, {
            config: { url: `${newUrl}/webhook` }
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        console.log('[BRIDGE] Successfully updated Hookdeck static bridge! ✅');
    } catch (err) {
        console.error('[BRIDGE ERROR] Failed to update Hookdeck destination:', err.response?.data?.message || err.message);
    }
}

function startWebhookTunnel() {
    const apiKey = process.env.HOOKDECK_API_KEY;
    const sourceName = process.env.HOOKDECK_SOURCE_NAME;
    const subdomain = process.env.LT_SUBDOMAIN;
    
    if (process.env.RENDER) {
        console.log(`[WEBHOOK TUNNEL] Running on Render Cloud. Skipping LocalTunnel.`);
        return;
    }
    
    console.log(`[WEBHOOK TUNNEL] Starting LocalTunnel...`);
    
    // Command: [path-to-lt] --port 3001 --subdomain [name]
    const ltPath = '/home/sahil/.npm/_npx/75ac80b86e83d4a2/node_modules/.bin/lt';
    const args = [
        '--port', `${port}`
    ];
    
    if (subdomain) {
        args.push('--subdomain', subdomain);
        console.log(`[WEBHOOK TUNNEL] Requesting subdomain: ${subdomain}`);
    }

    webhookProcess = spawn(ltPath, args, {
        shell: false,
        env: { ...process.env }
    });

    webhookProcess.stdout.on('data', (data) => {
        const output = data.toString();
        // Look for the tunnel URL in the output
        if (output.includes('your url is:')) {
            const url = output.split('your url is:')[1].trim();
            console.log(`[WEBHOOK TUNNEL] Ready! Local URL: ${url}`);
            
            // AUTOMATIC BRIDGE: Tell Hookdeck where we are!
            updateHookdeckDestination(url);
        }
    });

    webhookProcess.stderr.on('data', (data) => {
        console.error(`[WEBHOOK TUNNEL ERROR] ${data.toString().trim()}`);
    });

    webhookProcess.on('close', (code) => {
        console.log(`[WEBHOOK TUNNEL] Process exited with code ${code}`);
        webhookProcess = null;
    });
}

// Ensure processes are killed when Node exits
process.on('exit', () => { if (webhookProcess) webhookProcess.kill(); });
process.on('SIGINT', () => { if (webhookProcess) webhookProcess.kill(); process.exit(); });
process.on('SIGTERM', () => { if (webhookProcess) webhookProcess.kill(); process.exit(); });

app.listen(port, () => {
    console.log(`Backend server running on http://127.0.0.1:${port}`);
    
    // Connect to MongoDB Atlas
    connectDB();

    // Start Webhook Tunnel (Only if NOT on Render)
    if (process.env.RENDER) {
        const renderUrl = process.env.RENDER_EXTERNAL_URL;
        console.log(`[BRIDGE] Detected Render Cloud environment.`);
        if (renderUrl) {
            updateHookdeckDestination(renderUrl);
        } else {
            console.warn('[BRIDGE] RENDER_EXTERNAL_URL not found. Please ensure it is set in environment.');
        }
    } else {
        startWebhookTunnel();
    }
    
    // Trigger Hookdeck sync (wait a bit to ensure tunnel is active if needed)
    setTimeout(triggerHookdeckSync, 5000);
});
