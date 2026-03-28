import { Command } from "commander";

const BITFLOW_API = "https://api.bitflow.finance";
const HODLMM_FEES_ENDPOINT = `${BITFLOW_API}/api/v1/dlmm/fees`;
const HODLMM_POOLS_ENDPOINT = `${BITFLOW_API}/api/v1/dlmm/pools`;
const CRISIS_THRESHOLD = 60;
const DEFAULT_MIN_RATIO = 2;
const FETCH_TIMEOUT = 15_000;

function timestamp(): string {
  return new Date().toISOString();
}

function fail(msg: string): never {
  console.log(JSON.stringify({ error: msg }));
  process.exit(1);
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- doctor ---
async function doctor(): Promise<void> {
  const checks: Record<string, string> = {};

  try {
    await fetchJson(`${BITFLOW_API}/api/v1/dlmm/pools`);
    checks.bitflowApi = "ok";
    checks.hodlmmPools = "ok";
  } catch (e: any) {
    checks.bitflowApi = `error: ${e.message}`;
    checks.hodlmmPools = "not_checked";
  }

  // Wallet check is environment-specific
  checks.wallet = "not_checked";

  const allOk = checks.bitflowApi === "ok" && checks.hodlmmPools === "ok";
  console.log(
    JSON.stringify({
      status: allOk ? "ready" : "degraded",
      checks,
      timestamp: timestamp(),
    })
  );
}

// --- scan-fees ---
async function scanFees(opts: {
  poolId?: string;
  all?: boolean;
  address?: string;
}): Promise<void> {
  if (!opts.poolId && !opts.all) {
    fail("Provide --pool-id <id> or --all to scan fees.");
  }

  try {
    const pools = await fetchJson(HODLMM_POOLS_ENDPOINT);
    const targetPools = opts.poolId
      ? pools.filter((p: any) => p.poolId === opts.poolId)
      : pools;

    if (targetPools.length === 0) {
      fail(`No HODLMM pool found${opts.poolId ? ` with id ${opts.poolId}` : ""}.`);
    }

    const positions: any[] = [];
    let totalValueSats = 0;
    let totalGasCostSats = 0;

    for (const pool of targetPools) {
      try {
        const feeUrl = opts.address
          ? `${HODLMM_FEES_ENDPOINT}/${pool.poolId}?address=${opts.address}`
          : `${HODLMM_FEES_ENDPOINT}/${pool.poolId}`;
        const feeData = await fetchJson(feeUrl);

        const accruedFeesA = feeData.accruedFeesA ?? "0";
        const accruedFeesB = feeData.accruedFeesB ?? "0";
        const estimatedValueSats = feeData.estimatedValueSats ?? 0;
        const estimatedGasCostSats = feeData.estimatedGasCostSats ?? 2500;
        const bins = feeData.bins ?? 0;

        const profitableToHarvest =
          estimatedValueSats > estimatedGasCostSats * DEFAULT_MIN_RATIO;

        if (estimatedValueSats > 0) {
          positions.push({
            poolId: pool.poolId,
            tokenA: pool.tokenA ?? "unknown",
            tokenB: pool.tokenB ?? "unknown",
            accruedFeesA,
            accruedFeesB,
            estimatedValueSats,
            estimatedGasCostSats,
            profitableToHarvest,
            bins,
          });
          totalValueSats += estimatedValueSats;
          totalGasCostSats += estimatedGasCostSats;
        }
      } catch {
        // Skip pools with no fee data
      }
    }

    console.log(
      JSON.stringify({
        positions,
        totalValueSats,
        totalGasCostSats,
        timestamp: timestamp(),
      })
    );
  } catch (e: any) {
    fail(`Failed to scan fees: ${e.message}`);
  }
}

// --- harvest ---
async function harvest(opts: {
  poolId?: string;
  all?: boolean;
  confirm?: boolean;
  minRatio?: number;
  force?: boolean;
}): Promise<void> {
  if (!opts.confirm) {
    fail("Harvest requires --confirm flag. This is a write operation that moves funds.");
  }

  if (!opts.poolId && !opts.all) {
    fail("Provide --pool-id <id> or --all to harvest.");
  }

  const minRatio = opts.minRatio ?? DEFAULT_MIN_RATIO;

  // Crisis regime check (soft dependency on hodlmm-risk)
  if (!opts.force) {
    try {
      // Attempt to read regime from hodlmm-risk if available
      const riskData = await fetchJson(
        `${BITFLOW_API}/api/v1/dlmm/risk-snapshot`
      ).catch(() => null);
      if (riskData && riskData.volatilityScore > CRISIS_THRESHOLD) {
        fail(
          `Crisis regime detected (volatility score: ${riskData.volatilityScore}). ` +
            `Harvest blocked. Use --force to override.`
        );
      }
    } catch {
      // hodlmm-risk not available, proceed with warning
      console.error(
        "[warn] Could not check crisis regime. Proceeding with harvest."
      );
    }
  }

  try {
    const pools = await fetchJson(HODLMM_POOLS_ENDPOINT);
    const targetPools = opts.poolId
      ? pools.filter((p: any) => p.poolId === opts.poolId)
      : pools;

    if (targetPools.length === 0) {
      fail(`No HODLMM pool found${opts.poolId ? ` with id ${opts.poolId}` : ""}.`);
    }

    for (const pool of targetPools) {
      try {
        const feeData = await fetchJson(
          `${HODLMM_FEES_ENDPOINT}/${pool.poolId}`
        );

        const estimatedValueSats = feeData.estimatedValueSats ?? 0;
        const estimatedGasCostSats = feeData.estimatedGasCostSats ?? 2500;

        if (estimatedValueSats < estimatedGasCostSats * minRatio) {
          console.log(
            JSON.stringify({
              result: "skipped",
              poolId: pool.poolId,
              reason: `Fee value (${estimatedValueSats} sats) below ${minRatio}x gas cost (${estimatedGasCostSats} sats).`,
              timestamp: timestamp(),
            })
          );
          continue;
        }

        // Execute harvest via Bitflow claim-fees endpoint
        const harvestRes = await fetch(
          `${HODLMM_FEES_ENDPOINT}/${pool.poolId}/claim`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: true }),
          }
        );

        if (!harvestRes.ok) {
          const errText = await harvestRes.text();
          fail(`Harvest failed for ${pool.poolId}: ${errText}`);
        }

        const result = await harvestRes.json();

        console.log(
          JSON.stringify({
            result: "harvest_submitted",
            txId: result.txId ?? "pending",
            poolId: pool.poolId,
            collectedFeesA: feeData.accruedFeesA ?? "0",
            collectedFeesB: feeData.accruedFeesB ?? "0",
            gasCostSats: estimatedGasCostSats,
            timestamp: timestamp(),
          })
        );
      } catch (e: any) {
        console.log(
          JSON.stringify({
            error: `Harvest failed for pool ${pool.poolId}: ${e.message}`,
          })
        );
      }
    }
  } catch (e: any) {
    fail(`Harvest operation failed: ${e.message}`);
  }
}

