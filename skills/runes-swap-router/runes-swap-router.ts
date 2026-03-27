#!/usr/bin/env bun
/**
 * Runes Swap Router skill CLI
 * Runes-aware swap routing on Bitflow's DEX infrastructure
 *
 * Self-contained: uses Bitflow API directly, no external dependencies beyond commander.
 * Specializes in Bitcoin Runes tokens via the Runes AMM (Pontis bridge).
 *
 * Usage: bun run skills/runes-swap-router/runes-swap-router.ts <subcommand> [options]
 */
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BITFLOW_API = "https://api.bitflow.finance/api/v1";
const NETWORK = "mainnet";
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_SLIPPAGE = 4;
const PRICE_IMPACT_WARN = 2;
const PRICE_IMPACT_BLOCK = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RuneToken {
  symbol: string;
  runeId: string;
  contractId: string;
  pools: string[];
  totalLiquidity: string;
}

interface SwapRoute {
  from: string;
  to: string;
  amountIn: string;
  amountOut: string;
  route: string[];
  priceImpactPct: number;
  lpFeePct: number;
  slippageTolerance: number;
  minimumReceived: string;
  exchangeRate: string;
}

interface PoolInfo {
  poolId: string;
  tokenA: string;
  tokenB: string;
  liquidity: string;
  volume24h: string;
  feePct: number;
}

