const test = require('node:test');
const assert = require('node:assert');
const C = require('../cureplan.js');

const flat = (T, W, H = 40) => ({ temp: Array(H).fill(T), wind: Array(H).fill(W) });
const job = (over = {}) => Object.assign({
  firstLayer: 1, layers: 4, speedInS: 12, travelInS: 20, windLimit: 18,
  crossTies: null, material: { ea: 33500, openTime20: 60, minInterval20: 8 },
  items: [{ id: 'A', length_ft: 120, x: 0, y: 0 }, { id: 'B', length_ft: 120, x: 30, y: 0 }],
}, over);

test('maturity rate is 1 at 20 C and roughly doubles at 35 C', () => {
  assert.ok(Math.abs(C.rate(20, 33500) - 1) < 1e-12);
  const r = C.rate(35, 33500); assert.ok(r > 1.8 && r < 2.1, r);
});

test('equivalent age integrates exactly for constant temperature', () => {
  assert.ok(Math.abs(C.eqAge(flat(20, 0), 30, 90, 33500) - 60) < 1e-9);
  assert.ok(Math.abs(C.eqAge(flat(35, 0), 0, 60, 33500) - 60 * C.rate(35, 33500)) < 1e-6);
});

test('waitUntilAge finds the time the target equivalent age is reached', () => {
  const w = flat(35, 0); const t = C.waitUntilAge(w, 0, 1, 30, 33500);
  assert.ok(Math.abs(C.eqAge(w, 0, t, 33500) - 30) < 1e-3);
});

test('round time sets the interval; heat turns a safe interval into a cold joint', () => {
  const j = job({ items: [{ id: 'A', length_ft: 1500, x: 0, y: 0 }, { id: 'B', length_ft: 1500, x: 30, y: 0 }] });
  // each item takes 1500*12/12/60 = 25 min, so interval ~ 25 min + travel
  const cool = C.simulate(j, { startMin: 0, order: [0, 1], tiePolicy: 'after-item' }, flat(20, 0));
  assert.ok(cool.results.every(r => !r.cold));
  j.material.openTime20 = 40;
  const hot = C.simulate(j, { startMin: 0, order: [0, 1], tiePolicy: 'after-item' }, flat(38, 0));
  assert.ok(hot.results.every(r => r.cold));
});

test('buildability makes the robot wait when rounds are too fast', () => {
  const j = job({ items: [{ id: 'A', length_ft: 60, x: 0, y: 0 }] }); // 1 min per layer, min interval 8 min
  const s = C.simulate(j, { startMin: 0, order: [0], tiePolicy: 'after-item' }, flat(20, 0));
  assert.ok(s.buildWait > 20);
  for (const r of s.results) assert.ok(r.te >= 8 - 1e-6);
});

test('wind above the limit pauses printing and stretches the interval', () => {
  const w = flat(20, 5); for (let h = 1; h < 3; h++) w.wind[h] = 25;
  const s = C.simulate(job({ layers: 6 }), { startMin: 50, order: [0, 1], tiePolicy: 'after-item' }, w);
  assert.ok(s.windPause > 0);
});

test('parallel crew with staggered tie phases never makes the robot wait longer than aligned ties', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: 'I' + i, length_ft: 300, x: i * 10, y: 0 }));
  const j = job({ items, layers: 12, crossTies: { every: 6, minutes: 10 } });
  const aligned = C.simulate(j, { startMin: 0, order: [0, 1, 2, 3, 4, 5], tiePolicy: 'parallel', tieOffsets: [0, 0, 0, 0, 0, 0] }, flat(25, 0));
  const stag = C.simulate(j, { startMin: 0, order: [0, 1, 2, 3, 4, 5], tiePolicy: 'parallel', tieOffsets: [0, 1, 2, 3, 4, 5] }, flat(25, 0));
  assert.ok(stag.crewWait <= aligned.crewWait);
  assert.ok(stag.makespan <= aligned.makespan);
});

test('risk is an ensemble average and optimize never does worse than the baseline it can represent', () => {
  const D = require('../data.js');
  const ens = D.ensemble.slice(0, 10);
  const base = C.risk(D.job, D.baselinePlan, ens);
  const best = C.optimize(D.job, ens, { starts: [D.baselinePlan.startMin, 360] });
  assert.ok(best.r.expCold <= base.expCold + 1e-9);
  assert.ok(best.r.pAny >= 0 && best.r.pAny <= 1);
});

test('tour visits every item once', () => {
  const D = require('../data.js');
  const t = C.tour(D.job);
  assert.deepStrictEqual(t.slice().sort((a, b) => a - b), D.job.items.map((_, i) => i));
});
