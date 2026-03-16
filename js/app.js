/**
 * App principal — Orquestra UI, dados e interações.
 */
import { analyzeAll } from "./indicators.js";
import { calculateScore, determineOptionType } from "./score-engine.js";
import { WATCHLIST, fetchQuote, fetchHistorical, fetchMultipleQuotes } from "./market-data.js";
import * as PT from "./paper-trading.js";
import { buildOptionsChain, calculateHistoricalVolatility, getExpirations } from "./options-chain.js";

// Expose indicators globally for score-engine
window._indicators = { analyzeAll };

let selectedAsset = "PETR4";
let allOpportunities = [];
let marketData = {};
let scanning = false;

// =================== DOM HELPERS ===================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { el?.classList.remove("hidden"); }
function hide(el) { el?.classList.add("hidden"); }

// =================== TABS ===================
function initTabs() {
    $$(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            $$(".tab-btn").forEach(b => b.classList.remove("active"));
            $$(".tab-panel").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            $(`#${btn.dataset.tab}`)?.classList.add("active");
            // Auto-load chain when tab is clicked
            if (btn.dataset.tab === "tab-chain") loadChain();
        });
    });
}

// =================== ASSET SELECTOR ===================
function initAssetSelector() {
    const sel = $("#asset-select");
    if (!sel) return;
    sel.innerHTML = WATCHLIST.map(s =>
        `<option value="${s}" ${s === selectedAsset ? "selected" : ""}>${s}</option>`
    ).join("");
    sel.addEventListener("change", (e) => {
        selectedAsset = e.target.value;
        refreshAssetView();
        setStatus(`Ativo selecionado: ${selectedAsset}`);
    });
}

// =================== MARKET DATA ===================
async function refreshMarket() {
    setStatus("Atualizando mercado...");
    const data = await fetchMultipleQuotes(WATCHLIST);
    marketData = { ...marketData, ...data };

    // Update market cards
    for (const [symbol, info] of Object.entries(data)) {
        const card = $(`#card-${symbol}`);
        if (!card) continue;
        card.querySelector(".card-price").textContent = `R$ ${info.price.toFixed(2)}`;
        const chg = card.querySelector(".card-change");
        const arrow = info.change_pct >= 0 ? "▲" : "▼";
        chg.textContent = `${arrow} ${info.change_pct.toFixed(2)}%`;
        chg.className = `card-change ${info.change_pct >= 0 ? "positive" : "negative"}`;
        card.querySelector(".card-vol").textContent = `Vol: ${formatVol(info.volume)}`;
        card.querySelector(".card-time").textContent = info.timestamp;
    }

    // Update asset dashboard
    const sel = marketData[selectedAsset];
    if (sel) {
        $("#dash-price").textContent = `R$ ${sel.price.toFixed(2)}`;
        const chg = sel.change_pct;
        $("#dash-change").textContent = `${chg >= 0 ? "▲" : "▼"} ${chg.toFixed(2)}%`;
        $("#dash-change").className = `stat-value ${chg >= 0 ? "positive" : "negative"}`;
        $("#dash-volume").textContent = formatVol(sel.volume);
    }

    // Update open position prices
    const priceMap = {};
    for (const [s, d] of Object.entries(marketData)) priceMap[s] = d.price;
    PT.updatePrices(priceMap);
    renderPaperTrading();

    setStatus(`Mercado atualizado — ${Object.keys(data).length} ativos`);
}

