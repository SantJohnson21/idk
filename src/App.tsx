import { useCallback, useEffect, useRef, useState } from 'react';
import type { Franchise } from './game/types';
import { createFranchise, finishGame, startNewSeason, type GameSummary } from './game/season';
import { audio } from './game/audio';
import { activeSlot, clearSave, loadFranchise, saveFranchise, setActiveSlot } from './game/save';
import { bootNative, exitApp, onBackButton, reportBack, setHapticsEnabled } from './native';
import { TitleScreen } from './ui/TitleScreen';
import { HubScreen } from './ui/HubScreen';
import { GameScreen } from './ui/GameScreen';
import { OffseasonScreen } from './ui/OffseasonScreen';
import { DeviceCheck } from './ui/DeviceCheck';
import { closeTopModal } from './ui/components';

type View = 'title' | 'hub' | 'game' | 'offseason';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export default function App() {
  const [slot, setSlot] = useState(() => activeSlot());
  const [franchise, setFranchise] = useState<Franchise | null>(() => loadFranchise());
  const [view, setView] = useState<View>('title');
  const [gameKey, setGameKey] = useState(0);
  const [deviceCheck, setDeviceCheck] = useState(false);
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  const finishedRef = useRef(false);
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const wasHidden = useRef(false);

  useEffect(() => {
    if (franchise) saveFranchise(franchise, slot);
  }, [franchise, slot]);

  useEffect(() => {
    if (!franchise) return;
    audio.setEnabled(franchise.settings.sound);
    audio.setMusic(franchise.settings.music);
    setHapticsEnabled(franchise.settings.haptics);
  }, [franchise?.settings.sound, franchise?.settings.music, franchise?.settings.haptics, franchise]);

  // Native shell: status bar styling and the splash handoff after first paint.
  useEffect(() => {
    void bootNative();
  }, []);

  // Android hardware back: close the top panel, then step back through the app,
  // and quit from the title card. Registered once and routed through a ref:
  // re-subscribing on every navigation left a window where two listeners could
  // answer one press (back could skip a screen or exit early). Screens label
  // their own outcome for DEVICE CHECK.
  useEffect(
    () =>
      onBackButton(() => {
        if (closeTopModal()) {
          reportBack('CLOSED A PANEL');
          return;
        }
        const current = viewRef.current;
        if (current === 'title') {
          reportBack('EXITED APP');
          exitApp();
        } else if (current === 'hub' || current === 'offseason') {
          reportBack('BACK TO TITLE');
          setView('title');
        } else {
          window.dispatchEvent(new CustomEvent('rb:back'));
        }
      }),
    [],
  );

  // DEVICE CHECK: long-press the title build stamp, or add ?diag in a browser.
  useEffect(() => {
    const open = () => setDeviceCheck(true);
    window.addEventListener('rb:diag', open);
    if (new URLSearchParams(window.location.search).has('diag')) setDeviceCheck(true);
    return () => window.removeEventListener('rb:diag', open);
  }, []);

  // Audio beds follow the screen, and stop entirely while the app is backgrounded
  // so the crowd loop does not play on in a pocket and resume as a doubled mix.
  useEffect(() => {
    if (!visible) {
      wasHidden.current = true;
      audio.stopMusic();
      audio.stopCrowd();
      return;
    }
    if (wasHidden.current) {
      wasHidden.current = false;
      // The OS suspends the audio context in the background; this resumes it.
      audio.init();
    }
    if (view === 'game') {
      audio.stopMusic();
      audio.startCrowd();
    } else {
      audio.stopCrowd();
      if (franchise?.settings.music) audio.startMusic();
      else audio.stopMusic();
    }
  }, [view, franchise?.settings.music, visible]);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const wake = () => {
      audio.init();
      if (view === 'game') audio.startCrowd();
      else if (franchise?.settings.music) audio.startMusic();
      window.removeEventListener('pointerdown', wake);
    };
    window.addEventListener('pointerdown', wake);
    return () => window.removeEventListener('pointerdown', wake);
  }, [view, franchise?.settings.music]);

  const update = useCallback((fn: (f: Franchise) => void) => {
    setFranchise((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      fn(next);
      return next;
    });
  }, []);

  const startNew = (teamId?: string, targetSlot = slot) => {
    const f = createFranchise(Date.now(), teamId);
    setActiveSlot(targetSlot);
    setSlot(targetSlot);
    setFranchise(f);
    saveFranchise(f, targetSlot);
    setView('hub');
    audio.init();
    audio.play('kickoff');
  };

  const loadSlot = (targetSlot: number) => {
    const loaded = loadFranchise(targetSlot);
    if (!loaded) return;
    finishedRef.current = false;
    setActiveSlot(targetSlot);
    setSlot(targetSlot);
    setFranchise(loaded);
    setView('hub');
    audio.init();
    audio.play('select');
  };

  const deleteSlot = (targetSlot: number) => {
    clearSave(targetSlot);
    if (targetSlot === slot) {
      finishedRef.current = false;
      setFranchise(null);
      setView('title');
    }
  };

  const startGame = () => {
    finishedRef.current = false;
    setGameKey((k) => k + 1);
    setView('game');
  };

  const handleFinish = (summary: GameSummary) => {
    if (!franchise || finishedRef.current) return;
    finishedRef.current = true;
    const next = clone(franchise);
    finishGame(next, summary);
    setFranchise(next);
    saveFranchise(next, slot);
    setView(next.seasonStage === 'offseason' ? 'offseason' : 'hub');
  };

  const handleStartSeason = () => {
    if (!franchise) return;
    const next = startNewSeason(franchise);
    setFranchise(next);
    saveFranchise(next, slot);
    setView('hub');
  };

  return (
    <div className={`app ${franchise?.settings.crt ? 'crt-on' : ''}`}>
      {view === 'title' && (
        <TitleScreen
          franchise={franchise}
          activeSlot={slot}
          onContinue={() => setView('hub')}
          onNew={startNew}
          onLoadSlot={loadSlot}
          onDeleteSlot={deleteSlot}
        />
      )}
      {view === 'hub' && franchise && (
        <HubScreen
          franchise={franchise}
          update={update}
          onPlay={startGame}
          onOffseason={() => setView('offseason')}
          onTitle={() => setView('title')}
        />
      )}
      {view === 'game' && franchise && (
        <GameScreen
          key={`${franchise.season}-${franchise.week}-${gameKey}`}
          franchise={franchise}
          onExit={() => setView('hub')}
          onFinish={handleFinish}
        />
      )}
      {view === 'offseason' && franchise && (
        <OffseasonScreen
          franchise={franchise}
          update={update}
          onStartSeason={handleStartSeason}
          onHub={() => setView('hub')}
        />
      )}
      {deviceCheck && <DeviceCheck onClose={() => setDeviceCheck(false)} />}
      <div className={`crt-overlay ${franchise?.settings.crt === false ? 'off' : ''}`} aria-hidden />
    </div>
  );
}
