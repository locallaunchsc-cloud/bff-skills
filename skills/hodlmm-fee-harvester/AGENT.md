---
name: hodlmm-fee-harvester-agent
skill: hodlmm-fee-harvester
description: "HODLMM fee harvester -- collects accrued trading fees from Bitflow HODLMM concentrated liquidity positions with profitability checks and crisis regime guards."
---

# Agent Behavior -- HODLMM Fee Harvester

## Decision order

1. Run `doctor` first. If it fails, stop and surface the blocker.
2. Run `scan-fees --all` to discover positions with unclaimed fees.
3. If no positions have fees exceeding the minimum harvest ratio, report and stop.
4. For each profitable position, confirm intent with the operator before harvesting.
5. Check crisis regime via hodlmm-risk skill if available. If volatility score > 60, block harvest unless `--force` is used.
6. Execute `harvest --pool-id <id> --confirm` for each approved position.
7. Parse JSON output and report collected fees with tx hash.

## Guardrails

- Never harvest without explicit operator confirmation (`--confirm` flag).
- Never harvest when the fee-to-gas ratio is below the minimum threshold (default 2x).
- Never harvest during crisis regime (volatility score > 60) unless `--force` is explicitly passed.
- Never expose secrets or private keys in args or logs.
- Always surface the estimated gas cost alongside fee value so operators can make informed decisions.
- Default to scan-fees (read-only) when intent is ambiguous.
- If hodlmm-risk skill is unavailable, log a warning but allow harvest (do not hard-fail on missing dependency).

## On error

- Log the error payload.
- Do not retry silently.
- Surface to user with guidance (e.g., "Insufficient STX for gas -- fund wallet with at least X STX").
- If a harvest tx fails on-chain, report the tx hash and failure reason.

## On success

- Confirm the on-chain result with tx hash.
- Report total fees collected (tokenA and tokenB amounts).
- Report gas cost paid.
- Suggest next scan interval based on pool trading volume.

## Output contract

All commands return structured JSON to stdout.

**scan-fees output:**
```json
{
  "positions": [
    {
      "poolId": "string",
      "tokenA": "string",
      "tokenB": "string",
      "accruedFeesA": "string",
      "accruedFeesB": "string",
      "estimatedValueSats": "number",
      "estimatedGasCostSats": "number",
      "profitableToHarvest": "boolean",
      "bins": "number"
    }
  ],
  "totalValueSats": "number",
  "totalGasCostSats": "number",
  "timestamp": "string"
}
```

**harvest output:**
```json
{
  "result": "harvest_submitted",
  "txId": "string",
  "poolId": "string",
  "collectedFeesA": "string",
  "collectedFeesB": "string",
  "gasCostSats": "number",
  "timestamp": "string"
}
```

**error output:**
```json
{ "error": "descriptive message" }
```
