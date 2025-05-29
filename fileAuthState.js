const fs = require('fs');
const { initAuthCreds } = require('@whiskeysockets/baileys');

/**
 * Simple file-based auth state for Baileys
 * @param {string} folder Path to folder where auth files will be stored
 */
const useFileAuthState = async (folder) => {
    // Create folder if it doesn't exist
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
        console.log(`Created auth folder at ${folder}`);
    }

    const credsPath = `${folder}/creds.json`;
    
    // Function to get credentials from file
    const getCredentials = async () => {
        if (fs.existsSync(credsPath)) {
            const credsData = fs.readFileSync(credsPath, 'utf8');
            try {
                return JSON.parse(credsData);
            } catch (error) {
                console.error('Error parsing credentials file:', error);
                return initAuthCreds();
            }
        }
        
        // If no credentials file found, create new ones
        console.log('No credentials file found, creating new ones...');
        return initAuthCreds();
    };
    
    // Function to save credentials to file
    const saveCredentials = async (creds) => {
        try {
            fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
        } catch (error) {
            console.error('Error saving credentials to file:', error);
        }
    };
    
    // Function to get keys from files
    const getKeys = async () => {
        const keys = {};
        const keysFolder = `${folder}/keys`;
        
        if (fs.existsSync(keysFolder)) {
            const files = fs.readdirSync(keysFolder);
            for (const file of files) {
                try {
                    const data = fs.readFileSync(`${keysFolder}/${file}`, 'utf8');
                    keys[file] = JSON.parse(data);
                } catch (error) {
                    console.error(`Error reading key file ${file}:`, error);
                }
            }
        } else {
            fs.mkdirSync(keysFolder, { recursive: true });
        }
        
        return keys;
    };
    
    // Function to set a key in file
    const setKey = async (key, value) => {
        const keysFolder = `${folder}/keys`;
        try {
            fs.writeFileSync(`${keysFolder}/${key}`, JSON.stringify(value, null, 2));
        } catch (error) {
            console.error(`Error saving key ${key} to file:`, error);
        }
    };
    
    // Function to remove a key file
    const removeKey = async (key) => {
        const keyPath = `${folder}/keys/${key}`;
        if (fs.existsSync(keyPath)) {
            try {
                fs.unlinkSync(keyPath);
            } catch (error) {
                console.error(`Error removing key file ${key}:`, error);
            }
        }
    };
    
    // Function to clear all auth data
    const clearAuthData = async () => {
        try {
            if (fs.existsSync(credsPath)) {
                fs.unlinkSync(credsPath);
            }
            
            const keysFolder = `${folder}/keys`;
            if (fs.existsSync(keysFolder)) {
                const files = fs.readdirSync(keysFolder);
                for (const file of files) {
                    fs.unlinkSync(`${keysFolder}/${file}`);
                }
            }
            
            console.log('Auth data cleared successfully');
            return true;
        } catch (error) {
            console.error('Error clearing auth data:', error);
            return false;
        }
    };
    
    // Check if we need to clear auth data
    const shouldClearAuth = process.env.CLEAR_AUTH === 'true';
    if (shouldClearAuth) {
        console.log('CLEAR_AUTH is set to true, clearing auth data...');
        await clearAuthData();
    }
    
    // Get initial state
    const creds = await getCredentials();
    const keys = await getKeys();
    
    return {
        state: {
            creds,
            keys: {
                get: async (key) => {
                    return keys[key];
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
        },
        clearAuthData
    };
};

module.exports = { useFileAuthState };