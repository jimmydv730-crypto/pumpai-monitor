const axios = require("axios");

module.exports = async function sendWalletAlert(message) {

    try {

        await axios.post(
            `https://api.telegram.org/bot${process.env.WALLET_BOT_TOKEN}/sendMessage`,
            {
                chat_id: process.env.WALLET_CHAT_ID,
                text: message,
                parse_mode: "Markdown"
            }
        );

    } catch (err) {

        console.error(
    "Wallet bot error:",
    err.response?.data || err.message
);

    }

};