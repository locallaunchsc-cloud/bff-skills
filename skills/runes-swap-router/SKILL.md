---
name: runes-swap-router
description: "Runes-aware swap router for Bitflow -- discovers available Runes tokens, finds optimal swap routes through the Runes AMM and DEX aggregator, quotes multi-hop swaps with price impact analysis, and executes Runes trades via Pontis bridge integration. Read and write operations; wallet required for swaps."
metadata:
  author: "locallaunchsc-cloud"
  author-agent: "Runes Router Agent"
  user-invocable: "true"
  arguments: "doctor | list-runes | get-quote | swap | get-pools | assess-liquidity"
  entry: "runes-swap-router/runes-swap-router.ts"
  requires: "wallet, signing"
  tags: "defi, write, mainnet-only, l2, requires-funds"
---

# Runes Swap Router

## What it does
Provides Runes-specific swap intelligence on top of Bitflow's DEX infrastructure. While the base `bitflow` skill handles general token swaps, this skill specializes in Bitcoin Runes tokens -- discovering which Runes are tradeable, finding the best routes through the Runes AMM (powered by Pontis bridge), quoting swaps with slippage and price impact analysis, and executing trades. It also monitors Runes AMM pool liquidity depth to help agents decide when and how much to trade.

## Why agents need it
Runes are a growing class of fungible tokens on Bitcoin, but trading them requires navigating bridging (Pontis), AMM pool liquidity, and multi-hop routing that the generic swap skill doesn't optimize for. This skill gives agents a Runes-native trading interface -- they can discover new Runes listings, assess liquidity before trading, get optimized quotes, and execute swaps without understanding the underlying bridge mechanics.

## Safety notes
- Write operations (swap) move funds and are irreversible once confirmed on-chain.
- Mainnet only -- Bitflow Runes AMM is mainnet-only.
- Wallet with STX for gas and tokens to swap required for write operations.
- Read operations (list-runes, get-quote, get-pools, assess-liquidity) are safe and require no wallet.
- Slippage protection: default 4% tolerance, configurable via --slippage flag.
- Price impact warning: skill warns when impact exceeds 2% and blocks swaps exceeding 10% unless --force is used.

## Commands

### doctor
Checks Bitflow API reachability, Runes AMM availability, and wallet readiness. Safe to run anytime.
```bash
bun run runes-swap-router/runes-swap-router.ts doctor
```

Output:
```json
{
  "status": "ready",
  "checks": {
    "bitflowApi": "ok",
    "runesAmm": "ok",
    "wallet": "not_checked"
  },
  "timestamp": "2026-03-27T00:00:00.000Z"
}
```

### list-runes
Discovers all Runes tokens currently tradeable on Bitflow's Runes AMM.
```bash
bun run runes-swap-router/runes-swap-router.ts list-runes
```

Output:
```json
{
  "runes": [
    {
      "symbol": "DOG",
      "runeId": "DOG*GO*TO*THE*MOON",
      "contractId": "SP...",
      "pools": ["DOG-sBTC", "DOG-STX"],
      "totalLiquidity": "1250000"
    }
  ],
  "count": 12,
  "timestamp": "2026-03-27T00:00:00.000Z"
}
```

### get-quote
Gets an optimized swap quote for a Runes trade, including route, price impact, and fees.
```bash
bun run runes-swap-router/runes-swap-router.ts get-quote --from DOG --to sBTC --amount 1000
```

Options:
- `--from` (required) -- Source token symbol (Rune name or SIP-10 token)
- `--to` (required) -- Destination token symbol
- `--amount` (required) -- Amount of source token to swap
- `--slippage` (optional) -- Slippage tolerance in percent (default: 4)

Output:
```json
{
  "from": "DOG",
  "to": "sBTC",
  "amountIn": "1000",
  "amountOut": "0.00045",
  "route": ["DOG", "STX", "sBTC"],
  "priceImpactPct": 0.8,
  "lpFeePct": 0.3,
  "slippageTolerance": 4,
  "minimumReceived": "0.000432",
  "exchangeRate": "0.00000045",
  "timestamp": "2026-03-27T00:00:00.000Z"
}
```

### swap
Executes a Runes swap through the best available route. Requires wallet and explicit confirmation.
```bash
bun run runes-swap-router/runes-swap-router.ts swap --from DOG --to sBTC --amount 1000 --slippage 2 --confirm
```

Options:
- `--from` (required) -- Source token symbol
- `--to` (required) -- Destination token symbol
- `--amount` (required) -- Amount to swap
- `--slippage` (optional) -- Slippage tolerance percent (default: 4)
- `--confirm` (required) -- Explicit confirmation to execute the swap
- `--force` (optional) -- Override price impact safety check

Output:
```json
{
  "result": "swap_submitted",
  "txId": "0x...",
  "from": "DOG",
  "to": "sBTC",
  "amountIn": "1000",
  "expectedOut": "0.00045",
  "route": ["DOG", "STX", "sBTC"],
  "timestamp": "2026-03-27T00:00:00.000Z"
}
```

### get-pools
Lists all Runes AMM pools with liquidity and volume data.
```bash
bun run runes-swap-router/runes-swap-router.ts get-pools
```

Output:
```json
{
  "pools": [
    {
      "poolId": "runes-dog-sbtc",
      "tokenA": "DOG",
      "tokenB": "sBTC",
      "liquidity": "1250000",
      "volume24h": "85000",
      "feePct": 0.3
    }
  ],
  "count": 8,
  "timestamp": "2026-03-27T00:00:00.000Z"
}
```

### assess-liquidity
Assesses whether a Runes swap of a given size can execute with acceptable slippage.
```bash
bun run runes-swap-router/runes-swap-router.ts assess-liquidity --from DOG --to sBTC --amount 5000
```

Output:
```json
{
  "from": "DOG",
  "to": "sBTC",
  "amount": "5000",
  "estimatedPriceImpact": 3.2,
  "poolDepth": "45000",
  "recommendation": "split",
  "suggestedChunks": 3,
  "reasoning": "Price impact exceeds 2%. Recommend splitting into 3 chunks of ~1667 DOG over 15 minutes.",
  "timestamp": "2026-03-27T00:00:00.000Z"
}
```

## Output contract
All outputs are flat JSON to stdout.

**Error:**
```json
{ "error": "descriptive message" }
```

## Known constraints
- Mainnet only -- Bitflow Runes AMM does not exist on testnet.
- Runes must be bridged via Pontis to Stacks before trading. The skill handles this transparently.
- Runes AMM pool liquidity varies significantly -- always use assess-liquidity before large trades.
- Multi-hop routes (e.g., Rune -> STX -> sBTC) may have compounding slippage.
- New Runes listings may not have deep liquidity immediately.
- Price impact calculation is an estimate based on current pool state; actual impact may differ.
- Swap execution requires STX for gas fees in addition to the tokens being swapped.
- API endpoint: api.bitflow.finance/api/v1/runes/* -- Runes AMM endpoints. If these are unreachable, all commands except doctor will fail with a clear error.
- Wallet check in doctor is a placeholder -- wallet integration is environment-specific and not validated in this skill.
