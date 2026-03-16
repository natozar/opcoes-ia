/**
 * Score Engine — Calcula score 0-100 com 5 componentes ponderados.
 */

const WEIGHTS = { probability: 0.25, momentum: 0.20, volatility: 0.20, flow: 0.15, technical: 0.20 };

function last(arr) {
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i];
    return null;
}
function prev(arr, offset = 1) {
    if (!arr) return null;
    let count = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null) { if (count === offset) return arr[i]; count++; }
    }
    return null;
}

function probabilityScore(ind) {
    let score = 50;
    const rsi = last(ind.rsi);
    if (rsi !== null) {
        if (rsi < 30) score += 25;
        else if (rsi <= 40) score += 20;
        else if (rsi >= 60 && rsi <= 70) score += 15;
        else if (rsi > 70) score += 10;
        else score += 5;
    }
    const h = ind.macd?.histogram;
    const hLast = last(h), hPrev = prev(h);
    if (hLast !== null && hPrev !== null) {
        if (hLast > hPrev && hLast > 0) score += 15;
        else if (hLast > hPrev) score += 10;
    }
    const pctB = last(ind.bollinger?.pctB);
    if (pctB !== null) {
        if (pctB >= 0 && pctB <= 0.2) score += 15;
        else if (pctB >= 0.8 && pctB <= 1) score += 10;
    }
    return Math.min(Math.max(score, 0), 100);
}

function momentumScore(ind) {
    let score = 50;
    const adx = last(ind.adx);
    if (adx !== null) {
        if (adx > 40) score += 25;
        else if (adx > 25) score += 15;
        else if (adx > 20) score += 5;
    }
    const closes = ind.closes;
    if (closes && closes.length > 1) {
        const mom = closes[closes.length - 1] - closes[closes.length - 2];
        score += mom > 0 ? 15 : 5;
    }
    return Math.min(Math.max(score, 0), 100);
}

function volatilityScore(ind) {
    let score = 50;
    const atr = last(ind.atr);
    if (atr !== null && atr > 0) score += 10;
    const w = last(ind.bollinger?.width);
    if (w !== null) {
        if (w > 0.05) score += 20;
        else if (w > 0.03) score += 10;
    }
    return Math.min(Math.max(score, 0), 100);
}

function flowScore(ind) {
    let score = 50;
    const obv = ind.obv;
    if (obv && obv.length > 5) {
        if (obv[obv.length - 1] > obv[obv.length - 6]) score += 20;
        else score += 5;
    }
    return Math.min(Math.max(score, 0), 100);
}

function technicalScore(ind) {
    let score = 50;
    const kVal = last(ind.stochastic?.k);
    const dVal = last(ind.stochastic?.d);
    if (kVal !== null && dVal !== null) {
        if (kVal < 20 && kVal > dVal) score += 20;
        else if (kVal > 80 && kVal < dVal) score += 15;
    }
    return Math.min(Math.max(score, 0), 100);
}

export function calculateScore(indicators) {
    const breakdown = {
        probability: probabilityScore(indicators),
        momentum: momentumScore(indicators),
        volatility: volatilityScore(indicators),
        flow: flowScore(indicators),
        technical: technicalScore(indicators),
    };
    breakdown.total =
        breakdown.probability * WEIGHTS.probability +
        breakdown.momentum * WEIGHTS.momentum +
        breakdown.volatility * WEIGHTS.volatility +
        breakdown.flow * WEIGHTS.flow +
        breakdown.technical * WEIGHTS.technical;
    return breakdown;
}

export function determineOptionType(indicators) {
    let bullish = 0, bearish = 0;
    const rsi = last(indicators.rsi);
    if (rsi !== null) { if (rsi < 40) bullish++; else if (rsi > 60) bearish++; }
    const h = indicators.macd?.histogram;
    const hLast = last(h), hPrev = prev(h);
    if (hLast !== null && hPrev !== null) { if (hLast > hPrev) bullish++; else bearish++; }
    const closes = indicators.closes;
    if (closes && closes.length > 1) {
        if (closes[closes.length - 1] > closes[closes.length - 2]) bullish++; else bearish++;
    }
    const obv = indicators.obv;
    if (obv && obv.length > 5) {
        if (obv[obv.length - 1] > obv[obv.length - 6]) bullish++; else bearish++;
    }
    return bullish >= bearish ? "CALL" : "PUT";
}

export function analyzeAsset(candles, symbol) {
    if (!candles || candles.length < 50) return null;
    const { analyzeAll } = window._indicators;
    const indicators = analyzeAll(candles);
    const optionType = determineOptionType(indicators);
    const breakdown = calculateScore(indicators);
    const lastPrice = candles[candles.length - 1].close;
    const atrVal = last(indicators.atr) || lastPrice * 0.02;

    let target, stop;
    if (optionType === "CALL") {
        target = lastPrice + atrVal * 3;
        stop = lastPrice - atrVal * 1.5;
    } else {
        target = lastPrice - atrVal * 3;
        stop = lastPrice + atrVal * 1.5;
    }
    const risk = Math.abs(lastPrice - stop);
    const reward = Math.abs(target - lastPrice);
    const rr = risk > 0 ? reward / risk : 0;

    return {
        symbol, underlying: symbol, option_type: optionType,
        current_price: +lastPrice.toFixed(2),
        score: +breakdown.total.toFixed(1),
        probability: +Math.min(breakdown.total * 1.1, 95).toFixed(1),
        risk_reward: +rr.toFixed(2),
        target: +target.toFixed(2),
        stop_loss: +stop.toFixed(2),
        strike: +lastPrice.toFixed(2),
        breakdown
    };
}
