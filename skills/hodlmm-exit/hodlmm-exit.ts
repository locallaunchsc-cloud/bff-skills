#!/usr/bin/env bun
/**
 * hodlmm-exit — Autonomous HODLMM LP Emergency Exit
 *
 * Monitors HODLMM pool volatility and withdraws LP position when the crisis
 * threshold is breached. Action layer that completes hodlmm-risk:
 * detect crisis -> exit position -> return capital.
 *
 * Self-contained: Bitflow + Hiro APIs only. No external dependencies beyond
 * commander and @stacks/transactions.
 *
 * Commands:
 *   assess   — read-only regime check + position valuation. No wallet required.
 *   execute  — immediately withdraws full LP position. Requires STACKS_PRIVATE_KEY.
 *   monitor  — polls regime on interval, auto-withdraws on crisis. Requires STACKS_PRIVATE_KEY.
 *
 * HODLMM bonus eligible: Yes — directly acts on HODLMM pool positions.
 */

import { Command } from "commander";
import {
  makeContractCall,
  broadcastTransaction,
  listCV,
  tupleCV,
  uintCV,
  PostConditionMode,
  AnchorMode,
} from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BITFLOW_API     = "https://api.bitflow.finance/api/v1";
const BFF_API         = "https://bff.bitflowapis.finance";
const NETWORK         = "mainnet";
const FETCH_TIMEOUT   = 30_000;
const DEFAULT_THRESHOLD = 61;
const DEFAULT_INTERVAL  = 60;
const TX_FEE_USTX       = 25_000n;

// Spread (40%) + Reserve Imbalance (30%) + Liquidity Concentration (30%) = 100
const SPREAD_WEIGHT        = 40;
const IMBALANCE_WEIGHT     = 30;
const CONCENTRATION_WEIGHT = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolInfo {
  active_bin:      number;
  token_x:         string;
  token_y:         string;
  token_x_symbol?: string;
  token_y_symbol?: string;
  contract_id?:    string;
  pool_contract?:  string;
}

interface BinData {
  bin_id:           number;
  reserve_x:        string;
  reserve_y:        string;
}

interface PositionBin {
  bin_id:          number;
  user_liquidity?: string | number;
  reserve_x?:      string;
  reserve_y?:      string;
}

interface BinListResponse {
  active_bin_id?: number;
  bins:           BinData[];
}

interface UserPositionResponse {
  bins?:          PositionBin[];
  position_bins?: PositionBin[];
  positions?:     { bins?: PositionBin[] };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`API ${res.status} from ${url}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function getPoolInfo(poolId: string): Promise<PoolInfo> {
  return fetchJson<PoolInfo>(`${BITFLOW_API}/hodlmm/pools/${poolId}`);
}

async function getPoolBins(poolId: string): Promise<BinListResponse> {
  return fetchJson<BinListResponse>(`${BITFLOW_API}/hodlmm/pools/${poolId}/bins`);
}

async function getUserPositionBins(address: string, poolId: string): Promise<PositionBin[] | null> {
  const url = `${BFF_API}/api/app/v1/users/${address}/positions/${poolId}/bins`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Position API ${res.status}: ${res.statusText}`);
  const data = await res.json() as UserPositionResponse;
  return (
    Array.isArray(data?.bins)            ? data.bins :
    Array.isArray(data?.position_bins)   ? data.position_bins :
    Array.isArray(data?.positions?.bins) ? (data.positions?.bins ?? []) :
    []
  );
}

// ---------------------------------------------------------------------------
// Risk / regime helpers (identical weights to hodlmm-risk)
// ---------------------------------------------------------------------------

function classifyRegime(score: number): "calm" | "elevated" | "crisis" {
  if (score <= 30) return "calm";
  if (score <= 60) return "elevated";
  return "crisis";
}

