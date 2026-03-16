/**
 * Market Data — Busca dados reais da B3 via brapi.dev (API gratuita).
 * Token gratuito: cadastre em https://brapi.dev e cole abaixo.
 * Sem token funciona mas com limite menor de requests.
 */

const API_BASE = "https://brapi.dev/api";
const API_TOKEN = ""; // Cole seu token gratuito aqui (opcional)
const CACHE = {};
const CACHE_TTL = 30000; // 30s

function apiUrl(path) {
    const sep = path.includes("?") ? "&" : "?";
    return API_TOKEN ? `${API_BASE}${path}${sep}token=${API_TOKEN}` : `${API_BASE}${path}`;
}

export const WATCHLIST = [
    "PETR4", "VALE3", "ITUB4", "BBDC4", "ABEV3",
    "B3SA3", "RENT3", "WEGE3", "SUZB3", "JBSS3",
    "BBAS3", "ITSA4", "RADL3", "RAIL3", "VIVT3",
    "ELET3", "HAPV3", "MGLU3", "CSAN3", "GGBR4"
];

function cached(key) {
    const c = CACHE[key];
    if (c && Date.now() - c.ts < CACHE_TTL) return c.data;
    return null;
}

export async function fetchQuote(symbol) {
    const key = `quote_${symbol}`;
    const c = cached(key);
    if (c) return c;
    try {
        const res = await fetch(apiUrl(`/quote/${symbol}`));
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        const r = json.results?.[0];
        if (!r) return null;
        const data = {
            symbol: r.symbol,
            price: r.regularMarketPrice || 0,
            change_pct: r.regularMarketChangePercent || 0,
            volume: r.regularMarketVolume || 0,
            high: r.regularMarketDayHigh || 0,
            low: r.regularMarketDayLow || 0,
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        };
        CACHE[key] = { data, ts: Date.now() };
        return data;
    } catch (e) {
        console.warn(`Erro ao buscar ${symbol}:`, e.message);
        return null;
    }
}

export async function fetchHistorical(symbol, range = "6mo") {
    const key = `hist_${symbol}_${range}`;
    const c = cached(key);
    if (c) return c;
    try {
        const res = await fetch(apiUrl(`/quote/${symbol}?range=${range}&interval=1d`));
        if (!res.ok) throw new Error(res.statusText);
        const json = await res.json();
        const prices = json.results?.[0]?.historicalDataPrice;
        if (!prices || prices.length < 50) return null;
        const candles = prices.map(p => ({
            date: new Date(p.date * 1000),
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume || 0
        })).filter(c => c.close > 0);
        CACHE[key] = { data: candles, ts: Date.now() };
        return candles;
    } catch (e) {
        console.warn(`Erro histórico ${symbol}:`, e.message);
        return null;
    }
}

export async function fetchMultipleQuotes(symbols) {
    const results = {};
    // Fetch in batches of 5 to avoid rate limits
    for (let i = 0; i < symbols.length; i += 5) {
        const batch = symbols.slice(i, i + 5);
        const promises = batch.map(async s => {
            const data = await fetchQuote(s);
            if (data) results[s] = data;
        });
        await Promise.all(promises);
        if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 500));
    }
    return results;
}
