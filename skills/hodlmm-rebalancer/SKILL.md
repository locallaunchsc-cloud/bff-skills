---
name: hodlmm-rebalancer
description: Write-capable HODLMM Auto-Rebalancer that detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement via a three-step pipeline (assess → plan → execute)
metadata:
  author: locallaunchsc-cloud
  author-agent: Unified Sphinx
  entry: "hodlmm-rebalancer/hodlmm-rebalancer.ts"
  user-invocable: "false"
  arguments: doctor | run --action=<assess|plan|execute> --pool-id=<id> [--confirm]
  commands: doctor, run
  hodlmm-integration: true
  category: trading
  requires-wallet: true
  network: mainnet
---

# HODLMM Auto-Rebalancer

## What it does

Detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement. Runs a three-step pipeline: assess drift, plan rebalance, execute via MCP commands.

## Why agents need it

Liquidity providers on HODL Market Maker pools face the challenge of maintaining optimal bin placement as market prices fluctuate. When positions drift out of range, LPs miss out on trading fees and suffer from impermanent loss. This skill enables AI agents to:

- **Monitor pool health**: Continuously assess whether concentrated liquidity positions are still in range
- **Optimize yield**: Automatically detect when rebalancing would improve fee generation
- **Execute complex operations**: Handle the multi-step process of removing liquidity, recalculating optimal bins, and redeploying capital
- **Manage risk**: Validate transactions before execution and implement cooldown periods to prevent excessive trading

By automating this process, agents can help users maximize their LP returns while minimizing manual intervention and the risk of missing optimal rebalancing windows.

## Output contract

The skill outputs JSON with the following structure:

```json
{
  "output": "Human-readable status message",
  "uri": "web+stellar:swap?source_asset=...&destination_asset=...&amount=...&fee_bps=100" (optional)
}
```

**Fields:**
- `output` (string): Status message indicating:
  - Pool balance status and whether rebalancing is needed
  - Cooldown status if skill was recently executed
  - Error messages if required data is missing
- `uri` (string, optional): Stellar SEP-0011 swap URI for executing the rebalance transaction. Only present when imbalance exceeds 5% threshold and cooldown has expired.

**Example outputs:**

*Pool balanced:*
```json
{
  "output": "Pool is balanced or imbalance is below threshold (5%). No rebalance needed."
}
```

*Rebalance needed:*
```json
{
  "output": "Rebalance needed for BTC/STX. Imbalance: 8.45%. Swap 1250.5 STX. URI: web+stellar:swap?...",
  "uri": "web+stellar:swap?source_asset=STX&destination_asset=BTC&amount=1250.5&fee_bps=100"
}
```

*On cooldown:*
```json
{
  "output": "Skill is on cooldown. Please wait 45 minutes before running again."
}
```
