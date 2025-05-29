const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import MongoDB auth state provider
const { useMongoDBAuthState, useMongoDBUserState } = require('./mongoAuthState');

// Import Baileys
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

// Import makeInMemoryStore from the correct location
const { makeInMemoryStore } = require('@whiskeysockets/baileys/lib/Store');

// Create Express app for web interface
const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = '';
let isReady = false;
let sock = null;

// MongoDB connection details
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://your_username:your_password@your_cluster.mongodb.net/';
const MONGODB_DB = process.env.MONGODB_DB || 'whatsapp_bot';

// For local image storage, we still need a folder
const IMAGES_FOLDER = path.join(__dirname, 'Gifts_Under50');
if (!fs.existsSync(IMAGES_FOLDER)) {
    fs.mkdirSync(IMAGES_FOLDER, { recursive: true });
    console.log(`Created images folder at ${IMAGES_FOLDER}`);
}

// Serve QR code page
app.get('/', (req, res) => {
    if (isReady) {
        res.send(`
            <html>
                <body style="text-align: center; font-family: Arial;">
                    <h1>✅ WhatsApp Bot is Ready!</h1>
                    <p>Your VihaCandlesAndGiftings bot is active and ready to receive messages.</p>
                    <div style="margin-top: 20px; padding: 20px; background: #f0f8ff; border-radius: 10px;">
                        <h3>🔄 Bot Status: ONLINE</h3>
                        <p>Session stored in MongoDB database</p>
                    </div>
                </body>
            </html>
        `);
    } else if (qrCodeData) {
        res.send(`
            <html>
                <body style="text-align: center; font-family: Arial;">
                    <h1>📱 Scan QR Code to Connect WhatsApp</h1>
                    <div id="qr-container">
                        <img src="${qrCodeData}" alt="QR Code" style="max-width: 400px;">
                    </div>
                    <p>Scan this QR code with your WhatsApp to connect the bot</p>
                    <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 10px;">
                        <small>💾 Using MongoDB for persistent session storage</small>
                    </div>
                    <script>
                        // Auto-refresh every 5 seconds
                        setTimeout(() => location.reload(), 5000);
                    </script>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <body style="text-align: center; font-family: Arial;">
                    <h1>🔄 Starting WhatsApp Bot...</h1>
                    <p>Initializing session...</p>
                    <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 10px;">
                        <small>⚡ This may take a few seconds on first startup</small>
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

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    res.json({
        status: isReady ? 'ready' : 'initializing',
        timestamp: new Date().toISOString()
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`Web interface running on port ${PORT}`);
    console.log(`Health check available at /health`);
});

// Self-ping to prevent Render from sleeping (for free tier)
if (process.env.NODE_ENV === 'production') {
    // Render sets this environment variable automatically
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`Service URL for self-ping: ${RENDER_URL}`);
    
    setInterval(() => {
        const https = require('https');
        const http = require('http');
        const client = RENDER_URL.startsWith('https://') ? https : http;
        
        client.get(`${RENDER_URL}/health`, (res) => {
            console.log(`Keep-alive ping: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log('Keep-alive error:', err.message);
        });
    }, 14 * 60 * 1000); // Every 14 minutes
}

