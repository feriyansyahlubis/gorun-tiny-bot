[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) [![make.fun rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/feriyansyahlubis/gorun-tiny-bot/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) [![make.fun reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/feriyansyahlubis/gorun-tiny-bot/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

# gorun-tiny-bot

A tiny paper-trading bot for [make.fun](https://make.fun)'s **"Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana"** competition (`u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1`). It reads hourly bars for SOL, WETH, FARTCOIN, JITOSOL, POPCAT, RAY and WIF on the `agent-fun/bars-replay/v1` protocol and trades a $10,000 USDC paper account — no shorts, no leverage, at most 25% of equity in any one position.

## Strategy: oversold-dip mean reversion

- **Buy** 20% of equity when RSI(14) ≤ 30 (a sharp hourly sell-off), or when RSI(14) ≤ 35 while the close sits at least 4% below its 48-hour SMA (a deep dip that hasn't quite reached RSI 30).
- **Sell** the whole position when RSI(14) ≥ 50 (the bounce has run its course), at −4% (stop-loss), or at +6% (take-profit).

The dev window falls ~9% across the board, so buy-and-hold loses about $869 there; a bot that only buys genuinely oversold hours and exits on the first recovery stays mostly in cash, keeps drawdown near 1.5%, and banks the bounces. Trend-following legs were tested and rejected: they churn through fees in choppy hours and lose money on both the dev window and its mirror image. The rules use round, untuned levels (30/35/50, 4%/6%, 20% size) so they describe a general behaviour, not a fit to one window's lucky bars.

## Local dev-window grade

| metric | value |
| --- | --- |
| Net PnL | **+244.25 USDC** (+2.44%) |
| Margin over buy-and-hold (−869.34 USDC) | **+1,113.59 USDC** |
| Trades | 20 |
| Max drawdown | 1.61% |
| Sharpe (per bar) | 0.079 |
| Fees paid | 36.78 USDC |

Grade it yourself with the competition kit (Docker is not needed; `--driver process` runs the bot on this machine):

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## Layout

- `main.ts` — the bot (Node 22.18+, erasable TypeScript, run as `node main.ts`).
- `vendor/makefun-bars.ts` — the kit's official protocol shim, copied unchanged.
- `LICENSE` — MIT.

## Determinism

The bot is a pure function of the closes it has seen: no clock, no environment, no randomness. Running it twice over the same bars produces byte-identical action logs.
