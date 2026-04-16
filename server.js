const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const FormData = require('form-data');
const axios = require('axios');
const path = require('path');
const stripBom = require('strip-bom-stream').default || require('strip-bom-stream');
const mime = require('mime-types');
require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { Chat, Campaign, GlobalState } = require('./db/models');

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
        await loadData();
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

const campaignHistoryFile = path.join(__dirname, 'campaign_history.json');
const sentHistoryFile = path.join(__dirname, 'sent_history.json');
const mediaCacheFile = path.join(__dirname, 'media_cache.json');
const activeJobsFile = path.join(__dirname, 'active_jobs.json');
const wamidMapFile = path.join(__dirname, 'wamid_map.json');
const chatsFile = path.join(__dirname, 'chats.json');

let chats = {}; // { phone: [ { from, text, timestamp, type, status } ] }

const loadData = async () => {
  console.log('[DB] Loading initial state from cloud...');
  try {
    // 1. Load Campaign History
    const dbCampaigns = await Campaign.find({}).sort({ id: 1 });
    campaignHistory = dbCampaigns.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        totalContacts: c.totalContacts,
        sent: c.sent,
        failed: c.failed,
        timestamp: c.timestamp
    }));

    // 2. Load Global State Objects
    const states = await GlobalState.find({});
    states.forEach(state => {
        if (state.key === 'sentHistory') sentHistory = state.data;
        if (state.key === 'mediaCache') mediaCache = state.data;
        if (state.key === 'wamidToJob') wamidToJob = state.data;
        if (state.key === 'jobs') {
            Object.keys(state.data).forEach(id => {
                if (state.data[id].status === 'Running') state.data[id].status = 'Paused (Server Restart)';
                jobs[id] = state.data[id];
            });
        }
    });

    // 3. Load Recent Chats into Memory Cache (optional, for speed)
    const dbChats = await Chat.find({}).limit(100); 
    dbChats.forEach(c => { chats[c.phone] = c.messages; });

    console.log(`[DB] State Loaded: ${campaignHistory.length} Campaigns, ${Object.keys(jobs).length} Jobs.`);
  } catch (err) {
    console.error('[DB] Failed to load data:', err.message);
  }
};

const saveData = async (source = 'unknown') => {
  console.log(`[DB] Syncing state to Cloud (Source: ${source}).. `);
  try {
    // 1. Save Campaigns (Batch update)
    for (const campaign of campaignHistory) {
        await Campaign.findOneAndUpdate({ id: campaign.id }, campaign, { upsert: true });
    }

    // 2. Save Global States
    await GlobalState.findOneAndUpdate({ key: 'sentHistory' }, { data: sentHistory }, { upsert: true });
    await GlobalState.findOneAndUpdate({ key: 'mediaCache' }, { data: mediaCache }, { upsert: true });
    await GlobalState.findOneAndUpdate({ key: 'wamidToJob' }, { data: wamidToJob }, { upsert: true });
    await GlobalState.findOneAndUpdate({ key: 'jobs' }, { data: jobs }, { upsert: true });

    console.log(`[DB] ✅ Cloud Sync Success!`);
  } catch (err) {
    console.error(`[DB] ❌ Cloud Sync Failed: ${err.message}`);
  }
};

// Helpers
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let saveTimeout = null;
const requestSave = (source = 'auto') => {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    await saveData(source);
    saveTimeout = null;
  }, 5000); // Max once every 5 seconds during heavy tasks
};

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

// --- TEMPLATE CACHING ---
let cachedTemplates = null;
let cachedTemplatesTime = 0;