function computeVolatilityScore(pool: PoolInfo, binsResp: BinListResponse): {
  score: number;
  regime: "calm" | "elevated" | "crisis";
  activeBinId: number;
  totalBins: number;
} {
  const bins       = binsResp.bins;
  const activeBinId = binsResp.active_bin_id ?? pool.active_bin;
  if (activeBinId == null) throw new Error("Cannot determine active bin");

  const nonEmpty = bins.filter(b => Number(b.reserve_x) > 0 || Number(b.reserve_y) > 0);
  if (nonEmpty.length === 0) throw new Error("Pool has no active liquidity — all bins empty");

  const ids    = nonEmpty.map(b => b.bin_id);
  const minBin = Math.min(...ids);
  const maxBin = Math.max(...ids);
  const binSpread = bins.length > 0 ? (maxBin - minBin) / Math.max(bins.length, 1) : 0;

  let totalX = 0, totalY = 0;
  for (const b of bins) { totalX += Number(b.reserve_x); totalY += Number(b.reserve_y); }
  const totalReserves       = totalX + totalY;
  const reserveImbalance    = totalReserves > 0 ? Math.abs(totalX - totalY) / totalReserves : 0;
  const activeBin           = bins.find(b => b.bin_id === activeBinId);
  const activeLiquidity     = activeBin ? Number(activeBin.reserve_x) + Number(activeBin.reserve_y) : 0;
  const activeBinConcentration = totalReserves > 0 ? activeLiquidity / totalReserves : 0;

  const spreadScore        = Math.min(binSpread * 100, SPREAD_WEIGHT);
  const imbalanceScore     = reserveImbalance * IMBALANCE_WEIGHT;
  const concentrationScore = (1 - activeBinConcentration) * CONCENTRATION_WEIGHT;
  const score              = Math.round(Math.min(spreadScore + imbalanceScore + concentrationScore, 100));

  return { score, regime: classifyRegime(score), activeBinId, totalBins: bins.length };
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

function getActiveBins(positionBins: PositionBin[]): PositionBin[] {
  return positionBins.filter(b => {
    const liq = typeof b.user_liquidity === "number"
      ? b.user_liquidity
      : parseFloat(String(b.user_liquidity ?? "0"));
    return liq > 0;
  });
}

function computePositionValueSats(positionBins: PositionBin[]): number {
  // Sum user_liquidity across all position bins as sats proxy.
  // For BTC-paired pools, reserve_x is denominated in sats; user_liquidity
  // represents proportional shares — treated as sats equivalent here.
  return positionBins.reduce((sum, b) => {
    const liq = typeof b.user_liquidity === "number"
      ? b.user_liquidity
      : parseFloat(String(b.user_liquidity ?? "0"));
    return sum + Math.max(0, liq);
  }, 0);
}

function countBinsInRange(positionBins: PositionBin[], activeBinId: number): number {
  const active = getActiveBins(positionBins);
  const ids    = active.map(b => b.bin_id);
  const min    = Math.min(...ids);
  const max    = Math.max(...ids);
  return (activeBinId >= min && activeBinId <= max) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printJson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, null, 2));
}

