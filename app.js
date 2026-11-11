/* Cure Window UI. All numbers come from cureplan.js run on data.js. */
(function () {
  'use strict';
  const D = window.ICON_DATA, C = window.CurePlan, J = D.job, E = D.ensemble;
  const $ = id => document.getElementById(id);
  const n = J.items.length;
  const hhmm = m => { const h = Math.floor(m / 60) % 24, mm = Math.round(m % 60); const ap = h >= 12 ? 'PM' : 'AM'; return ((h + 11) % 12 + 1) + ':' + String(mm).padStart(2, '0') + ' ' + ap; };
  const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2);
  const pct = x => Math.round(x * 100) + '%';
  const printMin = i => J.items[i].length_ft * 12 / J.speedInS / 60;

  // ---------- compute ----------
  const base = { plan: D.baselinePlan };
  base.r = C.risk(J, base.plan, E);
  const starts = []; for (let m = 6 * 60; m <= 10 * 60; m += 60) starts.push(m);
  const opt = C.optimize(J, E, { starts });
  const fair = C.risk(J, { startMin: D.baselinePlan.startMin, order: D.baselinePlan.order, tiePolicy: 'parallel', tieOffsets: new Array(n).fill(0) }, E);
  const meanW = { temp: D.forecast.temp, wind: D.forecast.wind };
  const simB = C.simulate(J, base.plan, meanW), simO = C.simulate(J, opt.plan, meanW);
  const avg = (plan, key) => E.reduce((s, w) => s + C.simulate(J, plan, w)[key], 0) / E.length;
  const holdB = avg(base.plan, 'windPause'), holdO = avg(opt.plan, 'windPause');
  const crewB = avg(base.plan, 'crewWait') + avg(base.plan, 'tieIdle'), crewO = avg(opt.plan, 'crewWait') + avg(opt.plan, 'tieIdle');
  let state = 'opt';

  // ---------- header chips ----------
  const firstTieO = (() => { for (let L = 1; L <= J.layers; L++) for (const i of opt.plan.order) if ((J.firstLayer + L - 1 + opt.plan.tieOffsets[i]) % J.crossTies.every === 0) return { i, L: J.firstLayer + L - 1 }; return null; })();
  const o0 = opt.plan.order[0];
  const chips = [
    ['Printing Item', `ITEM ${o0 + 1}-L${J.firstLayer}`, true, 'pause'],
    ['Creating Batch', 'ADDING LIQUIDS', true, 'x'],
    ['QC Material', 'AT NOZZLE', true, 'pause'],
    ['Place Cross-ties', firstTieO ? `ON ITEM ${firstTieO.i + 1}-L${firstTieO.L}` : 'NONE', false, 'play'],
  ];
  const icon = k => k === 'pause' ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="#fff"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>' : k === 'x' ? '<svg width="12" height="12" viewBox="0 0 12 12" stroke="#fff" stroke-width="1.8"><path d="m2 2 8 8M10 2l-8 8"/></svg>' : '<svg width="12" height="12" viewBox="0 0 12 12" fill="#fff"><path d="M3 1.5v9l7-4.5z"/></svg>';
  $('chips').innerHTML = chips.map(([t, s, on, k], idx) => `<div class="chip ${idx === 3 ? 'ghost' : ''}"><div class="ring ${on ? '' : 'gray'}">${icon(k)}</div><div><div class="t">${t}</div><div class="s mono">${s}</div></div><span class="tm mono">▸ 1:05</span></div>`).join('');

  // ---------- layer stack ----------
  function layerRisk(r, Labs) { let p = 0; for (const [k, v] of r.cold) { const L = +k.split(':')[1] + J.firstLayer - 1; if (L === Labs) p = Math.max(p, v); } return p; }
  function renderLayers() {
    const r = state === 'opt' ? opt.r : base.r;
    let h = '';
    for (let L = J.firstLayer + 13; L >= J.firstLayer - 2; L--) {
      if (L === J.firstLayer) { h += `<div class="lay bar now"></div><div class="lay now">${L}</div><div class="lay bar" style="background:#fff"></div>`; continue; }
      const cls = L > J.firstLayer ? 'done' : ''; // upcoming layers dark, printed layers white (as in the Print Suite)
      const risk = L > J.firstLayer && layerRisk(r, L) > 0.5 ? ' risk' : '';
      h += `<div class="lay ${cls}${risk}">${L}</div>`;
    }
    $('layers').innerHTML = h;
  }

  // ---------- 3D model (isometric extrusion of the wall plan) ----------
  function drawModel() {
    const cv = $('model'), ctx = cv.getContext('2d');
    const W = cv.clientWidth || 560, Hc = Math.round(W * 1.12), dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = Hc * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hc);
    const r = state === 'opt' ? opt.r : base.r;
    const sc = W / 105, ox = W * 0.5, oy = Hc * 0.36, wallH = 9.5 * (J.firstLayer / 152) + 4.2; // ft printed so far (scaled for view)
    const P = (x, y, z) => [ox + (x - y) * sc * 0.87 - 4 * sc, oy + (x + y) * sc * 0.5 - z * sc * 1.15 - 4 * sc];
    const t = 0.55; // half wall thickness, ft
    const segs = [];
    J.items.forEach((it, i) => { for (let k = 1; k < it.pts.length; k++) segs.push({ i, a: it.pts[k - 1], b: it.pts[k] }); });
    segs.sort((s1, s2) => (Math.max(s1.a[0] + s1.a[1], s1.b[0] + s1.b[1]) + 0.5 * Math.min(s1.a[0] + s1.a[1], s1.b[0] + s1.b[1])) - (Math.max(s2.a[0] + s2.a[1], s2.b[0] + s2.b[1]) + 0.5 * Math.min(s2.a[0] + s2.a[1], s2.b[0] + s2.b[1])));
    const quad = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
    // floor grid
    ctx.strokeStyle = '#1b1b1d'; ctx.lineWidth = 1;
    for (let g = -10; g <= 70; g += 5) { let p = P(g, -10, 0), q = P(g, 50, 0); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); p = P(-10, g * 0.75, 0); q = P(70, g * 0.75, 0); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
    const cur = opt.plan.order[0];
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy), nx = -dy / L * t, ny = dx / L * t;
      const a1 = [s.a[0] + nx - dx / L * t, s.a[1] + ny - dy / L * t], a2 = [s.a[0] - nx - dx / L * t, s.a[1] - ny - dy / L * t];
      const b1 = [s.b[0] + nx + dx / L * t, s.b[1] + ny + dy / L * t], b2 = [s.b[0] - nx + dx / L * t, s.b[1] - ny + dy / L * t];
      const risky = (r.perItem[s.i].exp >= 1);
      const sideA = risky ? '#7a4a3c' : '#6f6f72', sideB = risky ? '#9b5a45' : '#8e8e91', top = risky ? '#ff6b3d' : '#c9c9cc';
      const H = wallH;
      // two visible side faces (south-ish and east-ish), then top
      quad([P(...a2, 0), P(...b2, 0), P(...b2, H), P(...a2, H)], sideB);
      quad([P(...b1, 0), P(...b2, 0), P(...b2, H), P(...b1, H)], sideA);
      quad([P(...a1, 0), P(...a2, 0), P(...a2, H), P(...a1, H)], sideA);
      // layer lines
      ctx.strokeStyle = 'rgba(0,0,0,.13)';
      for (let z = 0.25; z < H; z += 0.25) { const p = P(...a2, z), q = P(...b2, z); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
      quad([P(...a1, H), P(...b1, H), P(...b2, H), P(...a2, H)], top);
      if (s.i === cur) { ctx.strokeStyle = '#1fbf5b'; ctx.lineWidth = 3.5; ctx.beginPath(); const p = P(...a1, H + 0.15), q = P(...b1, H + 0.15), r2 = P(...b2, H + 0.15), u = P(...a2, H + 0.15); [p, q, r2, u, p].forEach((v, k) => k ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])); ctx.stroke(); }
    }
    // nozzle marker on current item
    const it = J.items[cur], m = P(it.pts[0][0] + (it.pts[1][0] - it.pts[0][0]) * 0.6, it.pts[0][1] + (it.pts[1][1] - it.pts[0][1]) * 0.6, wallH + 0.2);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(m[0], m[1], 9, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#bbb'; ctx.beginPath(); ctx.ellipse(m[0], m[1], 4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    // item labels
    ctx.font = '500 10px Roboto Mono, monospace'; ctx.textAlign = 'center';
    J.items.forEach((it2, i) => { const c = P(it2.x, it2.y, wallH + 1.6); ctx.fillStyle = r.perItem[i].exp >= 1 ? '#ff6b3d' : '#9a9a9f'; ctx.fillText('ITEM ' + (i + 1), c[0], c[1]); });
    $('coords').textContent = `X ${f2(it.x)} | Y ${f2(it.y)} | Z ${f2(wallH)}`;
  }

  // ---------- compare cards ----------
  const tieLbl = p => p.tiePolicy === 'after-item' ? 'Robot waits' : p.tiePolicy === 'parallel' ? 'Crew in parallel' : 'Batch at round end';
  const phaseLbl = p => p.tieOffsets.every(x => x === 0) ? 'same layer' : 'staggered';
  function renderCompare() {
    const card = (cls, title, p, r, hold, idle) => `<div class="cmp ${cls}"><div class="h"><span>${title}</span><span>${hhmm(p.startMin)} START</span></div>
      <div class="kv"><span>Expected cold joints</span><b class="${r.expCold >= 1 ? 'bad' : 'good'}">${f1(r.expCold)}</b></div>
      <div class="kv"><span>Chance of any cold joint</span><b class="${r.pAny > 0.2 ? 'bad' : 'good'}">${pct(r.pAny)}</b></div>
      <div class="kv"><span>Session length</span><b>${f1(r.makespan / 60)} hrs</b></div>
      <div class="kv"><span>Cross-ties</span><b>${tieLbl(p)}, ${phaseLbl(p)}</b></div>
      <div class="kv"><span>Robot idle for ties / wind</span><b>${Math.round(idle)} / ${Math.round(hold)} min</b></div></div>`;
    $('compare').innerHTML = card('', 'CURRENT PLAN', base.plan, base.r, holdB, crewB) + card('opt', 'CURE-SAFE PLAN', opt.plan, opt.r, holdO, crewO);
    $('sessName').textContent = `${J.name.toUpperCase()} · L${J.firstLayer}-L${J.firstLayer + J.layers - 1}`;
    $('sessHrs').textContent = f1((state === 'opt' ? opt.r : base.r).makespan / 60) + ' HRS';
  }

  // ---------- interval chart ----------
  function drawIntervals() {
    const cv = $('intervals'), ctx = cv.getContext('2d'), W = 520, H = 190, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const sim = state === 'opt' ? simO : simB, plan = state === 'opt' ? opt.plan : base.plan;
    const L0 = 34, R0 = W - 8, T0 = 8, B0 = H - 22, maxH = 14, maxY = 200;
    const X = h => L0 + (h / maxH) * (R0 - L0), Y = v => B0 - Math.min(v, maxY) / maxY * (B0 - T0);
    ctx.fillStyle = 'rgba(255,107,61,.10)'; ctx.fillRect(L0, T0, R0 - L0, Y(J.material.openTime20) - T0);
    ctx.strokeStyle = '#2a2a2d'; ctx.fillStyle = '#7d7d82'; ctx.font = '10px Roboto Mono, monospace'; ctx.textAlign = 'right';
    for (let v = 0; v <= maxY; v += 50) { ctx.beginPath(); ctx.moveTo(L0, Y(v)); ctx.lineTo(R0, Y(v)); ctx.stroke(); ctx.fillText(v, L0 - 6, Y(v) + 3); }
    ctx.textAlign = 'center'; for (let h = 0; h <= maxH; h += 2) ctx.fillText(hhmm(plan.startMin + h * 60).replace(':00', ''), X(h), H - 6);
    ctx.strokeStyle = '#ff6b3d'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L0, Y(J.material.openTime20)); ctx.lineTo(R0, Y(J.material.openTime20)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ff6b3d'; ctx.textAlign = 'left'; ctx.fillText('OPEN TIME ' + J.material.openTime20 + ' MIN @20°C', L0 + 6, Y(J.material.openTime20) - 5);
    // reconstruct start times: results are in print order; approximate x by cumulative interval end
    let cold = 0;
    for (const r of sim.results) {
      // r.interval ends at start of this layer: use te as y, time position from the layer index
      const h = (r.start - plan.startMin) / 60;
      ctx.fillStyle = r.cold ? '#ff6b3d' : '#1fbf5b'; if (r.cold) cold++;
      ctx.beginPath(); ctx.arc(X(h) + (r.item - n / 2) * 0.9, Y(r.te), 2.4, 0, Math.PI * 2); ctx.fill();
    }
    $('chartNote').textContent = `MEAN FORECAST · ${cold}/${sim.results.length} PAST OPEN TIME`;
    ctx.save(); ctx.translate(10, (T0 + B0) / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#7d7d82'; ctx.textAlign = 'center'; ctx.fillText('EQ. AGE (MIN)', 0, 0); ctx.restore();
  }

  // ---------- weather ----------
  function drawWx() {
    const cv = $('wx'), ctx = cv.getContext('2d'), W = 520, H = 120, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const h0 = 5, h1 = 24, L0 = 34, R0 = W - 34, T0 = 8, B0 = H - 20;
    const X = h => L0 + (h - h0) / (h1 - h0) * (R0 - L0);
    const band = (p, s, col, y) => { ctx.fillStyle = col; ctx.fillRect(X(p.startMin / 60), y, X((p.startMin + s.makespan) / 60) - X(p.startMin / 60), 5); };
    band(base.plan, base.r, '#ff6b3d', B0 + 3); band(opt.plan, opt.r, '#1fbf5b', B0 - 3);
    const wY = v => B0 - v / 30 * (B0 - T0);
    for (let h = h0; h < h1; h++) {
      const ws = E.map(e => e.wind[h]).sort((a, b) => a - b); const med = ws[Math.floor(ws.length / 2)], p90 = ws[Math.floor(ws.length * 0.9)];
      ctx.fillStyle = '#2c2c2f'; ctx.fillRect(X(h) + 2, wY(p90), X(h + 1) - X(h) - 4, B0 - 6 - wY(p90));
      ctx.fillStyle = med > J.windLimit ? '#ff3b30' : '#5a5a5f'; ctx.fillRect(X(h) + 2, wY(med), X(h + 1) - X(h) - 4, B0 - 6 - wY(med));
    }
    ctx.strokeStyle = '#ff3b30'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(L0, wY(J.windLimit)); ctx.lineTo(R0, wY(J.windLimit)); ctx.stroke(); ctx.setLineDash([]);
    const tF = c => c * 9 / 5 + 32, tY = f => B0 - 6 - (f - 70) / 35 * (B0 - 6 - T0);
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let h = h0; h <= h1; h++) { const y = tY(tF(D.forecast.temp[h])); h === h0 ? ctx.moveTo(X(h), y) : ctx.lineTo(X(h), y); }
    ctx.stroke(); ctx.lineWidth = 1;
    ctx.font = '10px Roboto Mono, monospace'; ctx.fillStyle = '#7d7d82'; ctx.textAlign = 'center';
    for (let h = 6; h <= 22; h += 4) ctx.fillText(hhmm(h * 60).replace(':00', ''), X(h), H - 3);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ddd'; const hi = Math.max(...D.forecast.temp.slice(h0, h1)); ctx.fillText('TEMP °F (HIGH ' + Math.round(tF(hi)) + ')', L0, T0 + 6);
    ctx.fillStyle = '#ff6b6b'; ctx.textAlign = 'right'; ctx.fillText('WIND MPH · LIMIT 18', R0, T0 + 6);
  }

  // ---------- task list ----------
  function renderTasks() {
    const p = opt.plan, rows = [];
    for (let L = 1; L <= 2; L++) {
      const Labs = J.firstLayer + L - 1;
      for (const i of p.order) {
        rows.push({ t: `Print Item ${i + 1} | L${Labs}`, s: `${Math.round(printMin(i))} MIN TASK`, tag: '' });
        if ((Labs + p.tieOffsets[i]) % J.crossTies.every === 0) rows.push({ t: `Place Cross-ties on Item ${i + 1} | L${Labs}`, s: `${J.crossTies.minutes} MIN TASK · CREW`, tag: '<span class="tag crew">IN PARALLEL</span>' });
      }
    }
    const worstTe = Math.max(...simO.results.map(r => r.te));
    $('planHrs').textContent = f1(opt.r.makespan / 60) + ' HRS';
    $('tasks').innerHTML = rows.slice(0, 9).map((r, k) => `<div class="task ${k > 3 ? 'muted' : ''}"><div class="play"><svg width="11" height="11" viewBox="0 0 12 12" fill="${k > 3 ? '#888' : '#fff'}"><path d="M3 1.5v9l7-4.5z"/></svg></div><div><div class="t">${r.t}</div><div class="s mono">${r.s}</div></div>${r.tag || (k === 0 ? `<span class="tag ok">MAX EQ. AGE ${Math.round(worstTe)}/${J.material.openTime20} MIN</span>` : '')}</div>`).join('');
    $('why').innerHTML = `<b>Why this plan:</b> cross-ties on every item at the same layer turn one round into ${Math.round(J.crossTies.minutes * n + J.items.reduce((s, _, i) => s + printMin(i), 0))} minutes, so every wall waits past its open time. Staggering the tie layers (${p.tieOffsets.map((o, i) => 'Item ' + (i + 1) + ': +' + o).slice(0, 3).join(', ')}, ...) lets one crew keep up while the robot keeps printing, and starting at ${hhmm(p.startMin)} finishes before the ${Math.round(Math.max(...D.forecast.temp) * 9 / 5 + 32)}°F afternoon peak and the gusts. Even with a parallel crew, keeping today's same-layer ties at ${hhmm(D.baselinePlan.startMin)} still expects ${f1(fair.expCold)} cold joints. Searched ${opt.evaluated.toLocaleString()} plans × ${E.length} forecast members.`;
  }

  $('planSeg').querySelectorAll('button').forEach(b => b.onclick = () => { state = b.dataset.p; $('planSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('modeBtn').classList.toggle('on', state === 'opt'); renderAll(); });
  $('modeBtn').onclick = () => $('planSeg').querySelector(`[data-p="${state === 'opt' ? 'base' : 'opt'}"]`).click();
  function renderAll() { renderLayers(); drawModel(); renderCompare(); drawIntervals(); drawWx(); renderTasks(); }
  renderAll();
  window.addEventListener('resize', drawModel);
})();
