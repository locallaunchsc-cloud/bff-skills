---
name: yield-compass
description: "Compare on-chain yield across Stacking, Zest Protocol, and Bitflow liquidity pools on Stacks mainnet — read-only snapshot with honest data-source notes."
metadata:
  author: "not-configured-yet"
  author-agent: "Unified Sphinx"
  user-invocable: "true"
  arguments: "compare-yields | best-allocation --amount <sats> | protocol-snapshot --protocol <stacking|zest|bitflow>"
  entry: "yield-compass/yield-compass.ts"
  requires: "wallet, settings"
  tags: "defi, read-only, mainnet-only, l2"
---

# Yield Compass

## What it does

Fetches live on-chain yield data from three Stacks mainnet protocols — PoX Stacking (BTC yield), Zest Protocol (sBTC lending APY), and Bitflow liquidity pools (fee APY) — and returns a ranked comparison so an autonomous agent can allocate NEW capital to the highest-yielding option. All operations are read-only; no funds move.

## Why agents need it

An agent holding idle sBTC or STX faces an opportunity-cost decision every cycle: stack for BTC yield, lend on Zest, or provide liquidity on Bitflow? Without a reliable comparison snapshot, the agent guesses or ignores yield entirely. Yield Compass gives the agent a structured JSON output it can act on in the same cycle — no manual research required.

## Data sources and limitations

| Protocol | Source | Limitation |
|---|---|---|
| Stacking APY | Hiro `/v2/pox` | PoX returns only participation ratio and locked STX. APY cannot be derived directly — `null` is returned with an honest note. |
| Zest APY | On-chain read-only call to `zest-reserve-v0` | Returns current deposit APY in basis points. Accurate at call time. |
| Bitflow pools | Bitflow BFF API | Pool sub-paths are version-dependent; `TODO` is flagged in code when endpoint changes. |

Yields are point-in-time. No historical averaging. No price-feed integration.

## Safety notes

- **Read-only.** No transactions are submitted. No funds move.
- **New capital only.** The `best-allocation` command recommends where to deploy NEW capital. It explicitly does NOT recommend rebalancing existing positions.
- **No HODLMM.** This skill does not analyze or recommend HODLMM LP positions. HODLMM impermanent loss math is out of scope.
- **Mainnet only.** Zest and Bitflow are deployed on Stacks mainnet.
- **APY null is honest.** If Stacking APY cannot be derived from available data, the field returns `null` rather than a fabricated estimate.

## Commands

### compare-yields
Fetches yield from all three protocols and returns a ranked list.
```bash
bun run skills/yield-compass/yield-compass.ts compare-yields
```

### best-allocation
Given a capital amount in sats, returns a JSON recommendation for where to deploy it.
```bash
bun run skills/yield-compass/yield-compass.ts best-allocation --amount 100000
```
**Important:** Output includes a disclaimer: `"⚠️ Recommendation applies to NEW capital only. This output does NOT instruct rebalancing of existing positions."`

### protocol-snapshot
Returns detailed data for a single protocol.
```bash
bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol zest
bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol bitflow
bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol stacking
```

## Output contract

All outputs are JSON to stdout.

**compare-yields:**
```json
{
  "status": "success",
  "timestamp": "2026-04-08T12:00:00.000Z",
  "yields": [
    { "protocol": "zest", "apy_pct": 4.2, "asset": "sBTC", "confidence": "high" },
    { "protocol": "bitflow", "apy_pct": 2.8, "asset": "STX/sBTC", "confidence": "medium" },
    { "protocol": "stacking", "apy_pct": null, "asset": "STX", "confidence": "low", "note": "APY not derivable from /v2/pox — use stacking explorer for estimates" }
  ],
  "error": null
}
```

**best-allocation:**
```json
{
  "status": "success",
  "recommendation": "zest",
  "reason": "Highest available APY at 4.2%",
  "disclaimer": "⚠️ Recommendation applies to NEW capital only. This output does NOT instruct rebalancing of existing positions.",
  "hodlmm_excluded": true,
  "hodlmm_note": "HODLMM IL risk is out of scope for this skill",
  "amount_sats": 100000,
  "error": null
}
```

**Error (fetch failed):**
```json
{
  "status": "error",
  "protocol": "bitflow",
  "error": "fetch timeout after 10s",
  "yields": null
}
```

## Known constraints

- Stacking APY requires an external estimator (e.g. stacking.club) — this skill returns `null` for that field and notes why.
- Bitflow pool endpoint paths are subject to API versioning. The code contains a `TODO` comment at that fetch point.
- Zest APY is per-market. The skill reads the sBTC market by default.
- No caching — each call hits live endpoints.
