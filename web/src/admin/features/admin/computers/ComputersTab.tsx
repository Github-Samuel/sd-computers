import { useState } from 'react';
import { Briefcase, Crosshair, KeyRound, Lock, MonitorUp, Move, Navigation, Pencil, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Badge, ConfirmDialog, Empty, Heading, SearchInput, Status } from '@/admin/components/shared';
import { ScrollArea } from '@/admin/components/ScrollArea';
import { useAdmin } from '@/admin/store/admin';
import { act, place } from '@/admin/nui/api';
import { styleLike, t } from '@/admin/i18n';
import type { Computer, OsStyle, Prop } from '@/admin/types';
import { ComputerSetupModal, PropIcon, PropImage } from './ComputerSetupModal';

type Filter = 'all' | 'placed' | 'config';

const coords = (c: Computer) => `${(c.x ?? 0).toFixed(1)}, ${(c.y ?? 0).toFixed(1)}, ${(c.z ?? 0).toFixed(1)}`;
const jobsOf = (c: Computer) => Object.entries(c.groups ?? {}).map(([job, grade]) => (grade > 0 ? `${job} ${grade}+` : job));

// Made from this panel: placed, or picked (a prop the game already had there).
const made = (c: Computer) => c.source === 'placed' || c.source === 'world';

// Where it is, in the row's second line: a placed or picked computer says its id, spot and prop; a
// config one its id and spot; one a resource added the resource too; a model computer the props
// that are it (it has no one place).
const whereOf = (c: Computer) => {
  if (c.source === 'model') {
    const models = c.models ?? [];
    return `${c.key} · ${models.slice(0, 2).join(', ')}${models.length > 2 ? ` ${t('computers.more_models', models.length - 2)}` : ''}`;
  }
  if (made(c)) return `#${c.id} · ${c.hostname} · ${coords(c)} · ${Math.round(c.heading ?? 0)}° · ${c.prop}`;
  if (c.source === 'script') return [c.key, c.resource, c.hostname, coords(c), c.prop].filter(Boolean).join(' · ');
  return `${c.key} · ${c.hostname} · ${coords(c)}`;
};

