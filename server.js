const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Function to broadcast to all WS clients
function broadcast(data) {
    console.log(`[WS] Broadcasting event: ${data.event}`);
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 = OPEN
            client.send(JSON.stringify(data));
        }
    });
}

wss.on('connection', (ws) => {
    console.log('[WS] New Terminal Connection Established');
});

// === CONFIGURATION ===
// Priorities: 1. .env, 2. Process Args, 3. Hardcoded Defaults
const PORT = process.env.PORT || 9259;
const TEAM_ID = process.env.TEAM_ID || 'the_rock';
const MQTT_BROKER = process.env.MQTT_BROKER || '157.173.101.159';
const MONGO_URI = process.env.MONGODB_URI;

const BASE_TOPIC = `rfid/${TEAM_ID}`;
const TOPIC_STATUS = `${BASE_TOPIC}/card/status`;
const TOPIC_BALANCE = `${BASE_TOPIC}/card/balance`;
const TOPIC_TOPUP = `${BASE_TOPIC}/card/topup`;
const TOPIC_PAY = `${BASE_TOPIC}/card/pay`;

// === MONGODB MODELS ===
const cardSchema = new mongoose.Schema({
    card_uid: { type: String, required: true, unique: true },
    holderName: { type: String, default: "Anonymous Operator" },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
    card_uid: { type: String, required: true, index: true },
    type: { type: String, enum: ['TOPUP', 'PAYMENT'], required: true },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    description: { type: String },
    timestamp: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    emoji: { type: String, default: '📦' },
    category: { type: String, default: 'Emerald Store' },
    active: { type: Boolean, default: true }
});

const Card = mongoose.model('Card', cardSchema, 'cards');
const Transaction = mongoose.model('Transaction', transactionSchema, 'transactions');
const Product = mongoose.model('Product', productSchema, 'products');

// === DB CONNECTION ===
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✓ Connected to MongoDB');
        seedProducts();
    })
    .catch(err => console.error('✗ MongoDB Connection Error:', err));

// === MQTT CLIENT ===
const mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:1883`, {
    clientId: `emerald_backend_${TEAM_ID}_${Math.random().toString(16).slice(3)}`
});

mqttClient.on('connect', () => {
    console.log(`✓ MQTT Connected to ${MQTT_BROKER}`);
    const wildcardTopic = `rfid/${TEAM_ID}/#`;
    mqttClient.subscribe(wildcardTopic, (err) => {
        if (!err) {
            console.log(`✓ Subscribed to wildcard: ${wildcardTopic}`);
        } else {
            console.error(`✗ Subscription error: ${err.message}`);
        }
    });
});

mqttClient.on('message', async (topic, message) => {
    try {
        const raw = message.toString();
        console.log(`[MQTT] Raw message on ${topic}:`, raw);
        const payload = JSON.parse(raw);

        if (topic === TOPIC_STATUS) {
            const { uid } = payload;
            if (!uid) return console.warn('[MQTT] Scan ignored: missing UID');

            console.log(`[MQTT] Search/Create card: ${uid}`);
            let card = await Card.findOne({ card_uid: uid });

            if (!card) {
                card = new Card({ card_uid: uid, balance: 0 });
                await card.save();
                console.log(`[DB] New protocol initialization: ${uid}`);
            }

            broadcast({
                event: 'card-detected',
                uid: card.card_uid,
                balance: card.balance,
                holderName: card.holderName
            });
        } else if (topic === TOPIC_BALANCE) {
            broadcast({ event: 'device-confirmation', payload });
        }
    } catch (e) {
        console.error('[MQTT ERROR]:', e.message);
    }
});

// === API MIDDLEWARE ===
app.use(cors());
app.use(express.json());

// Serving the dashboard at multiple entry points
const dashboardPath = path.join(__dirname, 'emerald_wallet.html');
app.get(['/', '/dashboard', '/emerald-wallet.html'], (req, res) => {
    res.sendFile(dashboardPath);
});

app.use(express.static(__dirname));

// ---------------- Wallet service with EdgeWallet safe update pattern ----------------

