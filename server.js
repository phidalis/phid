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
// Stores: { status, amount, userId, createdAt, payheroRef }
const paymentStore = {};

// FIX: 2-minute payment timeout constant
const PAYMENT_TIMEOUT_MS = 120000;

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

    // FIX: Check for immediate failure from PayHero
    const respData = response.data || {};
    if (
      respData.success === false ||
      String(respData.status || '').toUpperCase() === 'FAILED' ||
      (respData.ResultCode !== undefined && String(respData.ResultCode) !== '0')
    ) {
      console.warn('[Deposit] Immediate failure from PayHero:', respData);
      return res.status(400).json({
        success: false,
        error: respData.error_message || respData.message || 'STK push failed. Check your number and try again.',
      });
    }

    const reference = respData.reference
                   || respData.CheckoutRequestID
                   || respData.id
                   || respData.transaction_id;

    // FIX: Store PENDING entry with createdAt for timeout detection
    const entry = {
      status:     'PENDING',
      amount:     Number(amount),
      userId:     userId || null,
      createdAt:  Date.now(),   // ← NEW: used for server-side timeout
    };
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
app.get('/api/deposit/status', async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error: 'reference is required' });

  // ── 1. Direct in-memory lookup ──
  let payment = paymentStore[reference];

  // ── 2. Cross-ref scan: find by payheroRef link ──
  if (!payment || payment.status === 'PENDING') {
    for (const key of Object.keys(paymentStore)) {
      const e = paymentStore[key];
      if (e.payheroRef === reference && (e.status === 'SUCCESS' || e.status === 'FAILED')) {
        payment = e;
        console.log('[Status] cross-found:', key, '->', e.status);
        break;
      }
    }
  }

  // ── 3. Return immediately if already resolved ──
  if (payment && payment.status === 'SUCCESS') {
    console.log('[Status]', reference, '-> SUCCESS (store)');
    return res.json({ status: 'SUCCESS', amount: payment.amount });
  }

  // FIX: Return FAILED immediately if already stored as failed
  if (payment && payment.status === 'FAILED') {
    console.log('[Status]', reference, '-> FAILED (store)');
    return res.json({ status: 'FAILED', amount: payment.amount || 0 });
  }

  // FIX: Server-side timeout — if payment has been PENDING for >2 minutes, mark FAILED
  if (payment && payment.createdAt && (Date.now() - payment.createdAt) > PAYMENT_TIMEOUT_MS) {
    console.log('[Status]', reference, '-> FAILED (timeout after 2min)');
    paymentStore[reference] = Object.assign({}, payment, { status: 'FAILED' });
    return res.json({ status: 'FAILED', amount: payment.amount || 0 });
  }

  // ── 4. Still PENDING — query PayHero API directly ──
  if (PAYHERO_AUTH_TOKEN) {
    try {
      const phRes = await axios.get(
        `${PAYHERO_BASE_URL}/transaction-status`,
        {
          params: { reference },
          headers: { 'Authorization': getAuthHeader(), 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );

      const phData   = phRes.data || {};
      const phStatus = String(phData.status || phData.transaction_status || phData.Status || '').toUpperCase();
      const phAmount = Number(phData.amount || phData.Amount || (payment && payment.amount) || 0);
      const mpesaRef = phData.MPESA_Reference || phData.mpesa_reference || phData.MpesaReceiptNumber || '';
      // FIX: Also check ResultCode — '0' means success in Safaricom STK
      const resultCode = String(phData.ResultCode || phData.result_code || '');

      console.log('[Status] PayHero direct:', reference, '->', phStatus,
        '| mpesa:', mpesaRef, '| ResultCode:', resultCode, '| raw:', JSON.stringify(phData));

      let resolvedStatus = 'PENDING';

      // FIX: Explicit success detection
      if (
        phStatus === 'SUCCESS' || phStatus === 'COMPLETE' || phStatus === 'COMPLETED' ||
        mpesaRef ||
        resultCode === '0'
      ) {
        resolvedStatus = 'SUCCESS';
      }

      // FIX: Explicit failure detection — includes ResultCode !== '0' when present
      if (
        phStatus === 'FAILED' || phStatus === 'CANCELLED' || phStatus === 'FAIL' ||
        phStatus === 'TIMEOUT' || phStatus === 'EXPIRED' || phStatus === 'CANCELED' ||
        (resultCode && resultCode !== '0')  // ← any non-zero ResultCode = failure
      ) {
        resolvedStatus = 'FAILED';
      }

      // Cache the result if resolved
      if (resolvedStatus !== 'PENDING') {
        const uid = (payment && payment.userId) || null;
        paymentStore[reference] = { status: resolvedStatus, amount: phAmount, userId: uid, createdAt: (payment && payment.createdAt) || Date.now() };

        if (resolvedStatus === 'SUCCESS' && db && uid && phAmount > 0) {
          writeBalanceToFirestore(uid, phAmount, mpesaRef || reference).catch(e =>
            console.warn('[Status] Firebase write failed:', e.message)
          );
        }
      }

      return res.json({ status: resolvedStatus, amount: phAmount });

    } catch (phErr) {
      console.warn('[Status] PayHero query error:', phErr.message);
    }
  }

  // ── 5. No result anywhere — still PENDING ──
  console.log('[Status]', reference, '-> PENDING (no result)');
  return res.json({ status: 'PENDING', amount: 0 });
});

