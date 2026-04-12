const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');
const admin   = require('firebase-admin');

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Firebase Admin (server-side Firestore writes) ─────────────
// Set FIREBASE_SERVICE_ACCOUNT env var on Render with your service account JSON (stringified)
// OR place serviceAccountKey.json in the project root
let db = null;
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  db = admin.firestore();
  console.log('🔥 Firebase Admin SDK initialized');
} catch (e) {
  console.warn('⚠️  Firebase Admin SDK NOT initialized:', e.message);
  console.warn('   Deposit callbacks will only update in-memory store.');
  console.warn('   Set FIREBASE_SERVICE_ACCOUNT env var on Render to enable Firebase writes.');
}

// ── PayHero Config ────────────────────────────────────────────
const PAYHERO_AUTH_TOKEN = process.env.PAYHERO_AUTH_TOKEN;
const PAYHERO_CHANNEL    = process.env.PAYHERO_CHANNEL_ID || '6341';
const PAYHERO_BASE_URL   = 'https://backend.payhero.co.ke/api/v2';

function getAuthHeader() {
  return `Basic ${PAYHERO_AUTH_TOKEN}`;
}

console.log('🔧 PayHero Configuration:');
console.log('   API URL:', PAYHERO_BASE_URL);
console.log('   Channel ID:', PAYHERO_CHANNEL);
console.log('   Auth Token set:', PAYHERO_AUTH_TOKEN ? '✅ Yes' : '❌ No');

// ── In-memory payment store (reference -> status) ────────────
const paymentStore = {};

// ── POST /api/deposit — Initiate STK Push ─────────────────────
app.post('/api/deposit', async (req, res) => {
  const { amount, phone, userId, externalRef } = req.body;

  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone are required' });
  }

  // Normalize phone to 254XXXXXXXXX format
  let normalizedPhone = String(phone).replace(/\D/g, '');
  if (normalizedPhone.startsWith('254') && normalizedPhone.length === 12) {
    // already correct
  } else if (normalizedPhone.startsWith('0') && normalizedPhone.length === 10) {
    normalizedPhone = '254' + normalizedPhone.slice(1);
  } else if (!normalizedPhone.startsWith('254')) {
    normalizedPhone = '254' + normalizedPhone;
  }

  console.log(`📱 Deposit request: KES ${amount} to ${normalizedPhone} (user: ${userId})`);

  try {
    const usedExtRef = externalRef || `DEP_${userId || 'user'}_${Date.now()}`;

    const response = await axios.post(
      `${PAYHERO_BASE_URL}/payments`,
      {
        amount:             Number(amount),
        phone_number:       normalizedPhone,
        channel_id:         Number(PAYHERO_CHANNEL),
        provider:           process.env.PAYHERO_PROVIDER || 'm-pesa',
        external_reference: usedExtRef,
        callback_url:       process.env.CALLBACK_URL || 'https://sportybet-1vl1.onrender.com/api/callback',
      },
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type':  'application/json',
        },
      }
    );

    console.log('✅ STK Push sent:', response.data);

    const reference = response.data.reference
                   || response.data.CheckoutRequestID
                   || response.data.id
                   || response.data.transaction_id;

    // Pre-store as PENDING so polling works immediately
    // Store userId so the callback can update Firebase
    const entry = { status: 'PENDING', amount: Number(amount), userId: userId || null, payheroRef: reference };
    if (reference)    paymentStore[reference]    = { ...entry };
    paymentStore[usedExtRef] = { ...entry };

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
app.post('/api/callback', async (req, res) => {
  console.log('📬 PayHero callback:', JSON.stringify(req.body));

  try {
    const body      = req.body;
    const response  = body.response || body;
    const userRef   = response.User_Reference || response.external_reference || '';
    const amount    = Number(response.Amount || response.amount || 0);
    const mpesaRef  = response.MPESA_Reference || response.mpesa_reference || '';
    const wooStatus = response.woocommerce_payment_status || '';
    const success   = wooStatus === 'complete' || body.status === true || mpesaRef !== '';
    const checkoutId = response.CheckoutRequestID || response.checkout_request_id || '';

    console.log(`💳 Callback — ref: ${userRef}, amount: ${amount}, success: ${success}, mpesa_ref: ${mpesaRef}`);

    const finalStatus = success ? 'SUCCESS' : 'FAILED';

    // ── Update in-memory store ────────────────────────────────
    if (userRef)    paymentStore[userRef]    = { status: finalStatus, amount };
    if (checkoutId) paymentStore[checkoutId] = { status: finalStatus, amount };

    // ── Write to Firebase Firestore if payment succeeded ──────
    if (success && db) {
      // userRef format: DEP_<uid>_<timestamp>
      // Extract uid from external reference
      let userId = null;
      const match = userRef.match(/^DEP_([^_]+)_/);
      if (match) userId = match[1];

      // Also check the in-memory store for stored userId
      if (!userId && paymentStore[userRef]?.userId) {
        userId = paymentStore[userRef].userId;
      }
      if (!userId && checkoutId && paymentStore[checkoutId]?.userId) {
        userId = paymentStore[checkoutId].userId;
      }

      if (userId && amount > 0) {
        try {
          const userDocRef = db.collection('users').doc(userId);
          const now        = new Date();
          const timeStr    = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
                           + ' ' + now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });

          await userDocRef.update({
            balance:           admin.firestore.FieldValue.increment(amount),
            'stats.deposited': admin.firestore.FieldValue.increment(amount),
            transactions:      admin.firestore.FieldValue.arrayUnion({
              type:    'deposit',
              amount:  amount,
              method:  'M-Pesa',
              status:  'success',
              note:    `PayHero STK · MPESA: ${mpesaRef}`,
              time:    timeStr,
              uid:     userId,
            }),
          });

          console.log(`✅ Firebase balance updated: +KES ${amount} for user ${userId}`);
        } catch (fbErr) {
          console.error('❌ Firebase update failed:', fbErr.message);
        }
      } else {
        console.warn('⚠️  Could not identify userId from callback — Firebase NOT updated');
        console.warn('   userRef:', userRef, '| checkoutId:', checkoutId);
      }
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
  console.log(`💳 PayHero: ${PAYHERO_AUTH_TOKEN ? '✅ Configured' : '❌ Missing auth token'}`);
  console.log(`🔥 Firebase: ${db ? '✅ Connected' : '❌ Not connected'}`);
});
