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
const nodemailer = require('nodemailer');
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
            return false;
        }
        await mongoose.connect(uri);
        console.log('[DB] ✅ Connected to MongoDB Atlas');
        
        // Migration: Ensure all legacy chats have a lastMessageAt field for stable sorting
        await Chat.updateMany(
            { lastMessageAt: { $exists: false } },
            [{ $set: { lastMessageAt: "$updatedAt" } }],
            { updatePipeline: true }
        );
        
        return true;
    } catch (err) {
        console.error('[DB] ❌ Connection error:', err.message);
        return false;
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

// --- PERSISTENT JOB CACHE ---
// Used for real-time monitoring of actively running workers.
let jobs = {};            // { userId: { jobId: { status, results, ... } } }
let wamidToJob = {};      // { wamid: { jobId, phone, userId } }
let sentHistory = {};     // { phone: { sentAt, jobId } } (Shared cache)
// Persistent storage is handled by MongoDB via the Chat Schema

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

// ═══════════════════ MODULAR ENGINE HELPERS ═══════════════════

// --- EMAIL NOTIFICATION SYSTEM ---
async function sendEmailNotification(userId, msgDetails) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.emailConfig || !user.emailConfig.enabled) return;

    const { smtpHost, smtpPort, smtpUser, smtpPass, notifyEmail } = user.emailConfig;
    if (!smtpHost || !smtpUser || !smtpPass || !notifyEmail) {
        console.warn(`[EMAIL] Missing configuration for user ${userId}. Skipping alert.`);
        return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailOptions = {
      from: `"TIM Cloud Alerts" <${smtpUser}>`,
      to: notifyEmail,
      subject: `New Message from ${msgDetails.name || msgDetails.from}`,
      text: `You have received a new WhatsApp message.\n\nFrom: ${msgDetails.name} (${msgDetails.from})\nMessage: ${msgDetails.text}\n\nCheck your dashboard for more details.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #10b981;">New WhatsApp Message</h2>
          <p><strong>From:</strong> ${msgDetails.name} (${msgDetails.from})</p>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            ${msgDetails.text}
          </div>
          <p style="font-size: 12px; color: #666;">This is an automated notification from your TIM Cloud CRM.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Notification sent to ${notifyEmail} for user ${userId}`);
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send notification:`, err.message);
  }
}

// ═══════════════════ RESILIENT CAMPAIGN ENGINE ═══════════════════

async function runCampaignWorker(campaignId) {
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign || ['Completed', 'Stopped'].includes(campaign.status)) return;

    const { userId, id: jobIdNum } = campaign;
    const jobId = jobIdNum.toString();

    // Ensure it's in the memory cache for the UI polling
    if (!jobs[userId]) jobs[userId] = {};
    jobs[userId][jobId] = campaign.toObject();

    console.log(`[WORKER] Starting/Resuming Campaign ${jobId} for user ${userId}`);

    const { contacts, mapping, messageType, templateName, customMessage, config, processed } = campaign;
    const { token: ACCESS_TOKEN, phoneId: PHONE_NUMBER_ID, wabaId: WABA_ID } = config;

    // Smart Deduplication check (re-run to avoid overlaps)
    const alreadySentSet = new Set();
    campaign.results.forEach(r => {
      const s = r.status.toLowerCase();
      if (s.includes('✅') || s.includes('sent') || s.includes('delivered') || s.includes('read')) {
        alreadySentSet.add(r.phone);
      }
    });

    let template = null;
    if (messageType !== 'text') {
      const templates = await getMetaTemplatesForUser(WABA_ID, ACCESS_TOKEN);
      template = templates.find(t => t.name === templateName);
    }

    let cachedHeaderMediaId = mapping?.header_media_url || null;

    // THE WORK LOOP
    for (let i = processed; i < contacts.length; i++) {
      // Re-fetch level check for PAUSE/STOP status changes from other API calls
      const currentJob = await Campaign.findById(campaignId);
      if (!currentJob || currentJob.status === 'Stopped') break;

      if (currentJob.status === 'Paused') {
        console.log(`[WORKER] Campaign ${jobId} is Paused. Waiting 5s...`);
        jobs[userId][jobId].status = 'Paused';
        await sleep(5000);
        i--; // Retry this index
        continue;
      }

      jobs[userId][jobId].status = 'Running';

      const contact = contacts[i];
      const phone = String(contact[mapping.phone] || '').trim();
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

      let wamid = null, msgStatus = 'Pending', payload = null, error = null;

      // --- DEDUPLICATION CHECK ---
      if (alreadySentSet.has(cleanPhone)) {
        msgStatus = 'Skipped ✅ (Duplicate)';
        console.log(`[WORKER] Skipping duplicate: ${cleanPhone}`);
      } else {
        await sleep(250);
        try {
          if (messageType === 'text') {
            let text = customMessage || '';
            Object.keys(contact).forEach(k => {
              text = text.replace(new RegExp(`{{\\s*${escapeRegExp(k)}\\s*}}`, 'gi'), contact[k] || '');
            });
            payload = buildTextPayload(cleanPhone, text);
          } else {
            payload = buildTemplatePayload(cleanPhone, template, mapping, contact, cachedHeaderMediaId);
          }

          const response = await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, payload, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
          });
          
          msgStatus = 'Sent ✅';
          wamid = response.data.messages?.[0]?.id;

          if (wamid) {
            wamidToJob[wamid] = { jobId, phone: cleanPhone, userId };
            new WamidMapping({ wamid, userId, jobId, phone: cleanPhone }).save().catch(() => {});
            
            // Sync to individual Chat history
            const outboundMsg = {
                id: wamid,
                from: 'me',
                name: cleanPhone,
                text: messageType === 'template' ? `[Sent Template: ${templateName}]` : (customMessage || ''),
                timestamp: Date.now(),
                type: messageType
            };
            Chat.findOneAndUpdate(
                { userId: userId, phone: cleanPhone },
                { $push: { messages: outboundMsg }, $set: { updatedAt: Date.now(), lastMessageAt: Date.now() } },
                { upsert: true }
            ).catch(() => {});
          }
        } catch (err) {
          error = err.response?.data?.error ? mapMetaError(err.response.data.error) : err.message;
          msgStatus = `Failed ❌ (${error})`;
        }
      }

      // PERSIST PROGRESS
      const updateData = {
        $inc: { processed: 1 },
        $push: {
          results: {
            phone: cleanPhone,
            name: contact[mapping.name] || 'Customer',
            status: msgStatus,
            error: error,
            wamid: wamid,
            timestamp: new Date()
          }
        }
      };
      if (msgStatus.includes('✅')) updateData.$inc.sent = 1;
      else updateData.$inc.failed = 1;

      const updatedCampaign = await Campaign.findByIdAndUpdate(campaignId, updateData, { new: true });
      jobs[userId][jobId] = updatedCampaign.toObject();
    }

    const finalStatus = (await Campaign.findById(campaignId)).status;
    if (finalStatus !== 'Stopped') {
        const finishedCampaign = await Campaign.findByIdAndUpdate(campaignId, { status: 'Completed' }, { new: true });
        jobs[userId][jobId] = finishedCampaign.toObject();
        console.log(`[WORKER] Campaign ${jobId} Completed!`);
    }

  } catch (workerErr) {
    console.error(`[WORKER FATAL ERROR]`, workerErr);
    await Campaign.findByIdAndUpdate(campaignId, { status: 'Error' });
  }
}

async function resumeActiveCampaigns() {
    try {
        const active = await Campaign.find({ status: { $in: ['Running', 'Paused'] } });
        console.log(`[STARTUP] Found ${active.length} active campaigns to maintain.`);
        for (const campaign of active) {
            runCampaignWorker(campaign._id);
        }
    } catch (err) {
        console.error('[STARTUP] Resume Error:', err);
    }
}

/**
 * Build a simple text message payload
 */
function buildTextPayload(to, text) {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: text }
    };
}

/**
 * Build a complex template message payload (NAMED or POSITIONAL)
 */
function buildTemplatePayload(to, template, mapping, contact, cachedHeaderMediaId) {
    const isNamed = template.format === 'NAMED';
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "template",
        template: {
            name: template.name,
            language: { code: template.language || "en_US" },
            components: []
        }
    };

    const compData = template.componentsData;

    // 1. Header Component
    if (compData.header.type) {
        const headerComp = { type: "header", parameters: [] };
        const typeLower = compData.header.type.toLowerCase();

        if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(compData.header.type)) {
            if (cachedHeaderMediaId) {
                const mediaParam = {
                    type: typeLower,
                    [typeLower]: { id: String(cachedHeaderMediaId) }
                };
                if (isNamed) {
                    const headerObj = template.rawComponents.find(c => c.type === 'HEADER');
                    const mediaParamName = headerObj?.example?.header_handle_named_params?.[0]?.param_name || 'header_image';
                    mediaParam.parameter_name = mediaParamName;
                }
                headerComp.parameters.push(mediaParam);
            }
        } else if (compData.header.type === 'TEXT' && compData.header.variables.length > 0) {
            compData.header.variables.forEach(variable => {
                const csvCol = mapping[variable];
                const val = csvCol ? String(contact[csvCol] || '') : '';
                const param = { type: "text", text: val || ' ' };
                if (isNamed) param.parameter_name = variable;
                headerComp.parameters.push(param);
            });
        }

        if (headerComp.parameters.length > 0) {
            payload.template.components.push(headerComp);
        }
    }

    // 2. Body Component
    if (compData.body.variables.length > 0) {
        const bodyComp = { type: "body", parameters: [] };
        compData.body.variables.forEach(variable => {
            const csvCol = mapping[variable];
            let val = csvCol ? String(contact[csvCol] || '') : '';
            if (variable.toLowerCase() === 'name' && val.includes(' ')) {
                val = val.split(' ')[0];
            }
            const param = { type: 'text', text: val || ' ' };
            if (isNamed) param.parameter_name = variable;
            bodyComp.parameters.push(param);
        });
        payload.template.components.push(bodyComp);
    }

    // 3. Button Components
    compData.buttons.forEach(btn => {
        if (btn.type === 'URL' && btn.variables.length > 0) {
            const btnComp = {
                type: "button",
                sub_type: "url",
                index: String(btn.index),
                parameters: []
            };
            btn.variables.forEach(variable => {
                const csvCol = mapping[`btn_${btn.index}_${variable}`] || mapping[variable];
                const val = csvCol ? String(contact[csvCol] || '') : '';
                if (val) {
                    const bParam = { type: "text", text: val };
                    if (isNamed) bParam.parameter_name = variable;
                    btnComp.parameters.push(bParam);
                }
            });
            if (btnComp.parameters.length > 0) payload.template.components.push(btnComp);
        }

        if (btn.type === 'FLOW') {
            payload.template.components.push({
                type: "button",
                sub_type: "flow",
                index: String(btn.index),
                parameters: [{
                    type: "action",
                    action: { flow_token: `flow_${Date.now()}_${Math.random().toString(36).substr(2, 6)}` }
                }]
            });
        }

        if (btn.type === 'COPY_CODE') {
            const codeCol = mapping[`btn_${btn.index}_code`] || mapping['coupon_code'] || mapping['code'];
            const code = codeCol ? String(contact[codeCol] || 'CODE') : 'CODE';
            payload.template.components.push({
                type: "button",
                sub_type: "copy_code",
                index: String(btn.index),
                parameters: [{ type: "coupon_code", coupon_code: code }]
            });
        }
    });

    return payload;
}

/**
 * Build a media message payload (image, video, document)
 */
function buildMediaPayload(to, type, mediaId, text, filename) {
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: type,
        [type]: { id: mediaId }
    };

    if (text) payload[type].caption = text;
    if (type === 'document' && filename) {
        payload.document.filename = filename;
    }

    return payload;
}

// ══════════════════════════════════════════════════════════════

// --- TEMPLATE FETCHING (User Scoped) ---
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
      // ═══ PERFECTLY SYNC WITH META'S RAW TEMPLATE STRUCTURE ═══
      // We store the RAW components from Meta AND a clean parsed version
      const componentsData = {
        header: { type: null, text: null, imageUrl: null, variables: [] },
        body: { text: null, variables: [] },
        footer: { text: null },
        buttons: []
      };

      // Helper: extract variable names from text like "Hello {{name}}, your code is {{code}}"
      const extractVars = (text) => {
        if (!text) return [];
        const matches = text.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];
        return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
      };

      t.components.forEach(comp => {
        switch (comp.type) {
          case 'HEADER':
            componentsData.header.type = comp.format; // TEXT, IMAGE, VIDEO, DOCUMENT
            componentsData.header.text = comp.text || null;
            // Extract media example URL for auto-download
            if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(comp.format)) {
              componentsData.header.imageUrl = comp.example?.header_handle?.[0] || null;
            }
            // Extract text header variables
            componentsData.header.variables = extractVars(comp.text);
            break;

          case 'BODY':
            componentsData.body.text = comp.text || null;
            componentsData.body.variables = extractVars(comp.text);
            break;

          case 'FOOTER':
            componentsData.footer.text = comp.text || null;
            break;

          case 'BUTTONS':
            (comp.buttons || []).forEach((btn, idx) => {
              const btnData = {
                type: btn.type,       // URL, QUICK_REPLY, PHONE_NUMBER, FLOW, COPY_CODE, OTP
                text: btn.text || '',
                index: idx,
                url: btn.url || null,         // For URL buttons
                phone_number: btn.phone_number || null, // For PHONE buttons
                flow_id: btn.flow_id || null,  // For FLOW buttons
                flow_name: btn.flow_name || null,
                flow_action: btn.flow_action || null,
                variables: []                  // Only URL buttons have dynamic variables
              };
              // Only URL buttons can have dynamic {{variables}} in the URL
              if (btn.type === 'URL' && btn.url) {
                btnData.variables = extractVars(btn.url);
              }
              componentsData.buttons.push(btnData);
            });
            break;
        }
      });

      return {
        name: t.name,
        language: t.language,
        category: t.category,                           // MARKETING, UTILITY, AUTHENTICATION
        format: t.parameter_format || 'POSITIONAL',     // NAMED or POSITIONAL
        rawComponents: t.components,                     // Keep raw Meta data for reference
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
    res.json({ mediaId: response.data.id });
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
  const jobId = Date.now();

  // Initialize Persistent Campaign record
  const campaign = new Campaign({
    userId,
    id: jobId,
    name: templateName || 'Custom Text Campaign',
    status: 'Running',
    totalContacts: contacts.length,
    contacts,
    messageType,
    templateName,
    templateParams,
    customMessage,
    mapping,
    config: {
        phoneId: user.config.phoneId,
        token: user.config.token,
        wabaId: user.config.wabaId
    }
  });

  await campaign.save();

  // Trigger the resilient worker
  runCampaignWorker(campaign._id);

  res.json({ message: 'Campaign started successfully', jobId: jobId.toString() });
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
  const userId = req.user.id;
  const jobId = req.params.jobId;

  // 1. Check memory cache (for active jobs)
  if (jobs[userId] && jobs[userId][jobId]) {
    return res.json(jobs[userId][jobId]);
  }

  // 2. Fallback to DB
  try {
    const campaign = await Campaign.findOne({ userId, id: parseInt(jobId) });
    if (campaign) return res.json(campaign);
    res.status(404).json({ error: 'Job not found' });
  } catch (err) {
    res.status(500).json({ error: 'Database fetch failed' });
  }
});

// Pause Campaign API
app.post('/api/pause/:jobId', authenticateToken, async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
        { userId: req.user.id, id: parseInt(req.params.jobId), status: 'Running' },
        { status: 'Paused' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ error: 'Running campaign not found' });
    
    // Sync memory cache if it exists
    if (jobs[req.user.id] && jobs[req.user.id][req.params.jobId]) {
        jobs[req.user.id][req.params.jobId].status = 'Paused';
    }
    
    res.json({ message: 'Campaign paused', status: 'Paused' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Resume Campaign API
app.post('/api/resume/:jobId', authenticateToken, async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
        { userId: req.user.id, id: parseInt(req.params.jobId), status: 'Paused' },
        { status: 'Running' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ error: 'Paused campaign not found' });

    // Sync memory cache and ensure worker is running if dead
    if (!jobs[req.user.id]?.[req.params.jobId] || jobs[req.user.id][req.params.jobId].status !== 'Running') {
        runCampaignWorker(campaign._id);
    } else {
        jobs[req.user.id][req.params.jobId].status = 'Running';
    }

    res.json({ message: 'Campaign resumed', status: 'Running' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Stop Campaign API
app.post('/api/stop/:jobId', authenticateToken, async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
        { userId: req.user.id, id: parseInt(req.params.jobId), status: { $in: ['Running', 'Paused'] } },
        { status: 'Stopped' },
        { new: true }
    );
    if (!campaign) return res.status(404).json({ error: 'Active campaign not found' });

    if (jobs[req.user.id] && jobs[req.user.id][req.params.jobId]) {
        jobs[req.user.id][req.params.jobId].status = 'Stopped';
    }

    res.json({ message: 'Campaign stopped' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
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
      WEBHOOK_VERIFY_TOKEN: user.config.verifyToken,
      emailConfig: user.emailConfig
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

// --- EMAIL SETTINGS API ---

// Update Email Configuration
app.post('/api/settings/email', authenticateToken, async (req, res) => {
  try {
    const { enabled, smtpHost, smtpPort, smtpUser, smtpPass, notifyEmail } = req.body;
    
    await User.findByIdAndUpdate(req.user.id, {
      $set: {
        'emailConfig.enabled': enabled,
        'emailConfig.smtpHost': smtpHost,
        'emailConfig.smtpPort': smtpPort,
        'emailConfig.smtpUser': smtpUser,
        'emailConfig.smtpPass': smtpPass,
        'emailConfig.notifyEmail': notifyEmail
      }
    });

    res.json({ success: true, message: 'Email configuration updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update email settings' });
  }
});

// Test Email Configuration
app.post('/api/settings/email/test', authenticateToken, async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, notifyEmail } = req.body;
    
    if (!smtpHost || !smtpUser || !smtpPass || !notifyEmail) {
      return res.status(400).json({ error: 'Incomplete configuration for testing' });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `"TIM Cloud Test" <${smtpUser}>`,
      to: notifyEmail,
      subject: 'TIM Cloud SMTP Test Connection',
      text: 'Congratulations! Your SMTP connection is configured correctly and working.',
    });

    res.json({ success: true, message: 'Test email sent successfully! Check your inbox.' });
  } catch (err) {
    console.error('[EMAIL TEST ERROR]', err.message);
    res.status(500).json({ error: `Connection failed: ${err.message}` });
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
        const msgType = msg.type;
        
        switch (msgType) {
            case 'text':
                text = msg.text?.body || '';
                break;
            case 'image':
                text = msg.image?.caption || '📷 Image';
                break;
            case 'video':
                text = msg.video?.caption || '🎥 Video';
                break;
            case 'document':
                text = msg.document?.filename || '📄 Document';
                break;
            case 'audio':
                text = '🔊 Audio message';
                break;
            case 'sticker':
                text = '🏷️ Sticker';
                break;
            case 'location':
                text = '📍 Location';
                break;
            case 'button':
                // For template button replies, Meta sends button.text
                text = msg.button?.text || 'Interactive Reply';
                break;
            case 'interactive':
                // For interactive buttons or list clicks
                text = msg.interactive?.button_reply?.title || 
                       msg.interactive?.list_reply?.title || 
                       '[Interactive]';
                break;
            default:
                text = `[${msgType} message]`;
        }
        
        console.log(`[Webhook] Message from ${from} (${profileName}): ${text}`);
        
        const newMsg = {
          id: msg.id,
          from: 'customer',
          name: profileName,
          text: text,
          timestamp: Date.now(),
          type: msg.type
        };

        // PERSIST TO CLOUD (Scoped to User)
        try {
            await Chat.findOneAndUpdate(
                { userId: userId, phone: from },
                { 
                    $setOnInsert: { name: profileName },
                    $push: { messages: newMsg },
                    $inc: { unreadCount: 1 },
                    $set: { updatedAt: Date.now(), lastMessageAt: Date.now() }
                },
                { upsert: true }
            );
            
            // TRIGGER EMAIL NOTIFICATION
            sendEmailNotification(userId, {
                from: from,
                name: profileName,
                text: text
            });
            
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
    // Only show chats where there is at least one incoming message from the customer
    const dbChats = await Chat.find({ 
      userId: req.user.id,
      "messages.from": "customer" 
    }).sort({ lastMessageAt: -1, _id: -1 });
    res.json(dbChats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get specific chat history with media syncing
app.get('/api/chats/:phone', authenticateToken, async (req, res) => {
  try {
    const chat = await Chat.findOne({ userId: req.user.id, phone: req.params.phone });
    if (!chat || !chat.messages.length) return res.json([]);

    const user = await User.findById(req.user.id);
    const token = user?.config?.token;
    
    // Enrich messages with fresh media URLs if needed
    const enrichedMessages = await Promise.all(chat.messages.map(async (msg) => {
      // If it's a media message and we have an access token, try to resolve a fresh URL
      if (msg.mediaId && token && msg.type !== 'text') {
        try {
          const metaRes = await axios.get(`https://graph.facebook.com/v21.0/${msg.mediaId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (metaRes.data && metaRes.data.url) {
            return { ...msg.toObject(), mediaUrl: metaRes.data.url };
          }
        } catch (metaErr) {
          console.warn(`[META MEDIA SYNC] Failed to fetch URL for ID ${msg.mediaId}:`, metaErr.message);
        }
      }
      return msg;
    }));

    res.json(enrichedMessages);
  } catch (err) {
    console.error('[API] Chat history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch chat details' });
  }
});

