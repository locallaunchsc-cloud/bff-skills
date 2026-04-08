#!/usr/bin/env bun
/**
 * yield-compass.ts
 * Compare on-chain yield across Stacking, Zest Protocol, and Bitflow on Stacks mainnet.
 * READ-ONLY — no transactions submitted, no funds moved.
 */

import { Command } from "commander";

// ── Constants ────────────────────────────────────────────────────────────────

const HIRO_POX_URL = "https://api.hiro.so/v2/pox";
const HIRO_RPC_URL = "https://api.hiro.so/v2/contracts/call-read";

// Zest reserve contract (sBTC market)
const ZEST_CONTRACT_ADDRESS = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
const ZEST_RESERVE_CONTRACT = "zest-reserve-v0";

// Bitflow BFF API base — pool sub-paths are versioned, see TODO below
const BITFLOW_BASE_URL = "https://bff.bitflowapis.finance/api/quotes/v1";

const FETCH_TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface YieldResult {
  protocol: "stacking" | "zest" | "bitflow";
  apy_pct: number | null;
  asset: string;
  confidence: "high" | "medium" | "low";
  note?: string;
}

interface SkillOutput {
  status: "success" | "error" | "partial";
  timestamp: string;
  yields?: YieldResult[];
  recommendation?: string;
  reason?: string;
  disclaimer?: string;
  hodlmm_excluded?: boolean;
  hodlmm_note?: string;
  amount_sats?: number;
  data?: unknown;
  error?: string | null;
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// ── Stacking yield ────────────────────────────────────────────────────────────

async function fetchStackingYield(): Promise<YieldResult> {
  try {
    const res = await fetchWithTimeout(HIRO_POX_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // /v2/pox returns reward_cycle_id, total_liquid_supply_ustx, current_cycle.stacked_ustx
    // APY cannot be derived from these fields alone — we'd need actual BTC reward amounts
    // which are not exposed by this endpoint. Returning null with an honest note.
    const participationRatio =
      data?.current_cycle?.stacked_ustx && data?.total_liquid_supply_ustx
        ? (data.current_cycle.stacked_ustx / data.total_liquid_supply_ustx).toFixed(4)
        : null;

    return {
      protocol: "stacking",
      apy_pct: null,
      asset: "STX",
      confidence: "low",
      note: `APY not derivable from /v2/pox alone. Participation ratio: ${participationRatio ?? "unknown"}. Use stacking.club or Hiro explorer for APY estimates.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      protocol: "stacking",
      apy_pct: null,
      asset: "STX",
      confidence: "low",
      note: `Fetch failed: ${message}`,
    };
  }
}

// ── Zest yield ────────────────────────────────────────────────────────────────

async function callZestReadOnly(functionName: string, args: string[] = []): Promise<unknown> {
  const url = `${HIRO_RPC_URL}/${ZEST_CONTRACT_ADDRESS}/${ZEST_RESERVE_CONTRACT}/${functionName}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: ZEST_CONTRACT_ADDRESS, arguments: args }),
  });
  if (!res.ok) throw new Error(`Zest RPC HTTP ${res.status}`);
  return res.json();
}

async function fetchZestYield(): Promise<YieldResult> {
  try {
    // get-deposit-apy returns basis points (e.g. 420 = 4.20%)
    const result = (await callZestReadOnly("get-deposit-apy")) as {
      result?: string;
      okay?: boolean;
    };

    // Clarity response: (ok u420) → result = "0x0703...hex for uint 420"
    // Parse the uint from the Clarity response value
    const raw = result?.result ?? "";
    const match = raw.match(/^0x0703([0-9a-f]+)$/i);
    if (!match) throw new Error(`Unexpected Zest response: ${raw}`);

    const basisPoints = parseInt(match[1], 16);
    const apy = basisPoints / 100;

    return {
      protocol: "zest",
      apy_pct: apy,
      asset: "sBTC",
      confidence: "high",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      protocol: "zest",
      apy_pct: null,
      asset: "sBTC",
      confidence: "low",
      note: `Fetch failed: ${message}`,
    };
  }
}

// ── Bitflow yield ─────────────────────────────────────────────────────────────

