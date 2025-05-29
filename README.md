# VihaCandlesAndGiftings WhatsApp Bot

A WhatsApp bot for VihaCandlesAndGiftings built with Baileys, designed to handle customer inquiries about return gifts.

## Features

- Interactive conversation flow to collect customer requirements
- Automatic response system based on customer budget and needs
- Image sharing capabilities for product catalogs
- Web interface with QR code for easy connection
- MongoDB-based persistent storage (no need for persistent disk)
- Human agent override capability for complex inquiries

## Prerequisites

- Node.js (v14 or higher)
- MongoDB Atlas account (free tier is sufficient)

## MongoDB Setup

1. Create a free MongoDB Atlas account at [https://www.mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register)
2. Create a new cluster (the free tier is sufficient)
3. Set up database access:
   - Create a database user with password
   - Add your IP to the IP Access List (or use 0.0.0.0/0 for all IPs)
4. Get your connection string:
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string

## Installation

1. Clone this repository:
```
git clone https://github.com/yourusername/viha-bot-baileys.git
cd viha-bot-baileys
```

2. Install dependencies:
```
npm install
```

3. Update the `.env` file in the root directory with the following variables:
```
MONGODB_URI=mongodb+srv://your_username:your_password@your_cluster.mongodb.net/
MONGODB_DB=whatsapp_bot
PORT=3000
NODE_ENV=development
```
Replace `your_username`, `your_password`, and `your_cluster` with your actual MongoDB credentials.

4. Start the bot:
```
npm start
```

## Usage

1. Open `http://localhost:3000` in your browser
2. Scan the QR code with your WhatsApp
3. The bot will now respond to customer messages automatically

## Folder Structure

- `Gifts_Under50/` - Images of gifts under ₹50
- `Gifts_Under100/` - Images of gifts under ₹100

## Human Agent Commands

- Type `###` in any message to take over a conversation as a human agent
- Reply to a message with `RESET_BOT` to re-enable the bot for that conversation

## Deployment on Render

This bot is optimized for deployment on platforms like Render with MongoDB for persistent storage.

### Steps to deploy on Render:

1. Push your code to GitHub
2. Sign up for [Render](https://render.com/)
3. Create a new Web Service and connect your GitHub repository
4. Configure the service:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or choose a paid plan if you need more resources)
   - **Environment Variables**:
     - `PORT`: 3000
     - `NODE_ENV`: production
     - `MONGODB_URI`: your MongoDB connection string
     - `MONGODB_DB`: whatsapp_bot

5. Click "Create Web Service"

The bot will use MongoDB to store authentication and user state data, ensuring it persists between deployments and restarts without needing a persistent disk.

## Important Notes

- The bot uses MongoDB for persistent storage, so you don't need a persistent disk on Render
- Your WhatsApp session will be preserved between restarts
- User conversation states are stored in MongoDB
- You only need to scan the QR code once, unless you log out

## License

[MIT](LICENSE)