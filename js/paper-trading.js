/**
 * Paper Trading Engine — Simulador de operações com localStorage.
 */

const STORAGE_KEY = "optionhunter_trades";
const INITIAL_CAPITAL = 100000;

function loadTrades() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
}
function saveTrades(trades) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

export function getNextId() {
    const trades = loadTrades();
    return trades.length > 0 ? Math.max(...trades.map(t => t.id)) + 1 : 1;
}

export function openTrade({ symbol, optionType, price, quantity, stopLoss, takeProfit, score }) {
    const trades = loadTrades();
    const cost = price * quantity;
    const stats = getStats();
    if (cost > stats.available) return null;

    const trade = {
        id: getNextId(), symbol, optionType, entryPrice: price,
        currentPrice: price, quantity, stopLoss, takeProfit,
        score, status: "OPEN", pnl: 0, pnlPct: 0,
        openedAt: new Date().toISOString(), closedAt: null
    };
    trades.push(trade);
    saveTrades(trades);
    return trade;
}

export function closeTrade(tradeId, exitPrice) {
    const trades = loadTrades();
    const trade = trades.find(t => t.id === tradeId && t.status === "OPEN");
    if (!trade) return null;
    trade.currentPrice = exitPrice || trade.currentPrice;
    const diff = trade.optionType === "CALL"
        ? trade.currentPrice - trade.entryPrice
        : trade.entryPrice - trade.currentPrice;
    trade.pnl = +(diff * trade.quantity).toFixed(2);
    trade.pnlPct = trade.entryPrice > 0 ? +((diff / trade.entryPrice) * 100).toFixed(2) : 0;
    trade.status = trade.pnl >= 0 ? "WIN" : "LOSS";
    trade.closedAt = new Date().toISOString();
    saveTrades(trades);
    return trade;
}

export function updatePrices(priceMap) {
    const trades = loadTrades();
    let changed = false;
    for (const trade of trades) {
        if (trade.status !== "OPEN") continue;
        const price = priceMap[trade.symbol];
        if (!price) continue;
        trade.currentPrice = price;
        const diff = trade.optionType === "CALL"
            ? price - trade.entryPrice : trade.entryPrice - price;
        trade.pnl = +(diff * trade.quantity).toFixed(2);
        trade.pnlPct = trade.entryPrice > 0 ? +((diff / trade.entryPrice) * 100).toFixed(2) : 0;

        // Auto SL/TP
        if (trade.stopLoss > 0) {
            const hitSL = trade.optionType === "CALL" ? price <= trade.stopLoss : price >= trade.stopLoss;
            if (hitSL) { trade.status = "STOPPED"; trade.closedAt = new Date().toISOString(); changed = true; continue; }
        }
        if (trade.takeProfit > 0 && trade.status === "OPEN") {
            const hitTP = trade.optionType === "CALL" ? price >= trade.takeProfit : price <= trade.takeProfit;
            if (hitTP) { trade.status = "WIN"; trade.closedAt = new Date().toISOString(); changed = true; }
        }
    }
    saveTrades(trades);
    return changed;
}

export function getOpenTrades() {
    return loadTrades().filter(t => t.status === "OPEN");
}

export function getClosedTrades() {
    return loadTrades().filter(t => t.status !== "OPEN");
}

export function getStats() {
    const trades = loadTrades();
    const closed = trades.filter(t => t.status !== "OPEN");
    const open = trades.filter(t => t.status === "OPEN");
    const wins = closed.filter(t => t.pnl >= 0);
    const losses = closed.filter(t => t.pnl < 0);
    const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
    const unrealized = open.reduce((s, t) => s + t.pnl, 0);
    const invested = open.reduce((s, t) => s + t.entryPrice * t.quantity, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

    return {
        totalCapital: INITIAL_CAPITAL + totalPnl + unrealized,
        available: INITIAL_CAPITAL + totalPnl - invested,
        invested, totalPnl: totalPnl + unrealized,
        totalTrades: closed.length, openTrades: open.length,
        winRate: +winRate.toFixed(1),
        profitFactor: +profitFactor.toFixed(2),
    };
}

export function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
}
