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

// Auth header — PayHero uses Basic with a pre-built base64 token
function getAuthHeader() {
  return `Basic ${PAYHERO_AUTH_TOKEN}`;
}

console.log('🔧 PayHero Configuration:');
console.log('   API URL:', PAYHERO_BASE_URL);
console.log('   Channel ID:', PAYHERO_CHANNEL);
console.log('   Auth Token set:', PAYHERO_AUTH_TOKEN ? '✅ Yes' : '❌ No');

// ── POST /api/deposit — Initiate STK Push ─────────────────────
app.post('/api/deposit', async (req, res) => {
  const { amount, phone, userId, externalRef } = req.body;

  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone are required' });
  }

  // Normalize phone to 254XXXXXXXXX format
  let normalizedPhone = String(phone).replace(/\D/g, '');
  if (normalizedPhone.startsWith('254') && normalizedPhone.length === 12) {
    // already correct: 254XXXXXXXXX
  } else if (normalizedPhone.startsWith('0') && normalizedPhone.length === 10) {
    normalizedPhone = '254' + normalizedPhone.slice(1); // 07XX → 254 7XX
  } else if (!normalizedPhone.startsWith('254')) {
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
        provider:        process.env.PAYHERO_PROVIDER || 'm-pesa',
        external_reference: externalRef || `DEP_${userId || 'user'}_${Date.now()}`,
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

    // Pre-store as PENDING so polling works immediately
    if (reference) {
      paymentStore[reference] = { status: 'PENDING', amount: Number(amount) };
    }
    // Also store by external_reference so callback can find it
    const usedExtRef = externalRef || `DEP_${userId || 'user'}_${Date.now()}`;
    paymentStore[usedExtRef] = { status: 'PENDING', amount: Number(amount), payheroRef: reference };

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

// ── In-memory payment store (reference -> status) ────────────
const paymentStore = {};

// ── GET /api/deposit/status — Check stored payment status ─────
app.get('/api/deposit/status', (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.status(400).json({ error: 'reference is required' });
  }

  const payment = paymentStore[reference];
  console.log('🔍 Status check:', reference, '->', payment ? payment.status : 'PENDING');

  if (!payment) {
    return res.json({ status: 'PENDING' });
  }

  return res.json({
    status: payment.status,
    amount: payment.amount,
  });
});

// ── POST /api/callback — PayHero webhook ─────────────────────
app.post('/api/callback', (req, res) => {
  console.log('📬 PayHero callback:', JSON.stringify(req.body));

  try {
    const body = req.body;
    // PayHero sends: { status: true/false, response: { User_Reference, Amount, ... } }
    const response  = body.response || body;
    const userRef   = response.User_Reference || response.external_reference || '';
    const amount    = response.Amount || response.amount || 0;
    const mpesaRef  = response.MPESA_Reference || response.mpesa_reference || '';
    const success   = body.status === true || mpesaRef !== '';

    console.log(`💳 Callback - ref: ${userRef}, amount: ${amount}, success: ${success}, mpesa_ref: ${mpesaRef}`);

    // Store result keyed by external_reference (DEP_userId_timestamp)
    // The frontend polls using the PayHero reference, so we store under both
    const checkoutId = response.CheckoutRequestID || response.checkout_request_id || '';

    if (userRef) {
      paymentStore[userRef] = {
        status: success ? 'SUCCESS' : 'FAILED',
        amount: Number(amount),
      };
    }
    if (checkoutId) {
      paymentStore[checkoutId] = {
        status: success ? 'SUCCESS' : 'FAILED',
        amount: Number(amount),
      };
    }
  } catch (e) {
    console.error('❌ Callback parse error:', e.message);
  }

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
