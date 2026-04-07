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

Liquidity providers on HODL Market Maker pools face the challenge of maintaining optimal bin placement as market prices fluctuate. This skill enables AI agents to monitor pool health, optimize yield, and execute rebalancing via Stacks contract calls.

## Safety notes

- Requires explicit `--confirm` flag before executing any on-chain transaction.
- Implements a 1-hour cooldown per execution to prevent excessive rebalancing.
- Cooldown state is persisted to `~/.aibtc/hodlmm-rebalancer-cooldown.json`.
- Only operates on mainnet Bitflow HODLMM pools.
- Rebalance transactions are Stacks contract calls -- no Stellar or cross-chain operations.
- Agent must present the rebalance plan to the user before execution.

## Commands

### run

Check pool imbalance and generate a rebalance transaction if threshold is exceeded.

```
bun run hodlmm-rebalancer/hodlmm-rebalancer.ts run
```

Output:

```json
{
  "output": "Rebalance needed for sBTC/STX. Imbalance: 8.00%.",
  "transaction": {
    "contractAddress": "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR",
    "contractName": "hodlmm-pool-v1",
    "functionName": "rebalance-pool",
    "functionArgs": [{ "type": "uint128", "value": "1251" }],
    "network": "mainnet"
  }
}
```

## Output contract

- `output` (string): Status message.
- `transaction` (object, optional): Stacks contract call. Only present when imbalance exceeds 5% threshold and cooldown has expired.
