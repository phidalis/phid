const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── PayHero Config ────────────────────────────────────────────
const PAYHERO_AUTH_TOKEN = process.env.PAYHERO_AUTH_TOKEN;
const PAYHERO_CHANNEL    = process.env.PAYHERO_CHANNEL_ID || '6341';

// ✅ CORRECT base URL for PayHero live environment
const PAYHERO_BASE_URL   = 'https://backend.payhero.co.ke/api/v2';

// Auth header using Bearer token
function getAuthHeader() {
  return `Bearer ${PAYHERO_AUTH_TOKEN}`;
}

console.log('🔧 PayHero Configuration:');
console.log('   API URL:', PAYHERO_BASE_URL);
console.log('   Channel ID:', PAYHERO_CHANNEL);
console.log('   Auth Token set:', PAYHERO_AUTH_TOKEN ? '✅ Yes' : '❌ No');

// ── POST /api/deposit — Initiate STK Push ─────────────────────
app.post('/api/deposit', async (req, res) => {
  const { amount, phone, userId } = req.body;

  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone are required' });
  }

  // Normalize phone to 254XXXXXXXXX format
  let normalizedPhone = String(phone).replace(/\D/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '254' + normalizedPhone.slice(1);
  }
  if (!normalizedPhone.startsWith('254')) {
    normalizedPhone = '254' + normalizedPhone;
  }

  console.log(`📱 Deposit request: KES ${amount} to ${normalizedPhone}`);

  try {
    const response = await axios.post(
      `${PAYHERO_BASE_URL}/payments`,   // ✅ Correct endpoint
      {
        amount:          Number(amount),
        phone_number:    normalizedPhone,
        channel_id:      Number(PAYHERO_CHANNEL),
        provider:        'm-pesa',
        external_reference: `DEP_${userId || 'user'}_${Date.now()}`,
        callback_url:    process.env.CALLBACK_URL || 'https://sportybet-1vl1.onrender.com/api/callback',
      },
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type':  'application/json',
        },
      }
    );

    console.log('✅ STK Push sent:', response.data);

    // PayHero returns a reference/transaction id to poll with
    const reference = response.data.reference
                   || response.data.CheckoutRequestID
                   || response.data.id
                   || response.data.transaction_id;

    return res.json({
      success:   true,
      reference: reference,
      message:   'STK push sent. Check your phone.',
    });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('❌ Deposit error:', errData);
    return res.status(500).json({ error: errData?.error_message || errData?.message || 'Payment failed' });
  }
});

// ── GET /api/deposit/status — Poll payment status ─────────────
app.get('/api/deposit/status', async (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.status(400).json({ error: 'reference is required' });
  }

  try {
    const response = await axios.get(
      `${PAYHERO_BASE_URL}/transaction-status`,  // ✅ Correct status endpoint
      {
        params:  { reference },
        headers: { 'Authorization': getAuthHeader() },
      }
    );

    console.log('🔍 Status check:', reference, '->', response.data?.status);

    const data   = response.data;
    const status = data.status || data.Status || '';

    // Normalise status to SUCCESS / FAILED / PENDING
    let normStatus = 'PENDING';
    if (['SUCCESS', 'COMPLETE', 'COMPLETED'].includes(status.toUpperCase())) normStatus = 'SUCCESS';
    if (['FAILED', 'CANCELLED', 'CANCELED'].includes(status.toUpperCase()))  normStatus = 'FAILED';

    return res.json({
      status: normStatus,
      amount: data.amount,
      raw:    data,
    });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('❌ Status check error:', errData);
    return res.status(500).json({ error: 'Could not check status', status: 'PENDING' });
  }
});

// ── POST /api/callback — PayHero webhook (optional) ───────────
app.post('/api/callback', (req, res) => {
  console.log('📬 PayHero callback:', JSON.stringify(req.body));
  res.json({ received: true });
});

// ── Serve game files ──────────────────────────────────────────
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'aviator.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🎮 Game URL: https://localhost:${PORT}/game`);
  console.log(`💳 PayHero Status: ${PAYHERO_AUTH_TOKEN ? '✅ Configured' : '❌ Missing auth token'}`);
});
