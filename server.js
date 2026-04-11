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

// ===== PAYHERO CREDENTIALS (Get from your PayHero dashboard) =====
const PAYHERO_API_USERNAME = "YOUR_API_USERNAME_HERE";  // e.g., "api_live_xxxxx"
const PAYHERO_API_PASSWORD = "YOUR_API_PASSWORD_HERE";  // e.g., "password123"

// Generate Basic Auth Token
const authString = `${PAYHERO_API_USERNAME}:${PAYHERO_API_PASSWORD}`;
const basicAuthToken = `Basic ${Buffer.from(authString).toString('base64')}`;

console.log('🔐 Basic Auth Token generated successfully');

// ===== API ENDPOINTS =====
const PAYHERO_BASE_URL = 'https://api.payhero.co.ke';  // Live
// const PAYHERO_BASE_URL = 'https://sandbox.payhero.co.ke';  // Sandbox for testing

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'aviator.html'));
});

// ===== 1. SEND STK PUSH (Deposit) =====
app.post('/api/deposit', async (req, res) => {
    try {
        const { amount, phone, userId } = req.body;
        
        // Generate unique reference
        const reference = `DEP-${Date.now()}-${userId.slice(0,6)}`;
        
        console.log(`📱 Initiating deposit: KES ${amount} to ${phone}`);
        
        // Store pending payment
        pendingPayments.set(reference, {
            userId,
            amount,
            phone,
            status: 'pending',
            createdAt: Date.now()
        });
        
        // Send STK Push via PayHero
        const payheroResponse = await axios.post(
            `${PAYHERO_BASE_URL}/api/v1/stkpush`,
            {
                amount: amount,
                phone: phone,
                reference: reference,
                callback_url: `https://${req.get('host')}/api/callback`,
                channel_id: 1  // 1 = M-Pesa (check with PayHero for correct channel ID)
            },
            {
                headers: {
                    'Authorization': basicAuthToken,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✅ STK Push sent:', payheroResponse.data);
        
        res.json({
            success: true,
            reference: reference,
            message: 'STK Push sent to your phone. Enter PIN to complete payment.'
        });
        
    } catch (error) {
        console.error('❌ Deposit error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: error.response?.data?.message || 'Failed to initiate payment. Please try again.'
        });
    }
});

// ===== 2. CHECK TRANSACTION STATUS =====
app.get('/api/deposit/status', async (req, res) => {
    const { reference } = req.query;
    
    // First check our local cache
    const payment = pendingPayments.get(reference);
    
    if (!payment) {
        return res.json({ status: 'not_found' });
    }
    
    // If already confirmed locally, return immediately
    if (payment.status !== 'pending') {
        return res.json({
            status: payment.status,
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
                    'Authorization': basicAuthToken,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (statusResponse.data.status === 'success') {
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
        // Return cached status if API call fails
        res.json({
            status: payment.status,
            amount: payment.amount,
            reference: reference
        });
    }
});

// ===== 3. PAYHERO CALLBACK (M-Pesa sends confirmation here) =====
app.post('/api/callback', async (req, res) => {
    console.log('📞 Callback received:', JSON.stringify(req.body, null, 2));
    
    const { reference, status, amount, transaction_id } = req.body;
    
    if (reference && pendingPayments.has(reference)) {
        const payment = pendingPayments.get(reference);
        
        if (status === 'success' || status === 'completed') {
            payment.status = 'SUCCESS';
            payment.transactionId = transaction_id;
            console.log(`✅ Payment SUCCESS: ${reference} - KES ${amount || payment.amount}`);
        } else {
            payment.status = 'FAILED';
            console.log(`❌ Payment FAILED: ${reference}`);
        }
        
        pendingPayments.set(reference, payment);
    }
    
    // Always acknowledge callback to PayHero
    res.json({ status: 'ok', message: 'Callback received' });
});

// ===== 4. CHECK WALLET BALANCE (Optional) =====
app.get('/api/balance', async (req, res) => {
    try {
        const balanceResponse = await axios.get(
            `${PAYHERO_BASE_URL}/api/v1/wallet/balance`,
            {
                headers: {
                    'Authorization': basicAuthToken,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        res.json({
            service_wallet: balanceResponse.data.service_wallet,
            payment_wallet: balanceResponse.data.payment_wallet
        });
        
    } catch (error) {
        console.error('Balance check error:', error.message);
        res.status(500).json({ error: 'Failed to check balance' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📱 Game URL: http://localhost:${PORT}/game`);
    console.log(`🔐 Auth Method: Basic Auth (Username + Password)\n`);
});