interface LiquidityAssessment {
  from: string;
  to: string;
  amount: string;
  estimatedPriceImpact: number;
  poolDepth: string;
  recommendation: "proceed" | "split" | "abort";
  suggestedChunks?: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function getAvailableRunes(): Promise<RuneToken[]> {
  return fetchJson<RuneToken[]>(`${BITFLOW_API}/runes/tokens`);
}

async function getSwapQuote(
  from: string,
  to: string,
  amount: string,
  slippage: number
): Promise<SwapRoute> {
  const params = new URLSearchParams({ from, to, amount, slippage: String(slippage) });
  return fetchJson<SwapRoute>(`${BITFLOW_API}/runes/quote?${params}`);
}

async function executeSwap(
  from: string,
  to: string,
  amount: string,
  slippage: number
): Promise<{ txId: string; expectedOut: string; route: string[] }> {
  const res = await fetch(`${BITFLOW_API}/runes/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, amount, slippage }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Swap API error ${res.status}: ${res.statusText}`);
  return res.json() as Promise<{ txId: string; expectedOut: string; route: string[] }>;
}

async function getRunesPools(): Promise<PoolInfo[]> {
  return fetchJson<PoolInfo[]>(`${BITFLOW_API}/runes/pools`);
}

async function getLiquidityDepth(
  from: string,
  to: string,
  amount: string
): Promise<LiquidityAssessment> {
  const params = new URLSearchParams({ from, to, amount });
  return fetchJson<LiquidityAssessment>(`${BITFLOW_API}/runes/liquidity?${params}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function printJson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, null, 2));
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const output = { error: message };
  console.log(JSON.stringify(output, null, 2));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------
const program = new Command();

program
  .name("runes-swap-router")
  .description(
    "Runes-aware swap routing — discover Runes tokens, quote swaps, assess liquidity, and execute trades on Bitflow's Runes AMM."
  )
  .version("0.1.0");

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
program
  .command("doctor")
  .description(
    "Checks Bitflow API reachability, Runes AMM availability, and wallet readiness."
  )
  .action(async () => {
    try {
      const checks: Record<string, string> = {};

      // Check Bitflow API
      try {
        await fetchJson(`${BITFLOW_API}/runes/tokens`);
        checks.bitflowApi = "ok";
      } catch {
        checks.bitflowApi = "unreachable";
      }

      // Check Runes AMM
      try {
        await fetchJson(`${BITFLOW_API}/runes/pools`);
        checks.runesAmm = "ok";
      } catch {
        checks.runesAmm = "unavailable";
      }

      // Wallet check (placeholder — wallet integration is environment-specific)
      checks.wallet = "not_checked";

      const allOk = checks.bitflowApi === "ok" && checks.runesAmm === "ok";

      printJson({
        status: allOk ? "ready" : "degraded",
        checks,
        timestamp: new Date().toISOString(),
      });

      if (!allOk) process.exit(1);
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// list-runes
// ---------------------------------------------------------------------------
program
  .command("list-runes")
  .description(
    "Discovers all Runes tokens currently tradeable on Bitflow's Runes AMM."
  )
  .action(async () => {
    try {
      const runes = await getAvailableRunes();

      printJson({
        runes: runes.map((r) => ({
          symbol: r.symbol,
          runeId: r.runeId,
          contractId: r.contractId,
          pools: r.pools,
          totalLiquidity: r.totalLiquidity,
        })),
        count: runes.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// get-quote
// ---------------------------------------------------------------------------
program
  .command("get-quote")
  .description(
    "Gets an optimized swap quote for a Runes trade, including route, price impact, and fees."
  )
  .requiredOption("--from <token>", "Source token symbol (Rune name or SIP-10 token)")
  .requiredOption("--to <token>", "Destination token symbol")
  .requiredOption("--amount <amount>", "Amount of source token to swap")
  .option("--slippage <pct>", "Slippage tolerance in percent", String(DEFAULT_SLIPPAGE))
  .action(async (opts: { from: string; to: string; amount: string; slippage: string }) => {
    try {
      const slippage = Number(opts.slippage);
      const quote = await getSwapQuote(opts.from, opts.to, opts.amount, slippage);

      printJson({
        from: quote.from,
        to: quote.to,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        route: quote.route,
        priceImpactPct: quote.priceImpactPct,
        lpFeePct: quote.lpFeePct,
        slippageTolerance: slippage,
        minimumReceived: quote.minimumReceived,
        exchangeRate: quote.exchangeRate,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// swap
// ---------------------------------------------------------------------------
program
  .command("swap")
  .description(
    "Executes a Runes swap through the best available route. Requires wallet."
  )
  .requiredOption("--from <token>", "Source token symbol")
  .requiredOption("--to <token>", "Destination token symbol")
  .requiredOption("--amount <amount>", "Amount to swap")
  .option("--slippage <pct>", "Slippage tolerance percent", String(DEFAULT_SLIPPAGE))
  .option("--force", "Override price impact safety check", false)
  .action(
    async (opts: {
      from: string;
      to: string;
      amount: string;
      slippage: string;
      force: boolean;
    }) => {
      try {
        const slippage = Number(opts.slippage);

        // Pre-flight: check price impact
        const quote = await getSwapQuote(opts.from, opts.to, opts.amount, slippage);

        if (quote.priceImpactPct > PRICE_IMPACT_BLOCK && !opts.force) {
          throw new Error(
            `Price impact ${quote.priceImpactPct}% exceeds ${PRICE_IMPACT_BLOCK}% safety limit. Use --force to override.`
          );
        }

        if (quote.priceImpactPct > PRICE_IMPACT_WARN) {
          console.error(
            `Warning: price impact ${quote.priceImpactPct}% exceeds ${PRICE_IMPACT_WARN}% threshold.`
          );
        }

        const result = await executeSwap(opts.from, opts.to, opts.amount, slippage);

        printJson({
          result: "swap_submitted",
          txId: result.txId,
          from: opts.from,
          to: opts.to,
          amountIn: opts.amount,
          expectedOut: result.expectedOut,
          route: result.route,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(error);
      }
    }
  );

// ---------------------------------------------------------------------------
// get-pools
// ---------------------------------------------------------------------------
program
  .command("get-pools")
  .description(
    "Lists all Runes AMM pools with liquidity and volume data."
  )
  .action(async () => {
    try {
      const pools = await getRunesPools();

      printJson({
        pools: pools.map((p) => ({
          poolId: p.poolId,
          tokenA: p.tokenA,
          tokenB: p.tokenB,
          liquidity: p.liquidity,
          volume24h: p.volume24h,
          feePct: p.feePct,
        })),
        count: pools.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// assess-liquidity
// ---------------------------------------------------------------------------
program
  .command("assess-liquidity")
  .description(
    "Assesses whether a Runes swap of a given size can execute with acceptable slippage."
  )
  .requiredOption("--from <token>", "Source token symbol")
  .requiredOption("--to <token>", "Destination token symbol")
  .requiredOption("--amount <amount>", "Amount to assess")
  .action(async (opts: { from: string; to: string; amount: string }) => {
    try {
      const assessment = await getLiquidityDepth(opts.from, opts.to, opts.amount);

      printJson({
        from: assessment.from,
        to: assessment.to,
        amount: assessment.amount,
        estimatedPriceImpact: assessment.estimatedPriceImpact,
        poolDepth: assessment.poolDepth,
        recommendation: assessment.recommendation,
        suggestedChunks: assessment.suggestedChunks,
        reasoning: assessment.reasoning,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
program.parse(process.argv);
