require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(
    process.env.BOT_TOKEN,
    { polling: false }
);

async function sendAlert(message) {
    try {
        await bot.sendMessage(
            process.env.CHAT_ID,
            message,
            {
              parse_mode: "Markdown"
            }
        );
        await bot.sendMessage(
            process.env.MADHU_CHAT_ID,
            message,
            {
              parse_mode: "Markdown"
            }
        );
    } catch (err) {
        console.error(err);
    }
}

module.exports = sendAlert;