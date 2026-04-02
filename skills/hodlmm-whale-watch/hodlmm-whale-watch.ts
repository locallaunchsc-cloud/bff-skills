#!/usr/bin/env bun
/**
 * hodlmm-whale-watch — HODLMM Whale Position Monitor
 *
 * Detects large LP position changes across HODLMM pools by scanning
 * recent on-chain events and ranking wallets by liquidity size.
 * Surfaces smart-money entry/exit signals to help agents time
 * deposits and withdrawals around whale activity.
 *
 * Read-only: no wallet required. Uses Bitflow + Hiro APIs only.
 *
 * Commands:
 *   scan  — scan a pool for top LP holders and recent large changes
 *   watch — poll a pool on interval, alert when whale threshold is crossed
 */

import { Command } from "commander";

const BITFLOW_API = "https://api.bitflow.finance/api/v1";
const BFF_API = "https://bff.bitflowapis.finance";
const HIRO_API = "https://api.hiro.so";
const FETCH_TIMEOUT = 30_000;
const DEFAULT_WHALE_THRESHOLD = 1_000_000; // sats
const DEFAULT_TOP_N = 10;
const DEFAULT_INTERVAL = 120;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolInfo {
  pool_id: string;
  token_x_symbol?: string;
  token_y_symbol?: string;
  active_bin: number;
  total_liquidity?: string;
}

interface PositionHolder {
  address: string;
  total_liquidity: number;
  bin_count: number;
  bins: { bin_id: number; user_liquidity: number }[];
}

