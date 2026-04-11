const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Store pending payments (in memory - resets if server restarts)
const pendingPayments = new Map();

// ===== IMPORTANT: Replace with your PayHero credentials =====
const PAYHERO_API_KEY = "YOUR_PAYHERO_API_KEY_HERE";
const PAYHERO_API_SECRET = "YOUR_PAYHERO_SECRET_HERE";

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
        
        // Generate unique reference
        const reference = `DEP-${Date.now()}-${userId.slice(0,6)}`;
        
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
            'https://api.payhero.co.ke/api/v1/stkpush',
            {
                amount: amount,
                phone: phone,
                reference: reference,
                callback_url: `https://${req.get('host')}/api/callback`
            },
            {
                headers: {
                    'Authorization': `Bearer ${PAYHERO_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        res.json({
            success: true,
            reference: reference,
            message: 'STK Push sent to your phone'
        });
        
    } catch (error) {
        console.error('Deposit error:', error.message);
        res.status(500).json({ error: 'Failed to initiate payment' });
    }
});

// ===== CHECK PAYMENT STATUS =====
app.get('/api/deposit/status', async (req, res) => {
    const { reference } = req.query;
    const payment = pendingPayments.get(reference);
    
    if (!payment) {
        return res.json({ status: 'not_found' });
    }
    
    res.json({
        status: payment.status,
        amount: payment.amount,
        reference: reference
    });
});

// ===== PAYHERO CALLBACK (M-Pesa sends confirmation here) =====
app.post('/api/callback', async (req, res) => {
    console.log('Callback received:', JSON.stringify(req.body, null, 2));
    
    const { reference, ResultCode } = req.body;
    
    if (reference && pendingPayments.has(reference)) {
        const payment = pendingPayments.get(reference);
        
        if (ResultCode === '0') {
            payment.status = 'SUCCESS';
        } else {
            payment.status = 'FAILED';
        }
        
        pendingPayments.set(reference, payment);
        console.log(`Payment ${reference}: ${payment.status}`);
    }
    
    res.json({ ResultCode: 0 });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📱 Open: http://localhost:${PORT}`);
});
