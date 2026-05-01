/**
 * VotePredict — Graph Renderer (graph.js)
 *
 * Responsibilities (frontend / display only):
 *   GET /api/graph             → full family graph
 *   GET /api/graph/person/{id} → single-person subgraph
 *
 * All CSV parsing + graph logic lives in Python (app/main.py).
 */

// ═══════════════════════════════════════════════════════════
// Ambient particles
// ═══════════════════════════════════════════════════════════
(function () {
  const c = document.getElementById('particles');
  for (let i = 0; i < 28; i++) {
    const el = document.createElement('div');
    el.className = 'p';
    const s = Math.random() * 3 + 1.5;
    el.style.cssText = `width:${s}px;height:${s}px;left:${Math.random()*100}%;`
      + `bottom:-${s}px;animation-duration:${Math.random()*20+14}s;`
      + `animation-delay:${Math.random()*18}s;`;
    c.appendChild(el);
  }
}());

// ═══════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════
const App = (() => {

  // ── State ──────────────────────────────────────────────
  let nodes      = [];
  let edges      = [];
  let _fullNodes = [];   // cached full-graph data
  let _fullEdges = [];
  let ready      = false;
  let simulation = null;
  let svgRoot    = null;
  let zoomBeh    = null;
  let gRoot      = null;

  const EDGE_COLOR = {
    'parent-child': '#6c8cff',
    'spouse':       '#f472b6',
    'sibling':      '#34d399',
    'step-sibling': '#fbbf24',
  };

  // ── Helpers ────────────────────────────────────────────
  function show(id) { document.getElementById(id).style.display = ''; }
  function hide(id) { document.getElementById(id).style.display = 'none'; }

  function status(state, msg) {
    document.getElementById('status-dot').className = `dot ${state}`;
    document.getElementById('status-msg').textContent = msg;
  }

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

  // ── Core render (works for full graph AND subgraph) ────
  // focusId → if set, that node is highlighted gold
  function render(focusId = null) {
    const svgEl = document.getElementById('graph-svg');
    const W = svgEl.clientWidth  || window.innerWidth  - 272;
    const H = svgEl.clientHeight || window.innerHeight - 62;

    svgRoot = d3.select('#graph-svg');
    svgRoot.selectAll('*').remove();

    // Arrow marker
    const defs = svgRoot.append('defs');
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 20).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', EDGE_COLOR['parent-child']).attr('opacity', 0.6);

    zoomBeh = d3.zoom()
      .scaleExtent([0.04, 5])
      .on('zoom', e => gRoot.attr('transform', e.transform));
    svgRoot.call(zoomBeh);

    gRoot = svgRoot.append('g');
    const eData = visibleEdges();

    simulation = d3.forceSimulation(nodes)
      .force('link',      d3.forceLink(eData).id(d => d.id)
        .distance(+document.getElementById('sl-dist').value))
      .force('charge',    d3.forceManyBody()
        .strength(+document.getElementById('sl-charge').value))
      .force('center',    d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(focusId ? 24 : 18));

    // Links
    const linkSel = gRoot.selectAll('.link')
      .data(eData).join('line')
      .attr('class', d => `link ${d.type}`)
      .attr('marker-end', d => d.type === 'parent-child' ? 'url(#arrow)' : null);

    // Nodes
    const nodeSel = gRoot.selectAll('.node')
      .data(nodes).join('g')
      .attr('class', d => {
        const g = d.gender === 'F' ? 'female' : 'male';
        const f = focusId && d.id === focusId ? ' focus-node' : '';
        return `node ${g}${f}`;
      })
      .attr('id', d => `n-${d.id}`)
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end',   (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on('mouseover', showTip)
      .on('mousemove', moveTip)
      .on('mouseout',  hideTip)
      .on('click',     showDetail);

    // Circle (focus node is bigger)
    nodeSel.append('circle')
      .attr('r', d => focusId && d.id === focusId ? 14 : 9);

    // First name
    nodeSel.append('text')
      .attr('dy', d => focusId && d.id === focusId ? 28 : 21)
      .text(d => d.name.split(' ')[0]);

    // Relation badge (subgraph mode only)
    if (focusId) {
      nodeSel.append('text')
        .attr('class', 'rel-badge')
        .attr('dy', d => d.id === focusId ? 40 : 33)
        .text(d => (d.relation && d.relation !== 'focus') ? d.relation : '');
    }

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
    const rel = d.relation && d.relation !== 'focus' ? ` · <em>${d.relation}</em>` : '';
    tip.innerHTML =
      `<strong>${d.name}</strong>` +
      `ID: ${d.id} · ${d.gender === 'F' ? 'Female' : 'Male'}${rel}` +
      (d.father_id ? `<br>Father: #${d.father_id}` : '') +
      (d.mother_id ? `<br>Mother: #${d.mother_id}` : '');
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
  function dRow(k, v) {
    return `<div class="d-row"><span class="d-key">${k}</span><span class="d-val">${v}</span></div>`;
  }

  function showDetail(e, d) {
    e.stopPropagation();
    const isFem = d.gender === 'F';
    document.getElementById('d-avatar').className = `d-avatar ${isFem ? 'female' : 'male'}`;
    document.getElementById('d-avatar').textContent = d.name[0];
    document.getElementById('d-name').textContent   = d.name;
    const badge = document.getElementById('d-badge');
    badge.className   = `d-badge ${isFem ? 'female' : 'male'}`;
    badge.textContent = isFem ? '♀ Female' : '♂ Male';

    const spouses  = (d.spouse_ids  || []).map(resolve).join(', ') || '—';
    const siblings = (d.sibling_ids || []).length ? `${d.sibling_ids.length} sibling(s)` : '—';
    const steps    = (d.step_sib_ids || []).length ? `${d.step_sib_ids.length} step-sibling(s)` : '—';
    const relLabel = d.relation && d.relation !== 'focus' ? d.relation : '—';

    document.getElementById('d-rows').innerHTML =
      dRow('ID',            `#${d.id}`) +
      (d.relation ? dRow('Relation', relLabel) : '') +
      dRow('Father',        d.father_id ? resolve(d.father_id) : '—') +
      dRow('Mother',        d.mother_id ? resolve(d.mother_id) : '—') +
      dRow('Spouse(s)',     spouses) +
      dRow('Siblings',      siblings) +
      dRow('Step-Siblings', steps);

    show('detail');
  }

  document.addEventListener('click', e => {
    const panel = document.getElementById('detail');
    if (!panel.contains(e.target)) hide('detail');
  });

  // ═══════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════
  return {

    // ── Generate full graph ──────────────────────────────
    async generate() {
      if (ready) { nodes = _fullNodes; edges = _fullEdges; render(null); return; }

      status('loading', 'Fetching from /api/graph…');
      document.getElementById('btn-label').textContent = 'Loading…';
      hide('empty');
      show('loading');
      document.getElementById('loading-msg').textContent = 'Fetching graph from API…';

      try {
        const res = await fetch('/api/graph');
        if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
        const data = await res.json();

        nodes = data.nodes;
        edges = data.edges;
        _fullNodes = data.nodes;   // cache
        _fullEdges = data.edges;

        const s = data.stats;
        document.querySelector('#chip-persons .chip-num').textContent = s.total_persons;
        document.querySelector('#chip-edges .chip-num').textContent   = s.total_relations;

        document.getElementById('stat-grid').innerHTML = `
          <div class="stat-item"><div class="s-num">${s.total_persons}</div><div class="s-lbl">Persons</div></div>
          <div class="stat-item"><div class="s-num">${s.parent_child}</div><div class="s-lbl">Parent-Child</div></div>
          <div class="stat-item"><div class="s-num">${s.spouse}</div><div class="s-lbl">Spouses</div></div>
          <div class="stat-item"><div class="s-num">${s.sibling}</div><div class="s-lbl">Siblings</div></div>
          <div class="stat-item"><div class="s-num">${s.step_sibling}</div><div class="s-lbl">Step-Siblings</div></div>
          <div class="stat-item"><div class="s-num">${s.total_relations}</div><div class="s-lbl">Total Edges</div></div>`;
        show('stat-card');

        status('ok', `${s.total_persons} persons · ${s.total_relations} relations`);
        document.getElementById('btn-label').textContent = 'Re-render Graph';
        ready = true;

        hide('loading');
        show('graph-svg');
        show('toolbar');
        render(null);

      } catch (err) {
        hide('loading');
        show('empty');
        status('err', err.message);
        document.getElementById('btn-label').textContent = 'Generate Graph';
        console.error(err);
      }
    },

    // ── Focus on a single person ─────────────────────────
    async focusPerson() {
      const input = document.getElementById('focus-id-input');
      const pid   = input.value.trim();
      if (!pid) { input.focus(); return; }

      // Sidebar status
      const fDot = document.getElementById('focus-dot');
      const fMsg = document.getElementById('focus-msg');
      const fRow = document.getElementById('focus-status-row');
      fRow.style.display = '';
      fDot.className = 'dot loading';
      fMsg.textContent = `Loading person #${pid}…`;
      document.getElementById('btn-back').style.display = 'none';

      // Canvas loading
      hide('empty');
      hide('focus-banner');
      if (document.getElementById('graph-svg').style.display !== 'none') {
        // keep svg visible but show overlay
      }
      show('loading');
      document.getElementById('loading-msg').textContent = `Building subgraph for ID #${pid}…`;

      try {
        const res = await fetch(`/api/graph/person/${pid}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const s    = data.stats;

        // Swap to subgraph data
        nodes = data.nodes;
        edges = data.edges;

        // Canvas banner
        document.getElementById('focus-banner-name').textContent = data.focus_name;
        document.getElementById('focus-banner-sub').textContent =
          `${s.total_persons} nodes · ${s.total_relations} edges · ${s.children} child(ren)`;
        show('focus-banner');

        // Sidebar
        fDot.className = 'dot ok';
        fMsg.textContent = `${s.total_persons} people, ${s.total_relations} relations`;
        document.getElementById('btn-back').style.display = '';
        document.getElementById('legend-focus').style.display = '';

        hide('loading');
        show('graph-svg');
        show('toolbar');
        render(data.focus_id);

        // Auto-fit after simulation settles
        setTimeout(() => App.resetView(), 900);

      } catch (err) {
        hide('loading');
        ready ? show('graph-svg') : show('empty');
        fDot.className = 'dot err';
        fMsg.textContent = err.message;
        console.error(err);
      }
    },

    // ── Restore full graph ───────────────────────────────
    showFullGraph() {
      if (!ready) return;
      nodes = _fullNodes;
      edges = _fullEdges;

      hide('focus-banner');
      document.getElementById('focus-status-row').style.display = 'none';
      document.getElementById('btn-back').style.display = 'none';
      document.getElementById('legend-focus').style.display = 'none';
      document.getElementById('focus-id-input').value = '';

      render(null);
    },

    // ── Filter toggles ───────────────────────────────────
    applyFilters() { if (ready || nodes.length) render(null); },

    // ── Search highlight ─────────────────────────────────
    search(q) {
      if (!nodes.length) return;
      const t = q.trim().toLowerCase();
      d3.selectAll('.node')
        .classed('hi',  d => t && (d.name.toLowerCase().includes(t) || d.id.includes(t)))
        .classed('dim', d => t && !(d.name.toLowerCase().includes(t) || d.id.includes(t)));
    },

    // ── Physics sliders ──────────────────────────────────
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

    // ── Zoom controls ────────────────────────────────────
    zoomIn()    { svgRoot.transition().duration(280).call(zoomBeh.scaleBy, 1.5); },
    zoomOut()   { svgRoot.transition().duration(280).call(zoomBeh.scaleBy, 0.67); },
    resetView() { svgRoot.transition().duration(380).call(zoomBeh.transform, d3.zoomIdentity); },

    closeDetail() { hide('detail'); },
  };
})();

window.addEventListener('resize', () => {
  if (document.getElementById('graph-svg').style.display === 'none') return;
  App.applyFilters();
});
