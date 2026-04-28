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

// ── PayHero Config ─────────────────────────────────────────────────────────
// PAYHERO_AUTH_TOKEN must be the ALREADY base64-encoded string from PayHero
// dashboard → API Keys → copy the full Basic Auth token (without the word "Basic")
// e.g. if PayHero shows:  Basic dXNlcjpwYXNz  →  store only:  dXNlcjpwYXNz
const PAYHERO_AUTH_TOKEN = process.env.PAYHERO_AUTH_TOKEN;
const PAYHERO_CHANNEL    = process.env.PAYHERO_CHANNEL_ID || '6341';
const PAYHERO_BASE_URL   = 'https://backend.payhero.co.ke/api/v2';

// Builds the Authorization header — token is already base64(username:password)
function getAuthHeader() {
  return 'Basic ' + PAYHERO_AUTH_TOKEN;
}

console.log('[PayHero] Channel ID:', PAYHERO_CHANNEL);
console.log('[PayHero] Auth Token set:', PAYHERO_AUTH_TOKEN ? 'YES' : 'NO');

// ── In-memory payment store ────────────────────────────────────────────────
// WARNING: This resets on every Render restart.
// That is WHY we also check Firestore in the status endpoint — Firestore is
// the persistent source of truth. paymentStore is only a fast local cache.
const paymentStore = {};

// Payment timeout: if PENDING for more than 2 minutes → treat as FAILED
const PAYMENT_TIMEOUT_MS = 120000;

// ── POST /api/deposit — Initiate STK Push ─────────────────────────────────
app.post('/api/deposit', async (req, res) => {
  const { amount, phone, userId, externalRef } = req.body;

  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone are required' });
  }

  // Normalize phone → 254XXXXXXXXX
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

    const respData = response.data || {};
    console.log('[Deposit] PayHero response:', JSON.stringify(respData));

    // PayHero returns { success: true, status: "QUEUED", reference: "E8UWT7CLUW", CheckoutRequestID: "..." }
    // "QUEUED" means STK push was sent to the phone — NOT a payment success yet.

    if (respData.success === false) {
      console.warn('[Deposit] PayHero rejected STK:', respData);
      return res.status(400).json({
        success: false,
        error: respData.error_message || respData.message || 'STK push was rejected. Check your phone number and try again.',
      });
    }

    const reference = respData.reference
                   || respData.CheckoutRequestID
                   || respData.id
                   || respData.transaction_id;

    const entry = {
      status:    'PENDING',
      amount:    Number(amount),
      userId:    userId || null,
      createdAt: Date.now(),
    };
    if (reference)  paymentStore[reference]  = Object.assign({}, entry);
    paymentStore[usedExtRef] = Object.assign({}, entry, { payheroRef: reference });

    // Write a pending record to Firestore so the status endpoint can recover
    // the userId even after a Render restart wipes paymentStore in memory.
    if (db && userId) {
      db.collection('pendingPayments').doc(usedExtRef).set({
        userId,
        amount:    Number(amount),
        status:    'PENDING',
        reference: reference || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(e => console.warn('[Deposit] pendingPayments write failed:', e.message));
    }

    return res.json({ success: true, reference: reference, message: 'STK push sent. Check your phone.' });

  } catch (err) {
    const errData = err.response ? err.response.data : err.message;
    console.error('[Deposit] Error:', errData);
    return res.status(500).json({ error: (errData && (errData.error_message || errData.message)) || 'Payment initiation failed' });
  }
});

