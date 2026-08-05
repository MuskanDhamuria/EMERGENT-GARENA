// Pure client-side copy helpers for the AI Game Master's safe rule cards.
//
// The server remains authoritative: this module only turns already-validated
// `world.directorRules` data into short labels for the HUD. Keeping that
// translation here lets UI work evolve independently from director mechanics.

const FALLBACK = Object.freeze({
  directive: 'The world is shifting.',
  choice: 'The expedition faces a choice.',
  objective: 'A new task awaits the expedition.',
  instruction: 'Follow your role’s path and listen for the Game Master.',
});

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function titleCase(value) {
  return text(value).replaceAll(/[-_]/g, ' ').replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

function ownTarget(item, playerId) {
  const targets = list(item?.playerIds || item?.targets || item?.targetPlayerIds);
  return !targets.length || !playerId || targets.some((target) => target === playerId || target?.id === playerId);
}

/**
 * Formats an active director rule into a compact, player-facing label.
 * Supports both a fully authored `message` and rule-card style data.
 */
export function formatDirective(directive) {
  if (!directive || typeof directive !== 'object') return '';
  const message = text(directive.message || directive.description || directive.instruction);
  if (message) return message;
  const title = text(directive.title || directive.label) || titleCase(directive.type || directive.card || '');
  const duration = Number(directive.secondsRemaining ?? directive.durationRemaining);
  return title ? `${title}${Number.isFinite(duration) && duration > 0 ? ` (${Math.ceil(duration)}s)` : ''}` : FALLBACK.directive;
}

/**
 * Formats a story choice, including its available options when present.
 */
export function formatStoryChoice(choice) {
  if (!choice || typeof choice !== 'object') return '';
  const prompt = text(choice.prompt || choice.message || choice.description || choice.title, FALLBACK.choice);
  const options = list(choice.options).map((option) => text(option?.label || option?.title || option?.message || option)).filter(Boolean);
  return options.length ? `${prompt} ${options.slice(0, 2).join(' / ')}` : prompt;
}

/**
 * Formats one current objective. Completed objectives intentionally remain
 * readable so the UI can show a short status rather than silently removing it.
 */
export function formatObjective(objective) {
  if (!objective || typeof objective !== 'object') return '';
  const label = text(objective.instruction || objective.description || objective.task || objective.title || objective.label, FALLBACK.objective);
  return objective.completed || objective.status === 'complete' ? `Complete: ${label}` : label;
}

/**
 * Normalizes director state from either `world.directorRules` or the current
 * serialized room shape. The returned values are safe arrays for rendering.
 */
export function normalizeDirectorState(world = {}, playerId = null) {
  const rules = world?.directorRules || world?.world?.directorRules || {};
  const directives = list(rules.activeRules || rules.activeDirectives || rules.directives || rules.active || world?.activeDirectives)
    .filter((directive) => ownTarget(directive, playerId));
  const choices = list(rules.storyChoices || rules.choices || rules.storyChoice || world?.storyChoices)
    .filter((choice) => !choice?.status || choice.status === 'active');
  const objectives = list(rules.objectives || rules.activeObjectives || world?.objectives || world?.finalObjective)
    .filter((objective) => ownTarget(objective, playerId));
  return { directives, choices, objectives };
}

/**
 * Returns the single most useful instruction for a player right now.
 * Priority is private/targeted directives, then a pending team choice, then
 * an unfinished objective. This makes HUD placement straightforward.
 */
export function buildDirectorInstruction(world = {}, playerId = null) {
  const { directives, choices, objectives } = normalizeDirectorState(world, playerId);
  const activeDirective = directives.find((directive) => !directive?.completed && directive?.status !== 'complete');
  if (activeDirective) return formatDirective(activeDirective);
  const activeChoice = choices.find((choice) => !choice?.resolved && choice?.status !== 'complete');
  if (activeChoice) return formatStoryChoice(activeChoice);
  const objective = objectives.find((item) => !item?.completed && item?.status !== 'complete');
  if (objective) return formatObjective(objective);
  return FALLBACK.instruction;
}
