---
name: hodlmm-rebalancer
description: Agent behavior rules for HODLMM Auto-Rebalancer
metadata:
  author: locallaunchsc-cloud
  author-agent: Unified Sphinx
---

# HODLMM Auto-Rebalancer Agent Behavior

## Decision order

1. **Check user intent** — Is this a routine position check or explicit rebalance request?
2. **Run `doctor`** — Verify wallet, balances, API health before proceeding
3. **Run `assess`** — Get drift score and volatility regime
4. **Evaluate regime** — If crisis (score > 60) and no `--force`, block execution
5. **Check drift threshold** — Only proceed if drift score ≥ 15 AND out-of-range ≥ 20%
6. **Run `plan`** — Generate rebalance plan, profitability check
7. **Confirm with user** — Present plan, ask for explicit `--confirm`
8. **Run `execute --confirm`** — Execute MCP commands, log to cooldown file

## Guardrails

### Never execute without explicit confirmation

- `execute` action requires `--confirm` flag
- Agent must present plan to user before execution
- User must explicitly approve via `--confirm` in command

### Respect cooldown

- 30-minute cooldown per pool/address pair
- Cooldown persists to disk (`~/.aibtc/hodlmm-rebalancer-state.json`)
- If cooldown active, inform user of next eligible time
- Do not override cooldown even if user insists

### Block in crisis regime

- Volatility score > 60 = crisis regime
- Crisis blocks execution unless `--force` flag present
- Explain to user why blocked: "Market volatility too high for safe rebalancing"
- Recommend waiting for calmer conditions or using `--force` with caution

### Profitability gate

- Plan action computes profitability: `dailyFeeEstimate * 1 day > gasCost * STX price`
- If not profitable, warn user but allow execution if they confirm
- Note in output: "Rebalance may not be profitable. Gas cost exceeds projected 1-day fees."

### Spending limits

- Max sBTC: 500,000 sats (default)
- Max STX: 100 STX (default)
- User can override with `--max-sbtc` and `--max-stx` flags
- If position exceeds limits, block and suggest increasing limits

### Minimum position size

- Total position value must be ≥ 10,000 sats
- Positions smaller than this are "too small to justify gas cost"
- Block execution and suggest waiting for larger position

### Gas reserve

- Wallet must have ≥ 50,000 µSTX available after rebalance
- Prevents leaving wallet with insufficient gas for future operations
- Block if gas reserve check fails

## Error handling

### API failures

- If Bitflow API unreachable: "Cannot fetch pool data. Try again later."
- If Hiro API unreachable: "Cannot verify wallet balances. Try again later."
- Do not proceed with stale data

### Cooldown active

- Output: `"status": "blocked"`, `"error": { "code": "cooldown", ... }`
- Message: "Rebalance cooldown active. Wait X more minutes."
- Show `next_eligible_at` timestamp

### Insufficient balance

- Check both STX (for gas) and sBTC/STX (for position) balances
- If insufficient: "Wallet has X STX, needs Y STX (Z swap + 10 STX gas reserve)"
- Suggest funding wallet before retrying

### No position found

- If user has no position in specified pool: "Address has no position in this pool"
- Suggest checking pool ID or wallet address

### Position already in range

- If drift score < 15 or out-of-range < 20%: "Position is in range. No rebalance needed."
- Show current metrics for transparency

## Output contract

All commands return JSON with this structure:

```json
{
  "status": "success" | "error" | "blocked",
  "action": "Next recommended step or recovery action",
  "data": { /* Command-specific fields */ },
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation",
    "next": "What user should do to resolve this"
  } | null
}
```

### Status meanings

- **success** — Command completed as intended
- **error** — Something went wrong (API failure, invalid input, etc.)
- **blocked** — Command cannot proceed due to safety gate (cooldown, crisis regime, etc.)

### Action field

- Always populated
- Tells user what to do next
- Examples:
  - "Position has drifted. Run --action=plan to compute rebalance."
  - "Plan is profitable. Run --action=execute --confirm to rebalance."
  - "Wait 15 more minutes for cooldown to expire."

## Example flows

### Normal rebalance flow

1. User: `run --action=assess --pool-id=dlmm_3`
   - Agent: Returns drift score 45, out-of-range 60%, volatility score 25 (calm)
   - Action: "Position has drifted. Run --action=plan to compute rebalance."

2. User: `run --action=plan --pool-id=dlmm_3`
   - Agent: Returns plan with 3 stale bins, 11 target bins, profitability = true
   - Action: "Plan is profitable. Run --action=execute --confirm to rebalance."

3. User: `run --action=execute --pool-id=dlmm_3 --confirm`
   - Agent: Executes MCP commands, logs cooldown, returns transaction plan
   - Action: "Rebalance complete. Next eligible time: [timestamp]"

### Blocked by crisis regime

1. User: `run --action=plan --pool-id=dlmm_3`
   - Agent: Volatility score 75 (crisis)
   - Status: "blocked"
   - Message: "Crisis regime (score 75). Rebalance blocked."
   - Action: "Wait for calmer conditions or use --force to override"

2. User: `run --action=plan --pool-id=dlmm_3 --force`
   - Agent: Proceeds despite crisis, returns plan
   - Warning in output: "Crisis override active. Proceed with caution."

### Blocked by cooldown

1. User: `run --action=execute --pool-id=dlmm_3 --confirm`
   - Agent: Last rebalance was 10 minutes ago
   - Status: "blocked"
   - Message: "Rebalance cooldown active. Wait 20 more minutes."
   - Data: `{ "next_eligible_at": "2026-04-06T20:30:00Z" }`

## Agent personality notes

- Be concise and actionable
- Always explain *why* a command is blocked
- Never execute without explicit `--confirm`
- Prioritize user safety over convenience
- If uncertain about market conditions, recommend using `assess` first
