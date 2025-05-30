const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import Baileys
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

// Create Express app for web interface
const app = express();
// Use the PORT environment variable provided by Render
// Default to 3000 only for local development
const PORT = process.env.PORT || 3000;

let qrCodeData = '';
let isReady = false;
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// MongoDB connection details
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://your_username:your_password@your_cluster.mongodb.net/';
const MONGODB_DB = process.env.MONGODB_DB || 'whatsapp_bot';

// For local image storage
const IMAGES_FOLDER = path.join(__dirname, 'Gifts_Under50');
if (!fs.existsSync(IMAGES_FOLDER)) {
    fs.mkdirSync(IMAGES_FOLDER, { recursive: true });
    console.log(`Created images folder at ${IMAGES_FOLDER}`);
}

// Enhanced web interface
app.get('/', (req, res) => {
    if (isReady) {
        res.send(`
            <html>
                <head>
                    <title>WhatsApp Bot Status</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f5f5f5; }
                        .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                        .status-online { color: #28a745; }
                        .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
                        .btn:hover { background: #0056b3; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>✅ WhatsApp Bot is Ready!</h1>
                        <p class="status-online">Your VihaCandlesAndGiftings bot is active and ready to receive messages.</p>
                        <div style="margin-top: 20px; padding: 20px; background: #d4edda; border-radius: 10px;">
                            <h3>🔄 Bot Status: ONLINE</h3>
                            <p>Session authenticated successfully</p>
                            <p><small>Last connected: ${new Date().toLocaleString()}</small></p>
                        </div>
                        <button class="btn" onclick="location.reload()">Refresh Status</button>
                    </div>
                </body>
            </html>
        `);
    } else if (qrCodeData) {
        res.send(`
            <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f5f5f5; }
                        .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                        .qr-code { max-width: 300px; margin: 20px auto; border: 2px solid #ddd; border-radius: 10px; }
                        .warning { background: #fff3cd; padding: 15px; border-radius: 10px; margin: 20px 0; }
                        .instructions { text-align: left; background: #e7f3ff; padding: 20px; border-radius: 10px; margin: 20px 0; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>📱 Scan QR Code to Connect WhatsApp</h1>
                        <div class="instructions">
                            <h3>📋 Instructions:</h3>
                            <ol>
                                <li>Open WhatsApp on your phone</li>
                                <li>Tap Menu (⋮) → Linked Devices</li>
                                <li>Tap "Link a Device"</li>
                                <li>Scan this QR code</li>
                            </ol>
                        </div>
                        <div id="qr-container">
                            <img src="${qrCodeData}" alt="QR Code" class="qr-code">
                        </div>
                        <div class="warning">
                            <p><strong>⚠️ Important:</strong> QR code expires in 20 seconds. If expired, the page will refresh automatically.</p>
                        </div>
                        <p><small>💾 Session will be stored securely for reconnection</small></p>
                    </div>
                    <script>
                        // Auto-refresh every 15 seconds to get new QR if needed
                        setTimeout(() => location.reload(), 15000);
                    </script>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <head>
                    <title>WhatsApp Bot Starting</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f5f5f5; }
                        .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 50px; height: 50px; animation: spin 2s linear infinite; margin: 20px auto; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🔄 Starting WhatsApp Bot...</h1>
                        <div class="spinner"></div>
                        <p>Initializing session and connecting to WhatsApp...</p>
                        <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 10px;">
                            <small>⚡ This may take a few seconds on first startup</small>
                        </div>
                    </div>
                    <script>
                        // Auto-refresh every 3 seconds
                        setTimeout(() => location.reload(), 3000);
                    </script>
                </body>
            </html>
        `);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: isReady ? 'ready' : 'initializing',
        timestamp: new Date().toISOString(),
        reconnectAttempts: reconnectAttempts
    });
});

// Start Express server
// Make sure to listen on the PORT provided by Render
const server = app.listen(PORT, () => {
    console.log(`🌐 Web interface running on port ${PORT}`);
    console.log(`📊 Health check available at /health`);
    // Log additional information to help with debugging
    console.log(`🔍 Environment: ${process.env.NODE_ENV}`);
});