async function scanOpportunities() {
    if (scanning) return;
    scanning = true;
    setStatus("Escaneando oportunidades... (pode levar 1-2 min)");
    allOpportunities = [];

    for (const symbol of WATCHLIST) {
        try {
            const candles = await fetchHistorical(symbol);
            if (!candles || candles.length < 50) continue;
            const indicators = analyzeAll(candles);
            const breakdown = calculateScore(indicators);
            const lastPrice = candles[candles.length - 1].close;
            const atr = indicators.atr.filter(v => v !== null).pop() || lastPrice * 0.02;

            // Generate BOTH CALL and PUT for each asset
            for (const optType of ["CALL", "PUT"]) {
                let target, stop;
                if (optType === "CALL") {
                    target = lastPrice + atr * 3; stop = lastPrice - atr * 1.5;
                } else {
                    target = lastPrice - atr * 3; stop = lastPrice + atr * 1.5;
                }
                const risk = Math.abs(lastPrice - stop);
                const reward = Math.abs(target - lastPrice);

                // Adjust score: preferred direction gets full score, opposite gets penalty
                const preferred = determineOptionType(indicators);
                const adjScore = optType === preferred
                    ? breakdown.total
                    : Math.max(breakdown.total * 0.6, 20);

                allOpportunities.push({
                    symbol, underlying: symbol, option_type: optType,
                    current_price: +lastPrice.toFixed(2),
                    score: +adjScore.toFixed(1),
                    probability: +Math.min(adjScore * 1.1, 95).toFixed(1),
                    risk_reward: +(risk > 0 ? reward / risk : 0).toFixed(2),
                    target: +target.toFixed(2), stop_loss: +stop.toFixed(2),
                    strike: +lastPrice.toFixed(2), breakdown,
                    is_preferred: optType === preferred
                });
            }
        } catch (e) { console.warn(`Erro ${symbol}:`, e); }
        await new Promise(r => setTimeout(r, 300)); // rate limit
    }

    allOpportunities.sort((a, b) => b.score - a.score);
    allOpportunities.forEach((o, i) => o.rank = i + 1);
    scanning = false;

    renderRadarTable();
    refreshAssetView();
    setStatus(`Scan completo — ${allOpportunities.length} oportunidades`);
}

// =================== ASSET DASHBOARD ===================
function refreshAssetView() {
    const callOpp = allOpportunities.find(o => o.underlying === selectedAsset && o.option_type === "CALL");
    const putOpp = allOpportunities.find(o => o.underlying === selectedAsset && o.option_type === "PUT");

    // If only one type found, generate the other with lower score
    renderOptionCard("call", callOpp);
    renderOptionCard("put", putOpp);
    renderAIVerdict(callOpp, putOpp);
}

function renderOptionCard(type, data) {
    const card = $(`#${type}-card`);
    if (!card) return;
    if (!data) {
        card.querySelector(".opt-score").textContent = "Score: --";
        card.querySelector(".opt-bar").style.width = "0%";
        card.querySelector(".opt-strength").textContent = "Sem dados para este tipo";
        card.querySelector(".opt-entry").textContent = "---";
        card.querySelector(".opt-target").textContent = "---";
        card.querySelector(".opt-stop").textContent = "---";
        card.querySelector(".opt-rr").textContent = "---";
        card.querySelector(".opt-prob").textContent = "---";
        card.querySelector(".opt-explain").textContent = "Não há sinal suficiente no momento.";
        card.querySelector(".opt-buy-btn").disabled = true;
        return;
    }
    const s = data.score;
    card.querySelector(".opt-score").textContent = `Score: ${s.toFixed(0)}/100`;
    card.querySelector(".opt-bar").style.width = `${s}%`;
    card.querySelector(".opt-strength").textContent =
        s >= 70 ? "SINAL FORTE — Vários indicadores confirmam" :
        s >= 55 ? "SINAL MODERADO — Alguns indicadores divergem" :
        "SINAL FRACO — Considere esperar";

    card.querySelector(".opt-entry").textContent = `R$ ${data.current_price.toFixed(2)}`;
    const gainPct = data.current_price > 0 ? Math.abs(data.target - data.current_price) / data.current_price * 100 : 0;
    const lossPct = data.current_price > 0 ? Math.abs(data.stop_loss - data.current_price) / data.current_price * 100 : 0;
    card.querySelector(".opt-target").textContent = `R$ ${data.target.toFixed(2)} (+${gainPct.toFixed(1)}%)`;
    card.querySelector(".opt-stop").textContent = `R$ ${data.stop_loss.toFixed(2)} (-${lossPct.toFixed(1)}%)`;

    const rr = data.risk_reward;
    const rrLabel = rr >= 2 ? "Excelente" : rr >= 1.5 ? "Bom" : rr >= 1 ? "Aceitável" : "Ruim";
    card.querySelector(".opt-rr").textContent = `${rr.toFixed(1)}:1 (${rrLabel})`;
    card.querySelector(".opt-prob").textContent = `${data.probability.toFixed(0)}%`;

    const dir = type === "call" ? "SUBIR" : "CAIR";
    const action = type === "call" ? "comprar esta CALL" : "comprar esta PUT";
    const preferred = data.is_preferred ? "★ RECOMENDADO PELA IA\n" : "";
    card.querySelector(".opt-explain").textContent =
        `${preferred}Se você ${action}:\n• Entra a R$ ${data.current_price.toFixed(2)}\n` +
        `• Se ${dir.toLowerCase()} até R$ ${data.target.toFixed(2)}, ganha +${gainPct.toFixed(1)}%\n` +
        `• Se for contra, perde -${lossPct.toFixed(1)}% (limitado pelo stop)\n\n` +
        (s >= 70 ? "A IA recomenda com ALTA CONFIANÇA." :
         s >= 55 ? "Confiança MÉDIA. Cuidado." : "Sinal fraco. Melhor esperar.");

    const btn = card.querySelector(".opt-buy-btn");
    btn.disabled = s < 40;
    btn.onclick = () => executeBuy(data);
}

