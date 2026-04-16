const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function checkAccount() {
  const { WABA_ID, ACCESS_TOKEN } = process.env;
  if (!WABA_ID || !ACCESS_TOKEN) {
    console.error('Missing WABA_ID or ACCESS_TOKEN in .env');
    process.exit(1);
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/v21.0/${WABA_ID}`, {
      params: { fields: 'id,status' },
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });
    console.log('--- Account Status ---');
    console.log(JSON.stringify(response.data, null, 2));

    const phoneRes = await axios.get(`https://graph.facebook.com/v21.0/${WABA_ID}/phone_numbers`, {
      params: { fields: 'id,display_phone_number,quality_rating,status,code_verification_status' },
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });
    console.log('\n--- Phone Numbers ---');
    console.log(JSON.stringify(phoneRes.data, null, 2));

  } catch (err) {
    console.error('Error fetching data from Meta:', err.response?.data || err.message);
  }
}

checkAccount();
