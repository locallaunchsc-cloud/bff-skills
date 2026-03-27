---
name: yield-compass
description: "Cross-protocol yield compass — compares real-time APY across Bitflow HODLMM pools, Zest Protocol lending, and Stacks stacking to recommend optimal sBTC/STX allocation. Factors in HODLMM risk regime. Read-only; no wallet required."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "Yield Navigator"
  user-invocable: "false"
  arguments: "compare-yields | best-allocation | protocol-snapshot"
  entry: "yield-compass/yield-compass.ts"
  requires: ""
  tags: "l2, defi, read-only, mainnet-only, hodlmm"
---

# Yield Compass

## What it does
Compares yield opportunities across three Stacks DeFi protocols in real time:
1. **Bitflow HODLMM** — LP fee yield from concentrated liquidity pools
2. **Zest Protocol** — sBTC lending supply APY
3. **Stacks Stacking** — STX stacking rewards

Returns a ranked list of yield sources with estimated APY and a recommended allocation split based on current risk regime (using hodlmm-risk volatility scoring).

## Why agents need it
Agents holding idle sBTC or STX need to decide where capital works hardest. Today each protocol is a silo — an agent must call separate skills to check each. This skill does the comparison in one call, factors in risk regime from hodlmm-risk, and emits an allocation recommendation that downstream agents can execute.

## Safety notes
- Read-only — never writes to chain or moves funds.
- Mainnet only — Bitflow HODLMM and Zest APIs are mainnet-only.
- No wallet or funds required.
- APY estimates are point-in-time snapshots, not guaranteed returns.
- Allocation recommendations are informational signals, not financial advice.
- Pools with zero liquidity are excluded from comparison.

## Commands

### compare-yields
Compare current yield across all supported protocols.
```
bun run yield-compass/yield-compass.ts compare-yields
```

Options:
- `--pool-ids` (optional) — Comma-separated HODLMM pool IDs to check (default: all active pools)

Output:
```json
{
  "network": "mainnet",
  "yields": [
    {
      "protocol": "bitflow-hodlmm",
      "poolId": "dlmm_3",
      "pair": "sBTC/STX",
      "estimatedApyPct": 12.4,
      "riskRegime": "calm",
      "volatilityScore": 22,
      "source": "lp-fees"
    },
    {
      "protocol": "zest",
      "asset": "sBTC",
      "estimatedApyPct": 3.8,
      "utilizationPct": 72.5,
      "source": "lending-interest"
    },
    {
      "protocol": "stacking",
      "asset": "STX",
      "estimatedApyPct": 8.2,
      "cycleLength": 2100,
      "currentCycle": 94,
      "source": "consensus-rewards"
    }
  ],
  "bestYield": {
    "protocol": "bitflow-hodlmm",
    "estimatedApyPct": 12.4
  },
  "timestamp": "2026-03-27T20:00:00.000Z"
}
```

### best-allocation
Recommend an allocation split based on yield and risk.
```
bun run yield-compass/yield-compass.ts best-allocation --amount-sbtc <sats> --amount-stx <ustx>
```

Options:
- `--amount-sbtc` (optional) — sBTC amount in sats to allocate
- `--amount-stx` (optional) — STX amount in microSTX to allocate
- `--risk-tolerance` (optional) — "conservative" | "balanced" | "aggressive" (default: balanced)

Output:
```json
{
  "network": "mainnet",
  "riskTolerance": "balanced",
  "allocation": {
    "sbtc": {
      "total_sats": 500000,
      "hodlmm_pct": 40,
      "hodlmm_sats": 200000,
      "hodlmm_pool": "dlmm_3",
      "zest_pct": 35,
      "zest_sats": 175000,
      "idle_pct": 25,
      "idle_sats": 125000
    },
    "stx": {
      "total_ustx": 10000000,
      "stacking_pct": 60,
      "stacking_ustx": 6000000,
      "hodlmm_pct": 25,
      "hodlmm_ustx": 2500000,
      "idle_pct": 15,
      "idle_ustx": 1500000
    }
  },
  "reasoning": "HODLMM regime is calm (score 22) — safe for LP exposure. Zest utilization at 72% suggests stable lending demand. Stacking offers reliable baseline yield.",
  "timestamp": "2026-03-27T20:00:00.000Z"
}
```

### protocol-snapshot
Get a quick snapshot of a single protocol's yield.
```
bun run yield-compass/yield-compass.ts protocol-snapshot --protocol <name>
```

Options:
- `--protocol` (required) — "hodlmm" | "zest" | "stacking"
- `--pool-id` (optional) — Required for hodlmm, ignored for others

Output:
```json
{
  "network": "mainnet",
  "protocol": "hodlmm",
  "poolId": "dlmm_3",
  "estimatedApyPct": 12.4,
  "riskRegime": "calm",
  "volatilityScore": 22,
  "details": {
    "feeRate": 0.003,
    "volume24h": 45000,
    "tvl": 890000
  },
  "timestamp": "2026-03-27T20:00:00.000Z"
}
```

## Output contract
All outputs are flat JSON to stdout (no wrapper envelope).
On error:
```json
{ "error": "descriptive error message" }
```

## Known constraints
- Mainnet only — Bitflow HODLMM and Zest APIs do not exist on testnet.
- No wallet required — all operations are read-only.
- HODLMM APY is estimated from pool fee rate and 24h volume relative to TVL. Actual returns depend on position range and rebalancing.
- Zest APY is derived from current supply rate and utilization.
- Stacking APY uses the most recent completed cycle reward rate.
- Allocation recommendations assume the agent can execute deposits across all protocols. If a protocol is unavailable, the allocation redistributes.
- Risk regime from hodlmm-risk is factored into allocation: crisis regime sets HODLMM allocation to 0%.
- This skill composes with hodlmm-risk — it reuses the same volatility scoring and regime classification internally.
