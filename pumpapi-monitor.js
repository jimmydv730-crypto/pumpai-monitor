require("dotenv").config();
const sendWalletAlert = require("./walletAlert");

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
const walletPositions = new Map();
const walletTrades = {};
const tokenBuyers = new Map();

const TARGET_MC_USD = 15000;

async function updateSolPrice() {
  try {
    const response = await axios.get(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      {
        timeout: 10000,
      },
    );

    solPrice = Number(response.data.price);

    console.log("SOL Price:", solPrice);
  } catch (err) {
    console.log("SOL price update failed:", err.message);
  }
}

updateSolPrice();

setInterval(updateSolPrice, 180000);

// Remove tokens older than 30 minutes
setInterval(() => {
  const now = Date.now();

  for (const [mint, info] of tracked) {
    if (now - info.createdAt > 60 * 60 * 1000) {
      const buyersForToken = tokenBuyers.get(mint) || [];

      buyersForToken.forEach((buyer) => {
        if (buyer.buyMc > 25000) return;

        const multiple = info.athMc / buyer.buyMc;
        console.log(buyer.wallet, "MULTIPLE:", multiple.toFixed(2));

        if (!walletTrades[buyer.wallet]) {
          walletTrades[buyer.wallet] = {
            trades: 0,

            totalMultiple: 0,

            winners2x: 0,
            winners5x: 0,
            winners10x: 0,
          };
        }

        const stats = walletTrades[buyer.wallet];

        stats.trades++;

        stats.totalMultiple += multiple;

        if (multiple >= 2) stats.winners2x++;

        if (multiple >= 5) stats.winners5x++;

        if (multiple >= 10) stats.winners10x++;
      });
      tokenBuyers.delete(mint);
      buyers.delete(mint);
      tracked.delete(mint);
    }
  }
}, 60 * 1000);

// Health check every 5 minutes
setInterval(
  () => {
    console.log("Tracked tokens:", tracked.size);
  },
  5 * 60 * 1000,
);

