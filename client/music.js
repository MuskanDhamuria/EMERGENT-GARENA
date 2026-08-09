const TRACKS = Object.freeze({
  landing: '/audio/landing.mp3',
  missions: '/audio/missions.mp3',
  finale: '/audio/finale.mp3',
});

export function createMusicController(state) {
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.34;
  let unlocked = false;
  let currentTrack = null;
  let lastError = null;

  function section() {
    if (!state.joined) return 'landing';
    const realm = state.mine?.realm || 'overworld';
    const zone = state.mine?.zone || 'overworld';
    if (['lantern-rite', 'echo-accord'].includes(realm) || state.world?.phase === 'finale' && realm !== 'overworld') return 'finale';
    const activeGuardianTrial = Boolean(state.world?.guardianTrial?.activeTrial);
    const activeCollectorMission = Boolean(state.collectorGame || state.world?.collectorTrial?.active?.started && !state.world.collectorTrial.active.completed);
    if (realm !== 'overworld' || zone !== 'overworld' || activeGuardianTrial || activeCollectorMission) return 'missions';
    return 'landing';
  }

  function sync() {
    const source = TRACKS[section()];
    if (!source) {
      if (!audio.paused) audio.pause();
      currentTrack = null;
      return;
    }
    if (currentTrack !== source) {
      currentTrack = source;
      audio.src = source;
      audio.currentTime = 0;
    }
    if (unlocked && audio.paused) audio.play().then(() => { lastError = null; }).catch((error) => { lastError = error?.message || 'Playback was blocked.'; });
  }

  function unlock() {
    unlocked = true;
    sync();
  }

  addEventListener('pointerdown', unlock, { capture: true, once: true });
  addEventListener('keydown', unlock, { capture: true, once: true });
  return { sync, status: () => ({ section: section(), source: currentTrack, unlocked, paused: audio.paused, readyState: audio.readyState, volume: audio.volume, error: lastError || audio.error?.message || null }) };
}
