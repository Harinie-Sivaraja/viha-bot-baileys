# VihaCandlesAndGiftings WhatsApp Bot

A WhatsApp bot for VihaCandlesAndGiftings built with Baileys, designed to handle customer inquiries about return gifts.

## Features

- Interactive conversation flow to collect customer requirements
- Automatic response system based on customer budget and needs
- Image sharing capabilities for product catalogs
- Web interface with QR code for easy connection
- Lightweight authentication using local files (no MongoDB dependency)
- Human agent override capability for complex inquiries

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

3. Create a `.env` file in the root directory with the following variables:
```
PORT=3000
NODE_ENV=development
```

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
- `auth/` - Baileys authentication files (created automatically)

## Human Agent Commands

- Type `###` in any message to take over a conversation as a human agent
- Reply to a message with `RESET_BOT` to re-enable the bot for that conversation

## Deployment on Render

This bot is optimized for deployment on platforms like Render with minimal storage requirements.

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
   - **Persistent Disk**:
     - Mount Path: `/data`
     - Size: 1 GB (minimum)

5. Click "Create Web Service"

The bot will automatically use the persistent disk to store authentication and user state data, ensuring it persists between deployments and restarts.

## License

[MIT](LICENSE)