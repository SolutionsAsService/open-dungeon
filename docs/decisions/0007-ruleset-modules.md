# ADR 0007: Game systems as validated TypeScript modules

Status: accepted (2026-10-12)

## Context
The core must stay system-agnostic while supporting very different games (d20, narrative, homebrew).

## Decision
A `RulesetModule` (manifest, distance policy, conditions, roll presets, sheet sections, encounter policy, optional movement policy) is registered in `shared/rules/registry.ts` and validated by `defineRuleset`. Modules are data plus optional pure hooks; they never execute in the browser of other users as untrusted code.

## Consequences
Adding a system is adding a file. A user-facing ruleset editor (stored in the database as JSON validated by the same schema) is future work.
