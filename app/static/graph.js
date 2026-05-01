/**
 * VotePredict — Graph Renderer (graph.js)
 *
 * RESPONSIBILITIES (frontend only):
 *   - Calls GET /api/graph  → receives {nodes, edges, stats} from FastAPI
 *   - Renders a D3 force-directed graph
 *   - Handles zoom, drag, filters, search, tooltips, detail panel
 *
 * All CSV parsing / graph building happens in Python (app/main.py).
 */

// ═══════════════════════════════════════════════════════════
// Ambient particles (purely decorative)
// ═══════════════════════════════════════════════════════════
(function () {
  const container = document.getElementById('particles');
  for (let i = 0; i < 28; i++) {
    const el = document.createElement('div');
    el.className = 'p';
    const s = Math.random() * 3 + 1.5;
    el.style.cssText = `
      width:${s}px; height:${s}px;
      left:${Math.random() * 100}%;
      bottom:-${s}px;
      animation-duration:${Math.random() * 20 + 14}s;
      animation-delay:${Math.random() * 18}s;
    `;
    container.appendChild(el);
  }
}());

// ═══════════════════════════════════════════════════════════
// App state
// ═══════════════════════════════════════════════════════════
const App = (() => {
  let nodes      = [];
  let edges      = [];
  let simulation = null;
  let svgRoot    = null;
  let zoomBeh    = null;
  let gRoot      = null;   // <g> that holds everything (transformed by zoom)
  let ready      = false;

  // ── Colour helpers ──────────────────────────────────────
  const EDGE_COLOR = {
    'parent-child': '#6c8cff',
    'spouse':       '#f472b6',
    'sibling':      '#34d399',
    'step-sibling': '#fbbf24',
  };

  // ── Status bar ─────────────────────────────────────────
  function status(state, msg) {
    document.getElementById('status-dot').className = `dot ${state}`;
    document.getElementById('status-msg').textContent = msg;
  }

  // ── Show / hide helpers ────────────────────────────────
  function show(id) { document.getElementById(id).style.display = ''; }
  function hide(id) { document.getElementById(id).style.display = 'none'; }

  // ── Filtered edge list ─────────────────────────────────
  function visibleEdges() {
    const pc = document.getElementById('f-parent').checked;
    const sp = document.getElementById('f-spouse').checked;
    const sb = document.getElementById('f-sibling').checked;
    const st = document.getElementById('f-step').checked;
    return edges.filter(e =>
      (e.type === 'parent-child' && pc) ||
      (e.type === 'spouse'       && sp) ||
      (e.type === 'sibling'      && sb) ||
      (e.type === 'step-sibling' && st)
    );
  }

  // ── Render the D3 graph ────────────────────────────────
  function render() {
    const svgEl = document.getElementById('graph-svg');
    const W = svgEl.clientWidth  || window.innerWidth  - 272;
    const H = svgEl.clientHeight || window.innerHeight - 62;

    svgRoot = d3.select('#graph-svg');
    svgRoot.selectAll('*').remove();

    // Arrow marker for parent-child
    const defs = svgRoot.append('defs');
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 20).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', EDGE_COLOR['parent-child'])
      .attr('opacity', 0.6);

    // Zoom behaviour
    zoomBeh = d3.zoom()
      .scaleExtent([0.04, 5])
      .on('zoom', e => gRoot.attr('transform', e.transform));
    svgRoot.call(zoomBeh);

    gRoot = svgRoot.append('g');

    const eData = visibleEdges();

    // Simulation — uses a fresh copy of nodes so positions reset
    simulation = d3.forceSimulation(nodes)
      .force('link',      d3.forceLink(eData)
        .id(d => d.id)
        .distance(+document.getElementById('sl-dist').value))
      .force('charge',    d3.forceManyBody()
        .strength(+document.getElementById('sl-charge').value))
      .force('center',    d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(18));

    // Links
    const linkSel = gRoot.selectAll('.link')
      .data(eData).join('line')
      .attr('class', d => `link ${d.type}`)
      .attr('marker-end', d => d.type === 'parent-child' ? 'url(#arrow)' : null);

    // Nodes
    const nodeSel = gRoot.selectAll('.node')
      .data(nodes).join('g')
      .attr('class', d => `node ${d.gender === 'F' ? 'female' : 'male'}`)
      .attr('id', d => `n-${d.id}`)
      .call(
        d3.drag()
          .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end',   (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on('mouseover', showTip)
      .on('mousemove', moveTip)
      .on('mouseout',  hideTip)
      .on('click',     showDetail);

    nodeSel.append('circle').attr('r', 9);
    nodeSel.append('text').attr('dy', 21).text(d => d.name.split(' ')[0]);

    simulation.on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });
  }

  // ── Tooltip ────────────────────────────────────────────
  const tip = document.getElementById('tooltip');
  function showTip(e, d) {
    tip.style.display = 'block';
    tip.innerHTML = `<strong>${d.name}</strong>ID: ${d.id} · ${d.gender === 'F' ? 'Female' : 'Male'}
      ${d.father_id ? `<br>Father: #${d.father_id}` : ''}
      ${d.mother_id ? `<br>Mother: #${d.mother_id}` : ''}`;
    moveTip(e);
  }
  function moveTip(e) {
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY -  6) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  // ── Detail panel ───────────────────────────────────────
  function resolve(id) {
    const n = nodes.find(x => x.id === id);
    return n ? `${n.name} (#${id})` : `#${id}`;
  }
  function row(k, v) {
    return `<div class="d-row"><span class="d-key">${k}</span><span class="d-val">${v}</span></div>`;
  }

  function showDetail(e, d) {
    e.stopPropagation();
    const isFem = d.gender === 'F';
    document.getElementById('d-avatar').className = `d-avatar ${isFem ? 'female' : 'male'}`;
    document.getElementById('d-avatar').textContent = d.name[0];
    document.getElementById('d-name').textContent   = d.name;
    const badge = document.getElementById('d-badge');
    badge.className = `d-badge ${isFem ? 'female' : 'male'}`;
    badge.textContent = isFem ? '♀ Female' : '♂ Male';

    const spouses  = (d.spouse_ids  || []).map(resolve).join(', ') || '—';
    const siblings = (d.sibling_ids || []).length || 0;
    const steps    = (d.step_sib_ids || []).length || 0;

    document.getElementById('d-rows').innerHTML =
      row('ID',             `#${d.id}`) +
      row('Father',         d.father_id ? resolve(d.father_id) : '—') +
      row('Mother',         d.mother_id ? resolve(d.mother_id) : '—') +
      row('Spouse(s)',      spouses) +
      row('Siblings',       siblings ? `${siblings} person(s)` : '—') +
      row('Step-Siblings',  steps    ? `${steps} person(s)` : '—');

    show('detail');
  }

  document.addEventListener('click', e => {
    const panel = document.getElementById('detail');
    if (!panel.contains(e.target)) hide('detail');
  });

  // ── Public API ─────────────────────────────────────────
  return {

    // Called by the Generate Graph button
    async generate() {
      if (ready) { render(); return; }   // re-render with current data

      status('loading', 'Fetching from /api/graph…');
      document.getElementById('btn-label').textContent = 'Loading…';
      hide('empty');
      show('loading');

      try {
        const res = await fetch('/api/graph');
        if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);

        const data = await res.json();
        nodes = data.nodes;
        edges = data.edges;
        const s = data.stats;

        // Update header chips
        document.querySelector('#chip-persons .chip-num').textContent = s.total_persons;
        document.querySelector('#chip-edges .chip-num').textContent   = s.total_relations;

        // Update breakdown card
        const sg = document.getElementById('stat-grid');
        sg.innerHTML = `
          <div class="stat-item"><div class="s-num">${s.total_persons}</div>   <div class="s-lbl">Persons</div></div>
          <div class="stat-item"><div class="s-num">${s.parent_child}</div>    <div class="s-lbl">Parent-Child</div></div>
          <div class="stat-item"><div class="s-num">${s.spouse}</div>          <div class="s-lbl">Spouses</div></div>
          <div class="stat-item"><div class="s-num">${s.sibling}</div>         <div class="s-lbl">Siblings</div></div>
          <div class="stat-item"><div class="s-num">${s.step_sibling}</div>    <div class="s-lbl">Step-Siblings</div></div>
          <div class="stat-item"><div class="s-num">${s.total_relations}</div> <div class="s-lbl">Total Edges</div></div>
        `;
        show('stat-card');

        status('ok', `${s.total_persons} persons · ${s.total_relations} relations`);
        document.getElementById('btn-label').textContent = 'Re-render Graph';
        ready = true;

        hide('loading');
        show('graph-svg');
        show('toolbar');

        render();

      } catch (err) {
        hide('loading');
        show('empty');
        status('err', err.message);
        document.getElementById('btn-label').textContent = 'Generate Graph';
        console.error(err);
      }
    },

    applyFilters() {
      if (!ready) return;
      render();
    },

    search(q) {
      if (!ready) return;
      const term = q.trim().toLowerCase();
      d3.selectAll('.node')
        .classed('hi',  d => term && (d.name.toLowerCase().includes(term) || d.id.includes(term)))
        .classed('dim', d => term && !(d.name.toLowerCase().includes(term) || d.id.includes(term)));
    },

    physics() {
      const dist = +document.getElementById('sl-dist').value;
      const chg  = +document.getElementById('sl-charge').value;
      document.getElementById('lbl-dist').textContent = dist;
      document.getElementById('lbl-chg').textContent  = chg;
      if (!simulation) return;
      simulation.force('link').distance(dist);
      simulation.force('charge').strength(chg);
      simulation.alpha(0.5).restart();
    },

    zoomIn()    { svgRoot.transition().duration(280).call(zoomBeh.scaleBy, 1.5); },
    zoomOut()   { svgRoot.transition().duration(280).call(zoomBeh.scaleBy, 0.67); },
    resetView() { svgRoot.transition().duration(380).call(zoomBeh.transform, d3.zoomIdentity); },
    closeDetail() { hide('detail'); },
  };
})();

// Resize
window.addEventListener('resize', () => {
  if (!document.getElementById('graph-svg').style.display === 'none') return;
  App.applyFilters();
});
