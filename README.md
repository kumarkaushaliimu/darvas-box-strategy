# Darvas Box Strategy

A rule-based NIFTY universe scanner implementing the classical **Darvas Box** breakout method, with chronological (no look-ahead) box detection, volume-confirmed entries, trailing stops, position sizing, and a self-contained web dashboard.

## Live dashboard
After deployment: `https://kumarkaushaliimu.github.io/darvas-box-strategy/`

## Core rules (from the reference guide)
1. **Box top:** a candidate high is confirmed only after 3 completed sessions with no higher high.
2. **Box bottom:** found *after* top confirmation; confirmed after 3 sessions with no lower low. Top and bottom are confirmed at different times — no look-ahead bias.
3. **Entry:** daily close above the confirmed box top **and** volume ≥ 1.5× the 20-day average. Prefer above 50 & 200 DMA and near 52-week highs.
4. **Initial stop:** box bottom − 0.4% buffer. Skip if box height > 15% or risk > 12%.
5. **Trailing stop:** only after a new **higher** box confirms its bottom. Never lower the stop.
6. **Exit:** when the stop is hit. No averaging down, no widening stops.
7. **Position sizing:** Quantity = (capital × risk%) / (entry − stop). Default 1% of capital.

## Files
| File | Purpose |
|---|---|
| `lib/box-detector.js` | Chronological box detection + signal engine (core logic) |
| `fetch-darvas.js` | Fetches NIFTY universe OHLCV from Yahoo Finance, runs detector, applies filters → `darvas.json` |
| `template.html` | Dashboard template |
| `build.js` | Injects `darvas.json` into template → `index.html` |
| `index.html` | Generated self-contained dashboard |
| `test.js` | Unit test against the reference guide's worked example |

## Run locally
```bash
npm install           # no runtime deps for the engine; uses Node 18+ global fetch
node test.js                               # verify detector on worked example
node fetch-darvas.js --index=250           # full universe scan → darvas.json
node build.js                              # → index.html
```

## Dashboard features
- KPIs: universe, active breakouts, confirmed boxes, trailing stops raised, trend-aligned stocks
- Position-sizing calculator (capital, risk%, entry, stop → qty, investment, risk)
- Sortable, searchable, sector-filterable table with box top/bottom, stop, target, risk%, upside, RS
- Filters: active breakouts, box ready, trend aligned, recent signals
- Expandable rows showing the full signal timeline (BUY → RAISE_SL → EXIT) and trade parameters
- CSV export

## Parameters (starting values, to be backtested)
Confirm 3 sessions · volume 1.5× · buffer 0.4% · max box height 15% · max risk 12% · 1% capital risk · no profit target · pyramiding disabled.

## Backtest roadmap (independent tests)
A pure Darvas · B +volume · C +50/200 DMA · D +relative strength · E +ATR buffer · F +ghost-box trailing · G +controlled pyramiding. Compare net P&L, max drawdown, profit factor, win rate, expectancy, MFE/MAE, trade count and regime performance using survivorship-bias-free data and realistic costs/slippage/gaps.

**Disclaimer:** Research and education only — not investment advice. Signals are derived from delayed daily data and are not guaranteed.
