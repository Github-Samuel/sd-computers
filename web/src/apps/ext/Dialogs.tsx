import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { useExitFx } from '@/hooks/useExitFx';
import { Button, Dialog, TextInput } from '@/ui/controls';

// The OS's own dialogs, put up over a custom app's page when it asks (computer.dialog.*,
// computer.menu, computer.pickColor). Drawn with the control kit, so each look skins them as it
// skins every app's, and inside the app's window like any <Dialog>.

/** Escape puts a dialog away and goes no further: not to the page under it, nor to the machine. */
function useEscape(onEscape: () => void): void {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cb.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

export interface AlertOpts {
  title?: string;
  message?: string;
  okLabel?: string;
}

export function AlertBox({ opts, onDone }: { opts: AlertOpts; onDone: () => void }) {
  useEscape(onDone);
  return (
    <Dialog
      title={text(opts.title, 120)}
      onClose={onDone}
      actions={
        <Button variant="accent" autoFocus onClick={onDone}>
          {text(opts.okLabel, 40) || t('ui.common.ok')}
        </Button>
      }
    >
      <p className="whitespace-pre-wrap break-words">{text(opts.message, 2000)}</p>
    </Dialog>
  );
}

export interface ConfirmOpts extends AlertOpts {
  confirmLabel?: string;
  cancelLabel?: string;
  /** the confirming button is a destructive one */
  danger?: boolean;
}

export function ConfirmBox({ opts, onDone }: { opts: ConfirmOpts; onDone: (yes: boolean) => void }) {
  useEscape(() => onDone(false));
  return (
    <Dialog
      title={text(opts.title, 120)}
      onClose={() => onDone(false)}
      actions={
        <>
          <Button variant={opts.danger ? 'danger' : 'accent'} autoFocus onClick={() => onDone(true)}>
            {text(opts.confirmLabel, 40) || t('ui.common.ok')}
          </Button>
          <Button onClick={() => onDone(false)}>{text(opts.cancelLabel, 40) || t('ui.common.cancel')}</Button>
        </>
      }
    >
      <p className="whitespace-pre-wrap break-words">{text(opts.message, 2000)}</p>
    </Dialog>
  );
}

export interface PromptOpts extends ConfirmOpts {
  placeholder?: string;
  value?: string;
  /** a password field: what is typed is masked here and on the prop's screen */
  password?: boolean;
  maxLength?: number;
}

export function PromptBox({ opts, onDone }: { opts: PromptOpts; onDone: (value: string | null) => void }) {
  const max = Math.max(1, Math.min(2000, Number(opts.maxLength) || 500));
  const [value, setValue] = useState(text(opts.value, max));
  useEscape(() => onDone(null));
  return (
    <Dialog
      title={text(opts.title, 120)}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button variant={opts.danger ? 'danger' : 'accent'} onClick={() => onDone(value)}>
            {text(opts.confirmLabel, 40) || t('ui.common.ok')}
          </Button>
          <Button onClick={() => onDone(null)}>{text(opts.cancelLabel, 40) || t('ui.common.cancel')}</Button>
        </>
      }
    >
      {opts.message && <p className="whitespace-pre-wrap break-words mb-3">{text(opts.message, 2000)}</p>}
      <TextInput
        autoFocus
        type={opts.password ? 'password' : 'text'}
        value={value}
        maxLength={max}
        placeholder={text(opts.placeholder, 120)}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onDone(value);
        }}
      />
    </Dialog>
  );
}

const SWATCHES = ['#e81123', '#ff8c00', '#fce100', '#16c60c', '#00b7c3', '#0078d4', '#4f4fe0', '#8764b8', '#e3008c', '#7a7574', '#1f1f1f', '#ffffff'];

export function ColorBox({ initial, onDone }: { initial?: string; onDone: (colour: string | null) => void }) {
  const start = typeof initial === 'string' && /^#[0-9a-f]{6}$/i.test(initial) ? initial.toLowerCase() : '#0078d4';
  const [picked, setPicked] = useState(start);
  useEscape(() => onDone(null));
  return (
    <Dialog
      title={t('ui.ext.colour_title')}
      onClose={() => onDone(null)}
      actions={
        <>
          <Button variant="accent" autoFocus onClick={() => onDone(picked)}>
            {t('ui.common.ok')}
          </Button>
          <Button onClick={() => onDone(null)}>{t('ui.common.cancel')}</Button>
        </>
      }
    >
      <div className="grid grid-cols-6 gap-2 mb-4">
        {SWATCHES.map(c => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => setPicked(c)}
            className={`h-9 rounded-ctl border ${picked === c ? 'border-t1 ring-2 ring-[var(--accent-fill)]' : 'border-stroke-strong'}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="text-t1">{t('ui.ext.colour_custom')}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-caption text-t2">{picked}</span>
          <input type="color" value={picked} onChange={e => setPicked(e.target.value.toLowerCase())} className="h-8 w-12 cursor-pointer bg-transparent" />
        </span>
      </label>
    </Dialog>
  );
}

export interface MenuItemOpts {
  id?: string;
  label?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

/** A context menu where the page asked for it (the point the page names, in its own pixels). */
export function MenuBox({ x, y, items, onDone }: { x: number; y: number; items: MenuItemOpts[]; onDone: (id: string | null) => void }) {
  const exitFx = useExitFx<HTMLDivElement>('pop-out');
  const box = useRef<HTMLDivElement | null>(null);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      box.current = el;
      exitFx(el);
    },
    [exitFx],
  );
  const [at, setAt] = useState({ left: x, top: y });
  useEscape(() => onDone(null));

  // Kept inside the window: a menu that would run off its right or bottom edge opens the other way.
  useLayoutEffect(() => {
    const el = box.current;
    const area = el?.parentElement;
    if (!el || !area) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + w > area.clientWidth - 4 ? Math.max(4, x - w) : x;
    const top = y + h > area.clientHeight - 4 ? Math.max(4, y - h) : y;
    setAt({ left, top });
  }, [x, y]);

  return (
    <div className="absolute inset-0 z-40" onMouseDown={e => e.target === e.currentTarget && onDone(null)} onContextMenu={e => e.preventDefault()}>
      <div
        ref={ref}
        role="menu"
        className="ctl-menu ext-menu absolute min-w-[190px] max-w-[320px] py-1 rounded-[6px] acrylic shadow-flyout text-[13px] pop-in origin-top-left"
        style={at}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="ext-menu-sep my-1 mx-2 h-px bg-stroke-strong" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => onDone(typeof it.id === 'string' ? it.id : String(i))}
              className={`ext-menu-item w-[calc(100%-8px)] mx-1 h-[28px] flex items-center px-2.5 rounded-[4px] text-left hover:bg-subtle disabled:opacity-40 disabled:hover:bg-transparent ${it.danger ? 'text-critical' : 'text-t1'}`}
            >
              <span className="truncate">{text(it.label, 80)}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
