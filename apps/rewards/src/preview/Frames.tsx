import { FRAMES } from './frameList';

/** Dev only (`/_frames?preview=1`): every frame at phone width, side by side, for checking against the spec. */
export function Frames() {
  return (
    <div style={{ padding: 24, background: '#C5CAC5', minHeight: '100vh', display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      {FRAMES.map((f) => (
        <figure key={f.frame} style={{ margin: 0 }}>
          <iframe title={f.name} src={f.url} width={390} height={844} style={{ border: 0, background: '#fff', display: 'block' }} />
          <figcaption style={{ font: '12px/1.4 var(--font-mono)', marginTop: 6 }}>
            {f.frame} · {f.name}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
