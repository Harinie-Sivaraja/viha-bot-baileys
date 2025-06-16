const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const dotenv = require('dotenv');

// Load environment variables - updated
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

// Parse blocked numbers from environment variable
// Format should be comma-separated numbers without spaces, e.g.: "1234567890,9876543210"
const BLOCKED_NUMBERS = process.env.BLOCKED_NUMBERS ? process.env.BLOCKED_NUMBERS.split(',') : [];

// For local image storage - Initialize all gift folders
const GIFT_FOLDERS = ['Gifts_Under50', 'Gifts_under100', 'Gifts_under150'];
GIFT_FOLDERS.forEach(folderName => {
    const folderPath = path.join(__dirname, folderName);
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`Created images folder at ${folderPath}`);
    }
});

// Keep the original IMAGES_FOLDER for backward compatibility
const IMAGES_FOLDER = path.join(__dirname, 'Gifts_Under50');

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
    
    // Log blocked numbers (if any)
    if (BLOCKED_NUMBERS.length > 0) {
        console.log(`🚫 Blocked numbers (auto-responses only): ${BLOCKED_NUMBERS.join(', ')}`);
    } else {
        console.log(`ℹ️ No blocked numbers configured`);
    }
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
let userTimeouts = {}; // Store timeout IDs for each user

// Enhanced message templates
const messages = {
    welcome: `🎁 *Welcome to VihaCandlesAndGiftings!* 🎁

To serve you better, please answer *4 quick questions* to get the product details.`,

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
2️⃣ → Under ₹100
3️⃣ → Under ₹150
4️⃣ → Above ₹150
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3* or *4*`,

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

    notInterested: `Shall we know why you have contacted us? Do you have any return gifts requirement? If so, you will get

🎁 Get *FLAT ₹200 DISCOUNT* on your first purchase with us on 50 pieces MOQ.

This offer is valid only till tomorrow

If interested in above offer, please reply us. Our team will contact you within 30 mins.`,

    humanAgent: `We understand you may need personalized assistance. Our team will reach out to you shortly to help with your return gift requirements.

Thank you for your patience! 🙏`
};

// Error messages
const errorMessages = {
    function_time: `❌ Please reply with *1, 2, 3* or *4*`,  
    budget: `❌ Please reply with *1, 2, 3* or *4*`,
    piece_count: `❌ Please reply with *1, 2, 3, 4* or *5*`
};

// Helper functions
// Set timeout for any step - 5 minutes timeout for all questions
function setStepTimeout(jid, currentStep) {
    // Clear any existing timeout for this user
    if (userTimeouts[jid]) {
        clearTimeout(userTimeouts[jid]);
    }
    
    // Set a new timeout - 5 minutes (300000 ms)
    userTimeouts[jid] = setTimeout(async () => {
        // Check if the user is still in the same step
        if (userState[jid] && userState[jid].step === currentStep) {
            try {
                console.log(`⏰ No response from ${jid} after 5 minutes on step: ${currentStep}. Deactivating bot.`);
                await sendTextMessage(sock, jid, messages.notInterested);
                console.log(`✅ Sent notInterested message to ${jid}`);
                // Mark conversation as completed to stop further automated responses
                userState[jid].step = 'completed';
                console.log(`✅ Marked conversation as completed for ${jid} due to timeout on step: ${currentStep}`);
            } catch (error) {
                console.error(`❌ Error sending notInterested message: ${error.message}`);
            }
        }
    }, 5 * 60 * 1000); // 5 minutes
}

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
        '2': 'Under ₹100',
        '3': 'Under ₹150',
        '4': 'Above ₹150'
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
const sendProductImages = async (jid, folderName, budgetText) => {
    try {
        const detailedSummary = generateDetailedSummary(userState[jid]);
        await sendTextMessage(sock, jid, detailedSummary);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send best10 images for all categories
        await sendBest10Images(jid, folderName, budgetText);
        
    } catch (error) {
        console.error('❌ Error in sendProductImages:', error);
        const detailedSummary = generateDetailedSummary(userState[jid]);
        await sendTextMessage(sock, jid, detailedSummary);
        
        await sendTextMessage(sock, jid, `🎁 *Return Gifts ${budgetText}*

We have various beautiful return gift options ${budgetText}. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
    }
};

