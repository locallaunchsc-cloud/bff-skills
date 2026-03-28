---
name: hodlmm-fee-harvester
description: "HODLMM fee harvester -- reads accrued trading fees from Bitflow HODLMM concentrated liquidity positions, computes claimable amounts per bin, and executes fee collection with safety guards. Write-capable; wallet required for harvesting."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "Fee Harvester Agent"
  user-invocable: "true"
  arguments: "doctor | scan-fees | harvest | history"
  entry: "hodlmm-fee-harvester/hodlmm-fee-harvester.ts"
  requires: "wallet, signing"
  tags: "l2, defi, write, mainnet-only, requires-funds"
---

# HODLMM Fee Harvester

## What it does
Scans Bitflow HODLMM concentrated liquidity positions for accrued but unclaimed trading fees. Computes per-bin fee breakdowns (tokenA and tokenB), estimates gas costs vs fee value, and executes fee collection when profitable. Supports batch harvesting across multiple pools.

## Why agents need it
HODLMM positions earn trading fees continuously but those fees sit unclaimed until explicitly collected. Without a harvester, agents leave value on the table. This skill completes the HODLMM management stack -- risk monitor detects danger, rebalancer fixes drift, and the fee harvester captures earned yield. Agents can schedule periodic harvesting or trigger collection when accrued fees exceed a threshold.

## Safety notes
- Write operations (harvest) move funds from pool to wallet and are irreversible once confirmed on-chain.
- Mainnet only -- Bitflow HODLMM APIs are mainnet-only.
- Wallet with STX for gas required for harvest operations.
- Read operations (scan-fees, history) are safe and require no wallet.
- Minimum harvest threshold: only collects when fee value exceeds gas cost by 2x (configurable via --min-ratio).
- Operator confirmation required before any harvest execution unless --confirm is passed.
- Never harvests during crisis regime (volatility score > 60) to avoid harvesting into adverse conditions.

## Commands

### doctor
Checks Bitflow API reachability, HODLMM pool availability, and wallet readiness. Safe to run anytime.
```
bun run hodlmm-fee-harvester/hodlmm-fee-harvester.ts doctor
```

Output:
```json
{
  "status": "ready",
  "checks": {
    "bitflowApi": "ok",
    "hodlmmPools": "ok",
    "wallet": "connected"
  },
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

### scan-fees
Scans one or all HODLMM positions for accrued unclaimed fees.
```
bun run hodlmm-fee-harvester/hodlmm-fee-harvester.ts scan-fees --pool-id <pool_id>
bun run hodlmm-fee-harvester/hodlmm-fee-harvester.ts scan-fees --all
```

Options:
- `--pool-id` -- specific HODLMM pool to scan
- `--all` -- scan all positions for the connected wallet
- `--address` -- override wallet address (read-only scan for any address)

Output:
```json
{
  "positions": [
    {
      "poolId": "dlmm_3",
      "tokenA": "sBTC",
      "tokenB": "STX",
      "accruedFeesA": "0.00012",
      "accruedFeesB": "45.2",
      "estimatedValueSats": 58000,
      "estimatedGasCostSats": 2500,
      "profitableToHarvest": true,
      "bins": 12
    }
  ],
  "totalValueSats": 58000,
  "totalGasCostSats": 2500,
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

### harvest
Collects accrued fees from one or all profitable positions.
```
bun run hodlmm-fee-harvester/hodlmm-fee-harvester.ts harvest --pool-id <pool_id> --confirm
bun run hodlmm-fee-harvester/hodlmm-fee-harvester.ts harvest --all --confirm
```

Options:
- `--pool-id` -- specific pool to harvest
- `--all` -- harvest all profitable positions
- `--confirm` (required) -- explicit confirmation to execute
- `--min-ratio` (optional) -- minimum fee-to-gas ratio (default: 2)
- `--force` (optional) -- override crisis regime block

Output:
```json
{
  "result": "harvest_submitted",
  "txId": "0x...",
  "poolId": "dlmm_3",
  "collectedFeesA": "0.00012",
  "collectedFeesB": "45.2",
  "gasCostSats": 2500,
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```

### history
Returns recent fee harvest history for the connected wallet.
```
bun run hodlmm-fee-harvester/hodlmm-fee-harvester.ts history --limit 10
```

Output:
```json
{
  "harvests": [
    {
      "txId": "0x...",
      "poolId": "dlmm_3",
      "feesA": "0.00012",
      "feesB": "45.2",
      "timestamp": "2026-03-27T18:00:00.000Z"
    }
  ],
  "totalHarvests": 5,
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
- Mainnet only -- Bitflow HODLMM does not exist on testnet.
- Fee accrual depends on trading volume; low-volume pools may have negligible fees.
- Gas costs for multi-bin positions scale with bin count; very fragmented positions may not be profitable to harvest.
- Harvesting during high volatility may result in collecting fees denominated in a depreciating token.
- API endpoint: api.bitflow.finance -- if unreachable, all commands except doctor will fail with a clear error.
- Crisis regime detection depends on hodlmm-risk skill output format; if unavailable, defaults to allowing harvest.
- Batch harvesting (--all) submits one transaction per pool, not one atomic transaction.