async function runSafeWalletUpdate(uid, type, amount, description) {
    const session = await mongoose.startSession();
    let result;

    try {
        await session.withTransaction(async () => {
            const card = await Card.findOne({ card_uid: uid }).session(session);
            if (!card && type === 'PAYMENT') throw new Error('Card not registered');

            const balanceBefore = card ? card.balance : 0;
            let balanceAfter;

            if (type === 'TOPUP') {
                balanceAfter = balanceBefore + amount;
                if (card) {
                    card.balance = balanceAfter;
                    card.updatedAt = Date.now();
                    await card.save({ session });
                } else {
                    const newCard = new Card({ card_uid: uid, balance: amount });
                    await newCard.save({ session });
                }
            } else {
                if (balanceBefore < amount) throw new Error('Insufficient Funds');
                balanceAfter = balanceBefore - amount;
                card.balance = balanceAfter;
                card.updatedAt = Date.now();
                await card.save({ session });
            }

            const transaction = new Transaction({
                card_uid: uid,
                type,
                amount,
                balanceBefore,
                balanceAfter,
                description
            });
            await transaction.save({ session });

            result = { success: true, balanceAfter, card_uid: uid };
        });
        return result;
    } catch (error) {
        console.error(`[TX ERROR]: ${error.message}`);
        throw error;
    } finally {
        session.endSession();
    }
}

// === API ENDPOINTS ===

app.post('/topup', async (req, res) => {
    const { uid, amount, holderName } = req.body;
    try {
        const result = await runSafeWalletUpdate(uid, 'TOPUP', amount, `Top-Up via Dashboard`);

        if (holderName) {
            await Card.updateOne({ card_uid: uid }, { holderName });
        }

        mqttClient.publish(TOPIC_TOPUP, JSON.stringify({ uid, amount, newBalance: result.balanceAfter }));

        broadcast({
            event: 'transaction-complete',
            type: 'TOPUP',
            uid,
            amount,
            newBalance: result.balanceAfter,
            status: 'success'
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/pay', async (req, res) => {
    const { uid, product_id, quantity } = req.body;
    try {
        const product = await Product.findById(product_id);
        if (!product) throw new Error('Product not found');

        const totalAmount = product.price * (quantity || 1);
        const result = await runSafeWalletUpdate(uid, 'PAYMENT', totalAmount, `Paid for: ${product.name} x${quantity || 1}`);

        mqttClient.publish(TOPIC_PAY, JSON.stringify({ uid, amount: totalAmount, newBalance: result.balanceAfter }));

        broadcast({
            event: 'transaction-complete',
            type: 'PAYMENT',
            uid,
            amount: totalAmount,
            newBalance: result.balanceAfter,
            status: 'success',
            product: product.name
        });

        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/cards', async (req, res) => {
    const cards = await Card.find().sort({ updatedAt: -1 });
    res.json(cards);
});

app.get('/transactions', async (req, res) => {
    try {
        const txs = await Transaction.find().sort({ timestamp: -1 }).limit(10);
        res.json(txs);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.get('/products', async (req, res) => {
    console.log('[API] GET /products requested');
    try {
        const products = await Product.find({ active: true });
        res.json(products);
    } catch (err) {
        console.error('[API ERROR] /products:', err.message);
        res.status(500).json({ error: 'Database read failure' });
    }
});

async function seedProducts() {
    try {
        console.log('[DB] Synchronizing premium inventory...');
        // We'll clear the old demo data to ensure the new "Real World" catalog is active
        await Product.deleteMany({});
        const premiumCatalog = [
            { name: 'Artisan Arabica Coffee', price: 1500, emoji: '☕', category: 'Drinks' },
            { name: 'Sparkling Mineral Water', price: 500, emoji: '💧', category: 'Drinks' },
            { name: 'Premium Matcha Latte', price: 2000, emoji: '🍵', category: 'Drinks' },
            { name: 'Organic Power Bar', price: 1200, emoji: '🍫', category: 'Food' },
            { name: 'Avocado Smashed Toast', price: 3500, emoji: '🥑', category: 'Food' },
            { name: 'Wireless Audio Pods', price: 85000, emoji: '🎧', category: 'Tech' },
            { name: 'Fast-Charge Power Bank', price: 45000, emoji: '🔋', category: 'Tech' },
            { name: 'Premium Leather Wallet', price: 25000, emoji: '💼', category: 'Gear' }
        ];
        await Product.insertMany(premiumCatalog);
        console.log('✓ Premium real-world products synchronized');
    } catch (e) {
        console.error('[DB SEED ERROR]:', e.message);
    }
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ============================================
    EMERALD PROTOCOL ENGAGED (v2.1)
    Mode: Hybrid Environment
    Live at: http://localhost:${PORT}
    Target: ${MQTT_BROKER}
    Team ID: ${TEAM_ID}
    Transactions: ATOMIC (MONO-SYC)
    ============================================
    `);
});
