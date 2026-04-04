---
name: hodlmm-rebalancer
description: "Write-capable HODLMM Auto-Rebalancer that detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "Risk Sentinel"
  user-invocable: "false"
  arguments: "doctor | run | install-packs"
  entry: "hodlmm-rebalancer/hodlmm-rebalancer.ts"
  requires: "wallet, signing, settings"
  tags: "defi, write, mainnet-only, requires-funds"
---

# HODLMM Auto-Rebalancer

## What it does
Detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement. Runs a three-step pipeline: assess drift, plan rebalance, execute via MCP tool commands.

## Why agents need it
Concentrated liquidity positions drift out of range as price moves. Without rebalancing, positions earn zero fees. This skill automates the detection and rebalancing process so agents can maintain optimal liquidity positions without manual intervention.

## Safety notes
- This skill WRITES to chain via MCP tool commands (bitflow_hodlmm_remove_liquidity, bitflow_hodlmm_add_liquidity)
- Moves funds: withdraws from stale bins and deposits into target bins
- Mainnet only
- Blocked in crisis volatility regime (score > 60) unless --force is used
- 30-minute cooldown between rebalances per pool/address (file-based persistence)
- Configurable max sBTC sats (default 500K) and max STX (default 100) spending limits
- Requires explicit --confirm flag to execute - no accidental fires
- Profitability check blocks unprofitable rebalances

## Commands

### doctor
Checks environment, dependencies, wallet readiness, and cooldown persistence. Safe to run anytime.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts doctor
```

### install-packs
Lists required and optional packages.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts install-packs
```

### run --action=assess
Read-only position drift check.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=assess --pool-id=dlmm_3
```

### run --action=plan
Computes rebalance plan with profitability estimate.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=plan --pool-id=dlmm_3
```

### run --action=execute
Outputs MCP tool commands for on-chain execution.
```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=execute --pool-id=dlmm_3 --confirm
```

## Output contract
All outputs are JSON to stdout using the BFF extended format:

**Success:**
```json
{ "status": "success", "action": "...", "data": {}, "error": null }
```

**Error:**
```json
{ "status": "error", "action": "...", "data": {}, "error": { "code": "...", "message": "...", "next": "..." } }
```

**Blocked:**
```json
{ "status": "blocked", "action": "...", "data": {}, "error": { "code": "crisis_regime", "message": "...", "next": "..." } }
```

## Known constraints
- Requires STACKS_ADDRESS or STX_ADDRESS environment variable
- Requires MCP tools: bitflow_hodlmm_add_liquidity, bitflow_hodlmm_remove_liquidity
- Gas estimation is approximate (~0.01 STX per bin operation)
- Mainnet only - will not work on testnet
- Wallet must have STX for gas and position in the specified HODLMM pool
