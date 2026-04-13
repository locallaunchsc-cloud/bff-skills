---
name: yield-compass
description: "Compares real-time APY across Bitflow HODLMM pools, Zest Protocol sBTC lending, and Stacks PoX stacking to surface the highest-yield allocation for idle sBTC and STX. Read-only, no wallet required."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "LocalLaunch Agent"
  user-invocable: "false"
  arguments: "doctor | compare-yields | best-allocation | protocol-snapshot"
  entry: "yield-compass/yield-compass.ts"
  requires: ""
  tags: "l2, defi, read-only, mainnet-only"
---

# Yield Compass

## What it does
Fetches live APY data from Bitflow HODLMM pools (via the official Bitflow app API), Zest Protocol sBTC lending (via on-chain read-only contract call to pool-borrow-v2-3), and Stacks PoX stacking (via Hiro /v2/pox). Ranks protocols by yield and outputs a recommended allocation split for new capital.

## Why agents need it
An agent managing idle sBTC or STX needs a single read-only command to know where yield is highest right now before committing to a supply, stake, or liquidity deposit.

## Safety notes
- Read-only. No wallet required. No transactions are submitted.
- Allocation output is a recommendation for new capital only. It does not instruct the agent to rebalance existing positions.
- Mainnet only. Zest contracts and Bitflow pools are mainnet-deployed.
- APY figures are point-in-time estimates. HODLMM pool APR fluctuates with fee activity.

## Commands

### doctor
Checks connectivity to all three data sources. Safe to run anytime.
```bash
bun run skills/yield-compass/yield-compass.ts doctor
```

### compare-yields
Fetches current APY from all three protocols and ranks them highest to lowest.
```bash
bun run skills/yield-compass/yield-compass.ts compare-yields
```

### best-allocation
Returns a recommended allocation split (percentages) for new capital based on current yields.
```bash
bun run skills/yield-compass/yield-compass.ts best-allocation
bun run skills/yield-compass/yield-compass.ts best-allocation --capital-usd 1000
```

### protocol-snapshot
Returns current yield data for a single protocol.
```bash
bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol hodlmm
bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol zest
bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol stacking
```

## Output contract
All outputs are JSON to stdout.

**Success:**
```json
{ "status": "success", "action": "...", "data": {}, "error": null }
```

**Error:**
```json
{ "status": "error", "action": "...", "data": {}, "error": { "code": "...", "message": "...", "next": "..." } }
```

## Known constraints
- Zest APY is derived from get-reserve-state on pool-borrow-v2-3 at SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N. If Zest upgrades contracts this address may need updating.
- Stacking APY is estimated from current PoX cycle stacked_ustx and reward_cycle_length. It is an approximation, not a guarantee.
- HODLMM APY uses apr24h (24-hour trailing APR) from the top pool by TVL.
- All three fetches use AbortSignal.timeout(10000) for a 10s timeout each.
