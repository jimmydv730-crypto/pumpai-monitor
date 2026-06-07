
const WebSocket = require("ws");
require("dotenv").config();

const sendAlert = require("./alert");


const seen = new Set();

console.log("Monitoring graduations via PumpAPI...");

function connectWS() {

    const ws = new WebSocket(
    "ws://127.0.0.1:9999"
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

            if (
                event.pool !== "pump" ||
                event.tokensInPool !== 0
            ) {
                return;
            }

            if (seen.has(event.mint)) {
                return;
            }

            seen.add(event.mint);

            const msg = `
🎓 NEW PUMP.FUN GRADUATION

🪙 Name:
\`${event.name}\`

🏷 Symbol:
\`${event.symbol}\`

📍 Mint:
\`${event.mint}\`

👤 Creator:
\`${event.creatorFeeAddress || "UNKNOWN"}\`

💰 Market Cap:
${Number(event.marketCapSol).toFixed(2)} SOL

💵 Price:
${Number(event.price).toFixed(12)}

⏰ Graduated:
${new Date(event.timestamp).toISOString()}

🔗 https://pump.fun/coin/${event.mint}
`;

            console.log(
                "Graduation detected:",
                event.symbol,
                event.mint
            );

            await sendAlert(msg);

            console.log(
                "Alert sent:",
                event.symbol
            );

        } catch (err) {

            console.error(
                "PumpAPI error:",
                err
            );

        }

    });

    ws.on("close", (code, reason) => {

        console.log(
            `WebSocket closed. Code: ${code}`
        );

        console.log(
            `Reason: ${reason.toString()}`
        );

        console.log(
            "Reconnecting in 5 seconds..."
        );

        setTimeout(() => {
            connectWS();
        }, 5000);

    });

    ws.on("error", (err) => {

        console.error(
            "WebSocket error:",
            err.message
        );

    });

}

connectWS();

setInterval(() => {

    console.log(
        "HEARTBEAT",
        new Date().toLocaleTimeString()
    );

}, 60000);