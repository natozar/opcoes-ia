/**
 * Indicadores Técnicos - Calculados a partir de dados históricos.
 */

export function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return [];
    const rsi = new Array(closes.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
    }
    avgGain /= period;
    avgLoss /= period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
}

export function calcEMA(data, period) {
    const ema = new Array(data.length).fill(null);
    const k = 2 / (period + 1);
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === null) continue;
        if (count < period) {
            sum += data[i];
            count++;
            if (count === period) ema[i] = sum / period;
        } else {
            ema[i] = data[i] * k + ema[i - 1] * (1 - k);
        }
    }
    return ema;
}

export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = calcEMA(closes, fast);
    const emaSlow = calcEMA(closes, slow);
    const macdLine = closes.map((_, i) =>
        emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
    );
    const signalLine = calcEMA(macdLine, signal);
    const histogram = macdLine.map((v, i) =>
        v !== null && signalLine[i] !== null ? v - signalLine[i] : null
    );
    return { macd: macdLine, signal: signalLine, histogram };
}

export function calcBollinger(closes, period = 20, mult = 2) {
    const upper = [], lower = [], middle = [], pctB = [], width = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            upper.push(null); lower.push(null); middle.push(null);
            pctB.push(null); width.push(null);
            continue;
        }
        const slice = closes.slice(i - period + 1, i + 1);
        const avg = slice.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period);
        const u = avg + mult * std, l = avg - mult * std;
        upper.push(u); lower.push(l); middle.push(avg);
        pctB.push(u !== l ? (closes[i] - l) / (u - l) : 0.5);
        width.push(avg > 0 ? (u - l) / avg : 0);
    }
    return { upper, lower, middle, pctB, width };
}

export function calcATR(highs, lows, closes, period = 14) {
    const tr = [0];
    for (let i = 1; i < closes.length; i++) {
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    const atr = new Array(closes.length).fill(null);
    let sum = 0;
    for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
    if (tr.length >= period) atr[period - 1] = sum / period;
    for (let i = period; i < tr.length; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
    return atr;
}

export function calcADX(highs, lows, closes, period = 14) {
    if (closes.length < period * 2) return new Array(closes.length).fill(null);
    const pDM = [0], nDM = [0], tr = [0];
    for (let i = 1; i < closes.length; i++) {
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        pDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        nDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    const smooth = (arr) => {
        const s = new Array(arr.length).fill(null);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += arr[i];
        s[period - 1] = sum;
        for (let i = period; i < arr.length; i++) s[i] = s[i - 1] - s[i - 1] / period + arr[i];
        return s;
    };
    const sTR = smooth(tr), sPDM = smooth(pDM), sNDM = smooth(nDM);
    const dx = [];
    for (let i = 0; i < closes.length; i++) {
        if (sTR[i] === null || sTR[i] === 0) { dx.push(null); continue; }
        const pDI = 100 * sPDM[i] / sTR[i];
        const nDI = 100 * sNDM[i] / sTR[i];
        const sum = pDI + nDI;
        dx.push(sum === 0 ? 0 : 100 * Math.abs(pDI - nDI) / sum);
    }
    const adx = new Array(closes.length).fill(null);
    let adxSum = 0, adxCount = 0;
    for (let i = 0; i < dx.length; i++) {
        if (dx[i] === null) continue;
        adxSum += dx[i]; adxCount++;
        if (adxCount === period) { adx[i] = adxSum / period; }
        else if (adxCount > period) { adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period; }
    }
    return adx;
}

export function calcOBV(closes, volumes) {
    const obv = [0];
    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
        else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
        else obv.push(obv[i - 1]);
    }
    return obv;
}

export function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
    const k = new Array(closes.length).fill(null);
    for (let i = kPeriod - 1; i < closes.length; i++) {
        const hSlice = highs.slice(i - kPeriod + 1, i + 1);
        const lSlice = lows.slice(i - kPeriod + 1, i + 1);
        const hh = Math.max(...hSlice), ll = Math.min(...lSlice);
        k[i] = hh !== ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50;
    }
    const d = calcEMA(k, dPeriod);
    return { k, d };
}

export function analyzeAll(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    return {
        rsi: calcRSI(closes),
        macd: calcMACD(closes),
        bollinger: calcBollinger(closes),
        atr: calcATR(highs, lows, closes),
        adx: calcADX(highs, lows, closes),
        obv: calcOBV(closes, volumes),
        stochastic: calcStochastic(highs, lows, closes),
        closes, highs, lows, volumes
    };
}