function connectWebSocket() {
  const ws = new WebSocket("wss://stream.pumpapi.io/");

  ws.on("open", () => {
    console.log("Connected to PumpAPI");
  });

  ws.on("message", async (data) => {
    try {
      const event = JSON.parse(data);

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
$${((event.marketCapSol || 0) * solPrice).toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}

🔗 https://pump.fun/coin/${event.mint}
`);

        console.log("GRADUATED:", event.symbol);
      }

      if (event.pool !== "pump") {
        return;
      }

      // New token created
      if (event.action === "create") {
        if (event.mayhemMode === true) {
          return;
        }

        if (tracked.has(event.mint)) {
          return;
        }

        tracked.set(event.mint, {
          name: event.name,
          symbol: event.symbol,
          createdAt: Date.now(),

          athMc: 0,

          hit10k: false,
          hit25k: false,
          hit50k: false,
          hit100k: false,

          reward10k: false,
          reward25k: false,
          reward50k: false,
          reward100k: false,

          earlyBuyers: [],
        });

        buyers.set(event.mint, new Set());
        tokenBuyers.set(event.mint, []);

        console.log("TRACKING:", event.symbol, event.mint);

        return;
      }

      // Only care about buys/sells
      if (event.action !== "buy" && event.action !== "sell") {
        return;
      }

      // Only monitor tokens created after bot started
      if (!tracked.has(event.mint)) {
        return;
      }

      if (event.action === "buy") {
        buyers.get(event.mint)?.add(event.txSigner);

        const token = tracked.get(event.mint);

        {
          const alreadyExists = token.earlyBuyers.some(
            (b) => b.wallet === event.txSigner,
          );

          if (!alreadyExists) {
            const position = token.earlyBuyers.length + 1;

            token.earlyBuyers.push({
              wallet: event.txSigner,
              position,
            });

            walletPositions.set(`${event.txSigner}_${event.mint}`, {
              buyTime: Date.now(),
            });

            console.log(`EARLY BUYER #${position}:`, event.txSigner);

            if (!walletLeaderboard[event.txSigner]) {
              walletLeaderboard[event.txSigner] = {
                appearances: 0,
                firstPlace: 0,
                top5: 0,
                fastSells: 0,

                hit10k: 0,
                hit25k: 0,
                hit50k: 0,
                hit100k: 0,
              };
            }

            walletLeaderboard[event.txSigner].appearances++;

            if (position === 1) {
              walletLeaderboard[event.txSigner].firstPlace++;
            }

            if (position <= 5) {
              walletLeaderboard[event.txSigner].top5++;
            }
          }
        }
      }
      if (event.action === "sell") {
        const key = `${event.txSigner}_${event.mint}`;

        const buyData = walletPositions.get(key);

        if (buyData) {
          const holdSeconds = (Date.now() - buyData.buyTime) / 1000;

          if (holdSeconds <= 5) {
            if (walletLeaderboard[event.txSigner]) {
              walletLeaderboard[event.txSigner].fastSells++;
            }
          }

          walletPositions.delete(key);
        }
      }

      // Alert once when target MC reached
      const marketCapUsd =
    event.marketCapQuote * solPrice;
      if (event.action === "buy") {
        tokenBuyers.get(event.mint)?.push({
          wallet: event.txSigner,

          buyMc: marketCapUsd,
        });
      }
      if (!walletTrades[event.txSigner]) {
        walletTrades[event.txSigner] = {
          trades: 0,

          totalMultiple: 0,

          winners2x: 0,
          winners5x: 0,
          winners10x: 0,
        };
      }

      walletPositions.set(`${event.txSigner}_${event.mint}`, {
        buyMc: marketCapUsd,
        buyTime: Date.now(),
      });
     console.log({
  symbol: event.symbol,
  marketCapQuote: event.marketCapQuote,
  solPrice,
  marketCapUsd,
});
      const token = tracked.get(event.mint);

      if (token) {
        token.athMc = Math.max(token.athMc, marketCapUsd);

        if (marketCapUsd >= 10000) token.hit10k = true;

        if (marketCapUsd >= 25000) token.hit25k = true;

        if (marketCapUsd >= 50000) token.hit50k = true;

        if (marketCapUsd >= 100000) token.hit100k = true;
      }
      if (token && token.hit10k && !token.reward10k) {
        token.reward10k = true;

        token.earlyBuyers.forEach((buyer) => {
          if (walletLeaderboard[buyer.wallet]) {
            walletLeaderboard[buyer.wallet].hit10k++;
          }
        });
      }
      if (token && token.hit25k && !token.reward25k) {
        token.reward25k = true;

        token.earlyBuyers.forEach((buyer) => {
          if (walletLeaderboard[buyer.wallet]) {
            walletLeaderboard[buyer.wallet].hit25k++;
          }
        });
      }
      if (token && token.hit50k && !token.reward50k) {
        token.reward50k = true;

        token.earlyBuyers.forEach((buyer) => {
          if (walletLeaderboard[buyer.wallet]) {
            walletLeaderboard[buyer.wallet].hit50k++;
          }
        });
      }
      if (token && token.hit100k && !token.reward100k) {
        token.reward100k = true;

        token.earlyBuyers.forEach((buyer) => {
          if (walletLeaderboard[buyer.wallet]) {
            walletLeaderboard[buyer.wallet].hit100k++;
          }
        });
      }

      const uniqueBuyers = buyers.get(event.mint)?.size || 0;
      console.log(
    "TARGET CHECK",
    event.symbol,
    marketCapUsd,
    uniqueBuyers
);

      if (
        marketCapUsd >= TARGET_MC_USD &&
        uniqueBuyers >= 25 &&
        !alerted.has(event.mint)
      ) {
        alerted.add(event.mint);

        const info = tracked.get(event.mint);

        await sendAlert(`
🚀 TOKEN REACHED TARGET MC

🪙 Name:
${info?.name || event.name || "Unknown"}

🏷 Symbol:
${info?.symbol || event.symbol || "Unknown"}

📈 Market Cap:
$${marketCapUsd.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}

👥 Unique Buyers:
${uniqueBuyers}

📍 Mint:
\`${event.mint}\`

👤 Creator:
\`${event.txSigner || "Unknown"}\`

🔗 https://pump.fun/coin/${event.mint}
`);

        console.log("ALERT:", info?.symbol || event.symbol);
      }
    } catch (err) {
      console.error("Message error:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

  ws.on("close", (code, reason) => {
    console.log("WebSocket closed:", code, reason.toString());

    setTimeout(connectWebSocket, 5000);
  });
}
setInterval(async () => {
 const leaderboard = Object.entries(walletLeaderboard)

.filter(
    ([wallet, stats]) =>
        stats.appearances >= 1
)
  
  

    .filter(([wallet, stats]) => {
      const ratio = (stats.fastSells || 0) / Math.max(stats.appearances, 1);

      return ratio < 0.5;
    })
    .sort((a, b) => {

    const scoreA =
        (a[1].hit10k / Math.max(a[1].appearances, 1)) * 1000 +
        a[1].hit50k * 200 +
        a[1].hit25k * 50 -
        a[1].fastSells * 2;

    const scoreB =
        (b[1].hit10k / Math.max(b[1].appearances, 1)) * 1000 +
        b[1].hit50k * 200 +
        b[1].hit25k * 50 -
        b[1].fastSells * 2;

    return scoreB - scoreA;

})
    .slice(0, 20);

  let message = `🏆 TOP EARLY WALLETS
Tracked Wallets: ${Object.keys(walletLeaderboard).length}

`;

  leaderboard.forEach(([wallet, stats], index) => {
    const successRate =
    stats.hit10k /
    Math.max(stats.appearances, 1);

const score =
    successRate * 1000 +
    stats.hit50k * 200 +
    stats.hit25k * 50 -
    stats.fastSells * 2;

const successRateDisplay =
    (successRate * 100).toFixed(1);

    message += `${index + 1}.
\`${wallet}\`

Score: ${score}
Appearances: ${stats.appearances}
Success Rate: ${successRateDisplay}%
Top5: ${stats.top5}
First: ${stats.firstPlace}
FastSells: ${stats.fastSells || 0}
10k Hits: ${stats.hit10k || 0}
25k Hits: ${stats.hit25k || 0}
50k Hits: ${stats.hit50k || 0}
100k Hits: ${stats.hit100k || 0}

`;
  });
  console.log(message);

  await sendWalletAlert(message);
}, 30 * 1000);
setTimeout(
  async () => {
    console.log(walletLeaderboard);
  },
  30 * 60 * 1000,
);
connectWebSocket();
sendWalletAlert("✅ Wallet Tracker Bot Started");
setInterval(
  () => {
    const leaderboard = Object.entries(walletLeaderboard)

.filter(
    ([wallet, stats]) =>
        stats.appearances >= 10
)
      .sort((a, b) => b[1].top5 - a[1].top5)
      .slice(0, 20);

    console.log("\n===== TOP EARLY WALLETS =====");

    leaderboard.forEach(([wallet, stats], index) => {
      console.log(`${index + 1}. ${wallet}`);

      console.log(`Appearances: ${stats.appearances}`);

      console.log(`Top5: ${stats.top5}`);

      console.log(`First Buy: ${stats.firstPlace}`);
    });
  },
  10 * 60 * 1000,
);
setInterval(() => {
  const leaderboard = Object.entries(walletTrades)

    .filter(([wallet, stats]) => stats.trades >= 3)

    .sort((a, b) => {
      const avgA = a[1].totalMultiple / a[1].trades;

      const avgB = b[1].totalMultiple / b[1].trades;

      return avgB - avgA;
    })

    .slice(0, 20);

  console.log("\n===== TOP PROFITABLE WALLETS =====");

  leaderboard.forEach(([wallet, stats], index) => {
    const avg = (stats.totalMultiple / stats.trades).toFixed(2);

    console.log(`
${index + 1}. ${wallet}

Trades: ${stats.trades}

Average Multiple:
${avg}x

2x Winners:
${stats.winners2x}

5x Winners:
${stats.winners5x}

10x Winners:
${stats.winners10x}
`);
  });
}, 30000);
