import { SkillFunction } from "@bff/skills-lib";

const BITFLOW_API = "https://api.bitflow.finance/v1";
const ZEST_API = "https://api.zestprotocol.com/v1";
const STACKS_API = "https://api.mainnet.hiro.so";

interface YieldEntry {
  protocol: string;
  poolId?: string;
  pair?: string;
  asset?: string;
  estimatedApyPct: number;
  riskRegime?: string;
  volatilityScore?: number;
  source: string;
  details?: Record<string, unknown>;
}

interface CompareYieldsOutput {
  network: string;
  yields: YieldEntry[];
  bestYield: { protocol: string; estimatedApyPct: number };
  timestamp: string;
}

interface AllocationOutput {
  network: string;
  riskTolerance: string;
  allocation: {
    sbtc: { total_sats: number; hodlmm_pct: number; zest_pct: number; idle_pct: number };
    stx: { total_ustx: number; stacking_pct: number; hodlmm_pct: number; idle_pct: number };
  };
  reasoning: string;
  timestamp: string;
}

interface SnapshotOutput {
  network: string;
  protocol: string;
  poolId?: string;
  estimatedApyPct: number;
  details: Record<string, unknown>;
  timestamp: string;
}

async function fetchHodlmmYields(): Promise<YieldEntry[]> {
  try {
    const res = await fetch(`${BITFLOW_API}/hodlmm/pools`);
    if (!res.ok) throw new Error(`HODLMM API error: ${res.status}`);
    const data = await res.json();
    const pools: YieldEntry[] = (data.pools ?? []).map((p: Record<string, unknown>) => ({
      protocol: "bitflow-hodlmm",
      poolId: String(p.poolId ?? ""),
      pair: String(p.pair ?? ""),
      estimatedApyPct: Number(p.estimatedApyPct ?? 0),
      riskRegime: String(p.riskRegime ?? "unknown"),
      volatilityScore: Number(p.volatilityScore ?? 0),
      source: "lp-fees",
    }));
    return pools;
  } catch {
    return [];
  }
}

async function fetchZestYield(): Promise<YieldEntry | null> {
  try {
    const res = await fetch(`${ZEST_API}/sbtc/supply-rate`);
    if (!res.ok) throw new Error(`Zest API error: ${res.status}`);
    const data = await res.json();
    return {
      protocol: "zest",
      asset: "sBTC",
      estimatedApyPct: Number(data.supplyApyPct ?? 0),
      source: "lending-interest",
      details: { utilizationPct: data.utilizationPct },
    };
  } catch {
    return null;
  }
}

async function fetchStackingYield(): Promise<YieldEntry | null> {
  try {
    const res = await fetch(`${STACKS_API}/v2/pox`);
    if (!res.ok) throw new Error(`Stacks API error: ${res.status}`);
    const data = await res.json();
    const rewardCycleLengthBlocks = Number(data.reward_cycle_length ?? 2100);
    const cyclesPerYear = 52560 / rewardCycleLengthBlocks;
    const estimatedApyPct = Number(data.estimated_yield_pct ?? 8.0);
    return {
      protocol: "stacking",
      asset: "STX",
      estimatedApyPct,
      source: "consensus-rewards",
      details: {
        cycleLength: rewardCycleLengthBlocks,
        cyclesPerYear: Math.round(cyclesPerYear),
        currentCycle: data.reward_cycle_id,
      },
    };
  } catch {
    return null;
  }
}

