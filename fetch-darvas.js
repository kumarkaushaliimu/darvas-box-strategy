/**
 * Darvas Box Scanner — NIFTY universe daily data fetch + screening.
 * Usage: node fetch-darvas.js [--limit=50] [--index=250]
 * Output: darvas.json
 */
const fs = require('fs');
const { detectBoxes } = require('./lib/box-detector');

const args = process.argv.slice(2);
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);
const INDEX = (args.find(a => a.startsWith('--index=')) || '').split('=')[1] || '250';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const YH = { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let session;
async function yahooSession() {
  const r1 = await fetch('https://fc.yahoo.com', { headers: YH });
  const cookie = r1.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const cr = (await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...YH, Cookie: cookie } })).text()).trim();
  session = { cookie, crumb: cr };
}
async function getJson(url, tries = 3) {
  for (let t = 1; t <= tries; t++) {
    try {
      const r = await fetch(url, { headers: { ...YH, Cookie: session.cookie } });
      if (r.status === 200) return await r.json();
      if (r.status === 404) return null;
      if (r.status === 401) { await yahooSession(); continue; }
      if (r.status === 429 || r.status >= 500) { await sleep(600 * t); continue; }
      return null;
    } catch { await sleep(400 * t); }
  }
  return null;
}
function ema(vals, p) {
  if (vals.length < p) return null;
  const k = 2 / (p + 1);
  let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}