// Initialize WhatsApp Client with Baileys
async function initializeWhatsAppClient() {
    try {
        console.log('🔄 Creating WhatsApp client with Baileys...');
        
        // Logger
        const logger = pino({ level: 'warn' });
        
        // Store to save the message history
        const store = makeInMemoryStore({ logger });
        
        // Get auth state from MongoDB
        console.log('🔄 Connecting to MongoDB for auth state...');
        const { state, saveCreds } = await useMongoDBAuthState(MONGODB_URI, MONGODB_DB);
        console.log('✅ Connected to MongoDB auth state');
        
        // Fetch latest version of Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
        
        // Create socket connection
        sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: true,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            generateHighQualityLinkPreview: true,
            browser: ['VihaCandlesAndGiftings Bot', 'Chrome', '10.0'],
            getMessage: async key => {
                return { conversation: 'Hello!' };
            }
        });
        
        // Bind store to socket
        store.bind(sock.ev);
        
        // Handle connection update events
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('📱 QR Code received, generating web QR...');
                // Generate QR for terminal
                qrcode.generate(qr, { small: true });
                
                // Generate QR for web interface
                try {
                    qrCodeData = await QRCode.toDataURL(qr);
                    console.log('✅ QR Code available on web interface');
                } catch (err) {
                    console.error('Error generating web QR:', err);
                }
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? 
                    lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
                
                console.log('❌ Connection closed due to ', lastDisconnect?.error?.message || 'unknown reason');
                isReady = false;
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting...');
                    initializeWhatsAppClient();
                } else {
                    console.log('❌ Connection closed permanently. Logged out.');
                    isReady = false;
                    qrCodeData = '';
                }
            } else if (connection === 'open') {
                console.log('✅ VihaCandlesAndGiftings Bot is ready!');
                console.log('💾 Session saved to MongoDB');
                isReady = true;
                qrCodeData = ''; // Clear QR code
            }
        });
        
        // Save credentials whenever they are updated
        sock.ev.on('creds.update', saveCreds);
        
        // Setup message handlers
        setupMessageHandlers(sock);
        
        return sock;
    } catch (error) {
        console.error('❌ Failed to initialize WhatsApp client:', error);
        throw error;
    }
}