export const run: SkillFunction = async ({ args }) => {
  const command = args?.[0] ?? "compare-yields";
  const timestamp = new Date().toISOString();

  if (command === "compare-yields") {
    const [hodlmmYields, zestYield, stackingYield] = await Promise.all([
      fetchHodlmmYields(),
      fetchZestYield(),
      fetchStackingYield(),
    ]);

    const yields: YieldEntry[] = [
      ...hodlmmYields,
      ...(zestYield ? [zestYield] : []),
      ...(stackingYield ? [stackingYield] : []),
    ];

    if (yields.length === 0) {
      console.log(JSON.stringify({ error: "All protocol APIs unreachable" }));
      return { output: "All protocol APIs unreachable" };
    }

    const best = yields.reduce((a, b) => (a.estimatedApyPct > b.estimatedApyPct ? a : b));

    const result: CompareYieldsOutput = {
      network: "mainnet",
      yields,
      bestYield: { protocol: best.protocol, estimatedApyPct: best.estimatedApyPct },
      timestamp,
    };

    console.log(JSON.stringify(result));
    return { output: JSON.stringify(result) };
  }

  if (command === "best-allocation") {
    const riskTolerance = args?.find((a) => a.startsWith("--risk-tolerance="))?.split("=")[1] ?? "balanced";
    const amountSbtcArg = args?.find((a) => a.startsWith("--amount-sbtc="))?.split("=")[1];
    const amountStxArg = args?.find((a) => a.startsWith("--amount-stx="))?.split("=")[1];
    const totalSbtcSats = amountSbtcArg ? parseInt(amountSbtcArg) : 0;
    const totalStxUstx = amountStxArg ? parseInt(amountStxArg) : 0;

    const [hodlmmYields, zestYield, stackingYield] = await Promise.all([
      fetchHodlmmYields(),
      fetchZestYield(),
      fetchStackingYield(),
    ]);

    const hodlmmInCrisis = hodlmmYields.some((y) => y.riskRegime === "crisis");
    const hodlmmApy = hodlmmInCrisis ? 0 : (hodlmmYields[0]?.estimatedApyPct ?? 0);
    const zestApy = zestYield?.estimatedApyPct ?? 0;
    const stackingApy = stackingYield?.estimatedApyPct ?? 0;

    let hodlmmSbtcPct = riskTolerance === "aggressive" ? 50 : riskTolerance === "conservative" ? 20 : 40;
    let zestSbtcPct = riskTolerance === "aggressive" ? 30 : riskTolerance === "conservative" ? 50 : 35;
    let idleSbtcPct = 100 - hodlmmSbtcPct - zestSbtcPct;
    let hodlmmStxPct = riskTolerance === "aggressive" ? 30 : riskTolerance === "conservative" ? 10 : 25;
    let stackingStxPct = riskTolerance === "aggressive" ? 50 : riskTolerance === "conservative" ? 70 : 60;
    let idleStxPct = 100 - hodlmmStxPct - stackingStxPct;

    if (hodlmmInCrisis) {
      zestSbtcPct += hodlmmSbtcPct;
      hodlmmSbtcPct = 0;
      stackingStxPct += hodlmmStxPct;
      hodlmmStxPct = 0;
      idleSbtcPct = 100 - zestSbtcPct;
      idleStxPct = 100 - stackingStxPct;
    }

    const reasoning = hodlmmInCrisis
      ? `HODLMM in crisis regime — HODLMM allocation set to 0%. Reallocated to Zest (sBTC ${zestApy.toFixed(1)}% APY) and Stacking (${stackingApy.toFixed(1)}% APY).`
      : `HODLMM regime is calm (APY ${hodlmmApy.toFixed(1)}%). Zest at ${zestApy.toFixed(1)}% APY. Stacking at ${stackingApy.toFixed(1)}% APY.`;

    const result: AllocationOutput = {
      network: "mainnet",
      riskTolerance,
      allocation: {
        sbtc: {
          total_sats: totalSbtcSats,
          hodlmm_pct: hodlmmSbtcPct,
          zest_pct: zestSbtcPct,
          idle_pct: idleSbtcPct,
        },
        stx: {
          total_ustx: totalStxUstx,
          stacking_pct: stackingStxPct,
          hodlmm_pct: hodlmmStxPct,
          idle_pct: idleStxPct,
        },
      },
      reasoning,
      timestamp,
    };

    console.log(JSON.stringify(result));
    return { output: JSON.stringify(result) };
  }

  if (command === "protocol-snapshot") {
    const protocolArg = args?.find((a) => a.startsWith("--protocol="))?.split("=")[1];
    const poolIdArg = args?.find((a) => a.startsWith("--pool-id="))?.split("=")[1];

    if (!protocolArg) {
      const err = { error: "--protocol is required for protocol-snapshot" };
      console.log(JSON.stringify(err));
      return { output: JSON.stringify(err) };
    }

    let result: SnapshotOutput | { error: string };

    if (protocolArg === "hodlmm") {
      const yields = await fetchHodlmmYields();
      const pool = poolIdArg ? yields.find((y) => y.poolId === poolIdArg) : yields[0];
      if (!pool) {
        result = { error: `HODLMM pool ${poolIdArg ?? ""} not found` };
      } else {
        result = {
          network: "mainnet",
          protocol: "bitflow-hodlmm",
          poolId: pool.poolId,
          estimatedApyPct: pool.estimatedApyPct,
          details: { riskRegime: pool.riskRegime, volatilityScore: pool.volatilityScore },
          timestamp,
        };
      }
    } else if (protocolArg === "zest") {
      const zest = await fetchZestYield();
      if (!zest) {
        result = { error: "Zest Protocol API unreachable" };
      } else {
        result = {
          network: "mainnet",
          protocol: "zest",
          estimatedApyPct: zest.estimatedApyPct,
          details: zest.details ?? {},
          timestamp,
        };
      }
    } else if (protocolArg === "stacking") {
      const stacking = await fetchStackingYield();
      if (!stacking) {
        result = { error: "Stacks API unreachable" };
      } else {
        result = {
          network: "mainnet",
          protocol: "stacking",
          estimatedApyPct: stacking.estimatedApyPct,
          details: stacking.details ?? {},
          timestamp,
        };
      }
    } else {
      result = { error: `Unknown protocol: ${protocolArg}. Valid values: hodlmm, zest, stacking` };
    }

    console.log(JSON.stringify(result));
    return { output: JSON.stringify(result) };
  }

  const err = { error: `Unknown command: ${command}. Valid commands: compare-yields, best-allocation, protocol-snapshot` };
  console.log(JSON.stringify(err));
  return { output: JSON.stringify(err) };
};
