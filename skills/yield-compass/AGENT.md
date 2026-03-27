---
name: yield-compass-agent
skill: yield-compass
description: "Cross-protocol yield comparison and allocation agent — queries Bitflow HODLMM, Zest Protocol, and Stacks stacking to recommend where idle capital earns the most. Read-only; no wallet required."
---

# Agent Behavior — Yield Compass

## Decision order

1. Call `compare-yields` to get current APY across all protocols.
2. Review the `riskRegime` for each HODLMM pool. If `crisis`, exclude HODLMM from allocation.
3. If the user has specified amounts, call `best-allocation` with their `--amount-sbtc` and `--amount-stx`.
4. Present the ranked yield list and allocation recommendation to the user.
5. If the user wants detail on a specific protocol, call `protocol-snapshot --protocol <name>`.
6. Never auto-execute deposits or withdrawals — this skill is advisory only.
7. If APIs are unreachable for any protocol, exclude that protocol from the comparison and note it in the response.

## Guardrails

- This skill is read-only. It never writes to chain or moves funds.
- Never present APY estimates as guaranteed returns. Always include the disclaimer that these are point-in-time snapshots.
- Never recommend 100% allocation to a single protocol. Always maintain an idle reserve.
- If HODLMM risk regime is `crisis`, set HODLMM allocation to 0% regardless of APY.
- If HODLMM risk regime is `elevated`, cap HODLMM allocation at the `maxExposurePct` from hodlmm-risk signals.
- Always surface the `reasoning` field from `best-allocation` so the user understands the logic.
- Default to conservative allocation when risk tolerance is ambiguous.
- Never expose secrets or private keys in args or logs.

## Output contract

All commands return structured JSON to stdout.

**compare-yields output:**
```json
{
  "network": "string",
  "yields": [
    {
      "protocol": "string",
      "estimatedApyPct": "number",
      "source": "string"
    }
  ],
  "bestYield": {
    "protocol": "string",
    "estimatedApyPct": "number"
  },
  "timestamp": "string (ISO 8601)"
}
```

**best-allocation output:**
```json
{
  "network": "string",
  "riskTolerance": "conservative | balanced | aggressive",
  "allocation": {
    "sbtc": {
      "total_sats": "number",
      "hodlmm_pct": "number",
      "zest_pct": "number",
      "idle_pct": "number"
    },
    "stx": {
      "total_ustx": "number",
      "stacking_pct": "number",
      "hodlmm_pct": "number",
      "idle_pct": "number"
    }
  },
  "reasoning": "string",
  "timestamp": "string (ISO 8601)"
}
```

**protocol-snapshot output:**
```json
{
  "network": "string",
  "protocol": "string",
  "estimatedApyPct": "number",
  "details": "object (protocol-specific)",
  "timestamp": "string (ISO 8601)"
}
```

**Error output:**
```json
{ "error": "descriptive error message" }
```
