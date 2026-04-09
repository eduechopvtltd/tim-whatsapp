const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const stripBom = require('strip-bom-stream').default || require('strip-bom-stream');
const mime = require('mime-types');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;
const upload = multer({ dest: 'uploads/' });

// In-memory status tracking
const jobs = {};

app.use(cors());
app.use(express.json());

const campaignHistoryFile = path.join(__dirname, 'campaign_history.json');
const sentHistoryFile = path.join(__dirname, 'sent_history.json');
const mediaCacheFile = path.join(__dirname, 'media_cache.json');
const activeJobsFile = path.join(__dirname, 'active_jobs.json');

let campaignHistory = [];
let sentHistory = {};
let mediaCache = {};

const loadData = () => {
  if (fs.existsSync(campaignHistoryFile)) campaignHistory = JSON.parse(fs.readFileSync(campaignHistoryFile));
  if (fs.existsSync(sentHistoryFile)) sentHistory = JSON.parse(fs.readFileSync(sentHistoryFile));
  if (fs.existsSync(mediaCacheFile)) mediaCache = JSON.parse(fs.readFileSync(mediaCacheFile));
  if (fs.existsSync(activeJobsFile)) {
    const rawJobs = JSON.parse(fs.readFileSync(activeJobsFile));
    Object.keys(rawJobs).forEach(id => {
      if (rawJobs[id].status === 'Running') rawJobs[id].status = 'Paused (Server Restart)';
      jobs[id] = rawJobs[id];
    });
  }
};

const saveData = (source = 'unknown') => {
  console.log(`[SAVE] Saving state to disk (Source: ${source}).. `);
  try {
    fs.writeFileSync(campaignHistoryFile, JSON.stringify(campaignHistory, null, 2));
    fs.writeFileSync(sentHistoryFile, JSON.stringify(sentHistory, null, 2));
    fs.writeFileSync(mediaCacheFile, JSON.stringify(mediaCache, null, 2));
    fs.writeFileSync(activeJobsFile, JSON.stringify(jobs, null, 2));
    console.log(`[SAVE] Success: History size ${campaignHistory.length}, Active jobs ${Object.keys(jobs).length}`);
  } catch (err) {
    console.error(`[SAVE] Failed to save data: ${err.message}`);
  }
};

loadData();

// Helpers
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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

const getMetaTemplates = async () => {
  // If templates are cached and less than 1 hour old, use them to prevent rate limiting
  if (cachedTemplates && (Date.now() - cachedTemplatesTime < 3600000)) {
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
  const templates = await getMetaTemplates();
  res.json(templates);
});

app.get('/api/templates', async (req, res) => {
  const templates = await getMetaTemplates();
  res.json(templates);
});

// CSV Upload and Parse endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
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
      try { fs.unlinkSync(req.file.path); } catch(e) {}
      res.json({
        headers: Object.keys(results[0] || {}),
        data: results,
      });
    })
    .on('error', (err) => {
      // Clean up temp file on error too
      try { fs.unlinkSync(req.file.path); } catch(e) {}
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
  saveData(); // Persist job creation immediately

  // Process asynchronously
  (async () => {
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || 'MOCK_ID';
    const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'MOCK_TOKEN';

    // One-Stop Media Handler: Supports IMAGE, VIDEO, and DOCUMENT headers
    let cachedHeaderMediaId = null;
    const header = template.componentsData.header;
    
    if (header.type && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.type) && header.imageUrl) {
      let cached = mediaCache[template.name];
      if (typeof cached === 'string') cached = { id: cached, uploadedAt: 0 };

      const isExpired = !cached || !cached.uploadedAt || (Date.now() - cached.uploadedAt > 25 * 24 * 60 * 60 * 1000);
      
      if (cached && cached.id && !isExpired) {
        console.log(`[MEDIA CACHE] Using cached ${header.type} media_id for template: ${template.name}`);
        cachedHeaderMediaId = cached.id;
      } else {
        try {
          console.log(`[MEDIA] Downloading template ${header.type} from Meta CDN...`);
          const mediaResponse = await axios.get(header.imageUrl, { responseType: 'arraybuffer' });
          const mediaBuffer = Buffer.from(mediaResponse.data);
          
          const contentType = mediaResponse.headers['content-type'] || 'application/octet-stream';
          const extension = mime.extension(contentType) || 'bin';
          const tmpPath = path.join(__dirname, 'uploads', `header_${Date.now()}.${extension}`);
          
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
          console.log(`[MEDIA] Upload success! media_id = ${cachedHeaderMediaId} (Type: ${contentType})`);
          
          mediaCache[template.name] = { id: cachedHeaderMediaId, uploadedAt: Date.now() };
          saveData(); // Persistent sync
          fs.unlinkSync(tmpPath);
        } catch (uploadErr) {
          console.error(`[MEDIA] ${header.type} upload failed:`, uploadErr.response?.data || uploadErr.message);
        }
      }
    }

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

      try {
        let payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone
        };

        if (messageType === 'text') {
          let textBody = customMessage || '';
          // Replacing any {{CSV Column Name}} with the actual row data
          Object.keys(contact).forEach(csvHeader => {
            textBody = textBody.replace(new RegExp(`{{${csvHeader}}}`, 'g'), contact[csvHeader] || '');
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
              // Priority: Mapped URL > Cached/Default ID
              const mappedMediaUrl = mapping.header_media_url ? String(contact[mapping.header_media_url] || '').trim() : null;
              const typeLower = compData.header.type.toLowerCase();
              
              if (mappedMediaUrl) {
                headerComp.parameters.push({ type: typeLower, [typeLower]: { link: mappedMediaUrl } });
              } else if (cachedHeaderMediaId) {
                headerComp.parameters.push({ type: typeLower, [typeLower]: { id: cachedHeaderMediaId } });
              }
            } else if (compData.header.type === 'TEXT' && compData.header.variables.length > 0) {
              compData.header.variables.forEach((variable, idx) => {
                const val = String(contact[mapping[`header_${variable}`]] || '');
                headerComp.parameters.push({ type: "text", text: val });
              });
            }

            if (headerComp.parameters.length > 0) {
              payload.template.components.push(headerComp);
            }
          }

          // 2. Body Component
          if (compData.body.variables.length > 0) {
            const bodyComp = { type: "body", parameters: [] };
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
          }

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
            await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, payload, {
              headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
            });
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

              await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, fallbackPayload, {
                headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
              });
            } else {
              throw firstErr; // Rethrow other errors
            }
          }
        }
        msgStatus = 'Sent ✅';
        
        // Update history
        sentHistory[phone] = { sentAt: Date.now(), jobId };
        saveData();
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
        // Note: saveData() is called after the result is pushed below
      }

      jobs[jobId].results.push({
        name: mapping.name ? contact[mapping.name] : (contact['name'] || contact['Name'] || contact['NAME'] || contact[Object.keys(contact)[0]] || 'Unknown'),
        phone: cleanPhone || phone || 'N/A',
        status: msgStatus
      });
      jobs[jobId].processed += 1;
      saveData(); // Single save per contact processed

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
    saveData();
  })();
});

