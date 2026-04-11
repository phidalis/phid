const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Store pending payments
const pendingPayments = new Map();

// ===== READ CREDENTIALS FROM ENVIRONMENT VARIABLES =====
const PAYHERO_USERNAME = process.env.PAYHERO_USERNAME;
const PAYHERO_PASSWORD = process.env.PAYHERO_PASSWORD;
const PAYHERO_ENV = process.env.PAYHERO_ENV || 'live'; // 'live' or 'sandbox'
const PAYHERO_CHANNEL_ID = process.env.PAYHERO_CHANNEL_ID || '1'; // Payment channel

// Check if credentials are set
if (!PAYHERO_USERNAME || !PAYHERO_PASSWORD) {
    console.error('❌ ERROR: Missing PAYHERO_USERNAME or PAYHERO_PASSWORD environment variables!');
    console.error('Please set them in Render dashboard under Environment Variables');
    // Don't exit - let the app run but deposit will fail gracefully
}

// Generate Basic Auth Token dynamically
const getBasicAuthToken = () => {
    const authString = `${PAYHERO_USERNAME}:${PAYHERO_PASSWORD}`;
    return `Basic ${Buffer.from(authString).toString('base64')}`;
};

// PayHero API URL based on environment
const PAYHERO_BASE_URL = PAYHERO_ENV === 'sandbox' 
    ? 'https://sandbox.payhero.co.ke'
    : 'https://api.payhero.co.ke';

console.log(`🔧 PayHero Configuration:`);
console.log(`   Environment: ${PAYHERO_ENV}`);
console.log(`   API URL: ${PAYHERO_BASE_URL}`);
console.log(`   Channel ID: ${PAYHERO_CHANNEL_ID}`);
console.log(`   Username set: ${PAYHERO_USERNAME ? '✅ Yes' : '❌ No'}`);
console.log(`   Password set: ${PAYHERO_PASSWORD ? '✅ Yes' : '❌ No'}`);

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'aviator.html'));
});

// ===== DEPOSIT ENDPOINT =====
app.post('/api/deposit', async (req, res) => {
    try {
        const { amount, phone, userId } = req.body;
        
        // Validate credentials exist
        if (!PAYHERO_USERNAME || !PAYHERO_PASSWORD) {
            return res.status(500).json({ 
                error: 'Payment system not configured. Please contact support.' 
            });
        }
        
        // Generate unique reference
        const reference = `DEP-${Date.now()}-${userId.slice(0,6)}`;
        
        // Clean phone number (ensure 254 format)
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '254' + cleanPhone.slice(1);
        }
        if (!cleanPhone.startsWith('254')) {
            cleanPhone = '254' + cleanPhone;
        }
        
        console.log(`📱 Deposit request: KES ${amount} to ${cleanPhone}`);
        
        // Store pending payment
        pendingPayments.set(reference, {
            userId,
            amount,
            phone: cleanPhone,
            status: 'pending',
            createdAt: Date.now()
        });
        
        // Send STK Push via PayHero
        const payheroResponse = await axios.post(
            `${PAYHERO_BASE_URL}/api/v1/stkpush`,
            {
                amount: parseInt(amount),
                phone: cleanPhone,
                reference: reference,
                callback_url: `https://${req.get('host')}/api/callback`,
                channel_id: parseInt(PAYHERO_CHANNEL_ID)
            },
            {
                headers: {
                    'Authorization': getBasicAuthToken(),
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        console.log('✅ STK Push response:', payheroResponse.data);
        
        res.json({
            success: true,
            reference: reference,
            message: 'STK Push sent to your phone. Enter PIN to complete payment.'
        });
        
    } catch (error) {
        console.error('❌ Deposit error:', error.response?.data || error.message);
        
        // Provide helpful error messages
        let errorMessage = 'Payment failed. Please try again.';
        if (error.response?.status === 401) {
            errorMessage = 'Payment system authentication failed. Please contact support.';
        } else if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// ===== CHECK PAYMENT STATUS =====
app.get('/api/deposit/status', async (req, res) => {
    const { reference } = req.query;
    const payment = pendingPayments.get(reference);
    
    if (!payment) {
        return res.json({ status: 'not_found' });
    }
    
    // If already completed, return cached status
    if (payment.status !== 'pending') {
        return res.json({
            status: payment.status,
            amount: payment.amount,
            reference: reference
        });
    }
    
    // Check if transaction is older than 5 minutes (timeout)
    if (Date.now() - payment.createdAt > 5 * 60 * 1000) {
        payment.status = 'FAILED';
        payment.message = 'Transaction timed out';
        pendingPayments.set(reference, payment);
        return res.json({
            status: 'FAILED',
            amount: payment.amount,
            reference: reference
        });
    }
    
    // Query PayHero for fresh status
    try {
        const statusResponse = await axios.get(
            `${PAYHERO_BASE_URL}/api/v1/transaction/status`,
            {
                params: { reference: reference },
                headers: {
                    'Authorization': getBasicAuthToken(),
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        if (statusResponse.data.status === 'success' || statusResponse.data.ResultCode === '0') {
            payment.status = 'SUCCESS';
            pendingPayments.set(reference, payment);
            console.log(`✅ Payment confirmed: ${reference}`);
        } else if (statusResponse.data.status === 'failed') {
            payment.status = 'FAILED';
            pendingPayments.set(reference, payment);
            console.log(`❌ Payment failed: ${reference}`);
        }
        
        res.json({
            status: payment.status,
            amount: payment.amount,
            reference: reference
        });
        
    } catch (error) {
        console.error('Status check error:', error.message);
        // Return pending status if API call fails
        res.json({
            status: 'pending',
            amount: payment.amount,
            reference: reference
        });
    }
});

// ===== PAYHERO CALLBACK ENDPOINT =====
app.post('/api/callback', async (req, res) => {
    console.log('📞 Callback received:', JSON.stringify(req.body, null, 2));
    
    const { reference, status, amount, transaction_id, ResultCode, ResultDesc } = req.body;
    
    let transactionRef = reference;
    let transactionStatus = status;
    
    // Handle different callback formats
    if (ResultCode !== undefined) {
        transactionStatus = ResultCode === '0' ? 'SUCCESS' : 'FAILED';
        transactionRef = req.body.CheckoutRequestID || reference;
    }
    
    if (transactionRef && pendingPayments.has(transactionRef)) {
        const payment = pendingPayments.get(transactionRef);
        
        if (transactionStatus === 'SUCCESS' || transactionStatus === 'success') {
            payment.status = 'SUCCESS';
            payment.transactionId = transaction_id;
            payment.completedAt = Date.now();
            console.log(`✅✅✅ PAYMENT SUCCESS: ${transactionRef} - KES ${amount || payment.amount}`);
        } else {
            payment.status = 'FAILED';
            payment.failureReason = ResultDesc || status;
            console.log(`❌ Payment FAILED: ${transactionRef} - ${payment.failureReason}`);
        }
        
        pendingPayments.set(transactionRef, payment);
    }
    
    // Always acknowledge callback to PayHero
    res.json({ status: 'ok', message: 'Callback received' });
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        payhero_configured: !!(PAYHERO_USERNAME && PAYHERO_PASSWORD),
        payhero_env: PAYHERO_ENV
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`🎮 Game URL: https://localhost:${PORT}/game`);
    console.log(`💳 PayHero Status: ${PAYHERO_USERNAME && PAYHERO_PASSWORD ? '✅ Configured' : '❌ Not Configured'}\n`);
});