// ── Shared Firestore write helper ──
async function writeBalanceToFirestore(userId, amount, note) {
  if (!db || !userId || !amount) return;
  const userDocRef = db.collection('users').doc(userId);
  const now        = new Date();
  const timeStr    = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
                   + ' ' + now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });
  const txEntry = {
    type: 'deposit', amount, method: 'M-Pesa', status: 'success',
    note: 'PayHero STK - ' + note, time: timeStr, uid: userId,
  };
  const snap = await userDocRef.get();
  if (snap.exists === true || (typeof snap.exists === 'function' && snap.exists())) {
    await userDocRef.update({
      balance:           admin.firestore.FieldValue.increment(amount),
      'stats.deposited': admin.firestore.FieldValue.increment(amount),
      transactions:      admin.firestore.FieldValue.arrayUnion(txEntry),
    });
  } else {
    await userDocRef.set({
      balance: amount, stats: { deposited: amount, withdrawn: 0, won: 0, rounds: 0 },
      transactions: [txEntry], createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  console.log('[Firebase] Balance +KES', amount, 'for', userId);
}

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
    const ResultCode = String(response.ResultCode || response.result_code || body.ResultCode || body.result_code || '');
    const successByCode = ResultCode === '0';

    // FIX: Explicit failure by ResultCode — any non-zero code is a failure
    const failByCode = ResultCode !== '' && ResultCode !== '0';

    const finalSuccess = (success || successByCode) && !failByCode;
    const finalStatus  = finalSuccess ? 'SUCCESS' : 'FAILED';

    console.log('[Callback] ref:', userRef, 'amount:', amount, 'finalStatus:', finalStatus,
      '| wooStatus:', wooStatus, '| mpesaRef:', mpesaRef, '| ResultCode:', ResultCode);

    // Extract userId from DEP_<uid>_<timestamp> pattern, or from paymentStore
    let userId = null;
    const match = userRef.match(/^DEP_(.+)_(\d{13,})$/);
    if (match) userId = match[1];

    const existingByRef      = paymentStore[userRef]      || {};
    const existingByCheckout = paymentStore[checkoutId]   || {};

    if (!userId && existingByRef.userId)      userId = existingByRef.userId;
    if (!userId && existingByCheckout.userId) userId = existingByCheckout.userId;

    // FIX: Always store the resolved status (SUCCESS or FAILED) — preserve createdAt & userId
    if (userRef) {
      paymentStore[userRef] = {
        status:     finalStatus,
        amount,
        userId:     userId || existingByRef.userId || null,
        createdAt:  existingByRef.createdAt || Date.now(),
        payheroRef: existingByRef.payheroRef || checkoutId || null,
      };
    }
    if (checkoutId) {
      paymentStore[checkoutId] = {
        status:     finalStatus,
        amount,
        userId:     userId || existingByCheckout.userId || null,
        createdAt:  existingByCheckout.createdAt || Date.now(),
        payheroRef: existingByCheckout.payheroRef || checkoutId || null,
      };
    }

    // Write to Firebase only on success
    if (finalSuccess && db && userId && amount > 0) {
      writeBalanceToFirestore(userId, amount, 'MPESA: ' + (mpesaRef || userRef))
        .catch(e => console.error('[Firebase] Write failed:', e.message));
    } else if (!finalSuccess) {
      console.log('[Callback] Payment FAILED — userId:', userId, '| ResultCode:', ResultCode);
    } else if (!userId) {
      console.warn('[Callback] Could not identify userId — Firebase NOT updated. userRef:', userRef);
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
