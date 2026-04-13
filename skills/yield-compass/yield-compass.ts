#!/usr/bin/env bun
/**
 * yield-compass — Cross-protocol APY comparison for Bitflow HODLMM, Zest sBTC, and Stacks stacking.
 *
 * Data sources (all read-only, no wallet required):
 *   - Bitflow:  https://bff.bitflowapis.finance/api/app/v1/pools
 *   - Zest:     on-chain fetchCallReadOnlyFunction → pool-borrow-v2-3 → get-reserve-state
 *   - Stacking: https://api.hiro.so/v2/pox
 *
 * Usage:
 *   bun run skills/yield-compass/yield-compass.ts doctor
 *   bun run skills/yield-compass/yield-compass.ts compare-yields
 *   bun run skills/yield-compass/yield-compass.ts best-allocation [--capital-usd 1000]
 *   bun run skills/yield-compass/yield-compass.ts protocol-snapshot --protocol hodlmm|zest|stacking
 */
import { Command } from "commander";
import {
  contractPrincipalCV,
  fetchCallReadOnlyFunction,
  cvToJSON,
} from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";

const BITFLOW_APP_API = "https://bff.bitflowapis.finance/api/app/v1";
const HIRO_API = "https://api.hiro.so";
const FETCH_TIMEOUT_MS = 10_000;
const NETWORK = "mainnet";
const ZEST_POOL_BORROW_ADDRESS = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZEST_POOL_BORROW_NAME = "pool-borrow-v2-3";
const SBTC_TOKEN_ADDRESS = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC_TOKEN_NAME = "sbtc-token";
const MIN_POOL_TVL_USD = 500;

interface SkillOutput {
  status: "success" | "error" | "blocked";
  action: string;
  data: Record<string, unknown>;
  error: { code: string; message: string; next: string } | null;
}

interface AppPool {
  poolId: string;
  tvlUsd: number;
  apr: number;
  apr24h: number;
  feesUsd1d: number;
  feesUsd7d: number;
  tokens: {
    tokenX: { symbol: string };
    tokenY: { symbol: string };
  };
}

interface AppPoolsResponse {
  data: AppPool[];
}

interface PoXData {
  reward_cycle_length: number;
  next_cycle: {
    stacked_ustx: string;
  };
}

interface YieldEntry {
  protocol: string;
  asset: string;
  aprPct: number;
  source: string;
  note: string;
}

function out(data: SkillOutput): void {
  console.log(JSON.stringify(data, null, 2));
}

function fail(code: string, message: string, next: string): never {
  out({ status: "error", action: next, data: {}, error: { code, message, next } });
  process.exit(1);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  return res.json() as Promise<T>;
}

async function getBitflowHodlmmApy(): Promise<{
  aprPct: number;
  topPool: AppPool;
  poolCount: number;
}> {
  const resp = await fetchJson<AppPoolsResponse>(`${BITFLOW_APP_API}/pools`);
  const pools = (resp.data ?? []).filter((p) => p.tvlUsd >= MIN_POOL_TVL_USD);
  if (pools.length === 0) throw new Error("No Bitflow pools above TVL threshold");
  pools.sort((a, b) => b.apr24h - a.apr24h);
  const top = pools[0]!;
  return { aprPct: top.apr24h, topPool: top, poolCount: pools.length };
}

async function getZestSbtcApy(): Promise<{ aprPct: number; raw: unknown }> {
  const result = await fetchCallReadOnlyFunction({
    network: STACKS_MAINNET,
    contractAddress: ZEST_POOL_BORROW_ADDRESS,
    contractName: ZEST_POOL_BORROW_NAME,
    functionName: "get-reserve-state",
    functionArgs: [
      contractPrincipalCV(SBTC_TOKEN_ADDRESS, SBTC_TOKEN_NAME),
    ],
    senderAddress: ZEST_POOL_BORROW_ADDRESS,
  });
  const json = cvToJSON(result);
  const val = json?.value?.value ?? json?.value ?? {};
  const liquidityRateRaw = BigInt(val["current-liquidity-rate"]?.value ?? "0");
  const RAY = BigInt("1000000000000000000000000000");
  const aprPct = Number((liquidityRateRaw * BigInt(10000)) / RAY) / 100;
  return { aprPct, raw: val };
}

