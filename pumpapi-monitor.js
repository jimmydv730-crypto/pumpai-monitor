require("dotenv").config();
const sendWalletAlert =
    require("./walletAlert");

const express = require("express");
const WebSocket = require("ws");

const axios = require("axios");

const sendAlert = require("./alert");
const sendGraduationAlert = require("./graduationAlert");



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
const walletLeaderboard = {};
const earlyWallets = new Map();


const TARGET_MC_USD = 19000;



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

            await sendGraduationAlert(`
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
`);

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
                    createdAt: Date.now(),
                    earlyBuyers: []
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

            const token =
                tracked.get(event.mint);

            if (
                token &&
                token.earlyBuyers.length < 20
            ) {

                const alreadyExists =
                    token.earlyBuyers.some(
                        b =>
                            b.wallet ===
                            event.txSigner
                    );

                if (!alreadyExists) {

                    const position =
                        token.earlyBuyers.length + 1;

                    token.earlyBuyers.push({
                        wallet:
                            event.txSigner,
                        position
                    });

                    console.log(
                        `EARLY BUYER #${position}:`,
                        event.txSigner
                    );

                    if (
                        !walletLeaderboard[
                            event.txSigner
                        ]
                    ) {

                        walletLeaderboard[
                            event.txSigner
                        ] = {
                            appearances: 0,
                            firstPlace: 0,
                            top5: 0
                        };

                    }

                    walletLeaderboard[
                        event.txSigner
                    ].appearances++;

                    if (
                        position === 1
                    ) {

                        walletLeaderboard[
                            event.txSigner
                        ].firstPlace++;

                    }

                    if (
                        position <= 5
                    ) {

                        walletLeaderboard[
                            event.txSigner
                        ].top5++;

                    }

                }

            }

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
setInterval(async () => {

    const leaderboard =
        Object.entries(walletLeaderboard)
        .sort(
    (a, b) =>
        (
            b[1].firstPlace * 5 +
            b[1].top5 * 2 +
            b[1].appearances
        )
        -
        (
            a[1].firstPlace * 5 +
            a[1].top5 * 2 +
            a[1].appearances
        )
)
        .slice(0, 20);

    let message =
`🏆 TOP EARLY WALLETS
Tracked Wallets: ${Object.keys(walletLeaderboard).length}

`;

    leaderboard.forEach(
        ([wallet, stats], index) => {
             const score =
                stats.firstPlace * 5 +
                stats.top5 * 2 +
                stats.appearances;

            message +=
`${index + 1}. ${wallet.slice(0,8)}...
Score: ${score}
Appearances: ${stats.appearances}
Top5: ${stats.top5}
First: ${stats.firstPlace}

`;

        }
    );
    console.log(message);

    await sendWalletAlert(
        message
    );
    

}, 30 * 1000);
setTimeout(async () => {

    console.log(
        walletLeaderboard
    );

}, 30 * 60 * 1000);
connectWebSocket();
sendWalletAlert(
    "✅ Wallet Tracker Bot Started"
);
setInterval(() => {

    const leaderboard =
        Object.entries(
            walletLeaderboard
        )
        .sort(
            (a, b) =>
                b[1].top5 -
                a[1].top5
        )
        .slice(0, 20);

    console.log(
        "\n===== TOP EARLY WALLETS ====="
    );

    leaderboard.forEach(
        ([wallet, stats], index) => {

            console.log(
                `${index + 1}. ${wallet}`
            );

            console.log(
                `Appearances: ${stats.appearances}`
            );

            console.log(
                `Top5: ${stats.top5}`
            );

            console.log(
                `First Buy: ${stats.firstPlace}`
            );

        }
    );

}, 10 * 60 * 1000);
