---
name: hodlmm-rebalancer
description: Write-capable HODLMM Auto-Rebalancer that detects out-of-range concentrated liquidity positions on Bitflow HODLMM pools and automatically rebalances bin placement via a three-step pipeline (assess → plan → execute)
metadata:
  author: locallaunchsc-cloud
  author-agent: Unified Sphinx
  user-invocable: false
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

## Why it matters

This is the active counterpart to hodlmm-risk (read-only monitor, PR #23). Where hodlmm-risk reads pool state and computes risk scores, hodlmm-rebalancer acts on those readings.

## How it works

### Pipeline

1. **assess** — Fetches pool state, user position, computes volatility score and drift score
2. **plan** — Identifies stale bins (>5 bins from active), computes optimal rebalance plan with withdrawal amounts and target bins  
3. **execute** — Generates MCP tool commands for withdraw + re-add, gated by `--confirm` flag

### Safety model

- Blocked in crisis volatility regime (score > 60) unless `--force`
- 30-minute file-based cooldown between rebalances per pool/address (survives process restarts)
- Minimum gas balance check before execution
- Configurable max sBTC sats (500K) and max STX (100) spending limits
- Requires explicit `--confirm` flag — no accidental fires
- Profitability check blocks unprofitable rebalances
- All execution via MCP tool commands — agent framework handles signing

### Data sources

- Bitflow API — HODLMM pool metadata, bin state, user positions
- Hiro API — STX and sBTC wallet balances

## Commands

### doctor

Health check: verifies wallet address, STX balance, sBTC balance, Bitflow API reachability, MCP tool availability, cooldown persistence.

```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts doctor
```

### run --action=assess

Assess position drift and volatility. Returns drift score, out-of-range percentage, and volatility score with regime classification.

```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=assess --pool-id=dlmm_3
```

### run --action=plan

Compute rebalance plan. Returns stale bins to withdraw, target bins for re-add, gas estimate, and profitability check.

```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=plan --pool-id=dlmm_3 [--bin-width=5]
```

### run --action=execute

Execute rebalance via MCP commands. Requires `--confirm` flag and passes all safety gates.

```bash
bun run skills/hodlmm-rebalancer/hodlmm-rebalancer.ts run --action=execute --pool-id=dlmm_3 --confirm
```

**Options:**

- `--pool-id <id>` — HODLMM pool identifier (e.g. `dlmm_3`)
- `--address <addr>` — Override wallet address (defaults to `STACKS_ADDRESS` env var)
- `--bin-width <n>` — Bin width for rebalance target range (default: 5)
- `--confirm` — Required for execute action
- `--force` — Override crisis regime block
- `--max-sbtc <sats>` — Max sBTC sats to withdraw (default: 500000)
- `--max-stx <stx>` — Max STX to withdraw (default: 100)

## Output format

All commands emit strict JSON to stdout:

```json
{
  "status": "success" | "error" | "blocked",
  "action": "Next recommended action or error recovery step",
  "data": { /* Command-specific output */ },
  "error": { "code": "ERROR_CODE", "message": "...", "next": "..." } | null
}
```

## Environment variables

- `STACKS_ADDRESS` or `STX_ADDRESS` — Wallet address (required)
- `AIBTC_WALLET_PASSWORD` — Wallet password for MCP execution (optional, can be passed via `--password`)

## Files

- `skills/hodlmm-rebalancer/hodlmm-rebalancer.ts` — Full implementation (512 lines)
- `skills/hodlmm-rebalancer/SKILL.md` — This file
- `skills/hodlmm-rebalancer/AGENT.md` — Agent behavior rules

## Dependencies

- `commander` — CLI argument parsing
- Node.js built-in: `fs`, `path`
- MCP tools: `bitflow_hodlmm_add_liquidity`, `bitflow_hodlmm_remove_liquidity`

## Safety notes

- **Never runs without `--confirm` on execute action**
- **Cooldown persists to disk** — `.aibtc/hodlmm-rebalancer-state.json` in home directory
- **All wallet operations via MCP** — no private key handling in skill code
- **Profitability gate** — blocks rebalances where gas cost exceeds projected 1-day fee earnings
- **Crisis blocking** — volatility score > 60 blocks execution unless `--force` override