// History API
app.get('/api/history', (req, res) => {
  res.json(campaignHistory);
});

// Clear history API
app.post('/api/history/clear', (req, res) => {
  console.log('[CLEAR] Request received to wipe history');
  campaignHistory = [];
  Object.keys(jobs).forEach(key => delete jobs[key]);
  sentHistory = {};
  
  // Aggressive sync
  saveData('CLEAR_ENDPOINT');
  res.json({ message: 'History cleared' });
});

// Status Polling API
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Pause Campaign API
app.post('/api/pause/:jobId', (req, res) => {
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
app.post('/api/resume/:jobId', (req, res) => {
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
app.post('/api/stop/:jobId', (req, res) => {
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
app.get('/api/config', (req, res) => {
  res.json({
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || '',
    WABA_ID: process.env.WABA_ID || '',
    ACCESS_TOKEN: process.env.ACCESS_TOKEN || '',
    WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN || 'my_secret_token'
  });
});

// Update config
app.post('/api/config', (req, res) => {
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

// Active Job API (Recovery)
app.get('/api/active-job', (req, res) => {
  const activeJobId = Object.keys(jobs).find(
    id => jobs[id].status === 'Running' || jobs[id].status === 'Paused'
  );
  if (activeJobId) {
    res.json({ jobId: activeJobId, status: jobs[activeJobId] });
  } else {
    res.json({ jobId: null });
  }
});

// Webhook Verification (Meta requires this to subscribe)
app.get('/webhook', (req, res) => {
  const verify_token = process.env.WEBHOOK_VERIFY_TOKEN;
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  console.log('Incoming Webhook Verification Request:', { mode, token, challenge });

  if (mode === "subscribe" && token === verify_token) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    console.warn("WEBHOOK_VERIFICATION_FAILED: Token mismatch or invalid mode");
    res.sendStatus(403);
  }
});

// Webhook for tracking status
app.post('/webhook', (req, res) => {
  let body = req.body;

  if (body && body.object) {
    try {
      const changes = body.entry?.[0]?.changes?.[0]?.value;
      if (changes?.statuses) {
        let statusInfo = changes.statuses[0];
        let statusString = statusInfo.status; // sent, delivered, read, failed
        console.log(`[Webhook] Message to ${statusInfo.recipient_id} updated to: ${statusString}`);
        if (statusInfo.errors) {
          console.error('Webhook Error Details:', JSON.stringify(statusInfo.errors, null, 2));
        }
      } else if (changes?.messages) {
        // Incoming message received
        console.log('[Webhook] Incoming message received:', JSON.stringify(changes.messages[0], null, 2));
      }
    } catch (parseErr) {
      console.error('[Webhook] Error parsing body:', parseErr.message);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// --- JOB MEMORY CLEANUP ---
// Clean up in-memory jobs every hour to prevent memory leaks
// We only remove jobs that are Completed/Stopped and older than 12 hours
setInterval(() => {
  const now = Date.now();
  Object.keys(jobs).forEach(id => {
    const job = jobs[id];
    if ((job.status === 'Completed' || job.status === 'Stopped') && (now - job.createdAt > 12 * 60 * 60 * 1000)) {
      console.log(`[CLEANUP] Removing old job ${id} from memory`);
      delete jobs[id];
    }
  });
  saveData(); // Sync with disk
}, 3600000); // Every 1 hour

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
