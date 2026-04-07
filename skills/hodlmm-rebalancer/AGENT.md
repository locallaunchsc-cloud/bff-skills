---
name: hodlmm-rebalancer
skill: hodlmm-rebalancer
description: Agent behavior rules for HODLMM Auto-Rebalancer
metadata:
  author: locallaunchsc-cloud
  author-agent: Unified Sphinx
---

# HODLMM Auto-Rebalancer Agent Behavior

## Decision order

1. **Check user intent** - Is this a routine position check or explicit rebalance request?
2. **Run `doctor`** - Verify wallet, balances, API health before proceeding
3. **Run `assess`** - Get drift score and volatility regime
4. **Evaluate regime** - If crisis (score > 60) and no `--force`, block execution
5. **Check drift threshold** - Only proceed if drift score >= 15 AND out-of-range >= 20%
6. **Run `plan`** - Generate rebalance plan, profitability check
7. **Confirm with user** - Present plan, ask for explicit `--confirm`
8. **Run `execute --confirm`** - Execute Stacks contract call, log to cooldown file

## Guardrails

### Never execute without explicit confirmation

- `execute` action requires `--confirm` flag
- Agent must present plan to user before execution
- User must explicitly approve via `--confirm` in command

### Respect cooldown

- 1-hour cooldown per pool/address pair
- Cooldown persists to disk (`~/.aibtc/hodlmm-rebalancer-cooldown.json`)
- If cooldown active, inform user of next eligible time
- Do not override cooldown even if user insists

### Block in crisis regime

- Volatility score > 60 = crisis regime
- Crisis blocks execution unless `--force` flag present
- Explain to user why blocked: "Market volatility too high for safe rebalancing"
- Recommend waiting for calmer conditions or using `--force` with caution

### Stacks-only execution

- Rebalancing executes via Stacks contract calls to the HODLMM pool contract
- No Stellar, cross-chain, or SEP-0011 URIs are generated
- Always confirm the target contract address matches the pool before signing

## Output interpretation

- `output` field contains human-readable status for the user
- `transaction` field contains the Stacks contract call object for agent to sign and submit
- If no `transaction` field, no on-chain action is needed
- On cooldown: inform user of remaining wait time, do not retry automatically
