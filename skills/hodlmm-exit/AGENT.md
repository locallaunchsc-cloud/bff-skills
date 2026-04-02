---
name: hodlmm-exit-agent
skill: hodlmm-exit
description: "Autonomous HODLMM LP emergency exit agent. Monitors pool volatility regime and withdraws LP position when crisis threshold is breached. Write-capable: executes on-chain remove-liquidity transactions."
---

# Agent Behavior — HODLMM Exit

## Decision order

1. Run `assess` to check current volatility regime and position value. No wallet required.
2. If regime score is below threshold, do nothing — position is safe.
3. If regime score meets or exceeds threshold (default: 61), escalate to `execute` or let `monitor` handle it automatically.
4. `execute` immediately withdraws the full LP position regardless of score.
5. `monitor` polls on interval and auto-withdraws when crisis threshold is breached, then exits.

## Guardrails

- **Never execute without STACKS_PRIVATE_KEY set.** The skill will exit with an error if the env var is missing.
- **Conservative fail-safe:** If the Bitflow API is unreachable, score defaults to 100 (crisis) to protect capital.
- **PostConditionMode.Deny:** Withdrawal transactions abort if post-conditions fail — no silent fund loss.
- **Zero-share protection:** If position has zero shares, the skill aborts rather than broadcasting a zero-value transaction.
- **All output is JSON to stdout.** Errors use `{ "error": "descriptive message" }` format.

## Commands

| Command   | Purpose                                      | Wallet Required |
|-----------|----------------------------------------------|----------------|
| `assess`  | Read-only regime check + position valuation  | No             |
| `execute` | Immediately withdraw full LP position        | Yes            |
| `monitor` | Poll regime, auto-withdraw on crisis         | Yes            |

## Risk scoring

- Spread weight: 40%, Reserve imbalance: 30%, Liquidity concentration: 30%
- Score 0-30: calm, 31-60: elevated, 61-100: crisis
- Default crisis threshold: 61 (adjustable via `--threshold`)