function emaSeries(vals, p) {
  if (vals.length < p) return [];
  const k = 2 / (p + 1);
  const out = new Array(vals.length).fill(null);
  let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = e;
  for (let i = p; i < vals.length; i++) {
    e = vals[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

(async () => {
  console.log('Fetching NIFTY ' + INDEX + ' constituents...');
  const parseCsv = txt => txt.trim().split(/\r?\n/).slice(1).map(line => {
    const m = line.match(/^(.*),([^,]*),([^,]*),([^,]*),([^,]*)$/);
    return m ? { name: m[1].trim(), sector: m[2].trim(), symbol: m[3].trim() } : null;
  }).filter(Boolean);

  const csv500 = await (await fetch('https://archives.nseindia.com/content/indices/ind_nifty500list.csv', { headers: { 'User-Agent': UA } })).text();
  const all500 = parseCsv(csv500);
  let list;

  if (INDEX === '200') {
    const csv200 = await (await fetch('https://archives.nseindia.com/content/indices/ind_nifty200list.csv', { headers: { 'User-Agent': UA } })).text();
    list = parseCsv(csv200);
  } else {
    // NIFTY 250 has no official NSE list. Build it as: official NIFTY 200 + next
    // 50 largest by market cap from the rest of NIFTY 500. This guarantees all
    // NIFTY 200 names (incl. SBIN) are present, unlike slicing the alphabetical CSV.
    const csv200 = await (await fetch('https://archives.nseindia.com/content/indices/ind_nifty200list.csv', { headers: { 'User-Agent': UA } })).text();
    const n200 = parseCsv(csv200);
    const in200 = new Set(n200.map(c => c.symbol));
    const others = all500.filter(c => !in200.has(c.symbol));
    await yahooSession();
    const caps = {};
    for (let i = 0; i < others.length; i += 40) {
      const batch = others.slice(i, i + 40);
      const syms = batch.map(c => encodeURIComponent(c.symbol) + '.NS').join(',');
      const j = await getJson('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + syms + '&crumb=' + encodeURIComponent(session.crumb));
      for (const q of (j?.quoteResponse?.result || [])) {
        caps[decodeURIComponent(q.symbol.replace(/\.NS$/, ''))] = q.marketCap || 0;
      }
      await sleep(150);
    }
    others.sort((a, b) => (caps[b.symbol] || 0) - (caps[a.symbol] || 0));
    list = [...n200, ...others.slice(0, 50)];
    console.log('Universe: official NIFTY 200 + top 50 by market cap = ' + list.length);
  }
  if (LIMIT) list = list.slice(0, LIMIT);

  if (!session) await yahooSession();

  // Benchmark (NIFTY 500 index) for relative strength
  const idx = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ECRSLDX?range=1y&interval=1d');
  const idxClose = (idx?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  const idx3m = idxClose.length > 63 ? (idxClose.at(-1) / idxClose[idxClose.length - 64] - 1) * 100 : null;

  console.log('Scanning ' + list.length + ' stocks...');
  const results = [];
  let done = 0;
  for (const c of list) {
    const j = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(c.symbol) + '.NS?range=1y&interval=1d&includePrePost=false');
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const q = res?.indicators?.quote?.[0] || {};
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close?.[i] != null && q.high?.[i] != null && q.low?.[i] != null) {
        candles.push({
          date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] || 0,
        });
      }
    }
    if (candles.length < 60) { done++; continue; }
    const closes = candles.map(x => x.close);
    const price = closes.at(-1);
    const e50 = ema(closes, 50), e200 = ema(closes, 200);
    // 50 DMA slope: current EMA50 vs EMA50 from 10 sessions ago
    const e50s = emaSeries(closes, 50);
    const e50Prev = e50s.length > 10 ? e50s[e50s.length - 11] : null;
    const dma50SlopePct = (e50 != null && e50Prev != null && e50Prev !== 0) ? (e50 / e50Prev - 1) * 100 : null;
    const dma50SlopeUp = dma50SlopePct != null ? dma50SlopePct > 0 : null;
    const ret3m = closes.length > 63 ? (price / closes[closes.length - 64] - 1) * 100 : null;
    const high52 = Math.max(...candles.slice(-252).map(x => x.high));
    const det = detectBoxes(candles, { bufferPct: 0.4, volMult: 1.5, maxBoxHeightPct: 15 });

    const lastBuy = [...det.signals].reverse().find(s => s.type === 'BUY');
    const lastSL = [...det.signals].filter(s => s.type === 'RAISE_SL').at(-1);
    const lastExit = [...det.signals].reverse().find(s => s.type === 'EXIT');
    const buys = det.signals.filter(s => s.type === 'BUY');
    const activePosition = buys.length > (lastExit ? det.signals.filter(s => s.type === 'EXIT').length : 0);

    // Filters
    const above200 = e200 != null && price > e200;
    const dma50above200 = e50 != null && e200 != null && e50 > e200;
    const rs3m = ret3m != null && idx3m != null ? ret3m - idx3m : null;
    const nearHigh = high52 ? (price / high52 - 1) * 100 : null;

    const box = det.boxes.at(-1) || null;

    // ---- Recommended-buy evaluation (hard filters + score) ----
    const isActive = lastBuy && (!lastExit || lastBuy.date > lastExit.date);
    const currentSL = lastSL ? lastSL.newSL : (lastBuy ? lastBuy.initialSL : null);
    const target = box ? box.top + (box.height || 0) : null;
    const riskPct = (currentSL != null && price) ? (price - currentSL) / price * 100 : null;
    const upside = (target != null && price) ? (target / price - 1) * 100 : null;
    const buyAgeDays = lastBuy ? Math.floor((Date.now() - new Date(lastBuy.date).getTime()) / 86400000) : null;
    const volRatio = lastBuy?.volumeRatio ?? null;
    const closeAboveTop = (price != null && box?.top != null) ? price > box.top : null;
    // Hard filters
    const hard = {
      active: !!isActive,
      fresh: buyAgeDays != null && buyAgeDays <= 14,
      riskOk: riskPct != null && riskPct <= 12,
      rewardOk: upside != null && riskPct != null && upside >= riskPct * 1.5,
      volumeOk: volRatio != null && volRatio >= 1.5,
      slopeOk: dma50SlopeUp === true,
      above200: !!above200,
      rsOk: rs3m != null && rs3m > 0,
    };
    const passHard = Object.values(hard).every(Boolean);
    // Score (0-100) only for those passing hard filters
    let buyScore = null;
    if (passHard) {
      buyScore = 0;
      buyScore += Math.max(0, 30 - (buyAgeDays || 99) * 1.5);                // freshness up to 30
      buyScore += Math.max(0, Math.min(25, 25 - riskPct * 1.2));            // lower risk up to 25
      buyScore += Math.max(0, Math.min(20, (upside / Math.max(riskPct, 1)) * 8)); // reward/risk up to 20
      buyScore += Math.max(0, Math.min(15, ((volRatio || 0) - 1.5) * 10));  // volume up to 15
      buyScore += (closeAboveTop ? 10 : 0);                                  // holding above box top +10
      buyScore = Math.round(Math.min(100, buyScore));
    }

    results.push({
      symbol: c.symbol, name: c.name.replace(/\s+Ltd\.?$/, '').trim(), sector: c.sector,
      price, e50, e200, ret3m, rs3m, nearHigh,
      above200, dma50above200, dma50SlopePct, dma50SlopeUp,
      boxCount: det.boxes.length,
      activeBox: box,
      lastBuy, lastSL, lastExit,
      activePosition,
      currentSL,
      target,
      riskPct, upside, buyAgeDays, volRatio, closeAboveTop,
      hard, passHard, buyScore,
      signals: det.signals.slice(-12),
    });
    done++;
    if (done % 25 === 0) console.log(' ', done, '/', list.length);
    await sleep(50);
  }

  // Universe already reduced to the correct 250 (by market cap) at the top of the script.
  const outList = results;

  const out = {
    title: 'Darvas Box Scanner',
    index: INDEX,
    generatedAt: new Date().toISOString(),
    benchmark3m: idx3m,
    params: { confirmBars: 3, volumeMult: 1.5, bufferPct: 0.4, maxBoxHeightPct: 15 },
    stocks: outList,
  };
  fs.writeFileSync('darvas.json', JSON.stringify(out));
  const breakouts = outList.filter(s => s.lastBuy && (!s.lastExit || s.lastBuy.date > s.lastExit.date)).length;
  console.log('Wrote darvas.json:', outList.length, 'stocks |', breakouts, 'with active breakout signals');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
