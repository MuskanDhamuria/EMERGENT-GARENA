import assert from 'node:assert/strict';
import { createEmergentRules } from '../server/emergent-rules.mjs';

function player(id, archetype, x, z, overrides = {}) {
  return {
    id, name: id, archetype, x, z, movement: 0, visited: new Set(['starting-village']),
    relicIds: new Set(), privateRules: [], emergent: { energy: 100, activeRuleIds: [], effects: [] }, ...overrides,
  };
}

function room(players) {
  return { code: 'RULES', phase: 'evolving', players: new Map(players.map((entry) => [entry.id, entry])), events: [] };
}

function engine(options = {}) {
  const events = [];
  const rules = createEmergentRules({ event: (_room, type, message, details) => events.push({ type, message, ...details }) }, { analysisIntervalMs: 10, cooldownMs: 0, ...options });
  return { rules, events };
}

// Two players who repeatedly choose each other become linked. Separation then
// lowers both lanterns' energy, which directly changes movement speed in the
// authoritative server loop.
{
  const explorers = [player('explorer', 'Explorer', 0, 0), player('collector', 'Collector', 1, 0), player('guardian', 'Guardian', 20, 0), player('loner', 'Loner', -20, 0)];
  const game = room(explorers), { rules } = engine({ bondSeconds: 0.1 });
  rules.tick(game, 0.1, 100); rules.tick(game, 0.2, 300);
  const bond = game.emergentState.activeRules.find((rule) => rule.type === 'bond');
  assert.ok(bond, 'an exclusive persistent pair should create a bond');
  explorers[1].x = 20; rules.tick(game, 0.2, 500);
  assert.ok(explorers[0].emergent.energy < 100 && explorers[1].emergent.effects.includes('bond-separated'));
  explorers[1].x = 1; rules.tick(game, 0.2, 700);
  assert.equal(rules.movementMultiplier(game, explorers[0]) <= 1, true);
}

// The AI is not limited to the starter examples. It can combine an observed
// trigger with any compatible safe effect; here exploration becomes a private
// speed law, without changing the Explorer's fixed role.
{
  const explorer = player('explorer', 'Explorer', 0, 0, { movement: 40 });
  const game = room([explorer, player('collector', 'Collector', 20, 0), player('guardian', 'Guardian', -20, 0), player('loner', 'Loner', 0, 20)]);
  const { rules } = engine(); rules.tick(game, 0.1, 100);
  const created = rules.apply(game, { triggerId: 'explorer_travel', effectId: 'movement_boon', visibility: 'private', durationSeconds: 30, title: 'Trailblazer', message: 'Your wandering has made the old paths answer your stride.' }, 200);
  assert.equal(created.ok, true);
  assert.equal(rules.movementMultiplier(game, explorer), 1.2);
  assert.equal(rules.serialize(game, 'collector').activeRules.some((rule) => rule.title === 'Trailblazer'), false);
  assert.equal(rules.apply(game, { triggerId: 'loner_isolation', effectId: 'tether_energy', visibility: 'shared', title: 'Invalid Law', message: 'This must be rejected.' }, 300).ok, false);
}

// Explorer travel no longer invents a cosmetic path marker. Exploration only
// produces a rule when the AI selects a concrete compatible gameplay effect.
{
  const explorer = player('explorer', 'Explorer', 0, 0, { movement: 40 });
  const game = room([explorer, player('collector', 'Collector', 20, 0), player('guardian', 'Guardian', -20, 0), player('loner', 'Loner', 0, 20)]);
  const { rules } = engine(); rules.tick(game, 0.1, 100);
  assert.equal(rules.serialize(game, explorer.id).markers.length, 0);
  assert.equal(rules.serialize(game, 'collector').activeRules.some((rule) => rule.type === 'explorer_vision'), false);
}

// Collector hoarding becomes a co-operative altar requirement rather than a
// cosmetic message: three lanterns must be gathered at the altar.
{
  const collector = player('collector', 'Collector', 19, 9, { relicIds: new Set(['echo-water']) });
  const game = room([player('explorer', 'Explorer', -20, 0), collector, player('guardian', 'Guardian', 19, 10), player('loner', 'Loner', 20, 9)]);
  const { rules } = engine(); rules.tick(game, 0.1, 100);
  const altar = { id: 'final-altar', x: 19, z: 9 };
  assert.equal(rules.validateInteraction(game, collector, 'offer-relics', altar).ok, true);
  rules.completeInteraction(game, collector, 'offer-relics', altar);
  assert.equal(game.emergentState.activeRules.find((rule) => rule.type === 'hoard_value').objective.status, 'fulfilled');
}

// Guardian proximity restores nearby allies without replacing fixed roles.
{
  const guardian = player('guardian', 'Guardian', 0, 0);
  const allies = [player('explorer', 'Explorer', 1, 0, { emergent: { energy: 50, activeRuleIds: [], effects: [] } }), player('collector', 'Collector', -1, 0), guardian, player('loner', 'Loner', 30, 0)];
  const game = room(allies), { rules } = engine({ guardianSeconds: 0.01 });
  rules.tick(game, 0.1, 100); rules.tick(game, 0.2, 300);
  assert.equal(game.emergentState.activeRules.some((rule) => rule.type === 'guardian_protection'), true);
  assert.ok(allies[0].emergent.energy > 50 && allies[0].emergent.effects.includes('warded'));
  assert.deepEqual(new Set(allies.map((entry) => entry.archetype)), new Set(['Explorer', 'Collector', 'Guardian', 'Loner']));
}
{
  const loner = player('loner', 'Loner', 30, 30);
  const game = room([player('explorer', 'Explorer', 0, 0), player('collector', 'Collector', 20, 0), player('guardian', 'Guardian', -20, 0), loner]);
  const { rules } = engine({ lonerSeconds: 0.01 }); rules.tick(game, 0.1, 100);
  assert.equal(rules.serialize(game, loner.id).activeRules.some((rule) => rule.type === 'solitary_vision'), false);
  assert.equal(rules.serialize(game, 'explorer').activeRules.some((rule) => rule.type === 'solitary_vision'), false);
}

console.log('Emergent behaviour rule tests passed.');
