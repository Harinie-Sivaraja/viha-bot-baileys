const { MongoClient } = require('mongodb');
const { proto } = require('@whiskeysockets/baileys');
const { initAuthCreds } = require('@whiskeysockets/baileys/lib/Utils/auth');

/**
 * MongoDB-based auth state for Baileys
 * @param {string} uri MongoDB connection URI
 * @param {string} dbName Database name
 */
const useMongoDBAuthState = async (uri, dbName = 'whatsapp_bot') => {
    // Connect to MongoDB
    const client = new MongoClient(uri);
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(dbName);
    const credsCollection = db.collection('auth_creds');
    const keysCollection = db.collection('auth_keys');
    
    // Function to get credentials from MongoDB
    const getCredentials = async () => {
        const data = await credsCollection.findOne({ _id: 'credentials' });
        if (data) {
            return JSON.parse(data.value);
        }
        
        // If no credentials found, create new ones
        return initAuthCreds();
    };
    
    // Function to save credentials to MongoDB
    const saveCredentials = async (creds) => {
        const data = JSON.stringify(creds);
        await credsCollection.updateOne(
            { _id: 'credentials' },
            { $set: { value: data } },
            { upsert: true }
        );
    };
    
    // Function to get keys from MongoDB
    const getKeys = async () => {
        const keys = {};
        const cursor = keysCollection.find({});
        
        for await (const doc of cursor) {
            keys[doc._id] = JSON.parse(doc.value);
        }
        
        return keys;
    };
    
    // Function to set a key in MongoDB
    const setKey = async (key, value) => {
        const data = JSON.stringify(value);
        await keysCollection.updateOne(
            { _id: key },
            { $set: { value: data } },
            { upsert: true }
        );
    };
    
    // Function to remove a key from MongoDB
    const removeKey = async (key) => {
        await keysCollection.deleteOne({ _id: key });
    };
    
    // Get initial state
    const creds = await getCredentials();
    const keys = await getKeys();
    
    return {
        state: {
            creds,
            keys: {
                get: async (key) => {
                    const keyData = keys[key];
                    return keyData;
                },
                set: async (key, value) => {
                    keys[key] = value;
                    await setKey(key, value);
                },
                delete: async (key) => {
                    delete keys[key];
                    await removeKey(key);
                }
            }
        },
        saveCreds: async () => {
            await saveCredentials(creds);
        }
    };
};

/**
 * MongoDB-based user state storage
 * @param {string} uri MongoDB connection URI
 * @param {string} dbName Database name
 */
const useMongoDBUserState = async (uri, dbName = 'whatsapp_bot') => {
    // Connect to MongoDB (reuse connection if already connected)
    let client;
    try {
        client = new MongoClient(uri);
        await client.connect();
        console.log('Connected to MongoDB for user state');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
    
    const db = client.db(dbName);
    const userStateCollection = db.collection('user_state');
    const humanOverrideCollection = db.collection('human_override');
    
    // Load user state from MongoDB
    const loadUserState = async () => {
        try {
            const doc = await userStateCollection.findOne({ _id: 'userState' });
            return doc ? JSON.parse(doc.data) : {};
        } catch (error) {
            console.error('Error loading user state from MongoDB:', error);
            return {};
        }
    };
    
    // Load human override from MongoDB
    const loadHumanOverride = async () => {
        try {
            const doc = await humanOverrideCollection.findOne({ _id: 'humanOverride' });
            return doc ? JSON.parse(doc.data) : {};
        } catch (error) {
            console.error('Error loading human override from MongoDB:', error);
            return {};
        }
    };
    
    // Save user state to MongoDB
    const saveUserState = async (userState) => {
        try {
            await userStateCollection.updateOne(
                { _id: 'userState' },
                { $set: { data: JSON.stringify(userState) } },
                { upsert: true }
            );
        } catch (error) {
            console.error('Error saving user state to MongoDB:', error);
        }
    };
    
    // Save human override to MongoDB
    const saveHumanOverride = async (humanOverride) => {
        try {
            await humanOverrideCollection.updateOne(
                { _id: 'humanOverride' },
                { $set: { data: JSON.stringify(humanOverride) } },
                { upsert: true }
            );
        } catch (error) {
            console.error('Error saving human override to MongoDB:', error);
        }
    };
    
    // Combined save function
    const saveState = async (userState, humanOverride) => {
        await Promise.all([
            saveUserState(userState),
            saveHumanOverride(humanOverride)
        ]);
    };
    
    return {
        loadUserState,
        loadHumanOverride,
        saveState
    };
};

module.exports = { useMongoDBAuthState, useMongoDBUserState };