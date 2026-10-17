import { useCallback, useEffect, useRef, useState } from 'react';
import { useOS, leaveBlockedBy, selectActiveId, type Phase } from '@/store/os';
import { dissolveOver } from '@/hooks/useExitFx';
import { t } from '@/i18n';
import { accentVars } from './theme';
import { SHELLS } from './shells';
import { powerOff } from './session';
import { wireSounds } from './sfx';

const noop = () => {};

/** How long a first Escape counts for, where leaving takes two. */
const ESC_AGAIN_MS = 5000;

/**
 * The machine: applies the theme (data-theme + data-style + accent variables) and walks the phases
 * boot -> lock -> welcome -> desktop -> shutdown, rendering the computer's STYLE kit for each phase
 * (os/shells.ts - modern, retro, mac). A kit with `crossfade` gets its screens dissolved into each
 * other: the outgoing one stays mounted (inert) beneath the incoming one until that has faded in.
 * Also owns the OS-level keys, the same in every style:
 *   Escape      closes menus/flyouts; on the lock screen it stands you up, and on the desktop too
 *               unless the focused app had a use for it (an app marks that with preventDefault)
 *   Ctrl+Escape toggles the launcher (Start / app menu)
 *   Alt+F4      closes the focused window
 * And the system sounds of the modern and mac looks (os/sfx.ts), which follow the store and the
 * mouse from here so that no shell or app has to ask for them.
 */
export default function Computer() {
  const phase = useOS(s => s.phase);
  const settings = useOS(s => s.settings);
  const style = useOS(s => s.payload?.computer.style ?? 'modern');
  const { setPhase } = useOS.getState();
  const kit = SHELLS[style] ?? SHELLS.modern;
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(phase);
  const [leaving, setLeaving] = useState<Phase | null>(null);

  // The phase just changed: hold on to the outgoing screen. Decided during render (not in an
  // effect) so that screen is never unmounted in between - it keeps its state while it fades.
  if (shown !== phase) {
    setShown(phase);
    setLeaving(kit.crossfade && shown !== 'off' && phase !== 'off' ? shown : null);
  }

  // A theme or accent switch dissolves from a snapshot of the old look. Taken from a store
  // subscription, which runs as the setting changes - before React has repainted anything. Not on
  // boot (a new payload brings its own settings), and not in retro, where a new look just snaps in.
  useEffect(
    () =>
      useOS.subscribe((s, prev) => {
        const root = rootRef.current;
        if (!root || s.payload !== prev.payload || s.payload?.computer.style === 'retro') return;
        if (s.settings.theme !== prev.settings.theme || s.settings.accent !== prev.settings.accent) dissolveOver(root);
      }),
    [],
  );

  useEffect(() => (rootRef.current ? wireSounds(rootRef.current) : undefined), []);

  useEffect(() => {
    if (!leaving) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('.phase-out')) focused.blur();
    const h = window.setTimeout(() => setLeaving(null), kit.crossfade);
    return () => window.clearTimeout(h);
  }, [leaving, shown, kit.crossfade]);

  const toLock = useCallback(() => setPhase('lock'), [setPhase]);
  const toWelcome = useCallback(() => setPhase('welcome'), [setPhase]);
  const toDesktop = useCallback(() => setPhase('desktop'), [setPhase]);

  useEffect(() => {
    // Standing up with something open could throw work away, so two things ask first. Typing in a
    // field, or a hack in progress, wants the key twice: the first press only says so. And a window
    // with unsaved changes puts up its own prompt, as it does when it is closed.
    let againUntil = 0;
    const standUp = () => {
      const s = useOS.getState();
      if (s.phase !== 'desktop') return;
      const now = Date.now();
      const el = document.activeElement as HTMLElement | null;
      // (a custom app's page is a frame: its SDK marks the frame while a field in it is being typed in)
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'IFRAME' && el.dataset.typing === '1'));
      const hacking = s.windows.find(w => w.id === selectActiveId(s))?.app === 'hack';
      if ((typing || hacking) && now > againUntil) {
        againUntil = now + ESC_AGAIN_MS;
        s.toast({ app: 'system', title: t('ui.desktop.esc_again') });
        return;
      }
      againUntil = 0;
      if (leaveBlockedBy() === null) powerOff();
    };

    const onKey = (e: KeyboardEvent) => {
      const s = useOS.getState();
      if (e.key === 'Escape') {
        if (e.ctrlKey && s.phase === 'desktop') {
          s.setStart(!s.start);
          return;
        }
        if (s.start || s.flyout) {
          s.setStart(false);
          s.setFlyout(null);
          return;
        }
        if (s.phase === 'lock') powerOff();
        // On the desktop the key is the focused app's first. One that used it (closed a dialog,
        // cleared a field) has said so with preventDefault by the time every listener has run -
        // this one is among the first - so the key is looked at again after them. Unused, it
        // stands the player up, whatever is open.
        else if (s.phase === 'desktop') window.setTimeout(() => !e.defaultPrevented && standUp(), 0);
        return;
      }
      if (e.key === 'F4' && e.altKey && s.phase === 'desktop') {
        e.preventDefault();
        const id = selectActiveId(s);
        if (id) s.close(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { BootScreen, LockScreen, WelcomeScreen, ShutdownScreen, Desktop, Frame } = kit;
  // A screen on its way out gets inert callbacks: it must not move the phase again.
  const screen = (p: Phase, live: boolean) => {
    switch (p) {
      case 'boot':
        return <BootScreen onDone={live ? toLock : noop} />;
      case 'lock':
        return <LockScreen onSignedIn={live ? toWelcome : noop} />;
      case 'welcome':
        return <WelcomeScreen onDone={live ? toDesktop : noop} />;
      case 'desktop':
        return <Desktop />;
      case 'shutdown':
        return <ShutdownScreen onDone={live ? powerOff : noop} />;
      default:
        return null;
    }
  };
  // Keyed by phase, so the layer that was current simply carries on as the outgoing one.
  const screens = kit.crossfade
    ? [leaving, phase].map(
        p =>
          p &&
          p !== 'off' && (
            <div
              key={p}
              className={`phase-layer ${p === phase ? (leaving ? 'phase-in' : '') : 'phase-out'}`}
              style={{ zIndex: p === phase ? 1 : 0 }}
              aria-hidden={p !== phase}
            >
              {screen(p, p === phase)}
            </div>
          ),
      )
    : screen(phase, true);

  return (
    <div
      ref={rootRef}
      className="os-root absolute inset-0 overflow-hidden select-none"
      data-theme={settings.theme}
      data-style={style}
      style={accentVars(settings.accent, settings.theme)}
      onContextMenu={e => e.preventDefault()}
    >
      {Frame ? <Frame>{screens}</Frame> : screens}
    </div>
  );
}
