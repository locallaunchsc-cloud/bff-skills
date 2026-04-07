---
name: hodlmm-rebalancer
description: Write-capable HODLMM Auto-Rebalancer that detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement via a three-step pipeline (assess -> plan -> execute)
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

Detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement. Runs a three-step pipeline: assess drift, plan rebalance, execute via Stacks contract call.

## Why agents need it

Liquidity providers on HODL Market Maker pools face the challenge of maintaining optimal bin placement as market prices fluctuate. When positions drift out of range, LPs miss out on trading fees and suffer from impermanent loss. This skill enables AI agents to:

- **Monitor pool health**: Continuously assess whether concentrated liquidity positions are still in range
- **Optimize yield**: Automatically detect when rebalancing would improve fee generation
- **Execute complex operations**: Handle the multi-step process of removing liquidity, recalculating optimal bins, and redeploying capital
- **Manage risk**: Validate transactions before execution and implement cooldown periods to prevent excessive trading

By automating this process, agents can help users maximize their LP returns while minimizing manual intervention and the risk of missing optimal rebalancing windows.

## Safety notes

- Requires explicit `--confirm` flag before executing any on-chain transaction.
- Implements a 1-hour cooldown per execution to prevent excessive rebalancing.
- Cooldown state is persisted to `~/.aibtc/hodlmm-rebalancer-cooldown.json` — not to the skill source directory.
- Only operates on mainnet Bitflow HODLMM pools.
- Rebalance transactions are Stacks contract calls — no Stellar or cross-chain operations.
- Agent must present the rebalance plan to the user before execution and obtain confirmation.
- Do not override cooldown even if user insists; respect the guardrail to avoid fee drag.

## Commands

### run

Check pool imbalance and generate a rebalance transaction if threshold is exceeded.

```
bun run hodlmm-rebalancer/hodlmm-rebalancer.ts run
```

Requires `hodlmmData` in `context.globalState` with the following shape:

```json
{
  "imbalance": 0.08,
  "assetPair": { "name": "sBTC/STX" },
  "requiredRebalanceAmount": { "asset": "STX", "amount": 1250.5 },
  "poolContract": { "address": "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR", "name": "hodlmm-pool-v1" }
}
```

Output:

```json
{
  "output": "Rebalance needed for sBTC/STX. Imbalance: 8.00%. Swap 1250.5 STX via Stacks contract call to SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.hodlmm-pool-v1::rebalance-pool.",
  "transaction": {
    "contractAddress": "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
    "contractName": "hodlmm-pool-v1",
    "functionName": "rebalance-pool",
    "functionArgs": [{ "type": "uint128", "value": "1251" }],
    "postConditions": [],
    "network": "mainnet"
  }
}
```

## Output contract

The skill outputs JSON with the following structure:

```json
{
  "output": "Human-readable status message",
  "transaction": { ... }
}
```

**Fields:**

- `output` (string): Status message indicating pool balance status, cooldown status, or error.
- `transaction` (object, optional): Stacks contract call object. Only present when imbalance exceeds 5% threshold and cooldown has expired.

**Example outputs:**

*Pool balanced:*
```json
{ "output": "Pool is balanced or imbalance is below threshold (5%). No rebalance needed." }
```

*Rebalance needed:*
```json
{
  "output": "Rebalance needed for sBTC/STX. Imbalance: 8.00%. Swap 1250 STX via Stacks contract call.",
  "transaction": { "contractAddress": "...", "contractName": "hodlmm-pool-v1", "functionName": "rebalance-pool", "functionArgs": [...], "network": "mainnet" }
}
```

*On cooldown:*
```json
{ "output": "Skill is on cooldown. Please wait 45 minutes before running again." }
```
