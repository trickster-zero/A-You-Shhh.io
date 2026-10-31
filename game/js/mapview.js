// SVG node map for a floor. Reads run state; calls back on move and preview. No game rules here.
const NS = 'http://www.w3.org/2000/svg';

const GLYPHS = {
  entrance: '<path d="M-1.5 1.3 V-0.1 A1.5 1.5 0 0 1 1.5 -0.1 V1.3" class="glyph-line"/>',
  passage: '<circle r="0.55" class="glyph-fill"/>',
  fight: '<path d="M-1.2 -1.2 L1.2 1.2 M1.2 -1.2 L-1.2 1.2" class="glyph-line"/>',
  guard: '<path d="M-1.2 -1.2 L1.2 1.2 M1.2 -1.2 L-1.2 1.2" class="glyph-line"/><circle r="3.6" class="guard-ring"/>',
  crevice: '<path d="M-0.3 -1.6 L0.6 -0.5 L-0.4 0.4 L0.4 1.6" class="glyph-line"/>',
  chest: '<rect x="-1.4" y="-0.9" width="2.8" height="1.9" rx="0.3" class="glyph-line"/><path d="M-1.4 -0.1 H1.4" class="glyph-line"/>'
};

export function createMapView(container, run, { onMove, onPreview } = {}) {
  const { floor } = run;
  const svg = s('svg', { viewBox: '0 0 100 60', class: 'floor-map', role: 'group', 'aria-label': `Map of floor ${floor.number}` });
  svg.innerHTML = `
    <defs>
      <radialGradient id="caveGlow" cx="50%" cy="55%" r="65%">
        <stop offset="0%" stop-color="#16202b"/><stop offset="100%" stop-color="#0a0e13"/>
      </radialGradient>
    </defs>
    <rect class="map-bg" x="0" y="0" width="100" height="60" rx="1.5" fill="url(#caveGlow)"/>`;

  const edgeLayer = s('g', { class: 'edges' });
  const nodeLayer = s('g', { class: 'nodes' });
  svg.append(edgeLayer, nodeLayer);

  const edgeEls = floor.edges.map(([a, b]) => {
    const A = run.node(a), B = run.node(b);
    const line = s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'edge' });
    edgeLayer.append(line);
    return { a, b, el: line };
  });

  const nodeEls = {};
  for (const n of floor.nodes) {
    const g = s('g', { class: `node kind-${n.kind}`, transform: `translate(${n.x} ${n.y})`, 'data-id': n.id });
    g.innerHTML = `
      <circle r="6" class="hit"/>
      <circle r="4.1" class="reach-ring"/>
      <circle r="2.7" class="node-body"/>
      ${GLYPHS[n.kind] || ''}
      <text y="5.6" class="map-label">${escapeXml(n.label)}</text>`;
    g.addEventListener('click', () => onMove?.(n.id));
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onMove?.(n.id); }
    });
    g.addEventListener('pointerenter', () => onPreview?.(n.id));
    g.addEventListener('pointerleave', () => onPreview?.(null));
    g.addEventListener('focus', () => onPreview?.(n.id));
    g.addEventListener('blur', () => onPreview?.(null));
    nodeLayer.append(g);
    nodeEls[n.id] = g;
  }

  const marker = s('g', { class: 'player-marker', 'aria-hidden': 'true' });
  marker.innerHTML = '<circle r="3.4" class="marker-pulse"/><circle r="1.5" class="marker-core"/>';
  svg.append(marker);
  container.replaceChildren(svg);

  function update() {
    const reachable = new Set(run.moves());
    for (const n of floor.nodes) {
      const g = nodeEls[n.id];
      const current = run.position === n.id;
      const reach = reachable.has(n.id);
      g.classList.toggle('is-current', current);
      g.classList.toggle('is-reachable', reach);
      g.classList.toggle('is-visited', run.visited.has(n.id));
      g.classList.toggle('is-resolved', run.isResolved(n.id) && n.kind !== 'entrance' && n.kind !== 'passage');
      g.classList.toggle('is-blocked', run.blocked.has(n.id));
      g.setAttribute('tabindex', reach ? '0' : '-1');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-disabled', reach ? 'false' : 'true');
      g.setAttribute('aria-label', `${n.label}. ${run.describe(n.id)} ${current ? 'You are here.' : reach ? 'Press Enter to go here.' : 'Not reachable from here.'}`);
    }
    for (const e of edgeEls) {
      e.el.classList.toggle('is-walked', run.visited.has(e.a) && run.visited.has(e.b));
      e.el.classList.toggle('is-blocked', run.blocked.has(e.a) || run.blocked.has(e.b));
      e.el.classList.toggle('is-open', (e.a === run.position && reachable.has(e.b)) || (e.b === run.position && reachable.has(e.a)));
    }
    const p = run.node(run.position);
    marker.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  function flash(id, cls = 'is-failed') {
    const g = nodeEls[id];
    if (!g) return;
    g.classList.remove(cls);
    void g.getBoundingClientRect();
    g.classList.add(cls);
    setTimeout(() => g.classList.remove(cls), 700);
  }

  function focusNode(id) { nodeEls[id]?.focus(); }

  update();
  return { svg, update, flash, focusNode };
}

function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
const escapeXml = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
