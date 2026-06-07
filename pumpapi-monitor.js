require("dotenv").config();

const express = require("express");
const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const sendAlert = require("./alert");

const gradBot = new TelegramBot(
    process.env.GRAD_BOT_TOKEN,
    { polling: false }
);

const app = express();

app.get("/", (req, res) => {
    res.send("PumpAPI Monitor Running");
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Health server started");
});

let solPrice = 80;

const tracked = new Map();
const alerted = new Set();
const graduated = new Set();
const buyers = new Map();

const TARGET_MC_USD = 15000;



async function updateSolPrice() {

    try {

        const response = await axios.get(
            "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
            {
                timeout: 10000
            }
        );

        solPrice = Number(response.data.price);

        console.log(
            "SOL Price:",
            solPrice
        );

    } catch (err) {

        console.log(
            "SOL price update failed:",
            err.message
        );

    }

}

updateSolPrice();

setInterval(
    updateSolPrice,
    180000
);

// Remove tokens older than 30 minutes
setInterval(() => {

    const now = Date.now();

    for (const [mint, info] of tracked) {

        if (
            now - info.createdAt >
            30 * 60 * 1000
        ) {
            tracked.delete(mint);
        }

    }

}, 60 * 1000);

// Health check every 5 minutes
setInterval(() => {

    console.log(
        "Tracked tokens:",
        tracked.size
    );

}, 5 * 60 * 1000);

function connectWebSocket() {

const ws = new WebSocket(
    "wss://stream.pumpapi.io/"
);

ws.on("open", () => {

    console.log(
        "Connected to PumpAPI"
    );

});

ws.on("message", async (data) => {

    try {

        const event =
            JSON.parse(data);

        // Graduation Alert (Bot 2)
        if (
            event.pool === "pump" &&
            event.tokensInPool === 0 &&
            !graduated.has(event.mint)
        ) {

            graduated.add(event.mint);

            await gradBot.sendMessage(
                process.env.GRAD_CHAT_ID,
                `
🎓 NEW PUMP.FUN GRADUATION

🪙 Name:
${event.name}

🏷 Symbol:
${event.symbol}

📍 Mint:
\`${event.mint}\`

👤 Creator:
\`${event.creatorFeeAddress || "UNKNOWN"}\`

💰 Market Cap:
$${((event.marketCapSol || 0) * solPrice).toLocaleString(
    undefined,
    {
        maximumFractionDigits: 0
    }
)}

🔗 https://pump.fun/coin/${event.mint}
`,
                {
                    parse_mode: "Markdown"
                }
            );

            console.log(
                "GRADUATED:",
                event.symbol
            );
        }

        if (
            event.pool !== "pump"
        ) {
            return;
        }

        // New token created
        if (
            event.action === "create"
        ) {

            if (
                event.mayhemMode === true
            ) {
                return;
            }

            if (
                tracked.has(event.mint)
            ) {
                return;
            }

            tracked.set(
                event.mint,
                {
                    name: event.name,
                    symbol: event.symbol,
                    createdAt: Date.now()
                }
            );

            buyers.set(
                event.mint,
                new Set()
            );

            console.log(
                "TRACKING:",
                event.symbol,
                event.mint
            );

            return;
        }

        // Only care about buys/sells
        if (
            event.action !== "buy" &&
            event.action !== "sell"
        ) {
            return;
        }

        // Only monitor tokens created after bot started
        if (
            !tracked.has(
                event.mint
            )
        ) {
            return;
        }

        if (
            event.action === "buy"
        ) {

            buyers
                .get(event.mint)
                ?.add(event.txSigner);

        }

        // Alert once when target MC reached
        const marketCapUsd =
            event.marketCapQuote *
            solPrice;

        const uniqueBuyers =
            buyers.get(
                event.mint
            )?.size || 0;

        if (
            marketCapUsd >= TARGET_MC_USD &&
            uniqueBuyers >= 75 &&
            !alerted.has(
                event.mint
            )
        ) {

            alerted.add(
                event.mint
            );

            const info =
                tracked.get(
                    event.mint
                );

            await sendAlert(`
🚀 TOKEN REACHED TARGET MC

🪙 Name:
${info?.name || event.name || "Unknown"}

🏷 Symbol:
${info?.symbol || event.symbol || "Unknown"}

📈 Market Cap:
$${marketCapUsd.toLocaleString(
    undefined,
    {
        maximumFractionDigits: 0
    }
)}

👥 Unique Buyers:
${uniqueBuyers}

📍 Mint:
\`${event.mint}\`

👤 Creator:
\`${event.txSigner || "Unknown"}\`

🔗 https://pump.fun/coin/${event.mint}
`);

            console.log(
                "ALERT:",
                info?.symbol ||
                event.symbol
            );

        }

    } catch (err) {

        console.error(
            "Message error:",
            err
        );

    }

});

ws.on("error", (err) => {

    console.error(
        "WebSocket error:",
        err.message
    );

});

ws.on("close", (code, reason) => {

    console.log(
        "WebSocket closed:",
        code,
        reason.toString()
    );

    setTimeout(
        connectWebSocket,
        5000
    );

});

}

connectWebSocket();