// Keep-alive for Render
if (process.env.NODE_ENV === 'production') {
    // Use the RENDER_EXTERNAL_URL provided by Render
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
    console.log(`🔄 Keep-alive URL: ${RENDER_URL || 'Not available yet'}`);
    
    setInterval(() => {
        const https = require('https');
        const http = require('http');
        const client = RENDER_URL.startsWith('https://') ? https : http;
        
        client.get(`${RENDER_URL}/health`, (res) => {
            console.log(`💓 Keep-alive: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log('❌ Keep-alive error:', err.message);
        });
    }, 13 * 60 * 1000); // Every 13 minutes
}

// Simple in-memory state management (for Render's ephemeral storage)
let userState = {};
let humanOverride = {};

// Enhanced message templates
const messages = {
    welcome: `🎁 *Welcome to VihaCandlesAndGiftings!* 🎁

To serve you better, we have *5 quick questions* for you.

Are you looking for return gifts for your function?

━━━━━━━━━━━━━━━━━━━
1️⃣ → Yes, I need return gifts
2️⃣ → No
━━━━━━━━━━━━━━━━━━━

Reply with *1* or *2*`,

    timing: `⏰ *When do you need the return gifts delivered?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → Within 1 week
2️⃣ → Within 2 weeks  
3️⃣ → Within 3 weeks
4️⃣ → More than 3 weeks
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3* or *4*`,

    budget: `💰 *What's your budget range?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → Under ₹50
2️⃣ → ₹51 - ₹100
3️⃣ → ₹101 - ₹150
4️⃣ → ₹151 - ₹200
5️⃣ → More than ₹200
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3, 4* or *5*`,

    quantity: `🧮 *How many pieces do you need?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → Less than 30 pieces
2️⃣ → 30 - 50 pieces
3️⃣ → 51 - 100 pieces
4️⃣ → 101 - 150 pieces
5️⃣ → More than 150 pieces
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3, 4* or *5*`,

    location: `📍 *Your delivery location please (City/Area)?*`,

    notInterested: `Then, Shall we know why you have contacted us? Do you have any return gifts requirement? If so, you will get

🎁 Get *FLAT ₹250 DISCOUNT* on your first purchase with us on 50 pieces MOQ.

This offer is valid only till tomorrow

If interested in above offer, please reply us. Our team will talk to you within 30 mins.`,

    humanAgent: `We understand you may need personalized assistance. Our team will reach out to you shortly to help with your return gift requirements.

Thank you for your patience! 🙏`
};

// Error messages
const errorMessages = {
    start: `❌ Please reply with *1* or *2*`,
    function_time: `❌ Please reply with *1, 2, 3* or *4*`,  
    budget: `❌ Please reply with *1, 2, 3, 4* or *5*`,
    piece_count: `❌ Please reply with *1, 2, 3, 4* or *5*`
};

// Helper functions
async function sendTextMessage(sock, jid, text) {
    try {
        // Validate input parameters
        if (!text || typeof text !== 'string') {
            console.log(`❌ Invalid text provided: ${text}`);
            return;
        }
        
        if (!jid) {
            console.log('❌ Invalid JID provided');
            return;
        }

        // Trim whitespace and check if text is empty
        const trimmedText = text.trim();
        if (trimmedText === '') {
            console.log('❌ Empty text after trimming');
            return;
        }

        await sock.sendMessage(jid, { 
            text: trimmedText 
        });
        
        console.log(`📤 Sent message to ${jid}: ${trimmedText}`);
    } catch (error) {
        console.error('❌ Error sending message:', error);
    }
}

const sendImageMessage = async (jid, imagePath, caption = '') => {
    try {
        if (!fs.existsSync(imagePath)) {
            console.log(`❌ Image not found: ${imagePath}`);
            if (caption) await sendTextMessage(jid, caption);
            return;
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        await sock.sendMessage(jid, {
            image: imageBuffer,
            caption: caption,
            mimetype: 'image/jpeg'
        });
        console.log(`📸 Sent image to ${jid}`);
    } catch (error) {
        console.error(`❌ Error sending image: ${error.message}`);
        if (caption) await sendTextMessage(jid, caption);
    }
};

// Generate user summary
const generateDetailedSummary = (userStateData) => {
    const timingOptions = {
        '1': 'Within 1 week',
        '2': 'Within 2 weeks', 
        '3': 'Within 3 weeks',
        '4': 'After 3 weeks'
    };

    const budgetOptions = {
        '1': 'Under ₹50',
        '2': '₹51 - ₹100',
        '3': '₹101 - ₹150', 
        '4': '₹151 - ₹200',
        '5': 'More than ₹200'
    };

    const quantityOptions = {
        '1': 'Less than 30 pieces',
        '2': '30 - 50 pieces',
        '3': '51 - 100 pieces',
        '4': '101 - 150 pieces', 
        '5': 'More than 150 pieces'
    };

    return `*Your Requirements:*
• Budget: ${budgetOptions[userStateData.budget] || 'Not specified'}
• Quantity: ${quantityOptions[userStateData.quantity] || 'Not specified'}
• Function Timing: ${timingOptions[userStateData.timing] || 'Not specified'}
• Delivery Location: ${userStateData.location || 'Not specified'}`;
};

// Send product images
// Update sendProductImages function - around line 350
const sendProductImages = async (jid, folderName, budgetText) => {
    try {
        const detailedSummary = generateDetailedSummary(userState[jid]);
        await sendTextMessage(sock, jid, detailedSummary);  // FIXED: Added sock parameter
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await sendTextMessage(sock, jid, `🎁 *Here are our return gifts ${budgetText}:*`);  // FIXED: Added sock parameter
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const imagesFolder = path.join(__dirname, folderName);
        
        if (!fs.existsSync(imagesFolder)) {
            console.log(`❌ Images folder not found: ${imagesFolder}`);
            await sendTextMessage(sock, jid, `🎁 *Return Gifts ${budgetText}*

We have various beautiful return gift options ${budgetText}. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);  // FIXED: Added sock parameter
            return;
        }
        
        const imageFiles = fs.readdirSync(imagesFolder).filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });

        if (imageFiles.length === 0) {
            console.log(`❌ No images found in ${folderName}`);
            await sendTextMessage(sock, jid, `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);  // FIXED: Added sock parameter
            return;
        }

        // Send images with delays
        for (let i = 0; i < Math.min(imageFiles.length, 10); i++) { // Limit to 10 images
            const imagePath = path.join(imagesFolder, imageFiles[i]);
            await sendImageMessage(jid, imagePath);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }

        const finalMessage = `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`;

        await sendTextMessage(sock, jid, finalMessage);  // FIXED: Added sock parameter
        
    } catch (error) {
        console.error('❌ Error in sendProductImages:', error);
        const detailedSummary = generateDetailedSummary(userState[jid]);
        await sendTextMessage(sock, jid, detailedSummary);  // FIXED: Added sock parameter
        
        await sendTextMessage(sock, jid, `🎁 *Return Gifts ${budgetText}*

We have various beautiful return gift options ${budgetText}. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);  // FIXED: Added sock parameter
    }
};

// Initialize WhatsApp Client
async function initializeWhatsAppClient() {
    try {
        console.log('🔄 Creating WhatsApp client with Baileys...');
        
        const logger = pino({ level: 'silent' }); // Reduce logging noise
        
        // Use ephemeral auth state for Render
        const authFolder = path.join(__dirname, 'auth_info');
        if (!fs.existsSync(authFolder)) {
            fs.mkdirSync(authFolder, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        console.log('✅ Auth state initialized');
        
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📡 Using WA v${version.join('.')}, isLatest: ${isLatest}`);
        
        sock = makeWASocket({
            version,
            logger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            browser: ['VihaCandlesAndGiftings Bot', 'Chrome', '10.0'],
            generateHighQualityLinkPreview: true,
            defaultQueryTimeoutMs: 60000,
            getMessage: async key => {
                return { conversation: 'Hello!' };
            }
        });
        
        // Connection handler
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('📱 QR Code received');
                try {
                    qrCodeData = await QRCode.toDataURL(qr, { width: 300 });
                    console.log('✅ QR Code generated for web interface');
                } catch (err) {
                    console.error('❌ Error generating QR:', err);
                }
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error instanceof Boom ? 
                    lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
                
                console.log('❌ Connection closed:', lastDisconnect?.error?.message || 'unknown reason');
                isReady = false;
                qrCodeData = '';
                
                if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`🔄 Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                    setTimeout(() => initializeWhatsAppClient(), 5000);
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log('❌ Max reconnection attempts reached');
                } else {
                    console.log('❌ Logged out, waiting for QR scan');
                    qrCodeData = '';
                }
            } else if (connection === 'open') {
                console.log('✅ VihaCandlesAndGiftings Bot is ready!');
                isReady = true;
                qrCodeData = '';
                reconnectAttempts = 0;
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Message handler
        // Message handler - REPLACE the existing sock.ev.on('messages.upsert') section
sock.ev.on('messages.upsert', async ({ messages, type }) => {
    try {
        if (type !== 'notify') return;
        
        const message = messages[0];
        if (!message?.message) return;
        
        const jid = message.key.remoteJid;
        const isFromMe = message.key.fromMe;
        
        // Skip groups and status
        if (jid.includes('@g.us') || jid.includes('status@broadcast')) return;
        
        // Skip own messages
        if (isFromMe) return;
        
        // Extract message text
        let messageText = '';
        if (message.message.conversation) {
            messageText = message.message.conversation;
        } else if (message.message.extendedTextMessage) {
            messageText = message.message.extendedTextMessage.text;
        } else if (message.message.imageMessage?.caption) {
            messageText = message.message.imageMessage.caption;
        }
        
        console.log(`📨 Message from ${jid}: ${messageText}`);
        
        // Check human override
        if (humanOverride[jid]) {
            console.log(`👤 Human agent active for ${jid}`);
            return;
        }
        
        // Check if conversation completed
        if (userState[jid]?.step === 'completed') {
            console.log(`✅ Conversation completed for ${jid}`);
            return;
        }
        
        const text = messageText.toLowerCase().trim();
        
        // Initialize new user
        if (!userState[jid]) {
            userState[jid] = { 
                step: 'start',
                errorCount: { start: 0, function_time: 0, budget: 0, piece_count: 0 }
            };
            try {
                // Make sure we're sending the welcome message correctly
                await sendTextMessage(sock, jid, messages.welcome);
                console.log(`✅ Sent welcome message to ${jid}`);
            } catch (error) {
                console.error(`❌ Error sending welcome message: ${error.message}`);
            }
            return;
        }
        
        const state = userState[jid];
        
        // Handle invalid input
        const handleInvalidInput = async (currentStep) => {
            state.errorCount[currentStep]++;
            
            if (state.errorCount[currentStep] >= 3) {
                console.log(`❌ User ${jid} exceeded 3 attempts at ${currentStep}`);
                userState[jid].step = 'completed';
                try {
                    // Make sure we're sending the human agent message correctly
                    await sendTextMessage(sock, jid, messages.humanAgent);
                    console.log(`✅ Sent human agent message to ${jid}`);
                } catch (error) {
                    console.error(`❌ Error sending human agent message: ${error.message}`);
                }
                return true;
            } else {
                try {
                    await sendTextMessage(sock, jid, errorMessages[currentStep]);
                } catch (error) {
                    console.error(`❌ Error sending error message: ${error.message}`);
                }
                return false;
            }
        };
        
        // Conversation flow
        if (state.step === 'start') {
            if (['yes', '1'].includes(text)) {
                userState[jid].step = 'function_time';
                try {
                    // Debug the message content
                    console.log(`Timing message: ${typeof messages.timing === 'string' ? 'String' : 'Not a string'}`);
                    console.log(`Timing message length: ${messages.timing ? messages.timing.length : 'undefined'}`);
                    
                    await sendTextMessage(sock, jid, messages.timing);
                    console.log(`✅ Sent timing message to ${jid}`);
                } catch (error) {
                    console.error(`❌ Error sending timing message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "When do you need the return gifts delivered? Reply with 1, 2, 3 or 4");
                }
            } else if (['no', '2'].includes(text)) {
                userState[jid].step = 'completed';
                try {
                    await sendTextMessage(sock, jid, messages.notInterested);
                    console.log(`✅ Sent not interested message to ${jid}`);
                } catch (error) {
                    console.error(`❌ Error sending not interested message: ${error.message}`);
                }
            } else {
                const ended = await handleInvalidInput('start');
                if (ended) return;
            }
        }
        else if (state.step === 'function_time') {
            if (['1', '2', '3', '4'].includes(text)) {
                userState[jid].step = 'budget';
                userState[jid].timing = text;
                try {
                    await sendTextMessage(sock, jid, messages.budget);
                    console.log(`✅ Sent budget message to ${jid}`);
                } catch (error) {
                    console.error(`❌ Error sending budget message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "What's your budget range? Reply with 1, 2, 3, 4 or 5");
                }
            } else {
                const ended = await handleInvalidInput('function_time');
                if (ended) return;
            }
        }
        else if (state.step === 'budget') {
            if (['1', '2', '3', '4', '5'].includes(text)) {
                userState[jid].step = 'piece_count';
                userState[jid].budget = text;
                try {
                    await sendTextMessage(sock, jid, messages.quantity);
                    console.log(`✅ Sent quantity message to ${jid}`);
                } catch (error) {
                    console.error(`❌ Error sending quantity message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "How many pieces do you need? Reply with 1, 2, 3, 4 or 5");
                }
            } else {
                const ended = await handleInvalidInput('budget');
                if (ended) return;
            }
        }
        else if (state.step === 'piece_count') {
            if (['1', '2', '3', '4', '5'].includes(text)) {
                userState[jid].quantity = text;
                userState[jid].step = 'location';
                try {
                    await sendTextMessage(sock, jid, messages.location);
                    console.log(`✅ Sent location message to ${jid}`);
                } catch (error) {
                    console.error(`❌ Error sending location message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "Your delivery location please (City/Area)?");
                }
            } else {
                const ended = await handleInvalidInput('piece_count');
                if (ended) return;
            }
        }
        else if (state.step === 'location') {
            userState[jid].location = messageText.trim();
            
            try {
                if (userState[jid].budget === '1') {
                    await sendProductImages(jid, 'Gifts_Under50', 'under ₹50');
                    console.log(`✅ Sent product images (under ₹50) to ${jid}`);
                } else if (userState[jid].budget === '2') {
                    await sendProductImages(jid, 'Gifts_Under100', 'under ₹100');
                    console.log(`✅ Sent product images (under ₹100) to ${jid}`);
                } else {
                    try {
                        const detailedSummary = generateDetailedSummary(userState[jid]);
                        await sendTextMessage(sock, jid, detailedSummary);
                        console.log(`✅ Sent detailed summary to ${jid}`);
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        await sendTextMessage(sock, jid, `✅ *Thank you for your interest!*

Our team will talk to you. 😊`);
                        console.log(`✅ Sent thank you message to ${jid}`);
                    } catch (error) {
                        console.error(`❌ Error sending summary: ${error.message}`);
                        // Fallback to a simple message
                        await sendTextMessage(sock, jid, "Thank you for your interest! Our team will contact you shortly.");
                    }
                }
            } catch (error) {
                console.error(`❌ Error in location step: ${error.message}`);
                try {
                    await sendTextMessage(sock, jid, "Thank you for your information. Our team will contact you shortly.");
                } catch (innerError) {
                    console.error(`❌ Error sending fallback message: ${innerError.message}`);
                }
            }
            
            userState[jid].step = 'completed';
            console.log(`✅ Conversation completed for ${jid}`);
        }
        
    } catch (error) {
        console.error('❌ Error handling message:', error);
    }
});
        
        return sock;
    } catch (error) {
        console.error('❌ Failed to initialize WhatsApp client:', error);
        throw error;
    }
}

// Start the bot
console.log('🚀 Starting WhatsApp bot with Baileys...');
initializeWhatsAppClient().catch(error => {
    console.error('❌ Failed to start bot:', error);
    // Don't exit, let it retry
});