function renderAIVerdict(callData, putData) {
    const el = $("#ai-verdict");
    const txt = $("#ai-verdict-text");
    if (!callData && !putData) {
        el.textContent = "Aguardando...";
        el.className = "stat-value";
        txt.textContent = "Selecione um ativo e aguarde o scan (pode levar 1-2 min).";
        return;
    }
    const cScore = callData?.score || 0;
    const pScore = putData?.score || 0;
    if (cScore > pScore) {
        el.textContent = "COMPRAR CALL";
        el.className = "stat-value positive";
    } else {
        el.textContent = "COMPRAR PUT";
        el.className = "stat-value negative";
    }
    const winner = cScore > pScore ? "CALL" : "PUT";
    const diff = Math.abs(cScore - pScore);
    const conf = diff > 15 ? "alta" : diff > 5 ? "moderada" : "baixa";
    txt.textContent = `Para ${selectedAsset}, a IA recomenda ${winner} ` +
        `(CALL: ${cScore.toFixed(0)} vs PUT: ${pScore.toFixed(0)}). Confiança: ${conf}.` +
        (diff < 10 ? "\nDICA: Diferença pequena — considere esperar sinal mais claro." :
        "\nDICA: Clique em SIMULAR COMPRA no card recomendado.");
}

// =================== PAPER TRADING ===================
function executeBuy(data) {
    const qty = parseInt($("#buy-qty")?.value) || 100;
    const trade = PT.openTrade({
        symbol: data.underlying, optionType: data.option_type,
        price: data.current_price, quantity: qty,
        stopLoss: data.stop_loss, takeProfit: data.target, score: data.score
    });
    if (trade) {
        setStatus(`Trade aberto: ${trade.optionType} ${trade.symbol} @ R$${trade.entryPrice.toFixed(2)} x${trade.quantity}`);
        // Switch to operations tab
        $$(".tab-btn").forEach(b => b.classList.remove("active"));
        $$(".tab-panel").forEach(p => p.classList.remove("active"));
        $('[data-tab="tab-operations"]')?.classList.add("active");
        $("#tab-operations")?.classList.add("active");
    } else {
        setStatus("Erro: Capital insuficiente.");
    }
    renderPaperTrading();
}

function renderPaperTrading() {
    const stats = PT.getStats();
    $("#pt-capital").textContent = `R$ ${stats.totalCapital.toLocaleString("pt-BR", {minimumFractionDigits: 2})}`;
    $("#pt-available").textContent = `R$ ${stats.available.toLocaleString("pt-BR", {minimumFractionDigits: 2})}`;
    const pnlEl = $("#pt-pnl");
    pnlEl.textContent = `R$ ${stats.totalPnl.toLocaleString("pt-BR", {minimumFractionDigits: 2})}`;
    pnlEl.className = `stat-value ${stats.totalPnl >= 0 ? "positive" : "negative"}`;
    $("#pt-winrate").textContent = `${stats.winRate}%`;
    $("#pt-pf").textContent = stats.profitFactor.toFixed(2);
    $("#pt-trades").textContent = stats.totalTrades;

    // Open positions
    const openBody = $("#open-positions-body");
    const open = PT.getOpenTrades();
    openBody.innerHTML = open.map(t => `
        <tr>
            <td>${t.symbol}</td>
            <td class="${t.optionType === 'CALL' ? 'positive' : 'negative'}">${t.optionType}</td>
            <td>R$ ${t.entryPrice.toFixed(2)}</td>
            <td>R$ ${t.currentPrice.toFixed(2)}</td>
            <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">R$ ${t.pnl.toFixed(2)}</td>
            <td>R$ ${t.stopLoss.toFixed(2)}</td>
            <td>R$ ${t.takeProfit.toFixed(2)}</td>
            <td><button class="btn-close-trade" data-id="${t.id}">Fechar</button></td>
        </tr>
    `).join("") || '<tr><td colspan="8" class="empty">Nenhuma posição aberta</td></tr>';

    openBody.querySelectorAll(".btn-close-trade").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.id);
            const trade = open.find(t => t.id === id);
            const currentPrice = trade ? (marketData[trade.symbol]?.price || trade.currentPrice) : 0;
            PT.closeTrade(id, currentPrice);
            renderPaperTrading();
            setStatus(`Posição ${trade?.symbol || ""} fechada a R$ ${currentPrice.toFixed(2)}`);
        });
    });

    // History
    const histBody = $("#history-body");
    const closed = PT.getClosedTrades().slice(-20).reverse();
    histBody.innerHTML = closed.map(t => `
        <tr>
            <td>${t.symbol}</td>
            <td class="${t.optionType === 'CALL' ? 'positive' : 'negative'}">${t.optionType}</td>
            <td>R$ ${t.entryPrice.toFixed(2)}</td>
            <td>R$ ${t.currentPrice.toFixed(2)}</td>
            <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">R$ ${t.pnl.toFixed(2)}</td>
            <td>${t.pnlPct}%</td>
            <td class="${t.status === 'WIN' ? 'positive' : 'negative'}">${t.status}</td>
        </tr>
    `).join("") || '<tr><td colspan="7" class="empty">Nenhum trade no histórico</td></tr>';
}

