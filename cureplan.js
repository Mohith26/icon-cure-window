/*
 * Cure Window: forecast-aware layer-interval planning for 3D-printed walls.
 *
 * Each wall "item" is printed one layer at a time. Between two layers of the
 * same item the bead below keeps curing. Two things can go wrong:
 *   - too short an interval: the layer below has not built enough strength to
 *     carry the next one (buildability), so the robot must wait;
 *   - too long an interval: the layer below has stiffened past its open time,
 *     the next bead does not bond well (a cold joint).
 * Curing speed depends on temperature, so both limits are written in
 * equivalent age at 20 C (maturity method, Arrhenius form):
 *     te = integral of exp(Ea/R * (1/293.15 - 1/(T(t)+273.15))) dt
 * A cold joint happens when te over the interval exceeds the open time, and the
 * robot must wait while te is below the minimum. Titan also stops when
 * sustained wind exceeds 18 mph (published spec), which stretches intervals.
 *
 * simulate() builds the exact event schedule for one weather trace. risk() runs
 * it over a forecast ensemble to get the probability of a cold joint for every
 * item-layer. optimize() searches start time, item order and cross-tie policy
 * to minimize expected cold joints plus a small makespan penalty.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CurePlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const R = 8.314;

  function rate(tempC, ea) { return Math.exp(ea / R * (1 / 293.15 - 1 / (tempC + 273.15))); }

  // weather: {start (minutes since midnight of hour 0), temp:[C per hour], wind:[mph per hour]}
  function at(arr, tMin) {
    const h = tMin / 60, i = Math.max(0, Math.min(arr.length - 2, Math.floor(h)));
    const f = Math.max(0, Math.min(1, h - i));
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }
  // Precompute cumulative equivalent age at 1-minute resolution so every
  // interval query is O(1) (and waits are a binary search).
  function prepare(weather, ea) {
    if (weather._cum && weather._ea === ea) return weather;
    const N = (weather.temp.length - 1) * 60;
    const cum = new Float64Array(N + 1);
    for (let t = 0; t < N; t++) cum[t + 1] = cum[t] + rate(at(weather.temp, t + 0.5), ea);
    weather._cum = cum; weather._ea = ea; return weather;
  }
  function cumAt(w, t) {
    const c = w._cum, N = c.length - 1;
    if (t <= 0) return 0;
    if (t >= N) return c[N] + (t - N) * rate(w.temp[w.temp.length - 1], w._ea);
    const i = Math.floor(t), f = t - i; return c[i] + (c[i + 1] - c[i]) * f;
  }
  // equivalent age (minutes at 20 C) accumulated between t0 and t1
  function eqAge(weather, t0, t1, ea) { prepare(weather, ea); return cumAt(weather, t1) - cumAt(weather, t0); }
  // earliest time >= t at which te since tPrev reaches target
  function waitUntilAge(weather, tPrev, t, target, ea) {
    prepare(weather, ea);
    const base = cumAt(weather, tPrev);
    if (cumAt(weather, t) - base >= target) return t;
    let lo = t, hi = t + 1;
    while (cumAt(weather, hi) - base < target) hi = t + (hi - t) * 2;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (cumAt(weather, mid) - base < target) lo = mid; else hi = mid; }
    return hi;
  }
  function windy(weather, t, limit) { return at(weather.wind, t) > limit; }

  /*
   * job: {items:[{id, length_ft, x, y}], layers, layerHeightIn, speedInS, travelInS,
   *       crossTies:{every, minutes}, material:{ea, openTime20, minInterval20}, windLimit}
   * plan: {startMin, order:[item indices], tiePolicy:'after-item'|'end-of-round'|'parallel', tieOffsets:[phase per item]}
   */
  function simulate(job, plan, weather) {
    const m = job.material, n = job.items.length;
    const printMin = job.items.map(it => it.length_ft * 12 / job.speedInS / 60);
    const lastEnd = new Array(n).fill(null);
    const results = []; // per item-layer: {item, layer, interval, te, cold, waitBuild}
    let t = plan.startMin, pos = null, windPause = 0, buildWait = 0, crewWait = 0, tieIdle = 0, crewFree = plan.startMin;
    const tieDone = new Array(n).fill(-Infinity);
    const travel = (a, b) => a == null ? 0 : Math.hypot(job.items[a].x - job.items[b].x, job.items[a].y - job.items[b].y) * 12 / job.travelInS / 60;
    const pendingTies = [];
    for (let L = 1; L <= job.layers; L++) {
      const absL = (job.firstLayer || 1) + L - 1;
      let roundTie = false;
      for (let k = 0; k < n; k++) {
        const i = plan.order[k];
        // cross-ties go in every `every` layers per item; the phase can differ per item
        const tieLayer = !!job.crossTies && (absL + ((plan.tieOffsets && plan.tieOffsets[i]) || 0)) % job.crossTies.every === 0;
        roundTie = roundTie || tieLayer;
        t += travel(pos, i); pos = i;
        // wind: Titan holds until sustained wind is back under the limit
        while (windy(weather, t, job.windLimit)) { t += 5; windPause += 5; }
        // parallel crew: the cross-ties on this item must be in before its next layer
        if (tieDone[i] > t) { crewWait += tieDone[i] - t; t = tieDone[i]; }
        // buildability: wait until the layer below is strong enough
        if (lastEnd[i] != null) {
          const tw = waitUntilAge(weather, lastEnd[i], t, m.minInterval20, m.ea);
          buildWait += tw - t; t = tw;
        }
        const start = t;
        if (lastEnd[i] != null) {
          const te = eqAge(weather, lastEnd[i], start, m.ea);
          results.push({ item: i, layer: L, start, interval: start - lastEnd[i], te, cold: te > m.openTime20 });
        }
        t += printMin[i];
        lastEnd[i] = t;
        if (tieLayer) {
          if (plan.tiePolicy === 'after-item') { t += job.crossTies.minutes; tieIdle += job.crossTies.minutes; } // robot idles while crew ties this item
          else if (plan.tiePolicy === 'end-of-round') pendingTies.push(job.crossTies.minutes);
          else { // 'parallel': one crew ties items in the order the robot leaves them, robot keeps printing
            const st = Math.max(t, crewFree); crewFree = st + job.crossTies.minutes; tieDone[i] = crewFree;
          }
        }
      }
      if (roundTie && plan.tiePolicy === 'end-of-round') { while (pendingTies.length) { const d = pendingTies.pop(); t += d; tieIdle += d; } }
    }
    return { results, end: t, makespan: t - plan.startMin, windPause, buildWait, crewWait, tieIdle };
  }

  function risk(job, plan, ensemble) {
    const n = job.items.length;
    const cold = new Map(); let expCold = 0, makespan = 0, worstTe = 0;
    let anyCount = 0;
    for (const w of ensemble) {
      const s = simulate(job, plan, w);
      makespan += s.makespan / ensemble.length;
      if (s.results.some(r => r.cold)) anyCount++;
      for (const r of s.results) {
        const k = r.item + ':' + r.layer;
        if (r.cold) { cold.set(k, (cold.get(k) || 0) + 1 / ensemble.length); expCold += 1 / ensemble.length; }
        worstTe = Math.max(worstTe, r.te);
      }
    }
    // per item: expected cold joints and the layer band where they happen
    const perItem = Array.from({ length: n }, () => ({ exp: 0, layers: [] }));
    for (const [k, p] of cold) { const [i, L] = k.split(':').map(Number); perItem[i].exp += p; perItem[i].layers.push([L, p]); }
    perItem.forEach(x => x.layers.sort((a, b) => a[0] - b[0]));
    const pAny = anyCount / ensemble.length;
    return { expCold, pAny, makespan, perItem, cold, worstTe };
  }

  // nearest-neighbour + 2-opt tour over item positions (travel only)
  function tour(job) {
    const n = job.items.length, d = (a, b) => Math.hypot(job.items[a].x - job.items[b].x, job.items[a].y - job.items[b].y);
    let best = [0]; const left = new Set([...Array(n).keys()].slice(1));
    while (left.size) { const a = best[best.length - 1]; let bj = null, bd = Infinity; for (const j of left) if (d(a, j) < bd) { bd = d(a, j); bj = j; } best.push(bj); left.delete(bj); }
    const len = o => o.reduce((s, v, i) => s + d(v, o[(i + 1) % n]), 0);
    let improved = true;
    while (improved) { improved = false; for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) { const c = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1)); if (len(c) < len(best) - 1e-9) { best = c; improved = true; } } }
    return best;
  }

  /*
   * Search: start times x tie policies x orders (tour, its rotations and
   * reverse) x cross-tie phase (all items on the same layer, or staggered so
   * each round carries only one or two tie tasks), then pairwise swaps of the
   * best order. Every candidate is scored on the whole forecast ensemble.
   */
  function optimize(job, ensemble, opts) {
    opts = opts || {};
    const starts = opts.starts || [];
    const lam = opts.makespanWeight == null ? 0.002 : opts.makespanWeight; // cold joints per minute
    const score = r => r.expCold + lam * r.makespan;
    const base = tour(job), n = base.length;
    const orders = [];
    for (let r = 0; r < n; r++) { const o = base.slice(r).concat(base.slice(0, r)); orders.push(o, o.slice().reverse()); }
    let best = null, evaluated = 0;
    const every = job.crossTies ? job.crossTies.every : 1;
    const stagger = order => { const off = new Array(n).fill(0); order.forEach((it, k) => { off[it] = k % every; }); return off; };
    for (const startMin of starts) for (const tiePolicy of ['after-item', 'end-of-round', 'parallel']) for (const order of orders) for (const stag of [false, true]) {
      const plan = { startMin, order, tiePolicy, tieOffsets: stag ? stagger(order) : new Array(n).fill(0) };
      const r = risk(job, plan, ensemble); evaluated++;
      if (!best || score(r) < best.score) best = { plan, r, score: score(r) };
    }
    // local swaps on the winner
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < n && !improved; i++) for (let j = i + 1; j < n && !improved; j++) {
        const order = best.plan.order.slice(); [order[i], order[j]] = [order[j], order[i]];
        const plan = { ...best.plan, order }; const r = risk(job, plan, ensemble); evaluated++;
        if (score(r) < best.score - 1e-9) { best = { plan, r, score: score(r) }; improved = true; }
      }
    }
    best.evaluated = evaluated;
    return best;
  }

  return { rate, eqAge, waitUntilAge, simulate, risk, optimize, tour, at };
});
