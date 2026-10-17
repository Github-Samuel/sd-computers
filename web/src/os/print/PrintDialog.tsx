import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Minus, Plus, Printer as PrinterIcon } from 'lucide-react';
import { useOS, type WinApp } from '@/store/os';
import { rpc } from '@/nui/rpc';
import { t } from '@/i18n';
import { Button, Dialog, InfoBar, Spinner } from '@/ui/controls';

// Print, as every app asks for it. An app does not send a page: it names what to print - a
// source the server knows ('text', 'mail', 'statement', 'logs') and what in it - and the server
// builds the page from its own data (server/computers/printing.lua). This dialog only picks where
// it comes out: one of the printers in reach of this computer, and how many copies. The page then
// waits in that printer's tray until somebody goes and takes it.
//
// An app takes two things from here: <PrintSlot app="mail" /> once, at its root (the dialog is
// drawn inside the app's window, like every <Dialog>: the root is `relative`), and askPrint('mail',
// job) from wherever its Print command is. usePrinting() says whether to offer the command at all.

/** What an app wants printed. */
export interface PrintJob {
  /** The server's name for where the page comes from. */
  source: string;
  /** What in it: an id, a filter, or - for 'text' alone - the text itself. */
  data: Record<string, unknown>;
  /** What the dialog calls it. */
  title: string;
  /** Told how it ended: true once the page went to a printer, false when the dialog was put away. */
  onDone?: (sent: boolean) => void;
}

interface PrinterRow {
  id: number;
  label: string;
  /** metres from this computer */
  distance: number;
  /** copies in its tray */
  waiting: number;
  full: boolean;
}

interface Printers {
  enabled: boolean;
  printers: PrinterRow[];
  maxCopies: number;
  pageSeconds: number;
}

/** Whether this computer prints at all (configs/shared/printers.lua > Enabled): apps hide their Print without it. */
export const usePrinting = (): boolean => useOS(s => s.payload?.desktop.printing !== false);

/** What each app has asked to print and not yet sent or dropped, by app. */
const useAsked = create<{ jobs: Partial<Record<WinApp, PrintJob>> }>(() => ({ jobs: {} }));

/** Put the Print dialog up in an app's window (the app has a <PrintSlot> for it). */
export const askPrint = (app: WinApp, job: PrintJob): void => useAsked.setState(s => ({ jobs: { ...s.jobs, [app]: job } }));

const drop = (app: WinApp): void =>
  useAsked.setState(s => {
    const jobs = { ...s.jobs };
    delete jobs[app];
    return { jobs };
  });

/** Where an app's Print dialog is drawn: once, at the app's root. */
export function PrintSlot({ app }: { app: WinApp }) {
  const job = useAsked(s => s.jobs[app]);
  // (a window closed with the dialog up does not open on it next time)
  useEffect(() => () => drop(app), [app]);
  return job ? (
    <PrintDialog
      job={job}
      app={app}
      onClose={() => {
        drop(app);
        job.onDone?.(false);
      }}
    />
  ) : null;
}

function PrintDialog({ job, app, onClose }: { job: PrintJob; app: WinApp; onClose: () => void }) {
  const [state, setState] = useState<Printers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);

  // Escape puts the dialog away and goes no further: not to the app under it, and not to the
  // machine, which would stand the player up (src/os/Computer.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  useEffect(() => {
    let alive = true;
    void rpc<Printers>('print:printers').then(res => {
      if (!alive) return;
      if (!res.ok || !res.data) return setError(res.error ?? t('ui.common.error'));
      const printers = Array.isArray(res.data.printers) ? res.data.printers : [];
      setState({ ...res.data, printers });
      setPicked(printers.find(p => !p.full)?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const max = Math.max(1, state?.maxCopies ?? 1);
  const printer = state?.printers.find(p => p.id === picked) ?? null;

  async function print() {
    if (!printer || busy) return;
    setBusy(true);
    setError(null);
    const res = await rpc<{ printer: string; copies: number; seconds: number }>('print:submit', { printer: printer.id, copies, source: job.source, data: job.data });
    setBusy(false);
    if (!res.ok || !res.data) return setError(res.error ?? t('ui.common.error'));
    useOS.getState().toast({ app, title: t('ui.print.sent_title', res.data.printer), body: t(res.data.copies === 1 ? 'ui.print.sent_one' : 'ui.print.sent_many', res.data.copies) });
    job.onDone?.(true);
    onClose();
  }

  return (
    <Dialog
      title={t('ui.print.title')}
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="accent" icon={busy ? <Spinner size={15} /> : <PrinterIcon size={15} />} disabled={!printer || busy} onClick={() => void print()}>
            {t('ui.print.print')}
          </Button>
          <Button disabled={busy} onClick={onClose}>
            {t('ui.common.cancel')}
          </Button>
        </>
      }
    >
      <div className="text-t1 font-semibold truncate mb-3" title={job.title}>
        {job.title}
      </div>

      {error && (
        <div className="mb-3">
          <InfoBar severity="error">{error}</InfoBar>
        </div>
      )}

      {!state && !error && (
        <div className="h-24 flex items-center justify-center">
          <Spinner size={22} />
        </div>
      )}

      {state && state.printers.length === 0 && <InfoBar severity="warning" title={t('ui.print.none_title')}>{t('ui.print.none_body')}</InfoBar>}

      {state && state.printers.length > 0 && (
        <>
          <div className="text-caption text-t2 mb-1.5">{t('ui.print.printer')}</div>
          <div className="max-h-[168px] overflow-y-auto os-scroll flex flex-col gap-1 -mx-1 px-1" role="radiogroup" aria-label={t('ui.print.printer')}>
            {state.printers.map(p => {
              const on = p.id === picked;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={p.full || busy}
                  onClick={() => setPicked(p.id)}
                  className={`ctl-print-row w-full h-11 px-3 flex items-center gap-3 rounded-ctl border text-left disabled:opacity-50 ${on ? 'border-accent bg-subtle' : 'border-stroke hover:bg-subtle'}`}
                >
                  <PrinterIcon size={17} className={on ? 'text-accent-text' : 'text-t2'} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-body text-t1 truncate">{p.label}</span>
                    <span className="block text-caption text-t3 truncate">
                      {t('ui.print.away', p.distance)}
                      {' · '}
                      {p.full ? t('ui.print.tray_full') : p.waiting > 0 ? t('ui.print.waiting', p.waiting) : t('ui.print.tray_empty')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="flex-1 text-body text-t1">{t('ui.print.copies')}</span>
            <Button aria-label={t('ui.print.fewer')} title={t('ui.print.fewer')} disabled={copies <= 1 || busy} onClick={() => setCopies(c => Math.max(1, c - 1))} className="!px-2">
              <Minus size={14} />
            </Button>
            <span className="w-6 text-center text-body text-t1 tabular-nums">{copies}</span>
            <Button aria-label={t('ui.print.more')} title={t('ui.print.more')} disabled={copies >= max || busy} onClick={() => setCopies(c => Math.min(max, c + 1))} className="!px-2">
              <Plus size={14} />
            </Button>
          </div>
          <div className="mt-2 text-caption text-t3">{t('ui.print.hint')}</div>
        </>
      )}
    </Dialog>
  );
}
