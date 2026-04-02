---
name: hodlmm-exit
description: "Autonomous HODLMM LP emergency exit — monitors volatility regime and withdraws LP position when crisis threshold is breached. Pairs with hodlmm-risk for full assess-then-act coverage. Write-capable; requires unlocked wallet."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "Unified Sphinx"
  user-invocable: "false"
  arguments: "assess | execute | monitor"
  entry: "hodlmm-exit/hodlmm-exit.ts"
  requires: "hodlmm-risk"
  tags: "l2, defi, mainnet-only, write"
---

# HODLMM Exit Skill

## What it does

Monitors HODLMM pool volatility and withdraws LP position autonomously when the crisis threshold is breached. The action layer that completes `hodlmm-risk`: detect crisis, then exit.

Uses the same bin-spread / reserve-imbalance / concentration scoring as `hodlmm-risk` to evaluate regime, then constructs and broadcasts a withdrawal transaction when score ≥ threshold.

## Why agents need it

`hodlmm-risk` tells you the pool is in crisis. `hodlmm-exit` does something about it. Without an action layer, risk detection is advisory. This skill closes the loop — assess regime, protect capital, return funds to wallet.

## Safety notes

- `assess` is fully read-only — no wallet required.
- `execute` and `monitor` require `STACKS_PRIVATE_KEY` env var.
- All withdrawal transactions use `PostConditionMode.Deny` with explicit post conditions.
- Conservative fail-safe: Bitflow API unreachable = treat as crisis (score 100) — always alerts before executing.
- Rejects pools with zero liquidity or no user position rather than silently no-oping.
- Mainnet only — Bitflow HODLMM APIs are mainnet-only.

## Commands

### assess
Dry run — evaluates current regime and position without executing any transaction.
```
bun run hodlmm-exit/hodlmm-exit.ts assess --pool-id <pool_id> --address <stx_address> [--threshold <0-100>]
```
Options:
- `--pool-id` (required) — HODLMM pool identifier (e.g. `dlmm_3`)
- `--address` (required) — Stacks address to check
- `--threshold` (optional, default `61`) — volatility score at which exit triggers

Output:
```json
{
  "network": "mainnet",
  "poolId": "dlmm_3",
  "address": "SP2...",
  "would_trigger": false,
  "regime": "elevated",
  "regime_score": 58,
  "threshold": 61,
  "safe_to_add": false,
  "position_value_sats": 420000,
  "bins_in_range": 2,
  "total_bins": 5,
  "timestamp": "2026-03-31T21:00:00.000Z"
}
```

### execute
Immediately withdraws the full LP position regardless of current regime score.
```
bun run hodlmm-exit/hodlmm-exit.ts execute --pool-id <pool_id> --address <stx_address>
```
Options:
- `--pool-id` (required) — HODLMM pool identifier
- `--address` (required) — Stacks address to withdraw from

Output:
```json
{
  "network": "mainnet",
  "poolId": "dlmm_3",
  "triggered": true,
  "regime": "crisis",
  "regime_score": 74,
  "tx_id": "0xabc123...",
  "sats_returned": 420000,
  "bins_removed": 5,
  "timestamp": "2026-03-31T21:05:00.000Z"
}
```

### monitor
Polls regime on interval. Triggers withdrawal automatically when score ≥ threshold.
```
bun run hodlmm-exit/hodlmm-exit.ts monitor --pool-id <pool_id> --address <stx_address> [--threshold <0-100>] [--interval-seconds <n>]
```
Options:
- `--pool-id` (required) — HODLMM pool identifier
- `--address` (required) — Stacks address to monitor
- `--threshold` (optional, default `61`) — trigger threshold
- `--interval-seconds` (optional, default `60`) — poll interval

Output (each poll cycle):
```json
{
  "timestamp": "2026-03-31T21:00:00.000Z",
  "triggered": false,
  "regime_score": 58,
  "threshold": 61
}
```
On trigger:
```json
{
  "timestamp": "2026-03-31T21:06:00.000Z",
  "triggered": true,
  "regime_score": 74,
  "threshold": 61,
  "tx_id": "0xabc123...",
  "sats_returned": 420000,
  "bins_removed": 5
}
```

## Output contract

All outputs are flat JSON to stdout. On error:
```json
{ "error": "descriptive error message" }
```
Non-zero exit code on error.

## Known constraints

- Mainnet only.
- `assess` requires no wallet; `execute` and `monitor` require `STACKS_PRIVATE_KEY` env var.
- Volatility score ranges 0-100: 0-30 = calm, 31-60 = elevated, 61-100 = crisis.
- Score weights: bin spread (40%), reserve imbalance (30%), liquidity concentration (30%) — identical to `hodlmm-risk`.
- Default crisis threshold: 61. Adjustable via `--threshold`.
- Exits after successful withdrawal in monitor mode — does not re-poll.
- If position shares are zero, aborts with error rather than broadcasting a zero-value transaction.
- Fee: 25,000 microSTX per withdrawal transaction.
