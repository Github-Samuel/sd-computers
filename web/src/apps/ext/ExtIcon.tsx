import { useState } from 'react';
import { useOS } from '@/store/os';
import type { ExtAppId } from '@/types';

// A custom app's icon: the picture its resource registered, or - without one, or when it will not
// load - a tile with the first letter of its name, in its colour. Drawn by the three looks' own
// icon components (os/icons.tsx, os/mac/MacIcon.tsx, os/retro/glyphs.tsx), each asking for its kind.

/** modern: the art as it is; tile: filling the mac look's squircle; pixel: retro's 16-grid icons. */
export type ExtIconLook = 'modern' | 'tile' | 'pixel';

/** A colour for an app that named none, the same one every time for the same id. */
const PALETTE = ['#2f7bf5', '#7a5cf0', '#d9467b', '#e0731f', '#1f9d6b', '#0f8fa8', '#5b6b82', '#b8458f'];
const colourOf = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export default function ExtIcon({ app, size, look }: { app: ExtAppId; size: number | string; look: ExtIconLook }) {
  const def = useOS(s => s.payload?.computer.apps.find(a => a.id === app));
  const [broken, setBroken] = useState<string | null>(null);
  const src = def?.ext?.icon ?? null;
  // (inline, so it wins over a look's own rule for the art inside its tile)
  const box = { width: size, height: size };

  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setBroken(src)}
        className="ext-icon block shrink-0 object-contain"
        style={{ ...box, imageRendering: look === 'pixel' ? 'pixelated' : undefined }}
      />
    );
  }

  const letter = (def?.label ?? app.slice(4)).trim().charAt(0).toUpperCase() || '?';
  const colour = def?.ext?.color ?? colourOf(app);
  const pixel = look === 'pixel';
  return (
    <svg className="ext-icon shrink-0" style={box} viewBox="0 0 48 48" shapeRendering={pixel ? 'crispEdges' : undefined} aria-hidden>
      <rect x={pixel ? 3 : look === 'modern' ? 4 : 0} y={pixel ? 3 : look === 'modern' ? 4 : 0} width={pixel ? 42 : look === 'modern' ? 40 : 48} height={pixel ? 42 : look === 'modern' ? 40 : 48} rx={pixel ? 0 : look === 'modern' ? 9 : 0} fill={colour} />
      {pixel && <rect x="3" y="3" width="42" height="42" fill="none" stroke="#000" strokeWidth="3" />}
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={pixel ? 30 : 24}
        fontWeight={pixel ? 400 : 600}
        fontFamily={pixel ? "'VT323', monospace" : "'Inter Variable', Inter, system-ui, sans-serif"}
      >
        {letter}
      </text>
    </svg>
  );
}
