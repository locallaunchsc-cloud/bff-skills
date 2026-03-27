---
name: hodlmm-rebalancer-agent
skill: hodlmm-rebalancer
description: "HODLMM auto-rebalancer agent — detects out-of-range bins, plans optimal repositioning, and executes withdraw/re-deposit with safety guardrails."
---

# Agent Behavior — HODLMM Auto-Rebalancer

## Decision order

1. Run `doctor` first. If wallet lacks gas, Bitflow API is unreachable, or no HODLMM pools found, stop and surface the blocker.
2. Run `run --action=assess` to check position drift. If drift score < 15, report "position is in range" and stop.
3. If drift score >= 15, run `run --action=plan` to compute optimal rebalance.
4. If regime is `"crisis"` and `--force` is not set, report blocked status and do not proceed.
5. If plan shows `profitable: false`, warn user that rebalance may not cover gas costs.
6. Present plan to user: show stale bins, target bins, gas estimate, and profitability.
7. If user confirms, run `run --action=execute --confirm=true`.
8. After execution, report MCP commands issued and timestamp.

## Guardrails

- Never execute without showing the plan first.
- Never proceed when `doctor` reports failures.
- Block rebalance during crisis regime (volatility score > 60) unless user explicitly uses `--force`.
- Require `--confirm=true` for all write operations.
- Enforce 30-minute cooldown between rebalances per pool/address pair.
- Respect spending limits: `--max-sbtc` (default 500,000 sats) and `--max-stx` (default 100).
- Never expose wallet keys or secrets in args or logs.
- Default to read-only operations (doctor, assess, plan) when intent is ambiguous.

## Output contract

All commands return flat JSON to stdout.

**doctor output:**
```json
{
  "status": "ready | degraded",
  "checks": { "stx_balance": { "ok": "boolean", "detail": "string" } },
  "address": "string",
  "network": "mainnet",
  "timestamp": "ISO 8601"
}
```

**assess output:**
```json
{
  "network": "mainnet",
  "poolId": "string",
  "address": "string",
  "activeBinId": "number",
  "positionBinCount": "number",
  "driftScore": "number",
  "outOfRangePct": "number",
  "staleBinCount": "number",
  "inRangeBinCount": "number",
  "volatilityScore": "number",
  "regime": "calm | elevated | crisis",
  "shouldRebalance": "boolean",
  "timestamp": "ISO 8601"
}
```

**plan output:**
```json
{
  "network": "mainnet",
  "poolId": "string",
  "activeBinId": "number",
  "binWidth": "number",
  "volatilityScore": "number",
  "regime": "string",
  "staleBinCount": "number",
  "targetBinCount": "number",
  "totalWithdrawX": "number",
  "totalWithdrawY": "number",
  "estimatedGasUstx": "number",
  "profitable": "boolean",
  "timestamp": "ISO 8601"
}
```

**execute output:**
```json
{
  "operation": "rebalance",
  "network": "mainnet",
  "poolId": "string",
  "activeBinId": "number",
  "mcp_commands": [{ "step": "number", "tool": "string", "params": "object" }],
  "timestamp": "ISO 8601"
}
```

## On error

- Errors are returned as flat JSON: `{ "error": "descriptive message" }`
- Do not retry silently — surface the error to the user.
- Common errors: "No position found", "Crisis regime — rebalance blocked", "Cooldown active", "Insufficient gas", "Position too small", "No confirmation flag".

## On success

- Report the MCP commands to be executed (withdraw stale bins, deposit into target bins).
- Show gas estimate, profitability assessment, and regime context.
- Always include timestamp for audit trail.
