/**
 * Options Chain — Gera cadeia de opções com códigos B3 reais,
 * pricing via Black-Scholes e gregas (Delta, Gamma, Theta, Vega).
 * Usa preço real da ação (brapi.dev) + SELIC como taxa livre de risco.
 */

// =================== CONSTANTES B3 ===================
const CALL_MONTHS = "ABCDEFGHIJKL"; // A=Jan ... L=Dec
const PUT_MONTHS  = "MNOPQRSTUVWX"; // M=Jan ... X=Dec

// Mapa de raiz dos tickers (primeiros 4 chars do código da opção)
const TICKER_ROOT = {
    "PETR4": "PETR", "PETR3": "PETR",
    "VALE3": "VALE",
    "ITUB4": "ITUB", "ITUB3": "ITUB",
    "BBDC4": "BBDC", "BBDC3": "BBDC",
    "ABEV3": "ABEV",
    "B3SA3": "B3SA",
    "RENT3": "RENT",
    "WEGE3": "WEGE",
    "SUZB3": "SUZB",
    "JBSS3": "JBSS",
    "BBAS3": "BBAS",
    "ITSA4": "ITSA",
    "RADL3": "RADL",
    "RAIL3": "RAIL",
    "VIVT3": "VIVT",
    "ELET3": "ELET",
    "HAPV3": "HAPV",
    "MGLU3": "MGLU",
    "CSAN3": "CSAN",
    "GGBR4": "GGBR"
};

// SELIC atual (~13.25% a.a.)
const SELIC = 0.1325;

// =================== BLACK-SCHOLES ===================

/** Distribuição normal cumulativa (aproximação Abramowitz & Stegun) */
function normCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
}

/** Densidade da normal padrão */
function normPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes pricing + gregas
 * @param {string} type - "CALL" ou "PUT"
 * @param {number} S - Preço spot (ação)
 * @param {number} K - Strike
 * @param {number} T - Tempo até vencimento (anos)
 * @param {number} r - Taxa livre de risco (SELIC)
 * @param {number} sigma - Volatilidade implícita (anualizada)
 * @returns {object} { price, delta, gamma, theta, vega, iv }
 */
function blackScholes(type, S, K, T, r, sigma) {
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
        return { price: Math.max(type === "CALL" ? S - K : K - S, 0.01), delta: 0, gamma: 0, theta: 0, vega: 0, iv: sigma };
    }

    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    let price, delta;
    if (type === "CALL") {
        price = S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
        delta = normCDF(d1);
    } else {
        price = K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
        delta = normCDF(d1) - 1;
    }

    const gamma = normPDF(d1) / (S * sigma * Math.sqrt(T));
    const vega = S * normPDF(d1) * Math.sqrt(T) / 100; // per 1% move
    const theta = (-(S * normPDF(d1) * sigma) / (2 * Math.sqrt(T))
        - r * K * Math.exp(-r * T) * (type === "CALL" ? normCDF(d2) : normCDF(-d2))) / 365;

    return {
        price: Math.max(price, 0.01),
        delta: +delta.toFixed(4),
        gamma: +gamma.toFixed(6),
        theta: +theta.toFixed(4),
        vega: +vega.toFixed(4),
        iv: +(sigma * 100).toFixed(1)
    };
}

// =================== VENCIMENTOS B3 ===================

/**
 * Calcula a 3ª segunda-feira do mês (dia de vencimento das opções na B3)
 */
function thirdMonday(year, month) {
    const d = new Date(year, month, 1);
    const dayOfWeek = d.getDay(); // 0=Dom, 1=Seg, ...
    let firstMonday = dayOfWeek <= 1 ? (1 + (1 - dayOfWeek)) : (1 + (8 - dayOfWeek));
    return new Date(year, month, firstMonday + 14);
}

/**
 * Retorna os próximos N vencimentos a partir de hoje
 */
function getNextExpirations(count = 4) {
    const today = new Date();
    const expirations = [];
    let year = today.getFullYear();
    let month = today.getMonth();

    for (let i = 0; i < 12 && expirations.length < count; i++) {
        const exp = thirdMonday(year, month);
        if (exp > today) {
            expirations.push({
                date: exp,
                month: month,
                year: year,
                label: exp.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }),
                daysToExp: Math.ceil((exp - today) / (1000 * 60 * 60 * 24)),
                yearsToExp: (exp - today) / (1000 * 60 * 60 * 24 * 365)
            });
        }
        month++;
        if (month > 11) { month = 0; year++; }
    }
    return expirations;
}

// =================== GERADOR DE CÓDIGO B3 ===================

/**
 * Gera o ticker da opção no formato B3
 * Ex: PETR + C (Mar CALL) + 40 = PETRC40
 *     PETR + O (Mar PUT) + 40 = PETRO40
 */
function generateOptionTicker(stockSymbol, type, month, strike) {
    const root = TICKER_ROOT[stockSymbol] || stockSymbol.substring(0, 4);
    const monthChar = type === "CALL" ? CALL_MONTHS[month] : PUT_MONTHS[month];
    // Strike formatting: remove decimals if integer, keep 1 decimal otherwise
    const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1).replace(".", "");
    return `${root}${monthChar}${strikeStr}`;
}

// =================== CADEIA DE OPÇÕES ===================

/**
 * Calcula volatilidade histórica a partir de candles
 */
