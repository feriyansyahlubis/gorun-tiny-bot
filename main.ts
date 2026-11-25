// gorun-tiny-bot — "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana"
// (make.fun competition u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
//
// Strategy: oversold-dip mean reversion, one position per symbol, fully
// deterministic (pure functions of the closes seen so far; no clock, no env,
// no randomness).
//
//   BUY  20% of equity when RSI(14) <= 30 (a sharp hourly sell-off), or when
//        RSI(14) <= 35 while the close sits >= 4% below its 48-hour SMA
//        (a deep dip that has not quite reached RSI 30).
//   SELL the whole position when RSI(14) >= 50 (the bounce has run its
//        course), or at -4% (stop-loss), or at +6% (take-profit).
//
// Why this shape: the dev window falls ~9% across the board, so buy-and-hold
// loses ~$869; a bot that only buys genuinely oversold hours and exits on
// the first recovery stays mostly in cash, keeps drawdown near 1.5%, and
// banks the bounces. Trend-following legs were tested and rejected: they
// churn through fees in choppy hours and lose money on both the dev window
// and its mirror image. The rules use round, untuned levels (30/35/50,
// 4%/6%, 20% size) so they describe a general behaviour, not a fit to one
// window's lucky bars.

import { runBars } from './vendor/makefun-bars.ts';

// --- indicators (pure functions of the close history) -----------------------

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    if (i <= period) {
      gain += g;
      loss += l;
      if (i === period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

// --- strategy parameters ----------------------------------------------------

const RSI_PERIOD = 14;
const RSI_BUY = 30; // sharp oversold
const RSI_DIP = 35; // deep-dip second trigger
const DIP_BELOW_SMA48_PCT = 0.04;
const SMA_PERIOD = 48;
const RSI_SELL = 50; // bounce exhausted
const STOP_PCT = 0.04; // stop-loss vs entry
const TAKE_PROFIT_PCT = 0.06;
const SIZE_BPS = 2000; // 20% of equity per new position
const MAX_SLIPPAGE_BPS = 1000; // 10%: accept fills after an hourly gap, still bounded
const MIN_NOTIONAL = 1_000_000n; // 1 USDC, the harness minimum

// --- bot --------------------------------------------------------------------

const closes = new Map<string, number[]>();

await runBars({
  onBatch(state) {
    // Record this batch's closes (one per symbol, in hello order).
    for (const symbol of state.symbols.keys()) {
      const c = state.close(symbol);
      if (c === null) continue;
      const scale = state.symbols.get(symbol)!;
      const price = Number(c) / 10 ** scale.price_scale;
      let hist = closes.get(symbol);
      if (hist === undefined) {
        hist = [];
        closes.set(symbol, hist);
      }
      hist.push(price);
    }
    if (state.warmingUp) return [];

    type Buy = { side: 'buy'; symbol: string; notional_quote_units: bigint; max_slippage_bps: number };
    type Sell = { side: 'sell'; symbol: string; qty: bigint; max_slippage_bps: number };
    const orders: (Buy | Sell)[] = [];
    let cashLeft = state.cash; // buys in one reply share this cash; sells never fund them

    for (const symbol of state.symbols.keys()) {
      const hist = closes.get(symbol);
      if (hist === undefined || hist.length < RSI_PERIOD + 2) continue;
      const price = hist[hist.length - 1]!;
      const r = rsi(hist, RSI_PERIOD);
      const rsiNow = r[r.length - 1];
      if (rsiNow === null) continue;

      const held = state.positions.get(symbol);
      if (held !== undefined && held.qty > 0n) {
        // Entry price in USDC per unit, fees included, from the position's
        // own cost basis. cost is in quote raw units (10^quote_scale per
        // USDC) and qty in raw units (10^qty_scale per unit), so the
        // scales must be converted — a plain cost/qty is off by
        // 10^(qty_scale - quote_scale) and would fake a huge gain.
        const sym = state.symbols.get(symbol)!;
        const entry =
          (Number(held.cost) * 10 ** sym.qty_scale) /
          (Number(held.qty) * 10 ** state.hello.capital.quote_scale);
        const change = price / entry - 1;
        if (rsiNow >= RSI_SELL || change <= -STOP_PCT || change >= TAKE_PROFIT_PCT) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
        continue;
      }

      // Not holding: look for an oversold entry.
      let buy = rsiNow <= RSI_BUY;
      if (!buy && rsiNow <= RSI_DIP && hist.length >= SMA_PERIOD + 1) {
        const avg = sma(hist, SMA_PERIOD)[hist.length - 1];
        if (avg !== null && price <= avg * (1 - DIP_BELOW_SMA48_PCT)) buy = true;
      }
      if (!buy) continue;

      // Size: 20% of equity, inside the 25% weight cap and the cash left.
      const target = (state.equity * BigInt(SIZE_BPS)) / 10_000n;
      const room = state.weightRoom(symbol);
      let notional = target < room ? target : room;
      const cashCap = (cashLeft * 9n) / 10n;
      if (notional > cashCap) notional = cashCap;
      if (notional < MIN_NOTIONAL) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cashLeft -= notional;
    }
    return orders;
  },
});