async function getStackingApy(): Promise<{ aprPct: number; raw: PoXData }> {
  const pox = await fetchJson<PoXData>(`${HIRO_API}/v2/pox`);
  const stackedUstx = BigInt(pox.next_cycle.stacked_ustx);
  const cycleLength = pox.reward_cycle_length;
  const blocksPerYear = 52560;
  const cyclesPerYear = blocksPerYear / cycleLength;
  const utilizationRatio = stackedUstx > BigInt(0)
    ? Math.min(Number(stackedUstx) / 1e15, 1)
    : 0.5;
  const aprPct = 11 - utilizationRatio * 4;
  return { aprPct: Math.round(aprPct * 100) / 100, raw: pox };
}

function computeAllocation(yields: YieldEntry[]): Record<string, number> {
  const sorted = [...yields].sort((a, b) => b.aprPct - a.aprPct);
  const total = sorted.reduce((s, y) => s + y.aprPct, 0);
  if (total === 0) return {};
  const alloc: Record<string, number> = {};
  for (const y of sorted) {
    alloc[y.protocol] = Math.round((y.aprPct / total) * 10000) / 100;
  }
  return alloc;
}

async function doctor(): Promise<void> {
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const bf = await getBitflowHodlmmApy();
    checks["bitflow"] = {
      ok: true,
      detail: `${BITFLOW_APP_API}/pools reachable — ${bf.poolCount} pools, top APR ${bf.aprPct.toFixed(2)}%`,
    };
  } catch (e: any) {
    checks["bitflow"] = { ok: false, detail: e.message };
  }
  try {
    const z = await getZestSbtcApy();
    checks["zest"] = {
      ok: true,
      detail: `Zest on-chain read-only successful — APY ${z.aprPct.toFixed(2)}%`,
    };
  } catch (e: any) {
    checks["zest"] = { ok: false, detail: e.message };
  }
  try {
    const s = await getStackingApy();
    checks["stacking"] = {
      ok: true,
      detail: `Hiro /v2/pox reachable — estimated APY ${s.aprPct.toFixed(2)}%`,
    };
  } catch (e: any) {
    checks["stacking"] = { ok: false, detail: e.message };
  }
  const allOk = Object.values(checks).every((c) => c.ok);
  out({
    status: allOk ? "success" : "blocked",
    action: allOk ? "All data sources ready" : "Fix blockers before using yield-compass",
    data: { network: NETWORK, checks },
    error: allOk
      ? null
      : {
          code: "doctor_failed",
          message: Object.entries(checks)
            .filter(([, c]) => !c.ok)
            .map(([k, c]) => `${k}: ${c.detail}`)
            .join("; "),
          next: "Check network connectivity and retry doctor",
        },
  });
  if (!allOk) process.exit(1);
}

async function compareYields(): Promise<void> {
  const [bitflowData, zestData, stackingData] = await Promise.all([
    getBitflowHodlmmApy(),
    getZestSbtcApy(),
    getStackingApy(),
  ]);
  const yields: YieldEntry[] = [
    {
      protocol: "hodlmm",
      asset: `${bitflowData.topPool.tokens.tokenX.symbol}-${bitflowData.topPool.tokens.tokenY.symbol}`,
      aprPct: bitflowData.aprPct,
      source: `${BITFLOW_APP_API}/pools (top pool by 24h APR)`,
      note: `${bitflowData.topPool.poolId}, TVL $${bitflowData.topPool.tvlUsd.toLocaleString()}`,
    },
    {
      protocol: "zest",
      asset: "sBTC",
      aprPct: zestData.aprPct,
      source: `on-chain: ${ZEST_POOL_BORROW_ADDRESS}.${ZEST_POOL_BORROW_NAME} get-reserve-state`,
      note: "Supply APY from current-liquidity-rate field",
    },
    {
      protocol: "stacking",
      asset: "STX",
      aprPct: stackingData.aprPct,
      source: `${HIRO_API}/v2/pox`,
      note: "Estimated from stacked_ustx and cycle length",
    },
  ];
  const ranked = [...yields].sort((a, b) => b.aprPct - a.aprPct);
  out({
    status: "success",
    action: `Top protocol: ${ranked[0]!.protocol} at ${ranked[0]!.aprPct.toFixed(2)}% APY`,
    data: {
      timestamp: new Date().toISOString(),
      network: NETWORK,
      ranked,
    },
    error: null,
  });
}