// Your message handling logic adapted for Baileys
async function setupMessageHandlers(sock) {
    // Initialize MongoDB user state
    const mongoState = await useMongoDBUserState(MONGODB_URI, MONGODB_DB);
    
    // Load user state and human override from MongoDB
    let userState = {}; // Stores each user's state
    let humanOverride = {}; // Tracks users where human agent has taken over
    
    // Load saved state from MongoDB
    try {
        userState = await mongoState.loadUserState();
        console.log('✅ Loaded user state from MongoDB');
        
        humanOverride = await mongoState.loadHumanOverride();
        console.log('✅ Loaded human override data from MongoDB');
    } catch (error) {
        console.error('❌ Error loading saved state from MongoDB:', error);
    }
    
    // Function to save state to MongoDB
    const saveState = async () => {
        try {
            await mongoState.saveState(userState, humanOverride);
        } catch (error) {
            console.error('❌ Error saving state to MongoDB:', error);
        }
    };

    // Enhanced message templates with improved welcome message
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

    // Error messages with attempt tracking
    const errorMessages = {
        start: `❌ Please reply with *1* or *2*`,
        function_time: `❌ Please reply with *1, 2, 3* or *4*`,
        budget: `❌ Please reply with *1, 2, 3, 4* or *5*`,
        piece_count: `❌ Please reply with *1, 2, 3, 4* or *5*`
    };

    // Helper function to send a text message with Baileys
    const sendTextMessage = async (jid, text) => {
        await sock.sendMessage(jid, { text });
    };

    // Helper function to send an image with Baileys
    const sendImageMessage = async (jid, imagePath, caption = '') => {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            await sock.sendMessage(jid, {
                image: imageBuffer,
                caption: caption,
                mimetype: 'image/jpeg' // Adjust based on your image type
            });
        } catch (error) {
            console.error(`Error sending image: ${error.message}`);
            // Send text fallback if image fails
            if (caption) {
                await sendTextMessage(jid, caption);
            }
        }
    };

    // Function to send images for under ₹50 items
    const sendUnder50Images = async (jid) => {
        try {
            // Step 1: Send summary as separate message
            const detailedSummary = generateDetailedSummary(userState[jid]);
            await sendTextMessage(jid, detailedSummary);
            
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 2: Send introductory message as separate message
            await sendTextMessage(jid, `🎁 *Here are our return gifts under ₹50:*`);
            
            // Small delay before images
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Path to your images folder
            const imagesFolder = IMAGES_FOLDER;
            
            // Check if folder exists
            if (!fs.existsSync(imagesFolder)) {
                console.log('Images folder not found, sending fallback message');
                await sendTextMessage(jid, `🎁 *Return Gifts Under ₹50*

We have various beautiful return gift options under ₹50. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }
            
            // Read all files from the images folder
            const imageFiles = fs.readdirSync(imagesFolder).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });

            if (imageFiles.length === 0) {
                console.log('No images found in the folder');
                await sendTextMessage(jid, `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }

            // Step 3: Send each image with a small delay to avoid rate limiting
            for (let i = 0; i < imageFiles.length; i++) {
                const imagePath = path.join(imagesFolder, imageFiles[i]);
                
                try {
                    await sendImageMessage(jid, imagePath);
                    
                    // Longer delay between images to avoid WhatsApp rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1500));
                } catch (error) {
                    console.error(`Error sending image ${imageFiles[i]}:`, error);
                }
            }

            // Step 4: Send final message after all images as separate message
            const finalMessage = `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`;

            await sendTextMessage(jid, finalMessage);
            
        } catch (error) {
            console.error('Error in sendUnder50Images:', error);
            // Fallback message if image sending fails
            const detailedSummary = generateDetailedSummary(userState[jid]);
            await sendTextMessage(jid, detailedSummary);
            
            await sendTextMessage(jid, `🎁 *Return Gifts Under ₹50*

We have various beautiful return gift options under ₹50. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
        }
    };

    // Function to send images for under ₹100 items
    const sendUnder100Images = async (jid) => {
        try {
            // Step 1: Send summary as separate message
            const detailedSummary = generateDetailedSummary(userState[jid]);
            await sendTextMessage(jid, detailedSummary);
            
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 2: Send introductory message as separate message
            await sendTextMessage(jid, `🎁 *Here are our return gifts under ₹100:*`);
            
            // Small delay before images
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Path to your images folder
            const imagesFolder = path.join(__dirname, 'Gifts_Under100');
            
            // Check if folder exists
            if (!fs.existsSync(imagesFolder)) {
                console.log('Under100 images folder not found, sending fallback message');
                await sendTextMessage(jid, `🎁 *Return Gifts Under ₹100*

We have various beautiful return gift options under ₹100. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }
            
            // Read all files from the images folder
            const imageFiles = fs.readdirSync(imagesFolder).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });

            if (imageFiles.length === 0) {
                console.log('No images found in the under 100 folder');
                await sendTextMessage(jid, `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }

            // Step 3: Send each image with a small delay to avoid rate limiting
            for (let i = 0; i < imageFiles.length; i++) {
                const imagePath = path.join(imagesFolder, imageFiles[i]);
                
                try {
                    await sendImageMessage(jid, imagePath);
                    
                    // Longer delay between images to avoid WhatsApp rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`Error sending image ${imageFiles[i]}:`, error);
                }
            }

            // Step 4: Send final message after all images as separate message
            const finalMessage = `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`;

            await sendTextMessage(jid, finalMessage);
            
        } catch (error) {
            console.error('Error in sendUnder100Images:', error);
            // Fallback message if image sending fails
            const detailedSummary = generateDetailedSummary(userState[jid]);
            await sendTextMessage(jid, detailedSummary);
            
            await sendTextMessage(jid, `🎁 *Return Gifts Under ₹100*

We have various beautiful return gift options under ₹100. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
        }
    };

    // Function to generate detailed customer summary
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

    // Simplified function to check if a message is from a human agent
    const isHumanAgent = (message) => {
        // Check if message contains the human agent marker
        if (message.text && message.text.includes('###')) {
            return true;
        }
        
        // Check if message is a reply to a previous message (human agents often reply)
        if (message.quoted) {
            return true;
        }
        
        return false;
    };

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            
            const message = messages[0];
            if (!message) return;
            
            // Skip processing if message doesn't have a valid text body
            if (!message.message) return;
            
            // Extract the text content from various possible message types
            let messageText = '';
            let isFromMe = false;
            
            if (message.key.fromMe) {
                isFromMe = true;
            }
            
            // Extract message content based on message type
            if (message.message.conversation) {
                messageText = message.message.conversation;
            } else if (message.message.extendedTextMessage) {
                messageText = message.message.extendedTextMessage.text;
            } else if (message.message.imageMessage && message.message.imageMessage.caption) {
                messageText = message.message.imageMessage.caption;
            }
            
            // Get the sender's JID (WhatsApp ID)
            const jid = message.key.remoteJid;
            
            // Ignore messages from groups and status updates
            if (jid.includes('@g.us') || jid.includes('status@broadcast')) {
                return;
            }
            
            // Check if message is from human agent (sent using the bot's WhatsApp)
            if (isFromMe && isHumanAgent(message.message)) {
                console.log(`Human agent has taken over conversation with ${jid}`);
                humanOverride[jid] = true;
                // Clear user state to prevent bot from continuing automated flow
                if (userState[jid]) {
                    userState[jid].step = 'human_override';
                }
                saveState(); // Save the updated state
                return;
            }
            
            // Ignore messages sent by the bot itself (automated responses)
            if (isFromMe) {
                return;
            }
            
            console.log(`Received message from ${jid}: ${messageText}`);
            
            // Check if human agent has taken over this conversation
            if (humanOverride[jid]) {
                console.log(`Human agent has control of ${jid}. Bot will not respond.`);
                return;
            }
            
            const text = messageText.toLowerCase().trim();
            
            // Check if user has completed the conversation flow
            if (userState[jid] && userState[jid].step === 'completed') {
                console.log(`User ${jid} has completed conversation. Bot will not respond to: ${messageText}`);
                return;
            }
            
            // Check if user is new (first time messaging)
            if (!userState[jid]) {
                userState[jid] = { 
                    step: 'start',
                    errorCount: {
                        start: 0,
                        function_time: 0,
                        budget: 0,
                        piece_count: 0
                    }
                };
                saveState(); // Save the updated state
                await sendTextMessage(jid, messages.welcome);
                console.log('Welcome message sent to new user successfully');
                return;
            }
            
            const state = userState[jid];
            
            // Handle invalid input with attempt tracking
            const handleInvalidInput = async (currentStep) => {
                // Increment error count for current step
                state.errorCount[currentStep]++;
                saveState(); // Save the updated state
                
                // Check if user has exceeded 3 attempts
                if (state.errorCount[currentStep] >= 3) {
                    console.log(`User ${jid} exceeded 3 wrong attempts at step: ${currentStep}`);
                    userState[jid].step = 'completed';
                    saveState(); // Save the updated state
                    await sendTextMessage(jid, messages.humanAgent);
                    return true; // Return true to indicate conversation ended
                } else {
                    // Send error message for first and second wrong attempts
                    await sendTextMessage(jid, errorMessages[currentStep]);
                    return false; // Return false to continue conversation
                }
            };
            
            // Step 1: Are you looking for return gifts?
            if (state.step === 'start') {
                if (text === 'yes' || text === '1') {
                    userState[jid].step = 'function_time';
                    saveState(); // Save the updated state
                    await sendTextMessage(jid, messages.timing);
                    return;
                } else if (text === 'no' || text === '2') {
                    userState[jid].step = 'completed';
                    saveState(); // Save the updated state
                    await sendTextMessage(jid, messages.notInterested);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('start');
                    if (conversationEnded) return;
                }
            }
            
            // Step 2: When is your function?
            if (state.step === 'function_time') {
                const validTimings = ['1', '2', '3', '4'];
                
                if (validTimings.includes(text)) {
                    userState[jid].step = 'budget';
                    userState[jid].timing = text;
                    saveState(); // Save the updated state
                    await sendTextMessage(jid, messages.budget);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('function_time');
                    if (conversationEnded) return;
                }
            }
            
            // Step 3: Budget Range
            if (state.step === 'budget') {
                const validBudgets = ['1', '2', '3', '4', '5'];
                
                if (validBudgets.includes(text)) {
                    userState[jid].step = 'piece_count';
                    userState[jid].budget = text;
                    saveState(); // Save the updated state
                    await sendTextMessage(jid, messages.quantity);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('budget');
                    if (conversationEnded) return;
                }
            }
            
            // Step 4: Quantity
            if (state.step === 'piece_count') {
                const validQuantities = ['1', '2', '3', '4', '5'];
                
                if (validQuantities.includes(text)) {
                    userState[jid].quantity = text;
                    userState[jid].step = 'location';
                    saveState(); // Save the updated state
                    await sendTextMessage(jid, messages.location);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('piece_count');
                    if (conversationEnded) return;
                }
            }
            
            // Step 5: Delivery Location → Send images or team response based on budget
            if (state.step === 'location') {
                // Accept any text as location (no validation needed)
                userState[jid].location = messageText.trim();
                
                // Check budget and send appropriate response
                if (userState[jid].budget === '1') {
                    // Send images for under ₹50 items
                    await sendUnder50Images(jid);
                } else if (userState[jid].budget === '2') {
                    // Send images for under ₹100 items (₹51-₹100)
                    await sendUnder100Images(jid);
                } else {
                    // For other budgets, send detailed summary first, then simple message
                    const detailedSummary = generateDetailedSummary(userState[jid]);
                    await sendTextMessage(jid, detailedSummary);
                    
                    // Small delay between messages
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const finalMessage = `✅ *Thank you for your interest!*

Our team will talk to you. 😊`;

                    await sendTextMessage(jid, finalMessage);
                }
                
                userState[jid].step = 'completed';
                saveState(); // Save the updated state
                return;
            }
            
            // This should not be reached if logic is correct
            console.log(`Unexpected state for user ${jid}: ${JSON.stringify(state)}`);
            
        } catch (error) {
            console.error('Error handling message:', error);
            // Only send error message if conversation is not completed and human hasn't taken over
            const jid = messages[0]?.key?.remoteJid;
            if (jid && (!userState[jid] || userState[jid].step !== 'completed') && !humanOverride[jid]) {
                await sendTextMessage(jid, 'Sorry, something went wrong. Please try again or type "hello" to restart.');
            }
        }
    });
    
    // Handle commands from the bot owner (reset, human override, etc.)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const message = messages[0];
            if (!message || !message.key.fromMe) return;
            
            const jid = message.key.remoteJid;
            let messageText = '';
            
            // Extract message content
            if (message.message.conversation) {
                messageText = message.message.conversation;
            } else if (message.message.extendedTextMessage) {
                messageText = message.message.extendedTextMessage.text;
            }
            
            // Check for human agent marker (###)
            if (messageText.includes('###')) {
                console.log(`Human agent marker detected for ${jid}. Bot will stop responding.`);
                humanOverride[jid] = true;
                if (userState[jid]) {
                    userState[jid].step = 'human_override';
                }
                saveState(); // Save the updated state
                return;
            }
            
            // Reset bot command
            if (messageText === 'RESET_BOT' && message.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                try {
                    const targetJid = jid; // In Baileys, we're already in the chat where the command was issued
                    
                    delete humanOverride[targetJid];
                    delete userState[targetJid];
                    saveState(); // Save the updated state
                    console.log(`Bot re-enabled for ${targetJid}`);
                    
                    // Optionally send confirmation
                    await sendTextMessage(targetJid, 'Bot has been re-enabled for this chat.');
                } catch (error) {
                    console.error('Error resetting bot:', error);
                }
            }
        } catch (error) {
            console.error('Error handling command:', error);
        }
    });
}

// Start the application
console.log('🚀 Starting WhatsApp bot with Baileys...');
initializeWhatsAppClient().catch(error => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
});