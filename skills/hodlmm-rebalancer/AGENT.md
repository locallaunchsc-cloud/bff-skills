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
2. **Run `assess`** - Get drift score and volatility regime
3. **Evaluate regime** - If crisis (score > 60) and no `--force`, block execution
4. **Check drift threshold** - Only proceed if imbalance >= 5%
5. **Confirm with user** - Present plan, ask for explicit `--confirm`
6. **Run `execute --confirm`** - Execute Stacks contract call, log to cooldown file

## Guardrails

### Never execute without explicit confirmation

- Agent must present plan to user before execution
- User must explicitly approve

### Respect cooldown

- 1-hour cooldown per pool/address pair
- Cooldown persists to disk (`~/.aibtc/hodlmm-rebalancer-cooldown.json`)
- Do not override cooldown even if user insists

### Stacks-only execution

- Rebalancing executes via Stacks contract calls to the HODLMM pool contract
- No Stellar, cross-chain, or SEP-0011 URIs are generated

## Output interpretation

- `output` field contains human-readable status for the user
- `transaction` field contains the Stacks contract call object for agent to sign and submit
- If no `transaction` field, no on-chain action is needed
