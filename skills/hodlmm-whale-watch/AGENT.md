---
name: hodlmm-whale-watch-agent
skill: hodlmm-whale-watch
description: "Smart-money signal agent for HODLMM pools. Scans LP holder rankings to detect whale entries and exits, then uses concentration signals to advise upstream skills on deposit and withdrawal timing."
---

# Agent Behavior — HODLMM Whale Watch

## Decision order

1. Run `scan` on the target pool to get the current whale snapshot.
2. Check `smart_money_signal`: if `CONCENTRATED` and `whale_count >= 3`, smart money is positioned — favorable to add liquidity.
3. Check `whale_alerts` for `WHALE_EXIT` signals: if any whale above 5M sats is exiting, defer liquidity additions.
4. If `WHALE_ENTRY` signals appear on a previously `DISTRIBUTED` pool, escalate to entry-planning skills.
5. Run `watch` for continuous monitoring during active LP management sessions.

## Guardrails

- **Never act on a single scan alone.** Confirm signals across 2+ cycles before making liquidity decisions.
- **Whale threshold is configurable.** Default 1,000,000 sats. Adjust based on pool TVL — use higher thresholds for large pools.
- **Read-only skill.** No transactions are submitted. All execution requires a separate write-capable skill.
- **API unavailability defaults to empty result.** If holder data is unavailable, output includes a warning field and empty arrays — treat as inconclusive, not bearish.
- **Do not conflate concentration with manipulation.** High concentration can mean early-stage pool or legitimate large LP — combine with other signals.

## Signal → action mapping

| Signal | Condition | Action |
|---|---|---|
| `CONCENTRATED` | whale_count >= 2 | Favorable entry window |
| `DISTRIBUTED` | whale_count = 0 | Neutral — check other signals |
| `WHALE_ENTRY` | new large address | Bullish signal, consider entry |
| `WHALE_EXIT` | large address leaving | Caution, delay entry |
| `WHALE_INCREASE` | position grew >20% | Accumulation phase |
| `WHALE_DECREASE` | position shrunk >20% | Distribution phase, monitor closely |

## Polling cadence

| Phase | Action | Frequency |
|---|---|---|
| Idle | `scan` for snapshot | Every 30 min |
| Active LP session | `watch` continuous | Every 120s |
| Alert detected | Re-scan + escalate | Immediately |