// ── GET /api/deposit/status ────────────────────────────────────────────────
// Resolution order:
//   1. In-memory store (fastest — works if server didn't restart)
//   2. Firestore users/{userId}.transactions (did callback already credit the user?)
//   3. Firestore pendingPayments/{extRef} timeout detection (survives restarts)
//   4. PayHero transaction-status API (best-effort fallback)
//   5. PENDING
app.get('/api/deposit/status', async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.status(400).json({ error: 'reference is required' });

  // ── 1. Direct in-memory lookup ──────────────────────────────────────────
  let payment = paymentStore[reference];

  // Cross-ref: if frontend queries by payheroRef, find the extRef entry
  if (!payment || payment.status === 'PENDING') {
    for (const key of Object.keys(paymentStore)) {
      const e = paymentStore[key];
      if (e.payheroRef === reference && (e.status === 'SUCCESS' || e.status === 'FAILED')) {
        payment = e;
        console.log('[Status] cross-found in store:', key, '->', e.status);
        break;
      }
    }
  }

  if (payment && payment.status === 'SUCCESS') {
    return res.json({ status: 'SUCCESS', amount: payment.amount });
  }
  if (payment && payment.status === 'FAILED') {
    return res.json({ status: 'FAILED', amount: payment.amount || 0 });
  }

  // ── 2 + 3. Firestore checks ─────────────────────────────────────────────
  if (db) {
    try {
      let userId    = payment && payment.userId;
      let createdAt = payment && payment.createdAt;

      // Parse userId from DEP_<uid>_<timestamp> pattern
      if (!userId) {
        const match = reference.match(/^DEP_(.+)_(\d{13,})$/);
        if (match) {
          userId    = match[1];
          createdAt = createdAt || parseInt(match[2], 10);
        }
      }

      // Check pendingPayments Firestore doc (survives Render restarts)
      if (!userId) {
        const pendingDoc = await db.collection('pendingPayments').doc(reference).get();
        if (pendingDoc.exists) {
          const pd  = pendingDoc.data();
          userId    = pd.userId;
          createdAt = createdAt || (pd.createdAt && pd.createdAt.toMillis ? pd.createdAt.toMillis() : Date.now());
          // Restore into paymentStore so future polls are fast
          paymentStore[reference] = {
            status:    'PENDING',
            amount:    pd.amount || 0,
            userId,
            createdAt,
            payheroRef: pd.reference || null,
          };
          payment = paymentStore[reference];
        }
      }

      if (userId) {
        // Check if Firestore already has a success deposit for this reference.
        // We check the user's balance directly — if balance > 0 and pendingPayments
        // doc is gone, the callback already credited the user. We also check the
        // pendingPayments collection: if it was deleted, it means writeBalanceToFirestore ran.
        // PRIMARY: check if pendingPayments doc was already deleted (callback ran successfully)
        const pendingCheck = await db.collection('pendingPayments').doc(reference).get();
        if (!pendingCheck.exists) {
          // pendingPayments doc was deleted — this means callback ran and credited balance.
          // Read the actual balance from Firestore to return the correct amount.
          const userSnap = await db.collection('users').doc(userId).get();
          if (userSnap.exists) {
            const userData = userSnap.data();
            const txs = (userData.transactions || []);
            // Find the most recent successful deposit
            const depositTx = [...txs].reverse().find(tx =>
              tx.type === 'deposit' && tx.status === 'success'
            );
            const creditedAmount = depositTx ? depositTx.amount : (payment && payment.amount) || 0;
            console.log('[Status] pendingPayments deleted → SUCCESS for', reference, '| amount:', creditedAmount);
            paymentStore[reference] = { status: 'SUCCESS', amount: creditedAmount, userId, createdAt };
            return res.json({ status: 'SUCCESS', amount: creditedAmount });
          }
        }

        // FALLBACK: scan transactions for a match on the extRef or PayHero ref in the note
        const userSnap2 = await db.collection('users').doc(userId).get();
        if (userSnap2.exists) {
          const txs = (userSnap2.data().transactions || []);
          const matched = txs.find(tx =>
            tx.type === 'deposit' &&
            tx.status === 'success' &&
            (tx.ref && (tx.ref.includes(reference) || (payment && payment.payheroRef && tx.ref.includes(payment.payheroRef)))) ||
            (tx.note && (tx.note.includes(reference) || (payment && payment.payheroRef && tx.note.includes(payment.payheroRef))))
          );
          if (matched) {
            console.log('[Status] SUCCESS found in Firestore transactions for', reference);
            paymentStore[reference] = { status: 'SUCCESS', amount: matched.amount, userId, createdAt };
            db.collection('pendingPayments').doc(reference).delete().catch(() => {});
            return res.json({ status: 'SUCCESS', amount: matched.amount });
          }
        }
      }

      // Timeout: if payment has been PENDING > 2 minutes → FAILED
      if (createdAt && (Date.now() - createdAt) > PAYMENT_TIMEOUT_MS) {
        console.log('[Status] TIMEOUT for', reference, '— marking FAILED');
        paymentStore[reference] = Object.assign({}, payment || {}, { status: 'FAILED' });
        db.collection('pendingPayments').doc(reference).delete().catch(() => {});
        return res.json({ status: 'FAILED', amount: (payment && payment.amount) || 0 });
      }

    } catch (fsErr) {
      console.warn('[Status] Firestore check error:', fsErr.message);
    }
  }

  // ── 4. PayHero transaction-status API (best-effort) ─────────────────────
  if (PAYHERO_AUTH_TOKEN) {
    try {
      // Use the PayHero short reference (not the extRef DEP_...) for the query
      const queryRef = (payment && payment.payheroRef) || reference;

      const phRes = await axios.get(
        `${PAYHERO_BASE_URL}/transaction-status`,
        {
          params:  { reference: queryRef },
          headers: { 'Authorization': getAuthHeader() },
          timeout: 8000,
        }
      );

      const phData = phRes.data || {};
      console.log('[Status] PayHero transaction-status raw:', JSON.stringify(phData));

      // ResultCode is a NUMBER: 0 = success. Check with !== undefined, not ||
      const resultCode   = phData.ResultCode !== undefined ? Number(phData.ResultCode) : null;
      const phStatusStr  = String(phData.Status || phData.status || phData.transaction_status || '').toLowerCase();
      const mpesaReceipt = phData.MpesaReceiptNumber || phData.MPESA_Reference || phData.mpesa_reference || '';
      const phAmount     = Number(phData.Amount || phData.amount || (payment && payment.amount) || 0);

      console.log('[Status] resultCode:', resultCode, '| status:', phStatusStr, '| mpesa:', mpesaReceipt);

      let resolvedStatus = 'PENDING';

      if (resultCode === 0 || mpesaReceipt || phStatusStr === 'success' || phStatusStr === 'complete' || phStatusStr === 'completed') {
        resolvedStatus = 'SUCCESS';
      }
      // Non-zero ResultCode = definite failure. Common codes: 1032 cancelled, 1037 timeout, 2001 wrong PIN
      if ((resultCode !== null && resultCode !== 0) || phStatusStr === 'failed' || phStatusStr === 'fail' || phStatusStr === 'cancelled' || phStatusStr === 'canceled' || phStatusStr === 'expired' || phStatusStr === 'timeout') {
        resolvedStatus = 'FAILED';
      }

      if (resolvedStatus !== 'PENDING') {
        const uid = (payment && payment.userId) || null;
        paymentStore[reference] = { status: resolvedStatus, amount: phAmount, userId: uid, createdAt: (payment && payment.createdAt) || Date.now() };
        if (resolvedStatus === 'SUCCESS' && db && uid && phAmount > 0) {
          writeBalanceToFirestore(uid, phAmount, mpesaReceipt || reference).catch(e => console.warn('[Status] Firebase write failed:', e.message));
        }
        db && db.collection('pendingPayments').doc(reference).delete().catch(() => {});
      }

      return res.json({ status: resolvedStatus, amount: phAmount });

    } catch (phErr) {
      console.warn('[Status] PayHero query failed:', phErr.message, phErr.response ? '| HTTP ' + phErr.response.status : '');
    }
  }

  // ── 5. Nothing resolved — still PENDING ─────────────────────────────────
  console.log('[Status]', reference, '-> PENDING (no result from any source)');
  return res.json({ status: 'PENDING', amount: 0 });
});