const Row = ({ c, style, prop, onEdit, onDelete }: { c: Computer; style?: OsStyle; prop?: Prop; onEdit: () => void; onDelete: () => void }) => {
  const snapshot = useAdmin(s => s.snapshot)!;
  const busy = useAdmin(s => s.busy);
  const edit = snapshot.canEdit;
  const inUse = c.users.length > 0;
  const jobs = jobsOf(c);
  const showStyle = () => {
    useAdmin.getState().focusStyle(c.style);
    useAdmin.getState().setTab('styles');
  };
  // (taken away here: it is in the list only to be put back, and reads as not there)
  const gone = c.removed === true;
  return (
    <div className="sc-row" style={gone ? { opacity: 0.6 } : undefined}>
      {made(c) ? (
        <span title={prop?.label ?? c.prop}>
          <PropImage prop={prop} className="rounded-[6px]" style={{ width: 38, height: 38, boxShadow: inUse ? '0 0 0 1.5px var(--ok)' : '0 0 0 1px var(--hairline-strong)' }} iconSize={16} />
        </span>
      ) : (
        <span className="flex items-center justify-center flex-shrink-0" style={{ width: 38, color: inUse ? 'var(--ok)' : 'var(--text-3)' }} title={inUse ? t('computers.in_use_by', c.users.join(', ')) : t('computers.idle')}>
          <PropIcon kind={c.source === 'model' ? 'tower' : 'monitor'} size={16} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium truncate">{c.label}</span>
          {inUse && <Status tone="ok">{c.source === 'model' ? t('computers.in_use_count', c.users.length) : t('computers.in_use_by', c.users.join(', '))}</Status>}
          <button type="button" className="inline-flex p-0 bg-transparent border-0" title={[styleLike(c.style), t('computers.show_style')].filter(Boolean).join(' · ')} onClick={showStyle}>
            <Badge>{style?.name ?? c.style}</Badge>
          </button>
          <span title={c.source === 'script' ? t('computers.script_hint', c.resource ?? '') : undefined}>
            <Badge tone={made(c) ? 'accent' : 'neutral'}>{t(`computers.source_${c.source}`)}</Badge>
          </span>
          {c.off && <Status>{t('computers.off')}</Status>}
          {gone && (
            <span title={t('computers.removed_hint')}>
              <Status>{t('computers.removed_tag')}</Status>
            </span>
          )}
          {jobs.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11.5px] min-w-0" style={{ color: 'var(--text-2)' }} title={t('computers.locked_to', jobs.join(', '))}>
              <Lock size={11} className="flex-shrink-0" />
              <span className="truncate">{jobs.join(', ')}</span>
            </span>
          )}
          {/* (the job as the framework spells it, like the lock beside it; '*' = whoever signs in as a boss) */}
          {c.boss && (
            <span
              className="inline-flex items-center gap-1 text-[11.5px] min-w-0"
              style={{ color: 'var(--text-2)' }}
              title={c.boss === '*' ? t('computers.manages_any') : t('computers.manages_job', snapshot.jobs.find(j => j.name === c.boss)?.label ?? c.boss)}
            >
              <Briefcase size={11} className="flex-shrink-0" />
              <span className="truncate">{c.boss === '*' ? t('computers.boss_any') : c.boss}</span>
            </span>
          )}
          {c.pin && (
            <span className="inline-flex items-center" style={{ color: 'var(--text-2)' }} title={t('computers.has_pin')}>
              <KeyRound size={12} />
            </span>
          )}
        </div>
        <div className="text-[11.5px] mono mt-1 truncate" style={{ color: 'var(--text-3)' }}>
          {whereOf(c)}
        </div>
      </div>
      <div className="sc-row__actions">
        {edit && c.source !== 'model' && (
          <button type="button" className="sc-btn sc-btn--icon" title={t('actions.teleport')} aria-label={t('actions.teleport')} disabled={busy} onClick={() => void act('teleport', { key: c.key })}>
            <Navigation size={14} />
          </button>
        )}
        {c.source === 'model' && (
          <button type="button" className="sc-btn sc-btn--icon" title={t('computers.auto_settings')} aria-label={t('computers.auto_settings')} onClick={() => useAdmin.getState().setTab('automatic')}>
            <SlidersHorizontal size={14} />
          </button>
        )}
        {edit && made(c) && (
          <>
            <button type="button" className="sc-btn sc-btn--icon" title={t('actions.edit')} aria-label={t('actions.edit')} disabled={busy} onClick={onEdit}>
              <Pencil size={14} />
            </button>
            {/* (a picked prop is where the game put it) */}
            {c.source === 'placed' && (
              <button type="button" className="sc-btn sc-btn--icon" title={t('actions.move')} aria-label={t('actions.move')} disabled={busy} onClick={() => void place('movecomputer', { id: c.id })}>
                <Move size={14} />
              </button>
            )}
            <button type="button" className="sc-btn sc-btn--icon sc-btn--danger" title={t('actions.delete')} aria-label={t('actions.delete')} disabled={busy} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </>
        )}
        {/* (one of the config's locations: the file is not this panel's to change, so it is taken away and put back instead) */}
        {edit &&
          c.source === 'config' &&
          (gone ? (
            <button
              type="button"
              className="sc-btn sc-btn--icon"
              title={t('computers.restore')}
              aria-label={t('computers.restore')}
              disabled={busy}
              onClick={() => void act('restoreconfigcomputer', { key: c.key }, t('computers.config_restored', c.label))}
            >
              <RotateCcw size={14} />
            </button>
          ) : (
            <button type="button" className="sc-btn sc-btn--icon sc-btn--danger" title={t('computers.remove_config')} aria-label={t('computers.remove_config')} disabled={busy} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          ))}
      </div>
    </div>
  );
};

