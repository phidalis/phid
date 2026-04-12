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

// Firebase Admin SDK
let db = null;
try {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  console.log('[Firebase] Admin SDK initialized');
} catch (e) {
  console.warn('[Firebase] NOT initialized:', e.message);
  console.warn('[Firebase] Set FIREBASE_SERVICE_ACCOUNT env var on Render');
}

// PayHero Config
const PAYHERO_AUTH_TOKEN = process.env.PAYHERO_AUTH_TOKEN;
const PAYHERO_CHANNEL    = process.env.PAYHERO_CHANNEL_ID || '6341';
const PAYHERO_BASE_URL   = 'https://backend.payhero.co.ke/api/v2';

function getAuthHeader() {
  return 'Basic ' + PAYHERO_AUTH_TOKEN;
}

console.log('[PayHero] Channel ID:', PAYHERO_CHANNEL);
console.log('[PayHero] Auth Token set:', PAYHERO_AUTH_TOKEN ? 'YES' : 'NO');

// In-memory payment store — keyed by reference or external_reference
// Stores: { status, amount, userId }
const paymentStore = {};

// POST /api/deposit — Initiate STK Push
app.post('/api/deposit', async (req, res) => {
  const { amount, phone, userId, externalRef } = req.body;

  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone are required' });
  }

  // Normalize phone to 254XXXXXXXXX
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('254') && p.length === 12) {
    // already correct
  } else if (p.startsWith('0') && p.length === 10) {
    p = '254' + p.slice(1);
  } else if (!p.startsWith('254')) {
    p = '254' + p;
  }

  const usedExtRef = externalRef || ('DEP_' + (userId || 'user') + '_' + Date.now());
  console.log('[Deposit] KES', amount, 'to', p, 'userId:', userId, 'extRef:', usedExtRef);

  try {
    const response = await axios.post(
      PAYHERO_BASE_URL + '/payments',
      {
        amount:             Number(amount),
        phone_number:       p,
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

    console.log('[Deposit] STK sent:', response.data);

    const reference = response.data.reference
                   || response.data.CheckoutRequestID
                   || response.data.id
                   || response.data.transaction_id;

    // Store PENDING entry — userId is critical for the callback Firebase write
    const entry = { status: 'PENDING', amount: Number(amount), userId: userId || null };
    if (reference)  paymentStore[reference]  = Object.assign({}, entry);
    paymentStore[usedExtRef] = Object.assign({}, entry, { payheroRef: reference });

    return res.json({ success: true, reference: reference, message: 'STK push sent. Check your phone.' });

  } catch (err) {
    const errData = err.response ? err.response.data : err.message;
    console.error('[Deposit] Error:', errData);
    return res.status(500).json({ error: (errData && (errData.error_message || errData.message)) || 'Payment failed' });
  }
});

// GET /api/deposit/status
app.get('/api/deposit/status', (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error: 'reference is required' });

  const payment = paymentStore[reference];
  console.log('[Status]', reference, '->', payment ? payment.status : 'PENDING');

  if (!payment) return res.json({ status: 'PENDING' });
  return res.json({ status: payment.status, amount: payment.amount });
});

// POST /api/callback — PayHero webhook
app.post('/api/callback', async (req, res) => {
  console.log('[Callback] Received:', JSON.stringify(req.body));

  try {
    const body       = req.body;
    const response   = body.response || body;
    const userRef    = response.User_Reference || response.external_reference || '';
    const amount     = Number(response.Amount || response.amount || 0);
    const mpesaRef   = response.MPESA_Reference || response.mpesa_reference || '';
    const wooStatus  = response.woocommerce_payment_status || '';
    const success    = wooStatus === 'complete' || body.status === true || mpesaRef !== '';
    const checkoutId = response.CheckoutRequestID || response.checkout_request_id || '';

    console.log('[Callback] ref:', userRef, 'amount:', amount, 'success:', success, 'mpesa:', mpesaRef);

    const finalStatus = success ? 'SUCCESS' : 'FAILED';

    // Update in-memory store
    if (userRef)    paymentStore[userRef]    = { status: finalStatus, amount };
    if (checkoutId) paymentStore[checkoutId] = { status: finalStatus, amount };

    // Write to Firebase if payment succeeded
    if (success && db) {
      // Extract userId from external_reference: DEP_<uid>_<timestamp>
      let userId = null;
      const match = userRef.match(/^DEP_(.+)_(\d{13,})$/);
      if (match) userId = match[1];

      // Fallback: check paymentStore for stored userId
      if (!userId && paymentStore[userRef] && paymentStore[userRef].userId) {
        userId = paymentStore[userRef].userId;
      }
      if (!userId && checkoutId && paymentStore[checkoutId] && paymentStore[checkoutId].userId) {
        userId = paymentStore[checkoutId].userId;
      }

      if (userId && amount > 0) {
        try {
          const userDocRef = db.collection('users').doc(userId);
          const now        = new Date();
          const timeStr    = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
                           + ' ' + now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });

          const txEntry = {
            type:   'deposit',
            amount: amount,
            method: 'M-Pesa',
            status: 'success',
            note:   'PayHero STK - MPESA: ' + mpesaRef,
            time:   timeStr,
            uid:    userId,
          };

          // Check if doc exists — update() throws if missing
          const snap = await userDocRef.get();

          if (snap.exists === true || (typeof snap.exists === 'function' && snap.exists())) {
            // Document exists: use increment + arrayUnion
            await userDocRef.update({
              balance:           admin.firestore.FieldValue.increment(amount),
              'stats.deposited': admin.firestore.FieldValue.increment(amount),
              transactions:      admin.firestore.FieldValue.arrayUnion(txEntry),
            });
            console.log('[Firebase] Balance updated +KES', amount, 'for', userId);
          } else {
            // Document missing: create it from scratch
            await userDocRef.set({
              balance:      amount,
              stats:        { deposited: amount, withdrawn: 0, won: 0, rounds: 0 },
              transactions: [txEntry],
              createdAt:    admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log('[Firebase] User doc created with balance KES', amount, 'for', userId);
          }

        } catch (fbErr) {
          console.error('[Firebase] Write failed:', fbErr.message);
        }
      } else {
        console.warn('[Callback] Could not identify userId — Firebase NOT updated');
        console.warn('[Callback] userRef:', userRef, 'checkoutId:', checkoutId);
      }
    }

  } catch (e) {
    console.error('[Callback] Parse error:', e.message);
  }

  res.json({ received: true });
});

// Serve game files
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'aviator.html')));
app.get('/',     (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log('[Server] Running on port', PORT);
  console.log('[Server] PayHero:', PAYHERO_AUTH_TOKEN ? 'Configured' : 'MISSING AUTH TOKEN');
  console.log('[Server] Firebase:', db ? 'Connected' : 'NOT connected');
});