interface WhaleAlert {
  address: string;
  liquidity_sats: number;
  change_pct: number;
  signal: "WHALE_ENTRY" | "WHALE_EXIT" | "WHALE_INCREASE" | "WHALE_DECREASE";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`API ${res.status} from ${url}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

function printJson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, null, 2));
}

function exitWithError(message: string): never {
  printJson({ error: message });
  process.exit(1);
}

async function getPoolInfo(poolId: string): Promise<PoolInfo> {
  return fetchJson<PoolInfo>(`${BITFLOW_API}/hodlmm/pools/${poolId}`);
}

async function getPoolHolders(
  poolId: string,
  topN: number
): Promise<PositionHolder[]> {
  try {
    const url = `${BFF_API}/api/app/v1/pools/${poolId}/holders?limit=${topN}`;
    const data = await fetchJson<{ holders?: PositionHolder[]; positions?: PositionHolder[] }>(url);
    const raw = data.holders ?? data.positions ?? [];
    return raw.slice(0, topN).map((h) => ({
      address: h.address,
      total_liquidity: Number(h.total_liquidity ?? 0),
      bin_count: h.bin_count ?? (h.bins?.length ?? 0),
      bins: (h.bins ?? []).map((b) => ({
        bin_id: Number(b.bin_id),
        user_liquidity: Number(b.user_liquidity ?? 0),
      })),
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ warning: `getPoolHolders failed: ${msg}` }));
    return [];
  }
}

function classifyWhaleSignal(
  current: number,
  previous: number | null,
  threshold: number
): WhaleAlert["signal"] | null {
  if (previous !== null && previous >= threshold && current < threshold) return "WHALE_EXIT";
  if (current < threshold) return null;
  if (previous === null) return "WHALE_ENTRY";
  if (previous === 0) return "WHALE_ENTRY";
  const changePct = ((current - previous) / previous) * 100;
  if (changePct > 20) return "WHALE_INCREASE";
  if (changePct < -20) return "WHALE_DECREASE";
return null;
}

// ---------------------------------------------------------------------------
// scan command
// ---------------------------------------------------------------------------

async function cmdScan(opts: {
  poolId: string;
  topN: number;
  threshold: number;
}): Promise<void> {
  let pool: PoolInfo;
  try {
    pool = await getPoolInfo(opts.poolId);
  } catch (e) {
    exitWithError(`Failed to fetch pool ${opts.poolId}: ${(e as Error).message}`);
  }

  const holders = await getPoolHolders(opts.poolId, opts.topN);

  if (holders.length === 0) {
    printJson({
      pool_id: opts.poolId,
      token_x: pool.token_x_symbol ?? "unknown",
      token_y: pool.token_y_symbol ?? "unknown",
      warning: "No holder data available from API — pool may be new or API endpoint differs.",
      top_holders: [],
      whale_alerts: [],
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const whaleAlerts: WhaleAlert[] = [];
  const topHolders = holders.map((h) => {
    const signal = classifyWhaleSignal(h.total_liquidity, null, opts.threshold);
    if (signal) {
      whaleAlerts.push({
        address: h.address,
        liquidity_sats: h.total_liquidity,
        change_pct: 0,
        signal,
      });
    }
    return {
      address: h.address,
      total_liquidity_sats: h.total_liquidity,
      bin_count: h.bin_count,
      is_whale: h.total_liquidity >= opts.threshold,
    };
  });

  const totalLiquidity = topHolders.reduce(
    (sum, h) => sum + h.total_liquidity_sats,
    0
  );
  const whaleCount = topHolders.filter((h) => h.is_whale).length;
  const whaleConcentration =
    totalLiquidity > 0
      ? (topHolders
          .filter((h) => h.is_whale)
          .reduce((s, h) => s + h.total_liquidity_sats, 0) /
          totalLiquidity) *
        100
      : 0;

  printJson({
    pool_id: opts.poolId,
    token_x: pool.token_x_symbol ?? "unknown",
    token_y: pool.token_y_symbol ?? "unknown",
    active_bin: pool.active_bin,
    top_n: opts.topN,
    whale_threshold_sats: opts.threshold,
    whale_count: whaleCount,
    whale_concentration_pct: Math.round(whaleConcentration * 10) / 10,
    smart_money_signal: whaleConcentration > 50 ? "CONCENTRATED" : "DISTRIBUTED",
    top_holders: topHolders,
    whale_alerts: whaleAlerts,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// watch command
// ---------------------------------------------------------------------------

async function cmdWatch(opts: {
  poolId: string;
  topN: number;
  threshold: number;
  intervalSeconds: number;
}): Promise<void> {
  const previousSnapshot = new Map<string, number>();
  let cycle = 0;

  const poll = async (): Promise<void> => {
    cycle++;
    try {
      const holders = await getPoolHolders(opts.poolId, opts.topN);
      const alerts: WhaleAlert[] = [];

      for (const h of holders) {
        const prev = previousSnapshot.get(h.address) ?? null;
        const signal = classifyWhaleSignal(h.total_liquidity, prev, opts.threshold);
        if (signal) {
          const changePct =
            prev !== null && prev > 0
              ? Math.round(((h.total_liquidity - prev) / prev) * 1000) / 10
              : 0;
          alerts.push({
            address: h.address,
            liquidity_sats: h.total_liquidity,
            change_pct: changePct,
            signal,
          });
        }
        previousSnapshot.set(h.address, h.total_liquidity);
      }

      printJson({
        cycle,
        pool_id: opts.poolId,
        timestamp: new Date().toISOString(),
        holders_scanned: holders.length,
        whale_alerts: alerts,
        alert_count: alerts.length,
      });
    } catch (e) {
      printJson({
        cycle,
        pool_id: opts.poolId,
        timestamp: new Date().toISOString(),
        error: (e as Error).message,
        whale_alerts: [],
        alert_count: 0,
      });
    }
  };

  while (true) {
    await poll();
    await new Promise((resolve) =>
      setTimeout(resolve, opts.intervalSeconds * 1_000)
    );
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("hodlmm-whale-watch")
  .description(
    "Monitors HODLMM pool LP positions for whale activity. " +
      "Detects large entries, exits, and position changes to surface smart-money signals."
  )
  .version("1.0.0");

program
  .command("scan")
  .description(
    "One-shot scan of top LP holders in a HODLMM pool. " +
      "Returns ranked holders, whale count, and concentration metrics. Read-only."
  )
  .requiredOption("--pool-id <id>", "HODLMM pool identifier (e.g. dlmm_3)")
  .option(
    "--top-n <n>",
    "Number of top holders to fetch (default: 10)",
    String(DEFAULT_TOP_N)
  )
  .option(
    "--threshold <sats>",
    "Minimum liquidity in sats to classify as whale (default: 1000000)",
    String(DEFAULT_WHALE_THRESHOLD)
  )
  .action(
    async (opts: { poolId: string; topN: string; threshold: string }) => {
      const topN = parseInt(opts.topN, 10);
      const threshold = parseInt(opts.threshold, 10);
      if (isNaN(topN) || topN < 1)
        exitWithError("--top-n must be a positive integer");
      if (isNaN(threshold) || threshold < 0)
        exitWithError("--threshold must be a non-negative integer");
      await cmdScan({ poolId: opts.poolId, topN, threshold });
    }
  );

program
  .command("watch")
  .description(
    "Continuously polls a HODLMM pool and emits alerts when whale " +
      "position changes are detected. Runs until killed."
  )
  .requiredOption("--pool-id <id>", "HODLMM pool identifier")
  .option("--top-n <n>", "Number of top holders to track", String(DEFAULT_TOP_N))
  .option(
    "--threshold <sats>",
    "Whale threshold in sats",
    String(DEFAULT_WHALE_THRESHOLD)
  )
  .option(
    "--interval-seconds <s>",
    "Poll interval in seconds (default: 120)",
    String(DEFAULT_INTERVAL)
  )
  .action(
    async (opts: {
      poolId: string;
      topN: string;
      threshold: string;
      intervalSeconds: string;
    }) => {
      const topN = parseInt(opts.topN, 10);
      const threshold = parseInt(opts.threshold, 10);
      const intervalSeconds = parseInt(opts.intervalSeconds, 10);
      if (isNaN(topN) || topN < 1)
        exitWithError("--top-n must be a positive integer");
      if (isNaN(threshold) || threshold < 0)
        exitWithError("--threshold must be a non-negative integer");
      if (isNaN(intervalSeconds) || intervalSeconds < 1)
        exitWithError("--interval-seconds must be a positive integer");
      await cmdWatch({ poolId: opts.poolId, topN, threshold, intervalSeconds });
    }
  );

program.parseAsync(process.argv).catch((e: unknown) => {
  exitWithError(e instanceof Error ? e.message : String(e));
});
