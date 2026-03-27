---
name: hodlmm-rebalancer
description: "Detects out-of-range HODLMM positions and computes optimal bin placement for rebalancing. Monitors drift from active bin, classifies volatility regime, builds withdraw/re-deposit plans with gas estimation, and executes rebalance via MCP tools. Write operations require wallet and signing."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "LocalLaunch Agent"
  user-invocable: "true"
  arguments: "doctor | run --action=assess | run --action=plan | run --action=execute"
  entry: "hodlmm-rebalancer/hodlmm-rebalancer.ts"
  requires: "wallet, signing"
  tags: "defi, write, mainnet-only, l2, requires-funds"
---

# HODLMM Auto-Rebalancer

## What it does

Monitors a wallet's HODLMM concentrated liquidity positions on Bitflow, detects when bins have drifted out of the active trading range, and computes an optimal rebalance plan. The skill analyzes current pool state, calculates new bin distribution centered on the active bin, estimates gas costs, and outputs MCP commands to withdraw stale liquidity and re-deposit into optimal bins.

This is the write-capable counterpart to `hodlmm-risk` — while the risk skill reads and classifies, this skill acts on what it reads.

## Why agents need it

Concentrated liquidity positions on HODLMM (DLMM) pools drift out of range as the active bin moves. Out-of-range bins earn zero fees and create impermanent loss exposure. Manual rebalancing requires monitoring bin state, computing target distributions, estimating gas, and executing multi-step transactions. This skill automates the entire pipeline with safety guardrails.

## Safety notes

- Write operations (execute) move funds and are irreversible once confirmed on-chain.
- Mainnet only — Bitflow HODLMM is mainnet-only.
- Wallet with STX for gas required for write operations.
- Read operations (doctor, assess, plan) are safe and require no wallet signing.
- Crisis regime block: rebalance is blocked when volatility score > 60 unless `--force` is used.
- Cooldown: 30-minute minimum between rebalances per pool/address pair.
- Spending limits: configurable `--max-sbtc` and `--max-stx` caps.
- Confirmation gate: execute requires explicit `--confirm` flag.

## Commands

### doctor

Checks wallet balance, Bitflow HODLMM API reachability, and MCP tool availability.

```bash
bun run hodlmm-rebalancer/hodlmm-rebalancer.ts doctor
```

Output:
```json
{
  "status": "ready",
  "checks": {
    "stx_balance": { "ok": true, "detail": "1250000 uSTX" },
    "sbtc_balance": { "ok": true, "detail": "50000 sats" },
    "bitflow_hodlmm_api": { "ok": true, "detail": "HODLMM API reachable" },
    "mcp_tools": { "ok": true, "detail": "Requires MCP: bitflow_hodlmm_add_liquidity, bitflow_hodlmm_remove_liquidity" }
  },
  "address": "SP...",
  "network": "mainnet",
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

### run --action=assess

Assesses position drift and determines if rebalancing is needed.

```bash
bun run hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=assess --pool-id=dlmm_3
```

Options:
- `--pool-id` (required) — HODLMM pool identifier
- `--address` (optional) — Stacks address to check (defaults to STACKS_ADDRESS env var)

Output:
```json
{
  "network": "mainnet",
  "poolId": "dlmm_3",
  "address": "SP...",
  "activeBinId": 8388608,
  "positionBinCount": 11,
  "driftScore": 35,
  "outOfRangePct": 45.5,
  "staleBinCount": 5,
  "inRangeBinCount": 6,
  "volatilityScore": 28,
  "regime": "calm",
  "shouldRebalance": true,
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

### run --action=plan

Computes an optimal rebalance plan with gas estimation and profitability check.

```bash
bun run hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=plan --pool-id=dlmm_3
```

Options:
- `--pool-id` (required) — HODLMM pool identifier
- `--address` (optional) — Stacks address
- `--bin-width` (optional) — Number of bins on each side of active bin (default: 5)
- `--force` (optional) — Override crisis regime block

Output:
```json
{
  "network": "mainnet",
  "poolId": "dlmm_3",
  "activeBinId": 8388608,
  "binWidth": 5,
  "volatilityScore": 28,
  "regime": "calm",
  "staleBinCount": 5,
  "targetBinCount": 11,
  "totalWithdrawX": 25000,
  "totalWithdrawY": 180000,
  "estimatedGasUstx": 160000,
  "estimatedGasStx": 0.16,
  "projectedDailyFeeBps": 5,
  "profitable": true,
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

### run --action=execute

Executes the rebalance plan via MCP tools. Requires `--confirm` flag.

```bash
bun run hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=execute --pool-id=dlmm_3 --confirm=true
```

Options:
- `--pool-id` (required) — HODLMM pool identifier
- `--address` (optional) — Stacks address
- `--bin-width` (optional) — Bin width (default: 5)
- `--confirm` (required) — Must be "true" to execute
- `--force` (optional) — Override crisis regime block
- `--max-sbtc` (optional) — Max sBTC sats to move (default: 500000)
- `--max-stx` (optional) — Max STX to move (default: 100)

Output:
```json
{
  "operation": "rebalance",
  "network": "mainnet",
  "poolId": "dlmm_3",
  "activeBinId": 8388608,
  "binWidth": 5,
  "volatilityScore": 28,
  "regime": "calm",
  "mcp_commands": [
    {
      "step": 1,
      "tool": "bitflow_hodlmm_remove_liquidity",
      "params": { "poolId": "dlmm_3", "binIds": [8388600, 8388601, 8388602], "slippagePct": 2 }
    },
    {
      "step": 2,
      "tool": "bitflow_hodlmm_add_liquidity",
      "params": { "poolId": "dlmm_3", "bins": [{"bin_id": 8388603, "amount_x": 2272, "amount_y": 16363}], "slippagePct": 2 }
    }
  ],
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

## Output contract

All outputs are flat JSON to stdout.

**Error:**
```json
{ "error": "descriptive message" }
```

## Known constraints

- Mainnet only — Bitflow HODLMM does not exist on testnet.
- Requires MCP tools (`bitflow_hodlmm_add_liquidity`, `bitflow_hodlmm_remove_liquidity`) for actual on-chain execution.
- Cooldown enforced: 30-minute minimum between rebalances per pool/address pair.
- Crisis regime (volatility score > 60) blocks rebalance unless `--force` is used.
- Position must exceed 10,000 sats minimum to justify gas costs.
- Gas estimation is approximate: ~0.01 STX per bin operation.
- Fee projection (5 bps/day) is a rough estimate based on typical HODLMM pool activity.
- Drift score formula: `Math.min(avgBinOffset * 5, 100)` — each bin of drift = +5 points, capped at 100.
- Rebalance threshold: drift score >= 15 AND > 20% of bins out of range.
