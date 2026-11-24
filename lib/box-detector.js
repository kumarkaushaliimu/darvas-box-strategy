/**
 * Darvas Box Detector — chronological, no look-ahead.
 *
 * Implements the classical Darvas box rules from the reference guide:
 *  - Candidate HIGH is confirmed as box top only if the next 3 completed
 *    candles all fail to exceed it.
 *  - Candidate LOW (found AFTER top confirmation) is confirmed as box bottom
 *    only if the next 3 completed candles all stay above it.
 *  - Top and bottom are confirmed at DIFFERENT times (no look-ahead bias).
 *  - Trailing stop only moves UP, and only after a new HIGHER box is fully confirmed.
 */

const CONFIRM_BARS = 3;

/**
 * Detect the sequence of Darvas boxes from daily OHLC data.
 * @param {Array<{date:string, high:number, low:number, close:number, volume:number}>} candles
 * @param {object} opts
 * @returns {{boxes: Array, signals: Array, activeBox: object|null}}
 */
function detectBoxes(candles, opts = {}) {
  const confirm = opts.confirmBars ?? CONFIRM_BARS;
  const bufferPct = opts.bufferPct ?? 0.4; // % below box bottom for SL buffer
  const volMult = opts.volMult ?? 1.5;
  const maxBoxHeightPct = opts.maxBoxHeightPct ?? 15;

  const n = candles.length;
  const boxes = [];
  const signals = [];
  let activeBox = null;
  let pendingTop = null; // {value, idx}
  let pendingBottom = null;
  let trailingSL = null;
  let position = null; // {entry, date, initialSL}

  const buffer = v => v * (1 - bufferPct / 100);

  for (let i = 0; i < n; i++) {
    const c = candles[i];

    // ---- TOP detection ----
    // A new candidate high starts a potential box when price makes a higher high
    // than the current active box top (or any pending top).
    const refTop = pendingTop?.value ?? activeBox?.top ?? -Infinity;
    if (c.high > refTop) {
      pendingTop = { value: c.high, idx: i };
      pendingBottom = null;
    }

    // Confirm pending top after `confirm` completed candles with no higher high
    if (pendingTop && i >= pendingTop.idx + confirm) {
      let violated = false;
      for (let j = pendingTop.idx + 1; j <= i; j++) {
        if (candles[j].high > pendingTop.value) { violated = true; break; }
      }
      if (!violated) {
        // Top confirmed. Start looking for bottom from the bars after top formation.
        activeBox = {
          top: pendingTop.value,
          topDate: candles[pendingTop.idx].date,
          topIdx: pendingTop.idx,
          bottom: null,
          bottomDate: null,
          status: 'FORMING',
        };
        pendingTop = null;
      } else {
        pendingTop = null; // candidate rejected
      }
    }

    // ---- BOTTOM detection (only after active box top confirmed) ----
    if (activeBox && activeBox.bottom == null) {
      // candidate low = lowest low since the box top
      let candLow = Infinity, candIdx = -1;
      for (let j = activeBox.topIdx; j <= i; j++) {
        if (candles[j].low < candLow) { candLow = candles[j].low; candIdx = j; }
      }
      if (candLow < Infinity) {
        if (!pendingBottom || candLow < pendingBottom.value) {
          pendingBottom = { value: candLow, idx: candIdx };
        }
        // Confirm after `confirm` completed candles with no lower low
        if (i >= pendingBottom.idx + confirm) {
          let violated = false;
          for (let j = pendingBottom.idx + 1; j <= i; j++) {
            if (candles[j].low <= pendingBottom.value) { violated = true; break; }
          }
          if (!violated) {
            const heightPct = (activeBox.top - pendingBottom.value) / activeBox.top * 100;
            if (heightPct <= maxBoxHeightPct) {
              activeBox.bottom = pendingBottom.value;
              activeBox.bottomDate = candles[pendingBottom.idx].date;
              activeBox.height = activeBox.top - activeBox.bottom;
              activeBox.heightPct = heightPct;
              activeBox.status = 'CONFIRMED';
              activeBox.confirmDate = c.date;
              boxes.push({ ...activeBox });
            } else {
              // Box too wide — discard, wait for a new candidate high
              activeBox = null;
            }
            pendingBottom = null;
          } else {
            pendingBottom = null;
          }
        }
      }
    }

    // ---- ENTRY signal ----
    if (activeBox && activeBox.status === 'CONFIRMED' && !position) {
      const avgVol = avg(candles.slice(Math.max(0, i - 20), i).map(x => x.volume));
      const volOk = avgVol > 0 && c.volume >= volMult * avgVol;
      const closeAbove = c.close > activeBox.top;
      if (closeAbove && volOk) {
        const initialSL = buffer(activeBox.bottom);
        const riskPct = (c.close - initialSL) / c.close * 100;
        if (riskPct <= 12) { // skip excessively risky setups
          position = { entry: c.close, date: c.date, initialSL, box: { ...activeBox } };
          trailingSL = initialSL;
          signals.push({
            type: 'BUY', date: c.date, price: c.close,
            boxTop: activeBox.top, boxBottom: activeBox.bottom,
            volumeRatio: avgVol ? c.volume / avgVol : null,
            initialSL, riskPct,
          });
        }
      }
    }

    // ---- TRAILING stop: only after a new HIGHER confirmed box ----
    if (position && activeBox && activeBox.status === 'CONFIRMED') {
      if (activeBox.bottom != null && activeBox.top > position.box.top) {
        const newSL = buffer(activeBox.bottom);
        if (newSL > trailingSL) {
          trailingSL = newSL;
          signals.push({
            type: 'RAISE_SL', date: c.date, newSL,
            protectedProfit: newSL - position.entry,
            box: { ...activeBox },
          });
        }
      }
    }

    // ---- EXIT signal ----
    if (position && trailingSL != null && c.low <= trailingSL) {
      signals.push({
        type: 'EXIT', date: c.date, price: trailingSL,
        entry: position.entry, pnlPerShare: trailingSL - position.entry,
        reason: 'Stop triggered',
      });
      position = null;
      // keep activeBox/boxes but wait for fresh setup
    }
  }

  return { boxes, signals, activeBox, trailingSL, position };
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

module.exports = { detectBoxes, CONFIRM_BARS };