// Special function for Under ₹50 gifts with batch approach
const sendBest10Images = async (jid, folderName, budgetText) => {
    try {
        // First, try to send the best 10 images from best10 subfolder
        const best10Folder = path.join(__dirname, folderName, 'best10');
        
        if (fs.existsSync(best10Folder)) {
            const best10Images = fs.readdirSync(best10Folder).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });

            if (best10Images.length > 0) {
                await sendTextMessage(sock, jid, `✨ *Here are our TOP 10 best return gifts ${budgetText}:*`);
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Send best 10 images
                for (let i = 0; i < best10Images.length; i++) {
                    const imagePath = path.join(best10Folder, best10Images[i]);
                    await sendImageMessage(jid, imagePath);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Ask if user wants to see more collections
                await sendTextMessage(sock, jid, `🎁 *Would you like to see more collections ${budgetText}?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → YES - Show more collections
2️⃣ → NO - These are sufficient
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, YES* or *NO*`);

                // Set user state to wait for more catalog response
                userState[jid].waitingForCatalogResponse = true;
                userState[jid].currentBudgetText = budgetText; // Store budget text for response
                console.log(`🔍 Debug: Set waitingForCatalogResponse=true for ${jid}, budget: ${budgetText}`);
                return;
            }
        }
        
        // Fallback: if best10 folder doesn't exist or is empty, send regular images
        console.log(`❌ Best10 folder not found or empty for ${folderName}, falling back to regular images`);
        const mainFolder = path.join(__dirname, folderName);
        
        if (!fs.existsSync(mainFolder)) {
            console.log(`❌ Main folder not found: ${mainFolder}`);
            await sendTextMessage(sock, jid, `🎁 *Return Gifts ${budgetText}*

We have various beautiful return gift options ${budgetText}. Our team will contact you shortly with complete details.

Thank you for your interest! 😊`);
            return;
        }
        
        const imageFiles = fs.readdirSync(mainFolder).filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });

        if (imageFiles.length === 0) {
            console.log(`❌ No images found in ${folderName}`);
            await sendTextMessage(sock, jid, `🎁 *Return Gifts ${budgetText}*

We have various beautiful return gift options ${budgetText}. Our team will contact you shortly with complete details.

Thank you for your interest! 😊`);
            return;
        }

        // Send first 10 images from main folder
        const imagesToSend = Math.min(imageFiles.length, 10);
        await sendTextMessage(sock, jid, `✨ *Here are our best return gifts ${budgetText}:*`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        for (let i = 0; i < imagesToSend; i++) {
            const imagePath = path.join(mainFolder, imageFiles[i]);
            await sendImageMessage(jid, imagePath);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (imageFiles.length > 10) {
            await sendTextMessage(sock, jid, `🎁 *Would you like to see more collections ${budgetText}?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → YES - Show more collections
2️⃣ → NO - These are sufficient
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, YES* or *NO*`);
            userState[jid].waitingForCatalogResponse = true;
            userState[jid].currentBudgetText = budgetText;
            console.log(`🔍 Debug: Set waitingForCatalogResponse=true for ${jid} (fallback), budget: ${budgetText}`);
        } else {
            await sendTextMessage(sock, jid, `Thank you for viewing our return gifts ${budgetText}!

Our team will contact you shortly on your requirement.

Thank you for your interest! 😊`);
        }
        
    } catch (error) {
        console.error(`❌ Error in sendBest10Images for ${folderName}:`, error);
        await sendTextMessage(sock, jid, `🎁 *Return Gifts ${budgetText}*

We have various beautiful return gift options ${budgetText}. Our team will contact you shortly with complete details.

Thank you for your interest! 😊`);
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
        // Replace your existing connection.update handler with this:

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
        
        // Check if user logged out
        if (lastDisconnect?.error instanceof Boom && 
            lastDisconnect.error.output.statusCode === DisconnectReason.loggedOut) {
            
            console.log('🚪 User logged out - clearing auth and restarting...');
            
            // Clear auth folder to force new QR
            try {
                const authFolder = path.join(__dirname, 'auth_info');
                if (fs.existsSync(authFolder)) {
                    const files = fs.readdirSync(authFolder);
                    for (const file of files) {
                        fs.unlinkSync(path.join(authFolder, file));
                    }
                    console.log('🧹 Auth cleared');
                }
            } catch (error) {
                console.error('❌ Error clearing auth:', error);
            }
            
            // Restart immediately for logout
            setTimeout(() => initializeWhatsAppClient(), 2000);
            
        } else if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
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
sock.ev.on('messages.upsert', async ({ messages: receivedMessages, type }) => {
    try {
        if (type !== 'notify') return;
        
        const message = receivedMessages[0];
        if (!message?.message) return;
        
        const jid = message.key.remoteJid;
        const isFromMe = message.key.fromMe;
        
        // Skip groups and status
        if (jid.includes('@g.us') || jid.includes('status@broadcast')) return;
        
        // Skip own messages
        if (isFromMe) return;
        
        // Check if number is blocked (for automated responses only)
        const phoneNumber = jid.split('@')[0];
        const isBlocked = BLOCKED_NUMBERS.includes(phoneNumber);
        if (isBlocked) {
            console.log(`🚫 Message from blocked number ${phoneNumber} - will only allow human responses`);
            // Force human override for blocked numbers
            if (!humanOverride[jid]) {
                humanOverride[jid] = true;
                console.log(`👤 Human agent mode activated for blocked number ${phoneNumber}`);
            }
        }
        
        // Extract message texts
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
            // Make sure any timeout is cleared
            if (userTimeouts[jid]) {
                clearTimeout(userTimeouts[jid]);
                userTimeouts[jid] = null;
                console.log(`✅ Cleared timeout for ${jid} - conversation already completed`);
            }
            console.log(`✅ Conversation completed for ${jid}`);
            return;
        }
        
        const text = messageText.toLowerCase().trim();
        
        // Initialize new user
        if (!userState[jid]) {
            userState[jid] = { 
                step: 'piece_count',
                errorCount: { piece_count: 0, function_time: 0, budget: 0 },
                lastMessageTime: Date.now()
            };
            try {
                // Send welcome message followed by the first question (quantity)
                await sendTextMessage(sock, jid, messages.welcome);
                console.log(`✅ Sent welcome message to ${jid}`);
                
                // Wait a second before sending the first question
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Send the quantity question as the first question
                await sendTextMessage(sock, jid, messages.quantity);
                console.log(`✅ Sent quantity question to ${jid}`);
                
                // Set a timeout for the first question (piece_count)
                setStepTimeout(jid, 'piece_count');
                console.log(`⏰ Set 5-minute timeout for ${jid} on piece_count step`);
                
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
                
                // Clear any pending timeouts when transferring to human agent
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - transferring to human agent`);
                }
                
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
                    console.log(`✅ Sent error message to ${jid} for step: ${currentStep}`);
                    
                    // Set timeout after sending error message - if user doesn't respond in 5 minutes, deactivate bot
                    setStepTimeout(jid, currentStep);
                    console.log(`⏰ Set 5-minute timeout for ${jid} after invalid input on step: ${currentStep}`);
                    
                } catch (error) {
                    console.error(`❌ Error sending error message: ${error.message}`);
                }
                return false;
            }
        };
        
        // Conversation flow - Starting with piece_count (quantity) question
        if (state.step === 'function_time') {
            if (['1', '2', '3', '4'].includes(text)) {
                // Clear timeout since user responded correctly
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - correct response on function_time`);
                }
                
                userState[jid].step = 'budget';
                userState[jid].timing = text;
                try {
                    await sendTextMessage(sock, jid, messages.budget);
                    console.log(`✅ Sent budget message to ${jid}`);
                    
                    // Set timeout for budget question
                    setStepTimeout(jid, 'budget');
                    console.log(`⏰ Set 5-minute timeout for ${jid} on budget step`);
                    
                } catch (error) {
                    console.error(`❌ Error sending budget message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "What's your budget range? Reply with 1, 2, 3, 4 or 5");
                    setStepTimeout(jid, 'budget');
                }
            } else {
                const ended = await handleInvalidInput('function_time');
                if (ended) return;
            }
        }
        else if (state.step === 'budget') {
            if (['1', '2', '3', '4'].includes(text)) {
                // Clear timeout since user responded correctly
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - correct response on budget`);
                }
                
                userState[jid].step = 'location';
                userState[jid].budget = text;
                try {
                    await sendTextMessage(sock, jid, messages.location);
                    console.log(`✅ Sent location message to ${jid}`);
                    
                    // Set timeout for location question
                    setStepTimeout(jid, 'location');
                    console.log(`⏰ Set 5-minute timeout for ${jid} on location step`);
                    
                } catch (error) {
                    console.error(`❌ Error sending location message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "Your delivery location please (City/Area)?");
                    setStepTimeout(jid, 'location');
                }
            } else {
                const ended = await handleInvalidInput('budget');
                if (ended) return;
            }
        }
        else if (state.step === 'piece_count') {
            // Clear the timeout since the user has responded
            if (userTimeouts[jid]) {
                clearTimeout(userTimeouts[jid]);
                userTimeouts[jid] = null;
                console.log(`✅ Cleared timeout for ${jid} - user responded to first question`);
            }
            
            if (['1', '2', '3', '4', '5'].includes(text)) {
                userState[jid].quantity = text;
                userState[jid].step = 'function_time';
                try {
                    await sendTextMessage(sock, jid, messages.timing);
                    console.log(`✅ Sent timing message to ${jid}`);
                    
                    // Set timeout for timing question
                    setStepTimeout(jid, 'function_time');
                    console.log(`⏰ Set 5-minute timeout for ${jid} on function_time step`);
                    
                } catch (error) {
                    console.error(`❌ Error sending timing message: ${error.message}`);
                    // Fallback to a simple message if the template fails
                    await sendTextMessage(sock, jid, "When do you need the return gifts delivered? Reply with 1, 2, 3 or 4");
                    setStepTimeout(jid, 'function_time');
                }
            } else {
                const ended = await handleInvalidInput('piece_count');
                if (ended) return;
            }
        }
        else if (state.waitingForCatalogResponse) {
            // Handle 1/2/YES/NO response for more collections request
            console.log(`🔍 Debug: Customer ${jid} replied "${text}" while waiting for catalog response`);
            if (text.includes('1') || text.includes('yes') || text === 'y') {
                try {
                    const budgetText = userState[jid].currentBudgetText || 'in your budget';
                    await sendTextMessage(sock, jid, `✨ *Great! Our team will send you all collections ${budgetText} shortly.*

Thank you for your interest! 😊`);
                    console.log(`✅ Customer ${jid} requested more collections for budget: ${budgetText}`);
                } catch (error) {
                    console.error(`❌ Error sending more collections message: ${error.message}`);
                }
                
                // Reset the catalog response flag and mark conversation as completed
                userState[jid].waitingForCatalogResponse = false;
                userState[jid].step = 'completed';
                
                // Clear any pending timeouts
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - more collections requested`);
                }
                
            } else if (text.includes('2') || text.includes('no') || text === 'n') {
                try {
                    await sendTextMessage(sock, jid, `Thank you for viewing our return gifts!

Our team will contact you shortly on your requirement.

Thank you for your interest! 😊`);
                    console.log(`✅ Customer ${jid} declined more collections`);
                } catch (error) {
                    console.error(`❌ Error sending final message: ${error.message}`);
                }
                
                // Reset the catalog response flag and mark conversation as completed
                userState[jid].waitingForCatalogResponse = false;
                userState[jid].step = 'completed';
                
                // Clear any pending timeouts
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - collections declined`);
                }
                
            } else {
                // Invalid response to collections question - end conversation
                try {
                    await sendTextMessage(sock, jid, `Thank you for your interest!

Our team will contact you shortly on your requirement.

Thank you! 😊`);
                    console.log(`✅ Customer ${jid} gave invalid response - conversation ended`);
                } catch (error) {
                    console.error(`❌ Error sending team contact message: ${error.message}`);
                }
                
                // Reset the catalog response flag and mark conversation as completed
                userState[jid].waitingForCatalogResponse = false;
                userState[jid].step = 'completed';
                
                // Clear any pending timeouts
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - invalid response, conversation ended`);
                }
            }
            return; // Don't process further
        }
        else if (state.step === 'location') {
            // Clear timeout since user responded with location
            if (userTimeouts[jid]) {
                clearTimeout(userTimeouts[jid]);
                userTimeouts[jid] = null;
                console.log(`✅ Cleared timeout for ${jid} - location provided`);
            }
            
            userState[jid].location = messageText.trim();
            
            try {
                if (userState[jid].budget === '1') {
                    await sendProductImages(jid, 'Gifts_Under50', 'under ₹50');
                    console.log(`✅ Sent product images (under ₹50) to ${jid}`);
                } else if (userState[jid].budget === '2') {
                    await sendProductImages(jid, 'Gifts_under100', 'under ₹100');
                    console.log(`✅ Sent product images (under ₹100) to ${jid}`);
                } else if (userState[jid].budget === '3') {
                    await sendProductImages(jid, 'Gifts_under150', 'under ₹150');
                    console.log(`✅ Sent product images (under ₹150) to ${jid}`);
                } else if (userState[jid].budget === '4') {
                    await sendProductImages(jid, 'Gifts_above150', 'above ₹150');
                    console.log(`✅ Sent product images (above ₹150) to ${jid}`);
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
            
            // Only mark as completed if we're not waiting for catalog response
            if (!userState[jid].waitingForCatalogResponse) {
                userState[jid].step = 'completed';
                
                // Clear any pending timeouts when conversation is completed
                if (userTimeouts[jid]) {
                    clearTimeout(userTimeouts[jid]);
                    userTimeouts[jid] = null;
                    console.log(`✅ Cleared timeout for ${jid} - conversation completed`);
                }
                
                console.log(`✅ Conversation completed for ${jid}`);
            } else {
                console.log(`🔄 Waiting for catalog response from ${jid}`);
            }
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