// Mark chat as read
app.post('/api/chats/:phone/read', authenticateToken, async (req, res) => {
  try {
    await Chat.findOneAndUpdate(
      { userId: req.user.id, phone: req.params.phone },
      { $set: { unreadCount: 0 } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

app.post('/api/reply', authenticateToken, async (req, res) => {
  const { phone, text, type = 'text', mediaId, filename } = req.body;
  const userId = req.user.id;
  const user = await User.findById(userId);

  if (!phone) return res.status(400).json({ error: 'Phone is required' });
  if (type === 'text' && !text) return res.status(400).json({ error: 'Text is required for text messages' });
  if (type !== 'text' && !mediaId) return res.status(400).json({ error: 'Media ID is required for non-text messages' });

  if (!user || !user.config.token || !user.config.phoneId) {
     return res.status(400).json({ error: 'WhatsApp Credentials not configured' });
  }
  
  try {
    let payload = null;
    if (type === 'text') {
      payload = buildTextPayload(phone, text);
    } else {
      payload = buildMediaPayload(phone, type, mediaId, text, filename);
    }
    
    console.log(`[REPLY] Sending ${type} to ${phone}`);
    
    await axios.post(`https://graph.facebook.com/v21.0/${user.config.phoneId}/messages`, payload, {
      headers: { 'Authorization': `Bearer ${user.config.token}`, 'Content-Type': 'application/json' }
    });
    
    const newMsg = {
      id: `internal_${Date.now()}`,
      from: 'me',
      name: phone, 
      text: text || '',
      timestamp: Date.now(),
      type: type,
      mediaId: mediaId,
      filename: filename
    };

    await Chat.findOneAndUpdate(
        { userId: userId, phone: phone },
        { 
            $push: { messages: newMsg },
            $set: { updatedAt: Date.now(), lastMessageAt: Date.now() }
        },
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
    connectDB().then(connected => {
        if (connected) {
            // Resume active campaigns from DB upon successful connection
            resumeActiveCampaigns();
        }
    });

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