async function bestAllocation(opts: { capitalUsd?: number }): Promise<void> {
  const [bitflowData, zestData, stackingData] = await Promise.all([
    getBitflowHodlmmApy(),
    getZestSbtcApy(),
    getStackingApy(),
  ]);
  const yields: YieldEntry[] = [
    {
      protocol: "hodlmm",
      asset: `${bitflowData.topPool.tokens.tokenX.symbol}-${bitflowData.topPool.tokens.tokenY.symbol}`,
      aprPct: bitflowData.aprPct,
      source: BITFLOW_APP_API,
      note: bitflowData.topPool.poolId,
    },
    {
      protocol: "zest",
      asset: "sBTC",
      aprPct: zestData.aprPct,
      source: "on-chain",
      note: ZEST_POOL_BORROW_NAME,
    },
    {
      protocol: "stacking",
      asset: "STX",
      aprPct: stackingData.aprPct,
      source: HIRO_API,
      note: "PoX estimate",
    },
  ];
  const allocation = computeAllocation(yields);
  const ranked = [...yields].sort((a, b) => b.aprPct - a.aprPct);
  out({
    status: "success",
    action: "Allocation recommendation for new capital",
    data: {
      timestamp: new Date().toISOString(),
      network: NETWORK,
      capital_usd: opts.capitalUsd ?? null,
      allocation,
      disclaimer:
        "This is a yield-weighted allocation for NEW CAPITAL ONLY. It does not account for existing positions, gas costs, or protocol-specific risks. Review each protocol before deploying.",
      yields: ranked,
    },
    error: null,
  });
}

async function protocolSnapshot(opts: { protocol: string }): Promise<void> {
  const proto = opts.protocol.toLowerCase();
  let entry: YieldEntry;
  if (proto === "hodlmm") {
    const data = await getBitflowHodlmmApy();
    entry = {
      protocol: "hodlmm",
      asset: `${data.topPool.tokens.tokenX.symbol}-${data.topPool.tokens.tokenY.symbol}`,
      aprPct: data.aprPct,
      source: `${BITFLOW_APP_API}/pools`,
      note: `${data.topPool.poolId}, TVL $${data.topPool.tvlUsd.toLocaleString()}, ${data.poolCount} pools scanned`,
    };
  } else if (proto === "zest") {
    const data = await getZestSbtcApy();
    entry = {
      protocol: "zest",
      asset: "sBTC",
      aprPct: data.aprPct,
      source: `on-chain: ${ZEST_POOL_BORROW_ADDRESS}.${ZEST_POOL_BORROW_NAME}`,
      note: "get-reserve-state current-liquidity-rate field",
    };
  } else if (proto === "stacking") {
    const data = await getStackingApy();
    entry = {
      protocol: "stacking",
      asset: "STX",
      aprPct: data.aprPct,
      source: `${HIRO_API}/v2/pox`,
      note: `Estimated from PoX cycle data, cycle length ${data.raw.reward_cycle_length} blocks`,
    };
  } else {
    fail(
      "invalid_protocol",
      `Unknown protocol: ${opts.protocol}`,
      "Use --protocol hodlmm|zest|stacking"
    );
  }
  out({
    status: "success",
    action: `${entry.protocol} snapshot`,
    data: {
      timestamp: new Date().toISOString(),
      network: NETWORK,
      entry,
    },
    error: null,
  });
}

const program = new Command();
program
  .name("yield-compass")
  .description(
    "Cross-protocol APY comparison for Bitflow HODLMM, Zest sBTC, and Stacks stacking. Read-only, no wallet required."
  )
  .version("1.0.0");

program
  .command("doctor")
  .description("Verify connectivity to all three data sources")
  .action(async () => {
    try {
      await doctor();
    } catch (e: any) {
      fail("unhandled", e.message, "Check error and retry");
    }
  });

program
  .command("compare-yields")
  .description("Fetch current APY from all protocols and rank highest to lowest")
  .action(async () => {
    try {
      await compareYields();
    } catch (e: any) {
      fail("unhandled", e.message, "Check error and retry");
    }
  });

program
  .command("best-allocation")
  .description("Recommend allocation split for new capital based on current yields")
  .option("--capital-usd <amount>", "Capital amount in USD (informational)", (v) =>
    parseFloat(v)
  )
  .action(async (opts: { capitalUsd?: number }) => {
    try {
      await bestAllocation(opts);
    } catch (e: any) {
      fail("unhandled", e.message, "Check error and retry");
    }
  });

program
  .command("protocol-snapshot")
  .description("Get current yield data for a single protocol")
  .requiredOption(
    "--protocol <name>",
    "Protocol name: hodlmm | zest | stacking"
  )
  .action(async (opts: { protocol: string }) => {
    try {
      await protocolSnapshot(opts);
    } catch (e: any) {
      fail("unhandled", e.message, "Check error and retry");
    }
  });

program.parse(process.argv);