// ── Shared Firestore balance write ─────────────────────────────────────────
async function writeBalanceToFirestore(userId, amount, note) {
  if (!db)          { console.warn('[Firebase] writeBalance skipped — db not initialized'); return; }
  if (!userId)      { console.warn('[Firebase] writeBalance skipped — no userId'); return; }
  if (!amount || amount <= 0) { console.warn('[Firebase] writeBalance skipped — invalid amount:', amount); return; }

  const userDocRef = db.collection('users').doc(userId);
  const now        = new Date();
  const timeStr    = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
                   + ' ' + now.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });
  const txEntry = {
    type: 'deposit', amount, method: 'M-Pesa', status: 'success',
    note: 'PayHero STK - ' + note, time: timeStr, uid: userId, ref: note,
  };

  try {
    const snap = await userDocRef.get();
    // Admin SDK: snap.exists is a boolean property (not a function)
    if (snap.exists) {
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
  } catch (e) {
    console.error('[Firebase] writeBalanceToFirestore FAILED for', userId, ':', e.message);
    throw e; // re-throw so caller can catch and log
  }
}

// ── POST /api/callback — PayHero webhook ──────────────────────────────────
// SUCCESS: { "status": true,  "response": { "ResultCode": 0,    "MpesaReceiptNumber": "SAE3Y...", "Amount": 10, "ExternalReference": "DEP_...", ... } }
// FAILED:  { "status": false, "response": { "ResultCode": 1032, "ResultDesc": "Cancelled by user",  "ExternalReference": "DEP_...", ... } }
app.post('/api/callback', async (req, res) => {
  console.log('[Callback] Received:', JSON.stringify(req.body));

  try {
    const body     = req.body;
    const response = body.response || body;

    const userRef    = response.ExternalReference || response.external_reference || response.User_Reference || '';
    const checkoutId = response.CheckoutRequestID || response.checkout_request_id || '';
    const mpesaRef   = response.MpesaReceiptNumber || response.MPESA_Reference || response.mpesa_reference || '';

    // ResultCode is a NUMBER from PayHero/Safaricom — 0 = success
    // MUST check with !== undefined because 0 is falsy and would be skipped by ||
    const resultCode = response.ResultCode !== undefined
      ? Number(response.ResultCode)
      : (body.ResultCode !== undefined ? Number(body.ResultCode) : null);

    const bodyStatusTrue = body.status === true;

    // Success: PayHero says status:true AND ResultCode is 0 (or absent — some callbacks omit it on success)
    const isSuccess = bodyStatusTrue && (resultCode === null || resultCode === 0);
    const finalStatus = isSuccess ? 'SUCCESS' : 'FAILED';

    // Recover existing store entries BEFORE parsing amount/userId (needed as fallback)
    const existingByRef      = paymentStore[userRef]      || {};
    const existingByCheckout = paymentStore[checkoutId]   || {};

    // Amount: PayHero sometimes omits Amount in the callback body.
    // Without this fallback, amount=0 and writeBalanceToFirestore silently skips the write.
    let amount = Number(response.Amount || response.amount || 0);
    if (!amount || amount <= 0) {
      amount = existingByRef.amount || existingByCheckout.amount || 0;
      if (amount > 0) console.log('[Callback] Amount missing in callback — recovered from store:', amount);
    }

    // userId: store → DEP_ pattern → Firestore pendingPayments
    let userId = existingByRef.userId || existingByCheckout.userId || null;
    if (!userId) {
      const match = userRef.match(/^DEP_(.+)_(\d{13,})$/);
      if (match) userId = match[1];
    }
    // If Render restarted and paymentStore is empty, recover from Firestore
    if (!userId && db && userRef) {
      try {
        const pendingDoc = await db.collection('pendingPayments').doc(userRef).get();
        if (pendingDoc.exists) {
          userId = pendingDoc.data().userId;
          // Also recover amount if still missing
          if ((!amount || amount <= 0) && pendingDoc.data().amount) {
            amount = pendingDoc.data().amount;
            console.log('[Callback] Amount recovered from pendingPayments:', amount);
          }
        }
      } catch(e) { /* ignore */ }
    }

    console.log('[Callback]',
      '| extRef:', userRef,
      '| checkoutId:', checkoutId,
      '| amount:', amount,
      '| ResultCode:', resultCode,
      '| body.status:', body.status,
      '| mpesa:', mpesaRef,
      '| userId:', userId,
      '| => finalStatus:', finalStatus
    );

    const now = Date.now();
    if (userRef) {
      paymentStore[userRef] = { status: finalStatus, amount, userId, createdAt: existingByRef.createdAt || now, payheroRef: existingByRef.payheroRef || checkoutId || null };
    }
    if (checkoutId) {
      paymentStore[checkoutId] = { status: finalStatus, amount, userId, createdAt: existingByCheckout.createdAt || now, payheroRef: checkoutId };
    }

    if (isSuccess && db && userId && amount > 0) {
      writeBalanceToFirestore(userId, amount, 'MPESA: ' + (mpesaRef || userRef))
        .then(() => {
          if (userRef) db.collection('pendingPayments').doc(userRef).delete().catch(() => {});
        })
        .catch(e => console.error('[Firebase] Write failed:', e.message));
    } else if (isSuccess && (!userId || amount <= 0)) {
      // Payment succeeded but we can't credit — log everything for manual recovery
      console.error('[Callback] SUCCESS but COULD NOT CREDIT — userId:', userId, '| amount:', amount, '| extRef:', userRef, '| mpesa:', mpesaRef);
    } else if (!isSuccess) {
      console.log('[Callback] FAILED — ResultCode:', resultCode, '| userId:', userId);
      if (db && userRef) db.collection('pendingPayments').doc(userRef).delete().catch(() => {});
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