// Every computer on the server: the ones made from here - placed, or picked from the props the game
// already has - which can be changed and taken away, and the ones configs/shared/computers.lua
// defines, listed so the whole map is in one place. A location from that file can be taken away
// here too, and put back: the file is not changed, the computer only stops being one meanwhile.
export function ComputersTab() {
  const snapshot = useAdmin(s => s.snapshot)!;
  const busy = useAdmin(s => s.busy);
  const edit = snapshot.canEdit;
  const [setup, setSetup] = useState<{ computer?: Computer; world?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Computer | null>(null);
  const [wiping, setWiping] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const styles = Object.fromEntries(snapshot.styles.map(s => [s.key, s]));
  const props = Object.fromEntries(snapshot.props.map(p => [p.model, p]));
  const all = snapshot.computers;
  const placed = all.filter(made);
  const query = search.trim().toLowerCase();
  const shown = all.filter(
    c =>
      (filter === 'all' || (filter === 'placed' ? made(c) : c.source === 'config' || c.source === 'model')) &&
      `${c.label} ${c.key} ${c.hostname} ${c.prop ?? ''} ${(c.models ?? []).join(' ')} ${styles[c.style]?.name ?? c.style} ${Object.keys(c.groups ?? {}).join(' ')} ${c.boss ?? ''} ${c.users.join(' ')}`.toLowerCase().includes(query),
  );

  return (
    <div className="flex flex-col h-full min-h-0 px-6 py-5 gap-4">
      <Heading title={t('tabs.computers')} count={all.filter(c => !c.removed).length}>
        {edit && placed.length > 0 && (
          <button type="button" className="sc-btn sc-btn--danger" disabled={busy} onClick={() => setWiping(true)}>
            <Trash2 size={14} />
            {t('computers.delete_placed')}
          </button>
        )}
        {edit && (
          <button type="button" className="sc-btn" disabled={busy} onClick={() => setSetup({ world: true })}>
            <Crosshair size={14} />
            {t('computers.pick')}
          </button>
        )}
        {edit && (
          <button type="button" className="sc-btn sc-btn--primary" disabled={busy || snapshot.props.length === 0} onClick={() => setSetup({})}>
            <MonitorUp size={14} />
            {t('computers.place')}
          </button>
        )}
      </Heading>

      {all.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <SearchInput value={search} onChange={setSearch} placeholder={t('computers.search')} />
          <div className="sc-segment">
            {(['all', 'placed', 'config'] as const).map(f => (
              <button key={f} type="button" data-on={filter === f} onClick={() => setFilter(f)}>
                {t(`computers.filter_${f}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        {!all.length ? (
          <Empty text={t('computers.empty')} />
        ) : !shown.length ? (
          <Empty text={t(filter === 'placed' && !query ? 'computers.none_placed' : 'computers.no_results')} />
        ) : (
          <div className="sc-list">
            {shown.map(c => (
              <Row key={c.key} c={c} style={styles[c.style]} prop={c.prop ? (props[c.prop] ?? { model: c.prop, label: c.prop }) : undefined} onEdit={() => setSetup({ computer: c })} onDelete={() => setDeleting(c)} />
            ))}
          </div>
        )}
      </ScrollArea>

      {setup && <ComputerSetupModal computer={setup.computer} world={setup.world} onClose={() => setSetup(null)} />}
      {deleting && made(deleting) && (
        <ConfirmDialog
          title={t('computers.remove')}
          body={t('computers.remove_confirm', deleting.label)}
          confirmLabel={t('actions.delete')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const reply = await act('deletecomputer', { id: deleting.id }, t('computers.removed', deleting.label));
            if (reply.success) setDeleting(null);
          }}
        />
      )}
      {deleting && deleting.source === 'config' && (
        <ConfirmDialog
          title={t('computers.remove_config')}
          body={t('computers.remove_config_confirm', deleting.label)}
          confirmLabel={t('computers.remove_config_action')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const reply = await act('removeconfigcomputer', { key: deleting.key }, t('computers.config_removed', deleting.label));
            if (reply.success) setDeleting(null);
          }}
        />
      )}
      {wiping && (
        <ConfirmDialog
          title={t('computers.delete_placed_title')}
          body={t('computers.delete_placed_body', placed.length)}
          confirmLabel={t('actions.delete_all')}
          onClose={() => setWiping(false)}
          onConfirm={async () => {
            const reply = await act('deleteallcomputers', {}, t('computers.all_removed'));
            if (reply.success) setWiping(false);
          }}
        />
      )}
    </div>
  );
}
