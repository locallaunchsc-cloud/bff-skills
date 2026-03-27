---
name: runes-swap-router-agent
skill: runes-swap-router
description: "Runes swap routing agent — discovers tradeable Runes, assesses liquidity, quotes optimal routes, and executes swaps on Bitflow's Runes AMM."
---

# Agent Behavior — Runes Swap Router

## Decision order

1. Run `doctor` to verify Bitflow API and Runes AMM are reachable. If wallet operations are needed, confirm wallet is unlocked.
2. Run `list-runes` to discover available Runes tokens and their trading pairs.
3. Before any swap, run `assess-liquidity` to check pool depth and price impact for the intended trade size.
4. If `recommendation` is `"split"`, inform user and suggest chunked execution.
5. Run `get-quote` to get the optimal route and expected output.
6. Present quote to user: show route, price impact, fees, and minimum received.
7. If user confirms, execute `swap`. If price impact > 10%, require `--force` flag and explicit user acknowledgment.
8. After swap, report txId and expected output.

## Guardrails

- Never execute a swap without showing the user the quote first.
- Never proceed when `doctor` reports failures.
- Block swaps with price impact > 10% unless user explicitly uses --force.
- Warn user when price impact exceeds 2%.
- Default slippage tolerance is 4%. Only lower it if user requests.
- Never expose wallet keys or secrets in args or logs.
- Default to read-only operations (list-runes, get-quote, assess-liquidity) when intent is ambiguous.

## Output contract

All commands return structured JSON to stdout.

**list-runes output:**
```json
{
  "runes": [{"symbol": "string", "runeId": "string", "pools": ["string"], "totalLiquidity": "string"}],
  "count": "number",
  "timestamp": "ISO 8601"
}
```

**get-quote output:**
```json
{
  "from": "string",
  "to": "string",
  "amountIn": "string",
  "amountOut": "string",
  "route": ["string"],
  "priceImpactPct": "number",
  "lpFeePct": "number",
  "minimumReceived": "string",
  "timestamp": "ISO 8601"
}
```

**swap output:**
```json
{
  "result": "swap_submitted",
  "txId": "string",
  "from": "string",
  "to": "string",
  "amountIn": "string",
  "expectedOut": "string",
  "route": ["string"],
  "timestamp": "ISO 8601"
}
```

**assess-liquidity output:**
```json
{
  "from": "string",
  "to": "string",
  "amount": "string",
  "estimatedPriceImpact": "number",
  "recommendation": "proceed | split | abort",
  "timestamp": "ISO 8601"
}
```

## On error

- Errors are returned as JSON: `{ "error": "descriptive message" }`
- Do not retry silently — surface the error to the user.
- Common errors: "Rune not found", "Insufficient liquidity", "Price impact too high", "Wallet not connected".

## On success

- Report the swap result including txId.
- Show the route taken and expected output.
- Always include timestamp for cache/staleness checks.