export function calculateHistoricalVolatility(candles) {
    if (!candles || candles.length < 20) return 0.40; // default 40%
    const returns = [];
    for (let i = 1; i < candles.length; i++) {
        if (candles[i].close > 0 && candles[i - 1].close > 0) {
            returns.push(Math.log(candles[i].close / candles[i - 1].close));
        }
    }
    if (returns.length < 10) return 0.40;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance * 252); // Annualize (252 trading days)
}

/**
 * Gera strikes espaçados em torno do preço atual
 * @param {number} spotPrice - Preço atual da ação
 * @param {number} count - Número de strikes para cada lado (ITM e OTM)
 * @returns {number[]} Array de strikes
 */
function generateStrikes(spotPrice, count = 7) {
    // Determina o espaçamento baseado no preço
    let spacing;
    if (spotPrice < 5) spacing = 0.50;
    else if (spotPrice < 15) spacing = 1;
    else if (spotPrice < 30) spacing = 2;
    else if (spotPrice < 60) spacing = 2.50;
    else if (spotPrice < 100) spacing = 5;
    else spacing = 10;

    // ATM strike (arredonda para o spacing mais próximo)
    const atmStrike = Math.round(spotPrice / spacing) * spacing;
    const strikes = [];

    for (let i = -count; i <= count; i++) {
        const strike = +(atmStrike + i * spacing).toFixed(2);
        if (strike > 0) strikes.push(strike);
    }
    return strikes;
}

/**
 * Gera a cadeia de opções completa para um ativo
 * @param {string} symbol - Ticker da ação (ex: PETR4)
 * @param {number} spotPrice - Preço atual
 * @param {number} volatility - Volatilidade histórica anualizada
 * @param {number} expirationIndex - Índice do vencimento (0 = próximo)
 * @returns {object} { calls: [], puts: [], expiration, spotPrice, atmStrike }
 */
export function buildOptionsChain(symbol, spotPrice, volatility, expirationIndex = 0) {
    const expirations = getNextExpirations(4);
    if (expirations.length === 0) return null;

    const exp = expirations[Math.min(expirationIndex, expirations.length - 1)];
    const T = exp.yearsToExp;
    const strikes = generateStrikes(spotPrice);
    const sigma = volatility || 0.40;

    const calls = [];
    const puts = [];

    for (const K of strikes) {
        const callBS = blackScholes("CALL", spotPrice, K, T, SELIC, sigma);
        const putBS = blackScholes("PUT", spotPrice, K, T, SELIC, sigma);

        const callTicker = generateOptionTicker(symbol, "CALL", exp.month, K);
        const putTicker = generateOptionTicker(symbol, "PUT", exp.month, K);

        // Moneyness
        const callMoneyness = spotPrice > K ? "ITM" : spotPrice < K ? "OTM" : "ATM";
        const putMoneyness = spotPrice < K ? "ITM" : spotPrice > K ? "OTM" : "ATM";
        const isATM = Math.abs(spotPrice - K) / spotPrice < 0.02;

        // Volume simulado (mais volume no ATM, menos no deep ITM/OTM)
        const distFromATM = Math.abs(spotPrice - K) / spotPrice;
        const baseVol = Math.max(100, Math.round(5000 * Math.exp(-distFromATM * 10)));

        calls.push({
            ticker: callTicker,
            type: "CALL",
            strike: K,
            price: +callBS.price.toFixed(2),
            bid: +(callBS.price * 0.95).toFixed(2),
            ask: +(callBS.price * 1.05).toFixed(2),
            delta: callBS.delta,
            gamma: callBS.gamma,
            theta: callBS.theta,
            vega: callBS.vega,
            iv: callBS.iv,
            volume: baseVol + Math.round(Math.random() * 200),
            openInterest: baseVol * 3 + Math.round(Math.random() * 1000),
            moneyness: isATM ? "ATM" : callMoneyness,
            intrinsicValue: +Math.max(spotPrice - K, 0).toFixed(2),
            timeValue: +Math.max(callBS.price - Math.max(spotPrice - K, 0), 0).toFixed(2)
        });

        puts.push({
            ticker: putTicker,
            type: "PUT",
            strike: K,
            price: +putBS.price.toFixed(2),
            bid: +(putBS.price * 0.95).toFixed(2),
            ask: +(putBS.price * 1.05).toFixed(2),
            delta: putBS.delta,
            gamma: putBS.gamma,
            theta: putBS.theta,
            vega: putBS.vega,
            iv: putBS.iv,
            volume: baseVol + Math.round(Math.random() * 200),
            openInterest: baseVol * 3 + Math.round(Math.random() * 1000),
            moneyness: isATM ? "ATM" : putMoneyness,
            intrinsicValue: +Math.max(K - spotPrice, 0).toFixed(2),
            timeValue: +Math.max(putBS.price - Math.max(K - spotPrice, 0), 0).toFixed(2)
        });
    }

    return {
        symbol,
        spotPrice,
        volatility: +(sigma * 100).toFixed(1),
        selic: +(SELIC * 100).toFixed(2),
        expiration: exp,
        expirations: expirations,
        atmStrike: strikes[Math.floor(strikes.length / 2)],
        calls,
        puts
    };
}

/**
 * Retorna lista de vencimentos disponíveis
 */
export function getExpirations() {
    return getNextExpirations(4);
}
