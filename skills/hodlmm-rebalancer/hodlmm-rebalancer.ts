
import { SkillFunction } from "@bff/skills-lib";
import fs from "fs";
import path from "path";

const COOLDOWN_FILE = path.join(__dirname, "cooldown.json");
const COOLDOWN_PERIOD = 60 * 60 * 1000; // 1 hour in milliseconds
const FEE_BPS = 100; // 1% fee (in basis points)

interface CooldownData {
  lastExecution: number;
}

function loadCooldown(): CooldownData | null {
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const data = fs.readFileSync(COOLDOWN_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading cooldown file:", error);
  }
  return null;
}

function saveCooldown(data: CooldownData): void {
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error saving cooldown file:", error);
  }
}

function isOnCooldown(): boolean {
  const cooldownData = loadCooldown();
  if (!cooldownData) return false;

  const timeSinceLastExecution = Date.now() - cooldownData.lastExecution;
  return timeSinceLastExecution < COOLDOWN_PERIOD;
}

export const run: SkillFunction = async ({ context }) => {
  // Check cooldown
  if (isOnCooldown()) {
    const cooldownData = loadCooldown();
    const remainingTime = cooldownData
      ? Math.ceil((COOLDOWN_PERIOD - (Date.now() - cooldownData.lastExecution)) / 1000 / 60)
      : 0;
    return {
      output: `Skill is on cooldown. Please wait ${remainingTime} minutes before running again.`,
    };
  }

  const hodlmmData = context.globalState?.hodlmmData;
  if (!hodlmmData) {
    return {
      output: "Error: No HODL MM data found in global state.",
    };
  }

  const { imbalance, assetPair, requiredRebalanceAmount } = hodlmmData;

  if (!imbalance || imbalance <= 0.05) {
    return {
      output: "Pool is balanced or imbalance is below threshold (5%). No rebalance needed.",
    };
  }

  const assetToRebalance = requiredRebalanceAmount.asset;
  const amountToSwap = requiredRebalanceAmount.amount;

  // Build Stellar SEP-0011 swap URI with encodeURIComponent
  const stellarSwapUri = `web+stellar:swap?` +
    `source_asset=${encodeURIComponent(assetToRebalance)}` +
    `&destination_asset=${encodeURIComponent(assetPair.counterAsset)}` +
    `&amount=${amountToSwap}` +
    `&fee_bps=${FEE_BPS}`;

  // Save cooldown
  saveCooldown({ lastExecution: Date.now() });

  return {
    output: `Rebalance needed for ${assetPair.name}. Imbalance: ${(imbalance * 100).toFixed(2)}%. Swap ${amountToSwap} ${assetToRebalance}. URI: ${stellarSwapUri}`,
    uri: stellarSwapUri,
  };
};
