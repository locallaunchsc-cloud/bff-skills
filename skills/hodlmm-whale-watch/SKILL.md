---
name: hodlmm-whale-watch
description: "Monitors HODLMM pool LP positions for whale activity. Detects large entries, exits, and position size changes to surface smart-money signals for deposit and withdrawal timing."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "Unified Sphinx"
  user-invocable: "false"
  tags: "hodlmm, whale, lp, signal, monitoring"
  requires: "commander"
  entry: "hodlmm-whale-watch/hodlmm-whale-watch.ts"
  args: "scan | watch"
---

# HODLMM Whale Watch Skill

## What it does

Scans HODLMM pool LP holder rankings and detects large position changes (whale entries, exits, increases, decreases). Outputs smart-money concentration metrics and actionable signals to help agents decide when to enter or exit liquidity positions.

## Commands

### `scan`

One-shot snapshot of the top N LP holders in a HODLMM pool. Returns ranked holder list, whale count, concentration percentage, and a `CONCENTRATED` or `DISTRIBUTED` smart-money signal.

```bash
bun hodlmm-whale-watch.ts scan --pool-id dlmm_3 --top-n 10 --threshold 1000000
```

**Sample output (no whales):**
```json
{
  "pool_id": "dlmm_3",
  "token_x": "sBTC",
  "token_y": "STX",
  "active_bin": 8388608,
  "whale_count": 0,
  "whale_concentration_pct": 0,
  "smart_money_signal": "DISTRIBUTED",
  "top_holders": [],
  "whale_alerts": [],
  "timestamp": "2026-04-01T00:00:00.000Z"
}
```

### `watch`

Polls a pool on a configurable interval and emits alerts whenever whale position changes cross the threshold. Runs continuously until killed.

```bash
bun hodlmm-whale-watch.ts watch --pool-id dlmm_3 --threshold 1000000 --interval-seconds 120
```

## Output contract

All outputs are flat JSON to stdout. On error:
```json
{ "error": "descriptive error message" }
```

## Signal types

| Signal | Meaning |
|---|---|
| `WHALE_ENTRY` | New address above threshold appeared |
| `WHALE_EXIT` | Address dropped below threshold |
| `WHALE_INCREASE` | Position grew >20% |
| `WHALE_DECREASE` | Position shrank >20% |

## Known constraints

- Mainnet only - Bitflow HODLMM and BFF APIs do not exist on testnet.
- No wallet required - all operations are read-only.
- Whale threshold is configurable; default 1,000,000 sats.
- Watch mode compares current snapshot to previous cycle; first cycle has no deltas.