// =================== RADAR TABLE ===================
function renderRadarTable() {
    const body = $("#radar-body");
    if (!body) return;
    const filterAsset = $("#radar-asset-filter")?.value || "Todos";
    const filterType = $("#radar-type-filter")?.value || "Todos";
    let filtered = allOpportunities;
    if (filterAsset !== "Todos") filtered = filtered.filter(o => o.underlying === filterAsset);
    if (filterType !== "Todos") filtered = filtered.filter(o => o.option_type === filterType);

    body.innerHTML = filtered.map((o, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${o.underlying}</td>
            <td class="${o.option_type === 'CALL' ? 'positive' : 'negative'}">${o.option_type}</td>
            <td class="${o.score >= 70 ? 'positive' : o.score >= 55 ? 'warning' : ''}">${o.score.toFixed(0)}</td>
            <td>${o.probability.toFixed(0)}%</td>
            <td>${o.risk_reward.toFixed(1)}</td>
            <td>R$ ${o.target.toFixed(2)}</td>
            <td>R$ ${o.stop_loss.toFixed(2)}</td>
        </tr>
    `).join("") || '<tr><td colspan="8" class="empty">Escaneando...</td></tr>';

    $("#radar-count").textContent = `${filtered.length} oportunidades`;

    // Update radar asset filter options
    const radarSel = $("#radar-asset-filter");
    if (radarSel && radarSel.options.length <= 1) {
        const assets = [...new Set(allOpportunities.map(o => o.underlying))].sort();
        assets.forEach(a => { const opt = document.createElement("option"); opt.value = a; opt.textContent = a; radarSel.appendChild(opt); });
    }
}

// =================== MARKET CARDS ===================
function initMarketCards() {
    const grid = $("#market-grid");
    if (!grid) return;
    grid.innerHTML = WATCHLIST.slice(0, 10).map(s => `
        <div class="market-card" id="card-${s}">
            <div class="card-header"><span class="card-symbol">${s}</span><span class="card-time">--:--</span></div>
            <div class="card-price">R$ 0,00</div>
            <div class="card-footer"><span class="card-change">0.00%</span><span class="card-vol">Vol: --</span></div>
        </div>
    `).join("");
}

// =================== UTILS ===================
function formatVol(v) {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
}

function setStatus(msg) {
    const el = $("#status-bar");
    if (el) el.textContent = msg;
}

function updateClock() {
    const el = $("#clock");
    if (el) el.textContent = new Date().toLocaleTimeString("pt-BR");
}

// =================== OPTIONS CHAIN ===================
let chainVolatility = {};

function initChain() {
    const chainAsset = $("#chain-asset");
    if (!chainAsset) return;

    // Populate asset select
    chainAsset.innerHTML = WATCHLIST.map(s =>
        `<option value="${s}" ${s === selectedAsset ? "selected" : ""}>${s}</option>`
    ).join("");

    // Populate expiration select
    const exps = getExpirations();
    const chainExp = $("#chain-expiration");
    chainExp.innerHTML = exps.map((e, i) =>
        `<option value="${i}">${e.label} (${e.daysToExp}d)</option>`
    ).join("");

    // Event listeners
    chainAsset.addEventListener("change", () => loadChain());
    chainExp.addEventListener("change", () => loadChain());
    $("#chain-view")?.addEventListener("change", () => loadChain());
    $("#chain-refresh-btn")?.addEventListener("click", () => loadChain(true));
}

async function loadChain(forceRefresh = false) {
    const symbol = $("#chain-asset")?.value || selectedAsset;
    const expIdx = parseInt($("#chain-expiration")?.value) || 0;
    const view = $("#chain-view")?.value || "both";

    setStatus(`Carregando cadeia de opções para ${symbol}...`);

    // Get real stock price
    const quote = await fetchQuote(symbol);
    if (!quote) {
        setStatus(`Erro ao buscar dados de ${symbol}`);
        return;
    }

    // Get historical volatility
    if (!chainVolatility[symbol] || forceRefresh) {
        const candles = await fetchHistorical(symbol);
        chainVolatility[symbol] = calculateHistoricalVolatility(candles);
    }

    const chain = buildOptionsChain(symbol, quote.price, chainVolatility[symbol], expIdx);
    if (!chain) {
        setStatus("Erro ao gerar cadeia de opções");
        return;
    }

    // Update info bar
    $("#chain-spot").textContent = `R$ ${chain.spotPrice.toFixed(2)}`;
    $("#chain-vol").textContent = `${chain.volatility}%`;
    $("#chain-selic").textContent = `${chain.selic}%`;
    $("#chain-dte").textContent = `${chain.expiration.daysToExp}`;
    $("#chain-atm").textContent = `R$ ${chain.atmStrike.toFixed(2)}`;

    // Render table
    renderChainTable(chain, view);
    setStatus(`Cadeia de ${symbol} — venc. ${chain.expiration.label} — ${chain.calls.length} strikes`);
}

function renderChainTable(chain, view) {
    const body = $("#chain-body");
    if (!body) return;

    const showCalls = view !== "puts";
    const showPuts = view !== "calls";

    // Update header visibility
    const headers = $$("#chain-table thead tr");
    if (headers.length >= 2) {
        // We'll show/hide via the rendered rows
    }

    let html = "";
    for (let i = 0; i < chain.calls.length; i++) {
        const call = chain.calls[i];
        const put = chain.puts[i];
        const strike = call.strike;

        // Row class based on moneyness
        let rowClass = "";
        if (call.moneyness === "ATM") rowClass = "row-atm";
        else if (call.moneyness === "ITM") rowClass = "row-itm-call";
        if (put.moneyness === "ITM") rowClass += " row-itm-put";

        html += `<tr class="${rowClass}">`;

        // CALL columns
        if (showCalls) {
            html += `
                <td class="call-ticker">${call.ticker}</td>
                <td class="call-price">R$ ${call.price.toFixed(2)}</td>
                <td>${call.bid.toFixed(2)}</td>
                <td>${call.ask.toFixed(2)}</td>
                <td>${call.volume.toLocaleString()}</td>
                <td>${call.openInterest.toLocaleString()}</td>
                <td>${call.delta.toFixed(2)}</td>
                <td>${call.theta.toFixed(3)}</td>
                <td>${call.iv}%</td>`;
        }

        // STRIKE column
        html += `<td class="strike-col">R$ ${strike.toFixed(2)}</td>`;

        // PUT columns
        if (showPuts) {
            html += `
                <td class="put-ticker">${put.ticker}</td>
                <td class="put-price">R$ ${put.price.toFixed(2)}</td>
                <td>${put.bid.toFixed(2)}</td>
                <td>${put.ask.toFixed(2)}</td>
                <td>${put.volume.toLocaleString()}</td>
                <td>${put.openInterest.toLocaleString()}</td>
                <td>${put.delta.toFixed(2)}</td>
                <td>${put.theta.toFixed(3)}</td>
                <td>${put.iv}%</td>`;
        }

        html += `</tr>`;
    }

    body.innerHTML = html || '<tr><td colspan="19" class="empty">Nenhum dado disponível</td></tr>';
}

// =================== INIT ===================
document.addEventListener("DOMContentLoaded", async () => {
    initTabs();
    initAssetSelector();
    initMarketCards();
    initChain();
    renderPaperTrading();

    // Radar filters
    $("#radar-asset-filter")?.addEventListener("change", renderRadarTable);
    $("#radar-type-filter")?.addEventListener("change", renderRadarTable);

    // Clock
    setInterval(updateClock, 1000);
    updateClock();

    // Initial load
    await refreshMarket();
    scanOpportunities(); // fire and forget

    // Timers
    setInterval(refreshMarket, 60000);        // Market every 60s
    setInterval(scanOpportunities, 600000);   // Scan every 10min
});
