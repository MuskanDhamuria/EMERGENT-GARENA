const TRACKS = Object.freeze({
  landing: '/audio/landing.mp3',
  missions: '/audio/missions.mp3',
  finale: '/audio/finale.mp3',
  ending: '/audio/ending.mp3',
});
export function createMusicController(state) {
  const audioBySection = Object.fromEntries(Object.entries(TRACKS).map(([name, source]) => {
    const track = new Audio(source);
    track.loop = true;
    track.preload = 'auto';
    track.volume = 0.34;
    track.load();
    return [name, track];
  }));
  let unlocked = false;
  let currentSection = null;
  let currentAudio = null;
  let lastError = null;

  function section() {
    if (!state.joined) return 'landing';
    const realm = state.mine?.realm || 'overworld';
    const zone = state.mine?.zone || 'overworld';
    if (state.world?.finalObjective?.phase === 'COMPLETE') return 'ending';
    if (['lantern-rite', 'echo-accord'].includes(realm) || state.world?.phase === 'finale' && realm !== 'overworld') return 'finale';
    const activeGuardianTrial = Boolean(state.world?.guardianTrial?.activeTrial);
    const activeCollectorMission = Boolean(state.collectorGame || state.world?.collectorTrial?.active?.started && !state.world.collectorTrial.active.completed);
    if (realm !== 'overworld' || zone !== 'overworld' || activeGuardianTrial || activeCollectorMission) return 'missions';
    return 'landing';
  }

  function sync() {
    const nextSection = section();
    const nextAudio = audioBySection[nextSection];
    if (currentAudio !== nextAudio) {
      if (currentAudio) currentAudio.pause();
      currentSection = nextSection;
      currentAudio = nextAudio;
      currentAudio.currentTime = 0;
    }
    if (unlocked && currentAudio.paused) currentAudio.play().then(() => { lastError = null; }).catch((error) => { lastError = error?.message || 'Playback was blocked.'; });
  }

  function unlock() {
    unlocked = true;
    sync();
  }

  addEventListener('pointerdown', unlock, { capture: true, once: true });
  addEventListener('keydown', unlock, { capture: true, once: true });
  return { sync, status: () => ({ section: section(), source: TRACKS[currentSection], unlocked, paused: currentAudio?.paused ?? true, readyState: currentAudio?.readyState ?? 0, volume: currentAudio?.volume ?? 0.34, error: lastError || currentAudio?.error?.message || null }) };
}
