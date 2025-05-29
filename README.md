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

## Deployment

This bot is optimized for deployment on platforms like Render and Railway with minimal storage requirements.

## License

[MIT](LICENSE)