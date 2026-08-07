// One browser-safe catalogue for the AI control surface. Transport adapters
// may describe these actions, but game-world remains the sole authority that
// validates and applies them.
import { EVOLUTION_LIBRARY, FEATURES } from '../shared/game-content.js';

export const GAME_MASTER_CAPABILITIES = Object.freeze([
  Object.freeze({ id: 'observe', phase: 'any', purpose: 'Read authoritative world state and behaviour telemetry.' }),
  Object.freeze({ id: 'assign-archetypes', phase: 'observing', purpose: 'Make one permanent, evidence-backed role assignment.' }),
  Object.freeze({ id: 'narrate', phase: 'any', purpose: 'Explain an observed decision publicly or privately.' }),
  Object.freeze({ id: 'evolve-archetype', phase: 'evolving', purpose: 'Reveal the next bounded, authored evolution for one player.' }),
  Object.freeze({ id: 'unlock-feature', phase: 'evolving', purpose: 'Reveal a validated physical world change.' }),
  Object.freeze({ id: 'choose-guardian-trials', phase: 'evolving', purpose: 'Choose two immutable Guardian portal trials.' }),
  Object.freeze({ id: 'create-emergent-rule', phase: 'evolving', purpose: 'Apply one validated, reversible behaviour-to-effect rule.' }),
  Object.freeze({ id: 'apply-director-card', phase: 'evolving', purpose: 'Apply one authored Director intervention.' }),
  Object.freeze({ id: 'create-finale', phase: 'evolving', purpose: 'Open the authored cooperative Temple finale when prerequisites are met.' }),
]);

export const EVOLUTION_LIMITS = Object.freeze(Object.fromEntries(Object.entries(EVOLUTION_LIBRARY).map(([role, steps]) => [role, steps.length])));

export function canEvolvePlayer(player) {
  return Boolean(player?.archetype) && (player.evolutions || []).length < (EVOLUTION_LIMITS[player.archetype] || 0);
}

export const AI_FEATURE_IDS = Object.freeze([...FEATURES]);