async function fetchBitflowPools(): Promise<YieldResult> {
  try {
    // TODO: Bitflow BFF pool sub-path is versioned and may change.
    // Current known path — verify against https://bff.bitflowapis.finance docs if this fails.
    const url = `${BITFLOW_BASE_URL}/pools`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Find the sBTC/STX pool or the highest-APY pool
    const pools: Array<{ token_x?: string; token_y?: string; fee_apy?: number; apy?: number }> =
      Array.isArray(data) ? data : data?.pools ?? [];

    if (pools.length === 0) {
      return {
        protocol: "bitflow",
        apy_pct: null,
        asset: "varies",
        confidence: "medium",
        note: "No pools returned from Bitflow API",
      };
    }

    // Pick the pool with the highest fee_apy (or apy field)
    const best = pools.reduce((prev, curr) => {
      const prevApy = prev.fee_apy ?? prev.apy ?? 0;
      const currApy = curr.fee_apy ?? curr.apy ?? 0;
      return currApy > prevApy ? curr : prev;
    });

    const apy = best.fee_apy ?? best.apy ?? null;
    const asset =
      best.token_x && best.token_y ? `${best.token_x}/${best.token_y}` : "varies";

    return {
      protocol: "bitflow",
      apy_pct: apy,
      asset,
      confidence: "medium",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      protocol: "bitflow",
      apy_pct: null,
      asset: "varies",
      confidence: "low",
      note: `Fetch failed: ${message}`,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function output(data: SkillOutput): void {
  console.log(JSON.stringify(data, null, 2));
}

function sortByApy(yields: YieldResult[]): YieldResult[] {
  return [...yields].sort((a, b) => {
    if (a.apy_pct === null && b.apy_pct === null) return 0;
    if (a.apy_pct === null) return 1;
    if (b.apy_pct === null) return -1;
    return b.apy_pct - a.apy_pct;
  });
}

// ── Commands ──────────────────────────────────────────────────────────────────

const program = new Command();
program.name("yield-compass").description("Compare on-chain yield across Stacks DeFi protocols");

program
  .command("compare-yields")
  .description("Fetch yield from all protocols and return a ranked list")
  .action(async () => {
    const [stacking, zest, bitflow] = await Promise.all([
      fetchStackingYield(),
      fetchZestYield(),
      fetchBitflowPools(),
    ]);

    const yields = sortByApy([stacking, zest, bitflow]);
    output({
      status: "success",
      timestamp: new Date().toISOString(),
      yields,
      error: null,
    });
  });

program
  .command("best-allocation")
  .description("Recommend where to deploy new capital (does NOT recommend rebalancing)")
  .requiredOption("--amount <sats>", "Capital amount in satoshis", parseInt)
  .action(async (opts: { amount: number }) => {
    const [stacking, zest, bitflow] = await Promise.all([
      fetchStackingYield(),
      fetchZestYield(),
      fetchBitflowPools(),
    ]);

    const yields = sortByApy([stacking, zest, bitflow]);
    const best = yields.find((y) => y.apy_pct !== null && y.confidence !== "low");

    if (!best) {
      output({
        status: "error",
        timestamp: new Date().toISOString(),
        error: "No actionable yield data available — all sources returned null or low-confidence",
        yields,
      });
      return;
    }

    output({
      status: "success",
      timestamp: new Date().toISOString(),
      recommendation: best.protocol,
      reason: `Highest available APY at ${best.apy_pct}% (${best.asset}, confidence: ${best.confidence})`,
      disclaimer:
        "⚠️ Recommendation applies to NEW capital only. This output does NOT instruct rebalancing of existing positions.",
      hodlmm_excluded: true,
      hodlmm_note: "HODLMM impermanent loss risk is out of scope for this skill",
      amount_sats: opts.amount,
      yields,
      error: null,
    });
  });

program
  .command("protocol-snapshot")
  .description("Fetch detailed data for a single protocol")
  .requiredOption("--protocol <name>", "Protocol to inspect: stacking | zest | bitflow")
  .action(async (opts: { protocol: string }) => {
    let result: YieldResult;

    switch (opts.protocol) {
      case "stacking":
        result = await fetchStackingYield();
        break;
      case "zest":
        result = await fetchZestYield();
        break;
      case "bitflow":
        result = await fetchBitflowPools();
        break;
      default:
        output({
          status: "error",
          timestamp: new Date().toISOString(),
          error: `Unknown protocol "${opts.protocol}". Valid options: stacking, zest, bitflow`,
        });
        process.exit(1);
    }

    output({
      status: result.apy_pct !== null ? "success" : "partial",
      timestamp: new Date().toISOString(),
      data: result,
      error: result.apy_pct === null ? (result.note ?? "No data available") : null,
    });
  });

program.parseAsync(process.argv);
