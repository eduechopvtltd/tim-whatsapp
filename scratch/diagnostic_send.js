const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function sendDiagnostic() {
  const { PHONE_NUMBER_ID, ACCESS_TOKEN } = process.env;
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('Missing credentials in .env');
    process.exit(1);
  }

  // Number provided in logs: 919082291898
  const testNumber = '919082291898'; 
  
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: testNumber,
    type: "template",
    template: {
      name: "test",
      language: { code: "en" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Ko_Tapu_Island%2C_Phuket%2C_Thailand.jpg" }
            }
          ]
        }
      ]
    }
  };

  console.log(`[DIAGNOSTIC] Sending template 'tedt' to ${testNumber}...`);
  console.log('[DIAGNOSTIC] Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );

    console.log('--- META RESPONSE ---');
    console.log(JSON.stringify(response.data, null, 2));
    
    const msgId = response.data?.messages?.[0]?.id;
    console.log(`\n[SUCCESS] Message accepted by Meta with ID: ${msgId}`);
    console.log(`[ACTION] Please check if message reached ${testNumber}.`);
    console.log(`[ACTION] Also check server.log for [Webhook] status updates for this ID.`);

  } catch (err) {
    console.error('--- META ERROR ---');
    if (err.response) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
  }
}

sendDiagnostic();
