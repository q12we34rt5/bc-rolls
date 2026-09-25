// Roll planner.
//
// plan():        exact dynamic programming, for chasing specific targets.
// planCollect(): beam search, for collecting as many distinct new cats as
//                possible (the set of obtained cats is too large to search
//                exactly).
//
// plan() details:
// State: half position k, last cat id (only matters when it's a rare, for
// dupe rerolls), and the set of targets already obtained. Every action moves
// k forward, so buckets are processed in increasing k. For each state we keep
// a Pareto frontier of remaining resources and bonus score.
//
// Singles always spend a rare ticket first: (food, tickets-1) dominates
// (food-150, tickets) because food can do everything a ticket can, and more.
(function (root) {
  'use strict';

  const E = typeof module !== 'undefined' && module.exports
    ? require('./engine.js') : root.BCEngine;

  const SINGLE_COST = 150;
  const MULTI_COST = 1500;   // 11 rolls
  const STEP_UP_COST = 2100; // 300 + 750 + 1050 for 3+5+7 rolls
  const MUST_WEIGHT = 1e6;

  // Tie-break between equal scores. Default keeps the most total resources
  // (food + tickets*150). keepFood keeps cat food first, so a tickets-only
  // route wins whenever one reaches the same score, and food (including
  // guaranteed rolls) is spent only when needed.
  function moreLeft(a, b, keepFood) {
    if (keepFood) return a.f !== b.f ? a.f > b.f : a.t > b.t;
    return a.cap !== b.cap ? a.cap > b.cap : a.f > b.f;
  }

  function multiSpec(pool) {
    if (pool.guaranteed === 15) return { count: 15, cost: STEP_UP_COST, guaranteed: true };
    return { count: 11, cost: MULTI_COST, guaranteed: pool.guaranteed === 11 };
  }

  // opts: {seed, startK, lastId, pools, food, tickets, targets:[{id, weight,
  //        dup, must}], copyBonus:{id: value}, uberBonus, legendBonus,
  //        allowMulti, keepFood, cats}
  function plan(opts) {
    const seeds = opts.seeds || new E.Seeds(opts.seed);
    const pools = opts.pools;
    const cats = opts.cats;
    const startK = opts.startK || 0;
    const allowMulti = opts.allowMulti !== false;
    const uberBonus = +opts.uberBonus || 0;
    const legendBonus = +opts.legendBonus || 0;
    // Per-roll value for specific non-target cats, overriding the bonuses.
    const copyBonus = new Map(Object.entries(opts.copyBonus || {}).map(([id, v]) => [+id, +v || 0]));

    const bit = new Map();
    const weights = [];
    let mustMask = 0;
    opts.targets.forEach((t, i) => {
      bit.set(t.id, i);
      // The first copy is worth weight; every copy also adds dup, so the
      // set part only carries weight - dup.
      weights.push((t.must ? MUST_WEIGHT : 0) + (+t.weight || 0) - (+t.dup || 0));
      if (t.must) mustMask |= 1 << i;
    });
    if (opts.targets.length > 30) throw new Error('最多 30 個目標');

    const maskValue = new Map();
    function valueOf(mask) {
      let v = maskValue.get(mask);
      if (v === undefined) {
        v = 0;
        for (let i = 0; i < weights.length; i++) if (mask & (1 << i)) v += weights[i];
        maskValue.set(mask, v);
      }
      return v;
    }

    // What a list of rolled cats adds: targets are a set (OR), other ubers
    // and legends add bonus per occurrence. Independent of the current state.
    function gainOf(list) {
      let mask = 0, bonus = 0;
      for (const c of list) {
        const b = bit.get(c.id);
        if (b !== undefined) { mask |= 1 << b; bonus += +opts.targets[b].dup || 0; }
        else if (copyBonus.has(c.id)) bonus += copyBonus.get(c.id);
        else if (c.rarity === E.UBER) bonus += uberBonus;
        else if (c.rarity === E.LEGEND) bonus += legendBonus;
      }
      return { mask, bonus };
    }

    const multis = pools.map(multiSpec);
    const buckets = [];
    let labelCount = 0;

    const lastKey = makeLastKey(seeds, pools, cats);

    function push(k, last, mask, f, t, b, parent, act) {
      const i = k - startK;
      const bucket = buckets[i] || (buckets[i] = new Map());
      let byMask = bucket.get(last);
      if (!byMask) bucket.set(last, byMask = new Map());
      let list = byMask.get(mask);
      const cap = f + SINGLE_COST * t;
      if (list) {
        for (const e of list) {
          if (e.f >= f && e.cap >= cap && e.b >= b) return;
        }
        let n = 0;
        for (const e of list) {
          if (f >= e.f && cap >= e.cap && b >= e.b) e.dead = true;
          else list[n++] = e;
        }
        list.length = n;
      } else {
        byMask.set(mask, list = []);
      }
      list.push({ mask, f, t, cap, b, parent, act, dead: false });
      labelCount++;
    }

    // Outcomes of every action from (k, last), shared by all labels there.
    function transitions(k, last) {
      return pools.map((pool, p) => {
        const r = E.rollAt(seeds, pool, k, last);
        const single = { next: r.next, last: lastKey(r.id, r.next), ...gainOf([r]) };
        const spec = multis[p];
        let multi = null;
        if (allowMulti) {
          const m = E.rollMulti(seeds, pool, k, last, spec.count, spec.guaranteed);
          multi = { next: m.next, last: lastKey(m.last, m.next), cost: spec.cost, ...gainOf(m.cats) };
        }
        return { single, multi };
      });
    }

    function better(a, b) {
      if (!b) return true;
      const sa = valueOf(a.mask) + a.b, sb = valueOf(b.mask) + b.b;
      if (sa !== sb) return sa > sb;
      return moreLeft(a, b, opts.keepFood);
    }

    push(startK, lastKey(opts.lastId || 0, startK), 0, opts.food, opts.tickets, 0, null, -1);
    let best = null;

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (!bucket) continue;
      buckets[i] = null;
      const k = startK + i;
      lastKey.forget(k - 1);

      for (const [last, byMask] of bucket) {
        const tr = transitions(k, last);
        for (const list of byMask.values()) {
          for (const L of list) {
            if (L.dead) continue;
            if (better(L, best)) best = L;

            const canSingle = L.t > 0 || L.f >= SINGLE_COST;
            for (let p = 0; p < tr.length; p++) {
              const { single: s, multi: m } = tr[p];
              if (canSingle) {
                if (L.t > 0) push(s.next, s.last, L.mask | s.mask, L.f, L.t - 1, L.b + s.bonus, L, p * 2);
                else push(s.next, s.last, L.mask | s.mask, L.f - SINGLE_COST, L.t, L.b + s.bonus, L, p * 2);
              }
              if (m && L.f >= m.cost) {
                push(m.next, m.last, L.mask | m.mask, L.f - m.cost, L.t, L.b + m.bonus, L, p * 2 + 1);
              }
            }
          }
        }
      }
    }

    const r = replay(opts, seeds, best);
    const got = opts.targets.filter((_, i) => best.mask & (1 << i));
    const missingMust = opts.targets.filter((tg, i) => tg.must && !(best.mask & (1 << i)));
    return {
      ...r, got, missingMust,
      mustOk: (best.mask & mustMask) === mustMask,
      stats: { labels: labelCount },
    };
  }

  // Rebuilds the chosen path by replaying the actions recorded on the label
  // chain. Marks each cat as fresh when it's neither owned nor rolled earlier.
  function replay(opts, seeds, best) {
    const pools = opts.pools;
    const acts = [];
    for (let L = best; L && L.act >= 0; L = L.parent) acts.push(L.act);
    acts.reverse();

    const seen = new Set(opts.owned || []);
    const mark = (c) => { c.fresh = !seen.has(c.id) && c.id > 0; seen.add(c.id); return c; };
    const steps = [];
    let k = opts.startK || 0, last = opts.lastId || 0, f = opts.food, t = opts.tickets;
    for (const a of acts) {
      const p = a >> 1, pool = pools[p];
      if (a & 1) {
        const spec = multiSpec(pool);
        const r = E.rollMulti(seeds, pool, k, last, spec.count, spec.guaranteed);
        steps.push({ pool: p, type: 'multi', cost: spec.cost, pay: 'food', from: k, next: r.next, cats: r.cats.map(mark) });
        f -= spec.cost; k = r.next; last = r.last;
      } else {
        const r = E.rollAt(seeds, pool, k, last);
        const pay = t > 0 ? 'ticket' : 'food';
        if (pay === 'ticket') t--; else f -= SINGLE_COST;
        steps.push({ pool: p, type: 'single', cost: pay === 'ticket' ? 1 : SINGLE_COST, pay, from: k, next: r.next,
          cats: [mark({ id: r.id, rarity: r.rarity, pos: k, rerolled: r.rerolled })] });
        k = r.next; last = r.id;
      }
    }
    return { steps, end: { k, last, food: f, tickets: t, seed: k === 0 ? opts.seed : seeds.at(k - 1) } };
  }

  // The last cat only matters if some pool's next raw roll is the same rare
  // cat (a dupe reroll). Otherwise collapse it to 0 so states merge.
  function makeLastKey(seeds, pools, cats) {
    const rawCache = new Map();
    function rawIdsAt(k) {
      let ids = rawCache.get(k);
      if (!ids) {
        ids = pools.map((pool) => {
          const r = E.rollAt(seeds, pool, k, 0);
          return r.rarity === E.RARE ? r.id : 0;
        });
        rawCache.set(k, ids);
      }
      return ids;
    }
    const lastKey = (id, k) => {
      if (!(id > 0) || !cats[id] || cats[id][1] !== E.RARE) return 0;
      return rawIdsAt(k).includes(id) ? id : 0;
    };
    lastKey.forget = (k) => rawCache.delete(k);
    return lastKey;
  }

  // opts: same as plan(), plus owned:[id], rarityValue:{2,3,4,5},
  //       dupValue:{2,3,4,5}, beam. Targets may carry dup.
  // Each rolled cat is worth its copy value (target dup, or dupValue by
  // rarity). The first copy in the plan is worth instead: target weight
  // (+must) for targets, the copy value for owned cats, rarityValue otherwise.
  // Copy values are flat per roll; only the first-copy difference needs the
  // obtained set.
  function planCollect(opts) {
    const seeds = opts.seeds || new E.Seeds(opts.seed);
    const pools = opts.pools;
    const cats = opts.cats;
    const startK = opts.startK || 0;
    const allowMulti = opts.allowMulti !== false;
    const beam = Math.max(10, opts.beam || 400);
    const rv = opts.rarityValue || {};
    const dv = opts.dupValue || {};
    const owned = new Set(opts.owned || []);
    const targets = new Map(opts.targets.map((t) => [t.id, t]));

    const rarity = (id) => (cats[id] ? cats[id][1] : 0);
    const copyValue = (id) => (targets.has(id) ? +targets.get(id).dup || 0 : +dv[rarity(id)] || 0);

    // Index every cat whose first copy differs from later copies; others
    // never need tracking.
    const index = new Map(), values = [];
    for (const pool of pools) {
      for (const list of Object.values(pool.slots)) {
        for (const id of list) {
          if (index.has(id)) continue;
          const t = targets.get(id);
          const first = t ? (t.must ? MUST_WEIGHT : 0) + (+t.weight || 0)
            : owned.has(id) ? copyValue(id) : +rv[rarity(id)] || 0;
          const extra = first - copyValue(id);
          if (extra !== 0) { index.set(id, values.length); values.push(extra); }
        }
      }
    }
    const words = Math.max(1, Math.ceil(values.length / 32));
    // Zobrist hashing so identical sets merge without comparing bitsets.
    let rng = 0x9e3779b9;
    const rand = () => (rng = E.advance(rng));
    const z1 = values.map(rand), z2 = values.map(rand);

    const topValue = (r) => Math.max(+rv[r] || 0, +dv[r] || 0);
    // A rough value of one more roll, to rank paths that spent differently.
    const perRoll = pools.reduce((a, p) =>
      a + (p.rare * topValue(2) + p.supa * topValue(3) + p.uber * topValue(4) +
        (E.BASE - p.rare - p.supa - p.uber) * topValue(5)) / E.BASE, 0) / pools.length;
    const lambda = perRoll * 0.5 / SINGLE_COST;

    const multis = pools.map(multiSpec);
    const lastKey = makeLastKey(seeds, pools, cats);
    const buckets = [];
    let labelCount = 0;

    function transitions(k, last) {
      const idx = (list) => list.map((c) => index.get(c.id)).filter((x) => x !== undefined);
      const flat = (list) => list.reduce((a, c) => a + copyValue(c.id), 0);
      return pools.map((pool, p) => {
        const r = E.rollAt(seeds, pool, k, last);
        const single = { next: r.next, last: lastKey(r.id, r.next), idx: idx([r]), flat: flat([r]) };
        let multi = null;
        if (allowMulti) {
          const spec = multis[p];
          const m = E.rollMulti(seeds, pool, k, last, spec.count, spec.guaranteed);
          multi = { next: m.next, last: lastKey(m.last, m.next), cost: spec.cost, idx: idx(m.cats), flat: flat(m.cats) };
        }
        return { single, multi };
      });
    }

    function push(from, tr, f, t, act) {
      let bits = from.bits, h1 = from.h1, h2 = from.h2, score = from.score + tr.flat;
      for (const i of tr.idx) {
        const w = i >> 5, m = 1 << (i & 31);
        if (bits[w] & m) continue;
        if (bits === from.bits) bits = bits.slice();
        bits[w] |= m; h1 ^= z1[i]; h2 ^= z2[i]; score += values[i];
      }
      const i = tr.next - startK;
      const bucket = buckets[i] || (buckets[i] = new Map());
      const key = tr.last + ':' + h1 + ':' + h2;
      const cap = f + SINGLE_COST * t;
      let list = bucket.get(key);
      if (list) {
        for (const e of list) if (e.f >= f && e.cap >= cap && e.score >= score) return;
        list = list.filter((e) => !(f >= e.f && cap >= e.cap && score >= e.score));
        bucket.set(key, list);
      } else {
        bucket.set(key, list = []);
      }
      list.push({ last: tr.last, bits, h1, h2, score, f, t, cap, parent: from, act });
      labelCount++;
    }

    const better = (a, b) => !b || a.score > b.score || (a.score === b.score && moreLeft(a, b, opts.keepFood));
    const startLast = lastKey(opts.lastId || 0, startK);
    buckets[0] = new Map([['start', [{ last: startLast, bits: new Uint32Array(words), h1: 0, h2: 0, score: 0,
      f: opts.food, t: opts.tickets, cap: opts.food + SINGLE_COST * opts.tickets, parent: null, act: -1 }]]]);
    let best = null;

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (!bucket) continue;
      buckets[i] = null;
      const k = startK + i;
      lastKey.forget(k - 1);

      let labels = [...bucket.values()].flat();
      if (labels.length > beam) {
        // keepFood counts leftover food twice so food-saving paths survive.
        for (const L of labels) L.rank = L.score + lambda * (opts.keepFood ? L.cap + L.f : L.cap);
        labels.sort((a, b) => b.rank - a.rank);
        labels.length = beam;
      }
      const trCache = new Map();
      for (const L of labels) {
        if (better(L, best)) best = L;
        let tr = trCache.get(L.last);
        if (!tr) trCache.set(L.last, tr = transitions(k, L.last));
        const canSingle = L.t > 0 || L.f >= SINGLE_COST;
        for (let p = 0; p < tr.length; p++) {
          const { single: s, multi: m } = tr[p];
          if (canSingle) {
            if (L.t > 0) push(L, s, L.f, L.t - 1, p * 2);
            else push(L, s, L.f - SINGLE_COST, L.t, p * 2);
          }
          if (m && L.f >= m.cost) push(L, m, L.f - m.cost, L.t, p * 2 + 1);
        }
      }
    }

    const r = replay(opts, seeds, best);
    const gotIds = new Set(r.steps.flatMap((s) => s.cats.map((c) => c.id)));
    const got = opts.targets.filter((t) => gotIds.has(t.id));
    const missingMust = opts.targets.filter((t) => t.must && !gotIds.has(t.id));
    return { ...r, got, missingMust, mustOk: !missingMust.length, score: best.score, stats: { labels: labelCount } };
  }

  const api = { plan, planCollect, SINGLE_COST, MULTI_COST, STEP_UP_COST, multiSpec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BCPlanner = api;
})(typeof self !== 'undefined' ? self : this);
