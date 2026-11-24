const { detectBoxes } = require('./lib/box-detector');

// Worked example from the guide: box top 500 confirmed, bottom 474, breakout at 504.
const candles = [];
let d = 1;
const add = (high, low, close, vol = 1000) => candles.push({ date: '2026-01-' + String(d++).padStart(2, '0'), high, low, close, volume: vol });

// Pre-box
add(480, 465, 470);
add(490, 472, 485);
add(495, 480, 490);
// Day 4: new high 500
add(500, 485, 497);
// Days 5-7: lower highs confirm top 500
add(498, 482, 490);
add(497, 480, 488);
add(496, 478, 485);
// Days 8-10: lows; candidate low 474 on day 9
add(495, 475, 480);
add(493, 474, 478);
add(494, 476, 480);
// Days 11-13: higher lows confirm bottom 474
add(496, 478, 490);
add(498, 480, 492);
add(499, 482, 497);
// Day 14: breakout close 504 on high volume
add(506, 498, 504, 2000);

const r = detectBoxes(candles, { bufferPct: 0.4 });
console.log('BOXES:', JSON.stringify(r.boxes, null, 2));
console.log('SIGNALS:', JSON.stringify(r.signals, null, 2));
