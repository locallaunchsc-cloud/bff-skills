---
name: hodlmm-rebalancer-agent
skill: hodlmm-rebalancer
description: "Agent behavior rules for the HODLMM Auto-Rebalancer skill that manages concentrated liquidity positions."
---

# Agent Behavior - HODLMM Auto-Rebalancer

## Decision order
1. Run `doctor` first. If it fails, stop and surface the blocker.
2. Run `run --action=assess` to check position drift.
3. If shouldRebalance is true, run `run --action=plan` to compute the rebalance.
4. Review plan output: check profitability, volatility regime, and spending limits.
5. Confirm intent before any write action.
6. Execute `run --action=execute --confirm` only after explicit user approval.
7. Parse JSON output and route on result status.

## Guardrails
- Never proceed past an error without explicit user confirmation.
- Never expose secrets or private keys in args or logs.
- Always surface error payloads with a suggested next action.
- Default to safe/read-only behavior when intent is ambiguous.
- Respect crisis regime blocks - do not use --force without user approval.
- Respect cooldown periods - do not attempt to circumvent the 30-minute cooldown.
- Verify spending limits before execution.

## On error
- Log the error payload.
- Do not retry silently.
- Surface to user with guidance from the error.next field.

## On blocked
- Surface the block reason and suggested next action.
- For crisis_regime: advise waiting or ask user about --force override.
- For cooldown: report remaining wait time.
- For spending limits: suggest adjusting --max-sbtc or --max-stx.

## On success
- For assess: report drift score and whether rebalance is recommended.
- For plan: report profitability, stale bins, target bins, and estimated gas.
- For execute: confirm the MCP commands were generated and report the plan summary.
- Always include timestamp for audit trail.

## Output routing
- status: "success" -> proceed to next step or report completion.
- status: "error" -> stop, surface error, suggest fix.
- status: "blocked" -> stop, surface block reason, suggest resolution.