// --- history ---
async function history(opts: { limit?: number }): Promise<void> {
  const limit = opts.limit ?? 10;

  try {
    const data = await fetchJson(
      `${HODLMM_FEES_ENDPOINT}/history?limit=${limit}`
    );

    console.log(
      JSON.stringify({
        harvests: data.harvests ?? [],
        totalHarvests: data.totalHarvests ?? 0,
        timestamp: timestamp(),
      })
    );
  } catch (e: any) {
    fail(`Failed to fetch harvest history: ${e.message}`);
  }
}

// --- CLI ---
const program = new Command();

program
  .name("hodlmm-fee-harvester")
  .description(
    "Collect accrued trading fees from Bitflow HODLMM concentrated liquidity positions"
  );

program
  .command("doctor")
  .description("Check environment readiness")
  .action(async () => {
    await doctor();
  });

program
  .command("scan-fees")
  .description("Scan HODLMM positions for accrued unclaimed fees")
  .option("--pool-id <id>", "Specific HODLMM pool to scan")
  .option("--all", "Scan all positions")
  .option("--address <addr>", "Override wallet address for read-only scan")
  .action(async (opts) => {
    await scanFees(opts);
  });

program
  .command("harvest")
  .description("Collect accrued fees from HODLMM positions")
  .option("--pool-id <id>", "Specific pool to harvest")
  .option("--all", "Harvest all profitable positions")
  .option("--confirm", "Explicit confirmation to execute")
  .option("--min-ratio <ratio>", "Minimum fee-to-gas ratio", parseFloat)
  .option("--force", "Override crisis regime block")
  .action(async (opts) => {
    await harvest(opts);
  });

program
  .command("history")
  .description("View recent fee harvest history")
  .option("--limit <n>", "Number of records to return", parseInt)
  .action(async (opts) => {
    await history(opts);
  });

program.parse();
