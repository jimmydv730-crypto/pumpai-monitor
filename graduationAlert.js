require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const gradBot = new TelegramBot(
    process.env.GRAD_BOT_TOKEN,
    { polling: false }
);

async function sendGraduationAlert(message) {
    try {
        await gradBot.sendMessage(
            process.env.GRAD_CHAT_ID,
            message,
            {
                parse_mode: "Markdown"
            }
        );
    } catch (err) {
        console.error(err);
    }
}

module.exports = sendGraduationAlert;