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
const { User, Chat, Campaign, GlobalState, WamidMapping } = require('./db/models');
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
let wamidToJob = {};      // { wamid: { jobId, phone, userId } }
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
        header: { type: null, text: null, imageUrl: null, variables: [], portalNames: [] },
        body: { text: null, variables: [], portalNames: [] },
        footer: { text: null, variables: [], portalNames: [] },
        buttons: []
      };

      t.components.forEach(comp => {
        if (comp.type === 'HEADER') {
          componentsData.header.type = comp.format;
          componentsData.header.text = comp.text || null;
          if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(comp.format)) {
            if (comp.example?.header_handle?.[0]) {
              componentsData.header.imageUrl = comp.example.header_handle[0];
            }
          }
          const vars = comp.text?.match(/{{([a-zA-Z0-9_]+)}}/g)?.map(m => m.replace(/[{}]/g, '')) || [];
          const uniqueVars = [...new Set(vars)].sort((a, b) => {
            if (!isNaN(a) && !isNaN(b)) return parseInt(a) - parseInt(b);
            return a.localeCompare(b);
          });
          uniqueVars.forEach(v => {
            componentsData.header.variables.push(v);
            const label = isNaN(v) ? `Variable: ${v}` : `Header Var ${v}`;
            componentsData.header.portalNames.push(label);
          });
        }

        if (comp.type === 'BODY') {
          componentsData.body.text = comp.text || null;
          const vars = comp.text?.match(/{{([a-zA-Z0-9_]+)}}/g)?.map(m => m.replace(/[{}]/g, '')) || [];
          const uniqueVars = [...new Set(vars)].sort((a, b) => {
            if (!isNaN(a) && !isNaN(b)) return parseInt(a) - parseInt(b);
            return a.localeCompare(b);
          });
          uniqueVars.forEach(v => {
            componentsData.body.variables.push(v);
            const label = isNaN(v) ? `Variable: ${v}` : `Body Var ${v}`;
            componentsData.body.portalNames.push(label);
          });
        }

        if (comp.type === 'FOOTER') {
          componentsData.footer.text = comp.text || null;
          const vars = comp.text?.match(/{{([a-zA-Z0-9_]+)}}/g)?.map(m => m.replace(/[{}]/g, '')) || [];
          const uniqueVars = [...new Set(vars)].sort((a, b) => {
            if (!isNaN(a) && !isNaN(b)) return parseInt(a) - parseInt(b);
            return a.localeCompare(b);
          });
          uniqueVars.forEach(v => {
            componentsData.footer.variables.push(v);
            componentsData.footer.portalNames.push(`Footer Var ${v}`);
          });
        }

        if (comp.type === 'BUTTONS') {
          comp.buttons.forEach((btn, idx) => {
            const btnData = { type: btn.type, text: btn.text, index: idx, variables: [], portalNames: [] };
            if (btn.type === 'URL' && btn.url) {
              const matches = btn.url.match(/{{([a-zA-Z0-9_]+)}}/g) || [];
              const uniqueMatches = [...new Set(matches.map(m => m.replace(/[{}]/g, '')))].sort((a, b) => {
                if (!isNaN(a) && !isNaN(b)) return parseInt(a) - parseInt(b);
                return a.localeCompare(b);
              });
              uniqueMatches.forEach(v => {
                btnData.variables.push(v);
                btnData.portalNames.push(`Btn ${idx} Var ${v}`);
              });
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

// ═══ DEBUG ENDPOINT: Shows RAW template data from Meta + parsed structure ═══
app.get('/api/debug-template/:name', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { token, wabaId, phoneId } = user.config;
    
    // Get RAW templates from Meta
    const response = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const rawTemplate = response.data.data.find(t => t.name === req.params.name);
    if (!rawTemplate) return res.status(404).json({ error: `Template '${req.params.name}' not found` });
    
    // Get parsed version
    const parsed = (await getMetaTemplatesForUser(wabaId, token)).find(t => t.name === req.params.name);
    
    res.json({
      raw_from_meta: rawTemplate,
      parsed_by_server: parsed,
      user_config: {
        phoneId: phoneId ? `${phoneId.substring(0,6)}***` : 'MISSING',
        wabaId: wabaId ? `${wabaId.substring(0,6)}***` : 'MISSING',
        tokenPresent: !!token
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// ═══ DEBUG: Test-build payload without sending ═══
app.post('/api/debug-payload', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { contacts, templateName, mapping } = req.body;
    const { token, wabaId, phoneId } = user.config;
    
    const templates = await getMetaTemplatesForUser(wabaId, token);
    const template = templates.find(t => t.name === templateName);
    if (!template) return res.json({ error: 'Template not found', availableTemplates: templates.map(t => t.name) });
    
    // Build a sample payload for the first contact
    const contact = contacts[0] || {};
    const compData = template.componentsData;
    
    const components = [];
    
    // Header
    if (compData.header.type && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(compData.header.type)) {
      const typeLower = compData.header.type.toLowerCase();
      components.push({
        type: "header",
        parameters: [{ type: typeLower, [typeLower]: { id: mapping.header_media_url || 'MISSING_MEDIA_ID' } }]
      });
    }
    
    // Body
    if (compData.body.variables.length > 0) {
      const bodyParams = compData.body.variables.map((v, idx) => {
        const csvCol = mapping[v];
        const val = csvCol ? contact[csvCol] : undefined;
        return {
          variable: v,
          mapping_key: v,
          mapping_value: csvCol || 'NOT_MAPPED',
          csv_value: val || 'NOT_FOUND',
          final_param: { type: 'text', text: String(val || ' ') }
        };
      });
      components.push({ type: "body", variables_debug: bodyParams });
    }
    
    res.json({
      template_name: template.name,
      template_language: template.language,
      template_format: template.format,
      header_type: compData.header.type,
      header_imageUrl: compData.header.imageUrl ? 'PRESENT' : 'MISSING',
      header_media_id: mapping.header_media_url || 'NOT_SET',
      body_variables: compData.body.variables,
      mapping_keys: Object.keys(mapping),
      mapping_object: mapping,
      sample_contact: contact,
      components_debug: components
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
app.post('/api/upload-csv', authenticateToken, upload.single('csv'), async (req, res) => {
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

  const { contacts, messageType, templateName, templateParams, customMessage, mapping } = req.body;
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

    // ═══ CAMPAIGN DIAGNOSTICS ═══
    if (template) {
      console.log(`[CAMPAIGN START] Template: ${template.name}`);
      console.log(`[CAMPAIGN START] Format: ${template.format}`);
      console.log(`[CAMPAIGN START] Language: ${template.language}`);
      console.log(`[CAMPAIGN START] Header type: ${template.componentsData.header.type || 'NONE'}`);
      console.log(`[CAMPAIGN START] Header imageUrl: ${template.componentsData.header.imageUrl ? 'PRESENT' : 'MISSING'}`);
      console.log(`[CAMPAIGN START] Body variables: ${JSON.stringify(template.componentsData.body.variables)}`);
      console.log(`[CAMPAIGN START] Body portalNames: ${JSON.stringify(template.componentsData.body.portalNames)}`);
      console.log(`[CAMPAIGN START] Buttons: ${JSON.stringify(template.componentsData.buttons.map(b => b.type))}`);
      console.log(`[CAMPAIGN START] Mapping keys: ${JSON.stringify(Object.keys(mapping))}`);
      console.log(`[CAMPAIGN START] Mapping object: ${JSON.stringify(mapping)}`);
      console.log(`[CAMPAIGN START] header_media_url from mapping: ${mapping.header_media_url || 'NOT SET'}`);
      console.log(`[CAMPAIGN START] Contacts count: ${validContacts.length}`);
      console.log(`[CAMPAIGN START] Sample contact keys: ${JSON.stringify(Object.keys(validContacts[0] || {}))}`);
    }

    // ═══ AUTO-DOWNLOAD TEMPLATE HEADER MEDIA ═══
    // If template has an IMAGE/VIDEO/DOCUMENT header, automatically download 
    // from Meta CDN and upload to get a Media ID (prevents Portuguese placeholder text)
    let cachedHeaderMediaId = mapping.header_media_url || null;
    if (template && template.componentsData.header.type && 
        ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(template.componentsData.header.type)) {
      
      const header = template.componentsData.header;
      
      // If user already uploaded a file (media ID set), use that
      if (cachedHeaderMediaId && !String(cachedHeaderMediaId).startsWith('http')) {
        console.log(`[MEDIA] Using user-uploaded media ID: ${cachedHeaderMediaId}`);
      } 
      // Otherwise, auto-download from template's example image
      else if (header.imageUrl) {
        try {
          console.log(`[MEDIA] Downloading template ${header.type} from Meta CDN...`);
          const mediaResponse = await axios.get(header.imageUrl, { responseType: 'arraybuffer' });
          const mediaBuffer = Buffer.from(mediaResponse.data);
          
          const contentType = mediaResponse.headers['content-type'] || 'application/octet-stream';
          const extension = mime.extension(contentType) || 'bin';
          const uploadsDir = path.join(__dirname, 'uploads');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          const tmpPath = path.join(uploadsDir, `header_${Date.now()}.${extension}`);
          
          fs.writeFileSync(tmpPath, mediaBuffer);
          console.log(`[MEDIA] ${header.type} downloaded (${mediaBuffer.length} bytes), uploading to Meta...`);

          const formData = new FormData();
          formData.append('messaging_product', 'whatsapp');
          formData.append('file', fs.createReadStream(tmpPath), { 
            filename: `header.${extension}`, 
            contentType: contentType 
          });

          const uploadRes = await axios.post(
            `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/media`,
            formData,
            { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, ...formData.getHeaders() } }
          );
          
          cachedHeaderMediaId = uploadRes.data.id;
          console.log(`[MEDIA] Upload success! media_id = ${cachedHeaderMediaId}`);
          
          try { fs.unlinkSync(tmpPath); } catch(e) {}
        } catch (uploadErr) {
          console.error(`[MEDIA] ${header.type} auto-download failed:`, uploadErr.response?.data || uploadErr.message);
          cachedHeaderMediaId = null;
        }
      } else {
        console.warn(`[MEDIA] No example image URL in template and no file uploaded — header will be missing`);
        cachedHeaderMediaId = null;
      }
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

      let wamid = null;
      let msgStatus = 'Pending';
      let payload = { messaging_product: "whatsapp", recipient_type: "individual", to: cleanPhone };
      try {
        if (messageType === 'text') {
          let text = customMessage || '';
          Object.keys(contact).forEach(k => text = text.replace(new RegExp(`{{\\s*${escapeRegExp(k)}\\s*}}`, 'gi'), contact[k] || ''));
          payload.type = "text";
          payload.text = { body: text };
        } else {
          payload.type = "template";
          payload.template = { 
            name: template.name, 
            language: { code: template.language || "en_US" }, 
            components: [] 
          };

          const compData = template.componentsData;

          // 1. Header Component
          if (compData.header.type) {
            const headerComp = { type: "header", parameters: [] };
            
            if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(compData.header.type)) {
              const typeLower = compData.header.type.toLowerCase();
              
              // ALWAYS use {id: mediaId} — never {link: URL} to prevent Portuguese link preview text
              if (cachedHeaderMediaId) {
                // If somehow we still have a URL, convert it to media ID first
                let mediaId = cachedHeaderMediaId;
                if (String(mediaId).startsWith('http')) {
                  try {
                    console.log(`[HEADER] URL detected, converting to Media ID...`);
                    const dlRes = await axios.get(mediaId, { responseType: 'arraybuffer' });
                    const dlBuffer = Buffer.from(dlRes.data);
                    const dlType = dlRes.headers['content-type'] || 'image/jpeg';
                    const dlExt = mime.extension(dlType) || 'jpg';
                    const dlDir = path.join(__dirname, 'uploads');
                    if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true });
                    const dlPath = path.join(dlDir, `hdr_${Date.now()}.${dlExt}`);
                    fs.writeFileSync(dlPath, dlBuffer);
                    const dlForm = new FormData();
                    dlForm.append('messaging_product', 'whatsapp');
                    dlForm.append('file', fs.createReadStream(dlPath), { filename: `header.${dlExt}`, contentType: dlType });
                    const dlUpload = await axios.post(
                      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/media`, dlForm,
                      { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, ...dlForm.getHeaders() } }
                    );
                    mediaId = dlUpload.data.id;
                    cachedHeaderMediaId = mediaId; // Cache for next contacts
                    console.log(`[HEADER] Converted URL → Media ID: ${mediaId}`);
                    try { fs.unlinkSync(dlPath); } catch(e) {}
                  } catch (convErr) {
                    console.error(`[HEADER] URL→MediaID failed:`, convErr.response?.data || convErr.message);
                    mediaId = null;
                  }
                }
                if (mediaId) {
                  headerComp.parameters.push({ type: typeLower, [typeLower]: { id: mediaId } });
                }
              }
            } else if (compData.header.type === 'TEXT' && compData.header.variables.length > 0) {
              compData.header.variables.forEach((variable, idx) => {
                const val = String(contact[mapping[variable]] || '');
                headerComp.parameters.push({ type: "text", text: val || ' ' });
              });
            }

            if (headerComp.parameters.length > 0) {
              payload.template.components.push(headerComp);
            }
          }

          // 2. Body Component (exact old working format)
          if (compData.body.variables.length > 0) {
            const bodyComp = { type: "body", parameters: [] };
            compData.body.variables.forEach((variable, idx) => {
              let val = String(contact[mapping[variable]] || '');
              if (variable.toLowerCase() === 'name') val = val.split(' ')[0];
              
              const param = { type: 'text', text: val || ' ' };
              if (template.format === 'NAMED' && compData.body.portalNames[idx]) {
                param.parameter_name = compData.body.portalNames[idx];
              }
              bodyComp.parameters.push(param);
            });
            payload.template.components.push(bodyComp);
          }

          // 3. Button Components (exact old working format)
          compData.buttons.forEach((btn, idx) => {
            if (btn.type === 'URL' && btn.variables.length > 0) {
              const btnComp = { type: "button", sub_type: "url", index: idx.toString(), parameters: [] };
              const val = String(contact[mapping[`btn_${idx}_${btn.variables[0]}`]] || contact[mapping[`button_${idx}_url_suffix`]] || '');
              if (val) {
                btnComp.parameters.push({ type: "text", text: val });
                payload.template.components.push(btnComp);
              }
            }

            if (btn.type === 'FLOW') {
              payload.template.components.push({
                type: "button",
                sub_type: "flow",
                index: idx.toString(),
                parameters: [{
                  type: "action",
                  action: { flow_token: `token_${Date.now()}_${Math.floor(Math.random() * 1000)}` }
                }]
              });
            }
          });
        }

        // Log the FULL payload for debugging
        console.log(`[SEND] Payload to ${cleanPhone.substring(0,4)}***:`, JSON.stringify(payload, null, 2));
        
        try {
          const response = await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, payload, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
          });
          msgStatus = 'Sent ✅';
          wamid = response.data.messages?.[0]?.id;
        } catch (firstErr) {
          // Check for specific Error 132012 "Parameter format does not match"
          const errorCode = firstErr.response?.data?.error?.error_subcode || firstErr.response?.data?.error?.code;
          
          if (errorCode === 132012 || errorCode === 100) {
            console.log(`[FALLBACK] Error ${errorCode}, retrying without parameter_name for ${cleanPhone.substring(0,4)}***`);
            
            // Create a fallback payload WITHOUT parameter_name
            const fallbackPayload = JSON.parse(JSON.stringify(payload));
            if (fallbackPayload.template && fallbackPayload.template.components) {
              fallbackPayload.template.components.forEach(comp => {
                if (comp.parameters) {
                  comp.parameters.forEach(p => delete p.parameter_name);
                }
              });
            }

            const response = await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, fallbackPayload, {
              headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
            });
            msgStatus = 'Sent ✅';
            wamid = response.data.messages?.[0]?.id;
          } else {
            throw firstErr; // Rethrow other errors
          }
        }
      } catch (err) {
        // Log the COMPLETE error response from Meta for debugging
        if (err.response?.data) {
          console.error(`[META FULL ERROR] Phone: ${cleanPhone}`, JSON.stringify(err.response.data, null, 2));
        } else {
          console.error(`[ERROR] Phone: ${cleanPhone}`, err.message);
        }
        
        const metaError = err.response?.data?.error?.message || err.message;
        const subCode = err.response?.data?.error?.error_subcode || err.response?.data?.error?.code;
        
        if (subCode === 131030) {
          msgStatus = 'Failed ❌ (Not on WhatsApp or Rate Limited)';
        } else {
          const metaErrObj = err.response?.data?.error;
          msgStatus = metaErrObj ? `Failed: ${mapMetaError(metaErrObj)}` : `Failed: ${err.message}`;
        }
      }

      if (wamid) {
        wamidToJob[wamid] = { jobId, phone: cleanPhone, userId };
        sentHistory[cleanPhone] = { sentAt: Date.now(), jobId };
        
        // PERSIST WAMID MAPPING (for status survival after restart)
        new WamidMapping({
          wamid,
          userId,
          jobId,
          phone: cleanPhone
        }).save().catch(err => console.error('[DB] WamidMapping Save Error:', err.message));
      }

      userJobs[jobId].results.push({
        name: mapping.name ? contact[mapping.name] : 'Unknown',
        phone: cleanPhone || phone || 'N/A',
        status: msgStatus,
        wamid: wamid,
        details: messageType === 'template' ? payload.template : { text: customMessage }
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
              failed: finalJob.results.filter(r => r.status.includes('Failed')).length,
              results: finalJob.results.map(r => ({
                phone: r.phone,
                name: r.name,
                status: r.status,
                wamid: r.wamid
              }))
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
    // Exclude 'results' from the list view for performance
    const dbCampaigns = await Campaign.find({ userId: req.user.id }, { results: 0 }).sort({ timestamp: -1 });
    res.json(dbCampaigns);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get detailed results for a specific campaign
app.get('/api/history/:id', authenticateToken, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ userId: req.user.id, id: req.params.id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign details' });
  }
});

// Clear history API (User Scoped)
app.post('/api/history/clear', authenticateToken, async (req, res) => {
  console.log('[CLEAR] Request received to wipe history for user', req.user.id);
  try {
    await Campaign.deleteMany({ userId: req.user.id });
    // Also clear in-memory jobs for this user
    if (jobs[req.user.id]) delete jobs[req.user.id];
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
app.get('/api/active-job', authenticateToken, async (req, res) => {
  const userJobs = jobs[req.user.id] || {};
  const activeJobId = Object.keys(userJobs).find(
    id => userJobs[id].status === 'Running' || userJobs[id].status === 'Paused'
  );
  if (activeJobId) {
    res.json({ jobId: activeJobId, status: userJobs[activeJobId] });
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
        let mapping = wamidToJob[wamid];
        
        // Fallback to Database if not in memory (e.g. after restart)
        if (!mapping) {
          console.log(`[Webhook] ${wamid} not in memory, looking up in DB...`);
          const dbMapping = await WamidMapping.findOne({ wamid });
          if (dbMapping) {
            mapping = { 
              jobId: dbMapping.jobId, 
              phone: dbMapping.phone, 
              userId: dbMapping.userId 
            };
            // Restore to memory for speed
            wamidToJob[wamid] = mapping;
          }
        }

        if (mapping) {
          const { jobId, phone, userId } = mapping;
          const userJobs = jobs[userId] || {};
          
          if (userJobs[jobId]) {
            const result = userJobs[jobId].results.find(r => r.phone === phone);
            if (result) {
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
              
              // Also update the database if the campaign is already saved
              Campaign.findOneAndUpdate(
                { userId: userId, id: parseInt(jobId.slice(-6)), "results.phone": phone },
                { $set: { "results.$.status": result.status } }
              ).catch(err => console.error('[Webhook] DB Sync Error:', err.message));

              console.log(`[Webhook] Updated Job ${jobId} status for ${phone} to ${result.status}`);
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
