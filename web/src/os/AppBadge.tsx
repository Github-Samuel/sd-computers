import { useOS } from '@/store/os';

/**
 * The count on an app's icon (a custom app sets one: computer.setBadge, or SetAppBadge from its
 * server). Sits in the corner of whatever holds the icon, which has to be `relative`. Retro has
 * none: a 1991 desktop did not count things on its icons.
 */
export default function AppBadge({ app, className }: { app: string; className?: string }) {
  const count = useOS(s => s.badges[app] ?? 0);
  if (count <= 0) return null;
  return <span className={`app-badge pop-in ${className ?? ''}`}>{count > 99 ? '99+' : count}</span>;
}
