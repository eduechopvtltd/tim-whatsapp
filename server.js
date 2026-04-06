const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory status tracking for MVP
const jobs = {};

// Setup multer for CSV uploads
const upload = multer({ dest: 'uploads/' });
const templatesPath = path.join(__dirname, 'templates.json');
const historyPath = path.join(__dirname, 'sent_history.json');

// Load history into memory
let sentHistory = {};
if (fs.existsSync(historyPath)) {
  try {
    sentHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch(e) {
    console.error("Could not parse history file", e);
  }
}

const saveHistory = () => {
  fs.writeFileSync(historyPath, JSON.stringify(sentHistory, null, 2));
};

// --- TEMPLATE CACHING ---
let cachedTemplates = null;
let cachedTemplatesTime = 0;

// --- MEDIA CACHING ---
const mediaCachePath = path.join(__dirname, 'media_cache.json');
let mediaCache = {};
if (fs.existsSync(mediaCachePath)) {
  try {
    mediaCache = JSON.parse(fs.readFileSync(mediaCachePath, 'utf8'));
  } catch(e) {
    console.error("Could not parse media cache file", e);
  }
}

const saveMediaCache = () => {
  fs.writeFileSync(mediaCachePath, JSON.stringify(mediaCache, null, 2));
};

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
    const response = await axios.get(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates`, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });

    const parsedTemplates = response.data.data.filter(t => t.status === 'APPROVED').map(t => {
      const variables = [];
      const portalNames = [];
      let headerType = null;
      let headerImageUrl = null;

      t.components.forEach(comp => {
        if (comp.type === 'HEADER' && comp.format === 'IMAGE') {
          headerType = 'IMAGE';
          // Extract the actual image URL that Meta already has stored
          if (comp.example && comp.example.header_handle && comp.example.header_handle.length > 0) {
            headerImageUrl = comp.example.header_handle[0];
          }
        }
        
        const text = comp.text || '';
        const matches = text.match(/{{([a-zA-Z0-9_]+)}}/g);
        if (matches) {
          matches.forEach(m => {
            const varName = m.replace(/[{}]/g, '');
            if (!portalNames.includes(varName)) {
              variables.push(varName);
              portalNames.push(varName);
            }
          });
        }
      });

      return {
        name: t.name,
        language: t.language,
        variables,
        portalNames,
        headerType,
        headerImageUrl
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

app.get('/api/templates', async (req, res) => {
  const templates = await getMetaTemplates();
  res.json(templates);
});

// CSV Upload and Parse endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  const results = [];
  if (!req.file) return res.status(400).send('No file uploaded.');

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => {
      // Basic empty row trimming
      const hasContent = Object.values(data).some(val => val && val.trim() !== '');
      if (hasContent) results.push(data);
    })
    .on('end', () => {
      fs.unlinkSync(req.file.path);
      res.json({
        headers: Object.keys(results[0] || {}),
        data: results,
      });
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
    const templates = await getMetaTemplates();
    template = templates.find(t => t.name === templateName);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found locally or on Meta' });
    }
  }

  // Double check and filter out truly blank mapped phone numbers
  const validContacts = contacts.filter(c => c[mapping.phone] && c[mapping.phone].trim() !== '');

  const jobId = Date.now().toString();
  jobs[jobId] = {
    status: 'Running',
    total: validContacts.length,
    processed: 0,
    results: [],
    paused: false,
  };

  res.json({ message: 'Sending started.', jobId });

  // Process asynchronously
  (async () => {
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || 'MOCK_ID';
    const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'MOCK_TOKEN';

    // If the template has an image header, download it and upload to Meta to get a media_id
    let cachedMediaId = null;
    if (template && template.headerType === 'IMAGE' && template.headerImageUrl) {
      if (mediaCache[template.name]) {
        console.log(`[MEDIA CACHE] Using cached media_id for template: ${template.name}`);
        cachedMediaId = mediaCache[template.name];
      } else {
        try {
          console.log('[MEDIA] Downloading header image from Meta CDN...');
          const imgResponse = await axios.get(template.headerImageUrl, { responseType: 'arraybuffer' });
          const imgBuffer = Buffer.from(imgResponse.data);
          const tmpPath = path.join(__dirname, 'uploads', `header_${Date.now()}.png`);
          fs.writeFileSync(tmpPath, imgBuffer);
          console.log(`[MEDIA] Image downloaded (${imgBuffer.length} bytes), uploading to Meta...`);

          const FormData = require('form-data');
          const formData = new FormData();
          formData.append('messaging_product', 'whatsapp');
          formData.append('file', fs.createReadStream(tmpPath), { filename: 'header.png', contentType: 'image/png' });

          const uploadRes = await axios.post(
            `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/media`,
            formData,
            { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, ...formData.getHeaders() } }
          );
          cachedMediaId = uploadRes.data.id;
          console.log(`[MEDIA] Upload success! media_id = ${cachedMediaId}`);
          
          // Save to persistent cache so we don't upload it again 
          mediaCache[template.name] = cachedMediaId;
          saveMediaCache();

          // Clean up temp file
          fs.unlinkSync(tmpPath);
        } catch (uploadErr) {
          console.error('[MEDIA] Image upload failed:', uploadErr.response?.data || uploadErr.message);
          console.log('[MEDIA] Will attempt to send without image header.');
        }
      }
    }

    for (let contact of validContacts) {
      // Pause check - wait until paused is false
      while (jobs[jobId] && jobs[jobId].paused) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const phone = contact[mapping.phone];
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
      
      // Auto-append India country code if only 10 digits provided
      if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone;
      }
      
      // Basic formatting check: must be at least 10 digits (minimum length including country code)
      if (cleanPhone.length < 10) {
        jobs[jobId].results.push({
          name: mapping.name ? contact[mapping.name] : 'Unknown',
          phone: phone || 'N/A',
          status: 'Failed ❌ (Invalid Format)'
        });
        jobs[jobId].processed += 1;
        continue;
      }
      
      let msgStatus = 'Failed ❌';
      
      // Duplicate Protection Logic
      if (!allowDuplicates && messageType === 'template' && templateName && cleanPhone) {
        if (sentHistory[cleanPhone] && sentHistory[cleanPhone].includes(templateName)) {
          jobs[jobId].results.push({
            name: mapping.name ? contact[mapping.name] : 'Unknown',
            phone: phone || 'N/A',
            status: 'Skipped ⏭️ (Already Sent)'
          });
          jobs[jobId].processed++;
          continue; // Skip this iteration entirely
        }
      }

      try {
        let payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone
        };

        if (messageType === 'text') {
          let textBody = customMessage || '';
          Object.keys(mapping).forEach(key => {
            textBody = textBody.replace(new RegExp(`{{${key}}}`, 'g'), contact[mapping[key]] || '');
          });
          
          payload.type = "text";
          payload.text = { body: textBody };
        } else {
          const parameters = template.variables.map((variable, idx) => {
            let val = String(contact[mapping[variable]] || '');
            if (variable.toLowerCase() === 'name') {
              val = val.split(' ')[0]; // Extract first name only
            }
            const param = {
              type: 'text',
              text: val
            };
            if (template.portalNames && template.portalNames[idx]) {
              param.parameter_name = template.portalNames[idx];
            }
            return param;
          });

          payload.type = "template";
          payload.template = {
            name: template.name,
            language: { code: template.language || "en_US" }
          };

          if (parameters.length > 0 || template.headerType === 'IMAGE') {
            payload.template.components = [];

            // Add Header component if it's an image — use cached media_id
            if (template.headerType === 'IMAGE' && cachedMediaId) {
              payload.template.components.push({
                type: "header",
                parameters: [{
                  type: "image",
                  image: { id: cachedMediaId }
                }]
              });
            }

            // Add Body component
            if (parameters.length > 0) {
              payload.template.components.push({
                type: "body",
                parameters: parameters
              });
            }
          }
        }

        if (ACCESS_TOKEN !== 'MOCK_TOKEN') {
          console.log(`[SEND] Payload to ${phone}:`, JSON.stringify(payload.template?.components, null, 2));
          try {
            await axios.post(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`, payload, {
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

              await axios.post(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`, fallbackPayload, {
                headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
              });
            } else {
              throw firstErr; // Rethrow other errors
            }
          }
        }
        msgStatus = 'Sent ✅';
        
        // Update history
        if (messageType === 'template' && templateName && cleanPhone) {
          if (!sentHistory[cleanPhone]) sentHistory[cleanPhone] = [];
          if (!sentHistory[cleanPhone].includes(templateName)) {
            sentHistory[cleanPhone].push(templateName);
            saveHistory();
          }
        }
      } catch (err) {
        // Detailed Meta Graph API error parsing
        const metaError = err.response?.data?.error?.message || err.message;
        const subCode = err.response?.data?.error?.error_subcode || err.response?.data?.error?.code;
        
        if (subCode === 131030) {
          msgStatus = 'Failed ❌ (Not on WhatsApp)';
        } else {
          msgStatus = `Failed ❌ (${subCode ? '#' + subCode + ' ' : ''}${metaError})`;
        }
        console.error(`Failed to send to ${phone}: ${metaError}`);
      }

      jobs[jobId].results.push({
        name: mapping.name ? contact[mapping.name] : 'Unknown',
        phone: phone || 'N/A',
        status: msgStatus
      });
      jobs[jobId].processed += 1;

      // Rate limit delay to prevent Meta blocking
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    jobs[jobId].status = 'Completed';
  })();
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
  console.log('Incoming Webhook Body:', JSON.stringify(body, null, 2));

  if (body.object) {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.statuses) {
      let statusInfo = body.entry[0].changes[0].value.statuses[0];
      let statusString = statusInfo.status; // sent, delivered, read, failed
      console.log(`[Webhook] Message to ${statusInfo.recipient_id} updated to: ${statusString}`);
      if (statusInfo.errors) {
        console.error('Webhook Error Details:', JSON.stringify(statusInfo.errors, null, 2));
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