const getMetaTemplates = async (force = false) => {
  // If templates are cached and less than 1 hour old, use them to prevent rate limiting
  // Note: forceful refreshes skip this check
  if (!force && cachedTemplates && (Date.now() - cachedTemplatesTime < 3600000)) {
    console.log('[CACHE] Using locally cached Meta templates');
    return cachedTemplates;
  }

  const WABA_ID = process.env.WABA_ID;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

  if (!WABA_ID || !ACCESS_TOKEN) return [];

  try {
    const response = await axios.get(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
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

            // URL buttons can have one variable at the end
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

    cachedTemplates = parsedTemplates;
    cachedTemplatesTime = Date.now();
    return parsedTemplates;

  } catch (err) {
    console.error("Meta Fetch Error:", err.response?.data || err.message);
    return [];
  }
};

app.get('/api/templates/refresh', async (req, res) => {
  cachedTemplates = null;
  cachedTemplatesTime = 0;
  const templates = await getMetaTemplates(true); // Force fresh fetch
  res.json(templates);
});

app.get('/api/templates', async (req, res) => {
  const templates = await getMetaTemplates();
  res.json(templates);
});

// Media Upload endpoint (Meta Standard Media API)
app.post('/api/upload-media', upload.single('media'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    return res.status(400).json({ error: 'Meta Credentials not configured' });
  }

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

// Send message API
app.post('/api/send', async (req, res) => {
  const { contacts, templateName, mapping, messageType, customMessage, allowDuplicates } = req.body;

  if (!contacts || !mapping) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let template = null;
  if (messageType !== 'text') {
    if (!templateName) {
      return res.status(400).json({ error: 'Template name is required for template messages' });
    }
    const templates = await getMetaTemplates();
    template = templates.find(t => t.name === templateName);

    if (!template) {
      return res.status(404).json({ error: 'Template not found locally or on Meta. Try refreshing templates.' });
    }
  }

  // Double check and filter out truly blank mapped phone numbers
  const validContacts = contacts.filter(c => c[mapping.phone] && c[mapping.phone].trim() !== '');

  const jobId = Date.now().toString();
  jobs[jobId] = {
    id: jobId,
    status: 'Running',
    total: validContacts.length,
    processed: 0,
    results: [],
    paused: false,
    createdAt: Date.now(),
    templateName: messageType === 'template' ? templateName : 'Custom Text Message'
  };

  res.json({ message: 'Sending started.', jobId });
  await saveData(); // Persist job creation immediately

  // Process asynchronously
  (async () => {
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || 'MOCK_ID';
    const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'MOCK_TOKEN';

    // Track header media (Simplified: Use direct links from template data)
    const header = template.componentsData.header;
    let cachedHeaderMediaId = null;
    // We rely on the fallback within the loop to use header.imageUrl if no specific mapping is provided

    for (let contact of validContacts) {
      if (jobs[jobId].stopped) break;

      // Throttle: 250ms delay between messages to be a good citizen
      await sleep(250);

      // Pause check - wait until paused is false or job is stopped
      while (jobs[jobId] && jobs[jobId].paused && !jobs[jobId].stopped) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (jobs[jobId].stopped) break;

      const phone = String(contact[mapping.phone] || '').trim();
      if (!phone) continue;

      if (jobs[jobId].stopped) break;

      // Phone is already validated via validContacts filter, this is an extra guard
      if (!phone || phone.trim() === '') {
        jobs[jobId].results.push({
          name: mapping.name ? contact[mapping.name] : 'Unknown',
          phone: 'Missing',
          status: 'Failed ❌ (No Phone Number)'
        });
        jobs[jobId].processed += 1;
        continue;
      }
      let cleanPhone = phone.replace(/\D/g, '');
      
      // Auto-append country code only if number is exactly 10 digits (local format without code)
      if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone;
      }

      // Ensure strict E.164 format for better delivery reliability
      const strictPhone = '+' + cleanPhone;

      // Duplicate Check (using cleaned phone for better matching)
      if (!allowDuplicates && sentHistory[cleanPhone]) {
        console.log(`[SKIP] Duplicate detected for ${cleanPhone}`);
        jobs[jobId].results.push({
          name: mapping.name ? contact[mapping.name] : (contact['name'] || contact['Name'] || 'Unknown'),
          phone: cleanPhone,
          status: 'Skipped ⏭️ (Already Sent)'
        });
        jobs[jobId].processed += 1;
        continue;
      }

      // Basic formatting check: must be at least 10 digits (minimum length including country code)
      if (cleanPhone.length < 10) {
        jobs[jobId].results.push({
          name: mapping.name ? contact[mapping.name] : (contact['name'] || contact['Name'] || 'Unknown'),
          phone: phone || 'N/A',
          status: 'Failed ❌ (Invalid Format)'
        });
        jobs[jobId].processed += 1;
        continue;
      }
      
      let msgStatus = 'Failed ❌';

      // Removed redundant duplicate check logic block here

      let textBody = '';
      let payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone
      };

      try {
        if (messageType === 'text') {
          textBody = customMessage || '';
          // Replacing any {{CSV Column Name}} with the actual row data
          Object.keys(contact).forEach(csvHeader => {
            const escapedHeader = escapeRegExp(csvHeader);
            textBody = textBody.replace(new RegExp(`{{\\s*${escapedHeader}\\s*}}`, 'gi'), contact[csvHeader] || '');
          });

          payload.type = "text";
          payload.text = { body: textBody };
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
              let mappedMediaValue = null;

              if (mapping.header_media_url) {
                // Check if the mapping itself is a numeric ID (uploaded directly)
                if (/^\d{10,}$/.test(mapping.header_media_url)) {
                  mappedMediaValue = mapping.header_media_url;
                } else {
                  // Otherwise, look it up in the contact row (CSV column)
                  mappedMediaValue = String(contact[mapping.header_media_url] || '').trim();
                }
              }

              if (mappedMediaValue) {
                // If it's a numeric ID, treat as media_id, else as link
                if (/^\d{10,}$/.test(mappedMediaValue)) {
                  headerComp.parameters.push({ type: typeLower, [typeLower]: { id: mappedMediaValue } });
                } else {
                  headerComp.parameters.push({ type: typeLower, [typeLower]: { link: mappedMediaValue } });
                }
              } else if (cachedHeaderMediaId) {
                headerComp.parameters.push({ type: typeLower, [typeLower]: { id: cachedHeaderMediaId } });
              } else if (compData.header.imageUrl) {
                // Use template's default image from Meta
                headerComp.parameters.push({ type: typeLower, [typeLower]: { link: compData.header.imageUrl } });
              }
            } else if (compData.header.type === 'TEXT') {
              if (compData.header.variables.length > 0) {
                compData.header.variables.forEach((variable, idx) => {
                  const val = String(contact[mapping[`header_${variable}`]] || '');
                  headerComp.parameters.push({ type: "text", text: val });
                });
              }
            }
            // Only push header component if it has parameters (e.g. custom media ID or link)
            if (headerComp.parameters.length > 0) {
              payload.template.components.push(headerComp);
            }
          }

          // 2. Body Component
          const bodyComp = { type: "body", parameters: [] };
          if (compData.body.variables.length > 0) {
            compData.body.variables.forEach((variable, idx) => {
              let val = String(contact[mapping[`body_${variable}`]] || contact[mapping[variable]] || '');
              if (variable.toLowerCase() === 'name') val = val.split(' ')[0];

              const param = { type: 'text', text: val };
              if (template.format === 'NAMED' && compData.body.portalNames[idx]) {
                param.parameter_name = compData.body.portalNames[idx];
              }
              bodyComp.parameters.push(param);
            });
            payload.template.components.push(bodyComp);
          } else if (compData.header.type === 'TEXT') {
            // Meta requires empty body component for TEXT headers with no variables (like hello_world)
            payload.template.components.push(bodyComp);
          }
          // For IMAGE/VIDEO/DOCUMENT headers with no body variables, don't add body component - let Meta handle it

          // 3. Button Components
          compData.buttons.forEach((btn, idx) => {
            if (btn.type === 'URL' && btn.variables.length > 0) {
              const btnComp = { type: "button", sub_type: "url", index: idx.toString(), parameters: [] };
              const val = String(contact[mapping[`button_${idx}_url_suffix`]] || '');
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

        if (ACCESS_TOKEN !== 'MOCK_TOKEN') {
          // Log the FULL payload for debugging
          console.log(`[SEND] Full Payload to ${cleanPhone}:`, JSON.stringify(payload, null, 2));
          try {
            const response = await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, payload, {
              headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
            });
            const msgId = response.data?.messages?.[0]?.id;
            console.log(`[META] Success: Message accepted with ID ${msgId}`);
            
            // Map wamid for real-time status updates
            if (msgId) {
              wamidToJob[msgId] = { jobId, phone: cleanPhone };
              await saveData('WAMID_MAP_UPDATE');
            }
          } catch (firstErr) {
            // Check for specific Error 132012 "Parameter format does not match"
            const errorCode = firstErr.response?.data?.error?.error_subcode || firstErr.response?.data?.error?.code;

            if (errorCode === 132012 || errorCode === 100) {
              console.log(`Fallback: Named parameters failing (Error ${errorCode}), trying positional for ${phone}`);

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
              const msgId = response.data?.messages?.[0]?.id;
              console.log(`[META] Fallback Success: Message accepted with ID ${msgId}`);

              // Map fallback wamid too
              if (msgId) {
                wamidToJob[msgId] = { jobId, phone: cleanPhone };
                requestSave('WAMID_MAP_UPDATE');
              }
            } else {
              throw firstErr; // Rethrow other errors
            }
          }
        }
        msgStatus = 'Sent ✅';

        // Update history
        sentHistory[phone] = { sentAt: Date.now(), jobId };
        await saveData();
      } catch (err) {
        // Detailed Meta Graph API error parsing
        const metaError = err.response?.data?.error?.message || err.message;
        const subCode = err.response?.data?.error?.error_subcode || err.response?.data?.error?.code;

        if (subCode === 131030) {
          msgStatus = 'Failed ❌ (Not on WhatsApp or Rate Limited)';
        } else {
          const metaErrObj = err.response?.data?.error;
          msgStatus = `Failed: ${mapMetaError(metaErrObj)}`;
        }
        console.error(`Failed to send to ${phone}: ${metaError}`);
      }

      // If successful, update sentHistory with cleaned phone (used for dedup)
      if (msgStatus.includes('✅')) {
        sentHistory[cleanPhone] = { sentAt: Date.now(), jobId };
        // Note: await saveData() is called after the result is pushed below
      }

      jobs[jobId].results.push({
        name: mapping.name ? contact[mapping.name] : (contact['name'] || contact['Name'] || contact['NAME'] || contact[Object.keys(contact)[Object.keys(contact).length > 0 ? 0 : 0]] || 'Unknown'),
        phone: cleanPhone || phone || 'N/A',
        status: msgStatus,
        details: messageType === 'template' ? payload.template : { text: textBody }
      });
      jobs[jobId].processed += 1;

      // Prune sentHistory if it exceeds 50k entries to keep memory low
      const historyKeys = Object.keys(sentHistory);
      if (historyKeys.length > 50000) {
        console.log(`[CLEANUP] Pruning sentHistory (Size: ${historyKeys.length})...`);
        const keysToRemove = historyKeys.slice(0, 1000); // Remove oldest 1000
        keysToRemove.forEach(k => delete sentHistory[k]);
      }

      await saveData('JOB_PROGRESS'); // Using saveData instead of undefined requestSave

      // Rate limit delay: 500ms provides a safe pace for Meta
      await sleep(500);
    }

    if (jobs[jobId].stopped) {
      jobs[jobId].status = 'Stopped';
    } else {
      jobs[jobId].status = 'Completed';
    }

    // Save to persistent file
    campaignHistory.unshift(jobs[jobId]);
    await saveData();
  })();
});

// History API
app.get('/api/history', async (req, res) => {
  res.json(campaignHistory);
});

// Clear history API
app.post('/api/history/clear', async (req, res) => {
  console.log('[CLEAR] Request received to wipe history');
  campaignHistory = [];
  Object.keys(jobs).forEach(key => delete jobs[key]);
  sentHistory = {};

  // Aggressive sync
  await saveData('CLEAR_ENDPOINT');
  res.json({ message: 'History cleared' });
});

// Status Polling API
app.get('/api/status/:jobId', async (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Pause Campaign API
app.post('/api/pause/:jobId', async (req, res) => {
  const job = jobs[req.params.jobId];
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
app.post('/api/resume/:jobId', async (req, res) => {
  const job = jobs[req.params.jobId];
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
app.post('/api/stop/:jobId', async (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'Running' || job.status === 'Paused') {
    job.stopped = true;
    job.paused = false; // unpause to break loop immediately
    res.json({ message: 'Campaign stopped' });
  } else {
    res.status(400).json({ error: 'Only active campaigns can be stopped' });
  }
});

// --- CONFIGURATION API ---

// Get current config
app.get('/api/config', async (req, res) => {
  res.json({
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || '',
    WABA_ID: process.env.WABA_ID || '',
    ACCESS_TOKEN: process.env.ACCESS_TOKEN || '',
    WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN || 'my_secret_token'
  });
});

// Update config
app.post('/api/config', async (req, res) => {
  const { PHONE_NUMBER_ID, WABA_ID, ACCESS_TOKEN } = req.body;

  // Validate required fields
  if (!PHONE_NUMBER_ID || !WABA_ID || !ACCESS_TOKEN) {
    return res.status(400).json({ error: 'PHONE_NUMBER_ID, WABA_ID, and ACCESS_TOKEN are all required.' });
  }

  // 1. Update in-memory for immediate use
  process.env.PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.WABA_ID = WABA_ID;
  process.env.ACCESS_TOKEN = ACCESS_TOKEN;

  // 2. Clear template cache to force fresh fetch with new IDs
  cachedTemplates = null;
  cachedTemplatesTime = 0;

  // 3. Persist to .env file
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    const updateEnv = (key, value) => {
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };

    updateEnv('PHONE_NUMBER_ID', PHONE_NUMBER_ID);
    updateEnv('WABA_ID', WABA_ID);
    updateEnv('ACCESS_TOKEN', ACCESS_TOKEN);

    fs.writeFileSync(envPath, envContent.trim() + '\n');
    console.log('[CONFIG] Credentials updated and saved to .env');
    res.json({ message: 'Configuration updated and synced!' });
  } catch (err) {
    console.error('[CONFIG] Error saving .env:', err);
    res.status(500).json({ error: 'Failed to persist configuration' });
  }
});

// Manual Phone Registration with Meta
app.post('/api/register', async (req, res) => {
  const { pin } = req.body;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

  if (!pin || pin.length !== 6) {
    return res.status(400).json({ error: 'A 6-digit PIN is required for registration.' });
  }

  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    return res.status(400).json({ error: 'PHONE_NUMBER_ID and ACCESS_TOKEN must be configured first.' });
  }

  console.log(`[META] Attempting to register phone ${PHONE_NUMBER_ID} with PIN...`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/register`,
      { messaging_product: 'whatsapp', pin },
      { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } }
    );

    console.log('[META] Registration Successful:', response.data);

    // After registration, force a template refresh to verify connection
    cachedTemplates = null;
    cachedTemplatesTime = 0;

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

// Webhook for tracking status
app.post('/webhook', async (req, res) => {
  let body = req.body;

  if (body && body.object) {
    // Debug: Log raw webhook to disk
    fs.appendFileSync('webhook.log', `[${new Date().toISOString()}] ${JSON.stringify(body, null, 2)}\n---\n`);
    
    try {
      const changes = body.entry?.[0]?.changes?.[0]?.value;
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
              
              await saveData('WEBHOOK_STATUS_UPDATE');
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
            // Check if we have this number in any recent jobs
            for (const jId in jobs) {
                const found = jobs[jId].results.find(r => r.phone === from);
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

        // PERSIST TO CLOUD
        try {
            await Chat.findOneAndUpdate(
                { phone: from },
                { 
                    $setOnInsert: { name: profileName },
                    $push: { messages: newMsg } 
                },
                { upsert: true }
            );
            await saveData('WEBHOOK_INCOMING_MSG');
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

// --- CHAT API ---
app.get('/api/chats', async (req, res) => {
  try {
    const dbChats = await Chat.find({}).sort({ updatedAt: -1 });
    const summarizedChats = dbChats.map(c => {
      const history = c.messages;
      const lastMsg = history[history.length - 1];
      return {
        phone: c.phone,
        name: c.name || 'Customer',
        lastText: lastMsg?.text || '',
        lastTimestamp: lastMsg?.timestamp || Date.now(),
        unread: false
      };
    }).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    
    res.json(summarizedChats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/chats/:phone', async (req, res) => {
  try {
    const chat = await Chat.findOne({ phone: req.params.phone });
    res.json(chat ? chat.messages : []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/reply', async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error: 'Phone and text are required' });
  
  try {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { body: text }
    };
    
    console.log(`[REPLY] Sending to ${phone}: ${text}`);
    
    await axios.post(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`, payload, {
      headers: { 'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
    });
    
    const newMsg = {
      id: `internal_${Date.now()}`,
      from: 'me',
      name: (chats[phone] && chats[phone].find(m => m.from === 'customer')?.name) || phone, 
      text: text,
      timestamp: Date.now(),
      type: 'text'
    };

    if (!chats[phone]) chats[phone] = [];
    chats[phone].push(newMsg);
    
    // Persist to Cloud
    try {
        await Chat.findOneAndUpdate(
            { phone },
            { $push: { messages: newMsg } },
            { upsert: true }
        );
        await saveData('USER_REPLY');
    } catch (err) {
        console.error('[DB ERROR] User reply failed:', err.message);
    }
    res.json({ success: true });
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    console.error('[REPLY] Failed:', metaError);
    res.status(err.response?.status || 500).json({ error: metaError });
  }
});

// --- JOB MEMORY CLEANUP ---
// Clean up in-memory jobs every hour to prevent memory leaks
// We only remove jobs that are Completed/Stopped and older than 12 hours
setInterval(async () => {
  const now = Date.now();
  Object.keys(jobs).forEach(id => {
    const job = jobs[id];
    if ((job.status === 'Completed' || job.status === 'Stopped') && (now - job.createdAt > 12 * 60 * 60 * 1000)) {
      console.log(`[CLEANUP] Removing old job ${id} from memory`);
      delete jobs[id];
    }
  });
  await saveData(); // Sync with disk
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
