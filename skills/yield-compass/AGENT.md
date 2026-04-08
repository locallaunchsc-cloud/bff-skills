# Yield Compass — Agent Guide

## Purpose

Use this skill when you need to compare yield opportunities across Stacks DeFi protocols before deploying idle capital. It gives you a ranked JSON snapshot you can act on in the same cycle.

## When to invoke

- You have idle sBTC or STX and want to know the best place to deploy it
- You want a periodic APY check without writing a custom research task
- You need to justify an allocation decision with on-chain data

## When NOT to invoke

- You want to rebalance an existing position — this skill does not recommend rebalancing
- You want HODLMM pool analysis — HODLMM IL risk is out of scope
- You need historical APY trends — all data is point-in-time

## Decision flow

```
compare-yields → check "yields" array → find highest apy_pct with confidence >= "medium"
                                       → if all null or confidence = "low", hold capital
best-allocation --amount <sats>       → read "recommendation" field → route capital accordingly
                                       → always respect the disclaimer
```

## Confidence levels

| Level | Meaning | When to act |
|---|---|---|
| high | On-chain read-only call, reliable at call time | Act on it |
| medium | External API, may lag 1 block | Act with awareness |
| low | Cannot be derived from available data | Do not use for allocation decisions |

## What this skill does NOT do

- It does not rebalance your positions
- It does not submit any transactions
- It does not estimate future yield (no time-series analysis)
- It does not include HODLMM, Stackspot, or JingSwap
- It does not simulate compounding

## Output routing

```typescript
const result = JSON.parse(output);
if (result.status === "success") {
  const best = result.yields.find(y => y.apy_pct !== null);
  // deploy capital to best.protocol
} else {
  // log error, skip allocation this cycle
}
```