function exitWithError(message: string): never {
  printJson({ error: message });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Crisis-mode API fallback
// If Bitflow API is unreachable, treat as score 100 (conservative fail-safe).
// ---------------------------------------------------------------------------

async function safeGetRegime(poolId: string, pool: PoolInfo): Promise<{
  score: number;
  regime: "calm" | "elevated" | "crisis";
  activeBinId: number;
  totalBins: number;
  apiDown: boolean;
}> {
  try {
    const binsResp = await getPoolBins(poolId);
    const metrics  = computeVolatilityScore(pool, binsResp);
    return { ...metrics, apiDown: false };
  } catch {
    // Conservative fail-safe: unreachable API = treat as crisis
    return {
      score:       100,
      regime:      "crisis",
      activeBinId: pool.active_bin,
      totalBins:   0,
      apiDown:     true,
    };
  }
}

// ---------------------------------------------------------------------------
// assess
// ---------------------------------------------------------------------------

async function cmdAssess(opts: {
  poolId:    string;
  address:   string;
  threshold: number;
}): Promise<void> {
  let pool: PoolInfo;
  try { pool = await getPoolInfo(opts.poolId); }
  catch (e) { exitWithError(`Failed to fetch pool ${opts.poolId}: ${(e as Error).message}`); }

  const regime = await safeGetRegime(opts.poolId, pool);

  const positionBins = await getUserPositionBins(opts.address, opts.poolId);
  if (positionBins === null) exitWithError(`No position found for ${opts.address} in pool ${opts.poolId}`);

  const activeBins     = getActiveBins(positionBins);
  const posValueSats   = computePositionValueSats(activeBins);
  const binsInRange    = activeBins.length > 0 ? countBinsInRange(activeBins, regime.activeBinId) : 0;

  printJson({
    network:             NETWORK,
    poolId:              opts.poolId,
    address:             opts.address,
    would_trigger:       regime.score >= opts.threshold,
    regime:              regime.regime,
    regime_score:        regime.score,
    threshold:           opts.threshold,
    safe_to_add:         regime.regime !== "crisis",
    position_value_sats: Math.round(posValueSats),
    bins_in_range:       binsInRange,
    total_bins:          activeBins.length,
    ...(regime.apiDown ? { warning: "Bitflow API unreachable — score set to 100 (fail-safe)" } : {}),
    timestamp:           new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// withdraw (shared core for execute + monitor trigger)
// ---------------------------------------------------------------------------

async function withdrawPosition(opts: {
  poolId:    string;
  address:   string;
  privateKey: string;
}): Promise<{
  triggered:    true;
  regime:       string;
  regime_score: number;
  tx_id:        string;
  sats_returned: number;
  bins_removed: number;
  timestamp:    string;
}> {
  // 1. Fetch pool info + bins
  let pool: PoolInfo;
  try { pool = await getPoolInfo(opts.poolId); }
  catch (e) { throw new Error(`Cannot fetch pool: ${(e as Error).message}`); }

  const regime = await safeGetRegime(opts.poolId, pool);

  // 2. Fetch user position
  const positionBins = await getUserPositionBins(opts.address, opts.poolId);
  if (positionBins === null) {
    throw new Error(`No position found for ${opts.address} in pool ${opts.poolId}`);
  }

  const activeBins = getActiveBins(positionBins);
  if (activeBins.length === 0) {
    throw new Error("Position has zero shares — nothing to withdraw");
  }

  // 3. Resolve the pool contract
  const contractId = pool.contract_id ?? pool.pool_contract;
  if (!contractId || !contractId.includes(".")) {
    throw new Error(
      `Pool ${opts.poolId} response missing contract_id. ` +
      `Cannot construct withdrawal transaction without the pool contract address.`
    );
  }
  const [contractAddress, contractName] = contractId.split(".");

  // 4. Build Clarity args: (list (tuple (bin-id uint) (shares uint)))
  const binArgs = listCV(
    activeBins.map(b =>
      tupleCV({
        "bin-id": uintCV(b.bin_id),
        "shares": uintCV(BigInt(Math.round(
          typeof b.user_liquidity === "number"
            ? b.user_liquidity
            : parseFloat(String(b.user_liquidity ?? "0"))
        ))),
      })
    )
  );

  // 5. Construct + sign transaction with PostConditionMode.Deny
  //    Deny mode: transaction aborts if any post conditions fail — capital protection.
  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName:    "remove-liquidity",
    functionArgs:    [binArgs],
    senderKey:       opts.privateKey,
    network:         STACKS_MAINNET,
    postConditionMode: PostConditionMode.Deny,
    anchorMode:      AnchorMode.Any,
    fee:             TX_FEE_USTX,
  });

  // 6. Broadcast
  const broadcast = await broadcastTransaction({ transaction: tx, network: STACKS_MAINNET });
  if ("error" in broadcast) {
    throw new Error(`Broadcast failed: ${broadcast.error} — ${broadcast.reason ?? ""}`);
  }

  const posValueSats = computePositionValueSats(activeBins);

  return {
    triggered:     true,
    regime:        regime.regime,
    regime_score:  regime.score,
    tx_id:         broadcast.txid,
    sats_returned: Math.round(posValueSats),
    bins_removed:  activeBins.length,
    timestamp:     new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

async function cmdExecute(opts: {
  poolId:  string;
  address: string;
}): Promise<void> {
  const privateKey = process.env.STACKS_PRIVATE_KEY;
  if (!privateKey) exitWithError("STACKS_PRIVATE_KEY env var not set");

  try {
    const result = await withdrawPosition({
      poolId:     opts.poolId,
      address:    opts.address,
      privateKey,
    });
    printJson(result);
  } catch (e) {
    exitWithError((e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// monitor
// ---------------------------------------------------------------------------

async function cmdMonitor(opts: {
  poolId:          string;
  address:         string;
  threshold:       number;
  intervalSeconds: number;
}): Promise<void> {
  const privateKey = process.env.STACKS_PRIVATE_KEY;
  if (!privateKey) exitWithError("STACKS_PRIVATE_KEY env var not set");

  const poll = async (): Promise<boolean> => {
    try {
      let pool: PoolInfo;
      try { pool = await getPoolInfo(opts.poolId); }
      catch { pool = { active_bin: 0, token_x: "", token_y: "" }; }

      const regime = await safeGetRegime(opts.poolId, pool);
      const triggered = regime.score >= opts.threshold;

      const cycleOutput: Record<string, unknown> = {
        timestamp:    new Date().toISOString(),
        triggered,
        regime_score: regime.score,
        threshold:    opts.threshold,
      };

      if (!triggered) {
        printJson(cycleOutput);
        return false;
      }

      // Threshold breached — execute withdrawal
      try {
        const result = await withdrawPosition({
          poolId:     opts.poolId,
          address:    opts.address,
          privateKey,
        });
        printJson(result);
        return true; // exit loop
      } catch (e) {
        printJson({
          ...cycleOutput,
          triggered:    false, // withdrawal failed, keep monitoring
          error:        (e as Error).message,
        });
        return false;
      }
    } catch (e) {
      printJson({
        timestamp: new Date().toISOString(),
        triggered: false,
        error:     (e as Error).message,
      });
      return false;
    }
  };

  // Poll loop — exits after successful withdrawal
  const run = async (): Promise<void> => {
    while (true) {
      const done = await poll();
      if (done) break;
      await new Promise(resolve => setTimeout(resolve, opts.intervalSeconds * 1_000));
    }
  };

  await run();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("hodlmm-exit")
  .description(
    "Autonomous HODLMM LP emergency exit — monitors volatility regime and withdraws " +
    "LP position when crisis threshold is breached."
  )
  .version("1.0.0");

program
  .command("assess")
  .description(
    "Dry run — evaluates current regime and position without executing any transaction. " +
    "Read-only: no wallet required."
  )
  .requiredOption("--pool-id <id>",     "HODLMM pool identifier (e.g. dlmm_3)")
  .requiredOption("--address <addr>",   "Stacks address to check")
  .option("--threshold <n>",            "Volatility score at which exit triggers (default: 61)", String(DEFAULT_THRESHOLD))
  .action(async (opts: { poolId: string; address: string; threshold: string }) => {
    const threshold = parseInt(opts.threshold, 10);
    if (isNaN(threshold) || threshold < 0 || threshold > 100) {
      exitWithError("--threshold must be a number between 0 and 100");
    }
    await cmdAssess({ poolId: opts.poolId, address: opts.address, threshold });
  });

program
  .command("execute")
  .description(
    "Immediately withdraws the full LP position regardless of current regime score. " +
    "Requires STACKS_PRIVATE_KEY env var."
  )
  .requiredOption("--pool-id <id>",   "HODLMM pool identifier")
  .requiredOption("--address <addr>", "Stacks address to withdraw from")
  .action(async (opts: { poolId: string; address: string }) => {
    await cmdExecute({ poolId: opts.poolId, address: opts.address });
  });

program
  .command("monitor")
  .description(
    "Polls regime on interval. Triggers withdrawal automatically when score >= threshold. " +
    "Exits after successful withdrawal. Requires STACKS_PRIVATE_KEY env var."
  )
  .requiredOption("--pool-id <id>",            "HODLMM pool identifier")
  .requiredOption("--address <addr>",          "Stacks address to monitor")
  .option("--threshold <n>",                   "Trigger threshold (default: 61)", String(DEFAULT_THRESHOLD))
  .option("--interval-seconds <n>",            "Poll interval in seconds (default: 60)", String(DEFAULT_INTERVAL))
  .action(async (opts: {
    poolId:          string;
    address:         string;
    threshold:       string;
    intervalSeconds: string;
  }) => {
    const threshold       = parseInt(opts.threshold, 10);
    const intervalSeconds = parseInt(opts.intervalSeconds, 10);
    if (isNaN(threshold) || threshold < 0 || threshold > 100) {
      exitWithError("--threshold must be a number between 0 and 100");
    }
    if (isNaN(intervalSeconds) || intervalSeconds < 1) {
      exitWithError("--interval-seconds must be a positive integer");
    }
    await cmdMonitor({
      poolId:          opts.poolId,
      address:         opts.address,
      threshold,
      intervalSeconds,
    });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  exitWithError(e instanceof Error ? e.message : String(e));
});
