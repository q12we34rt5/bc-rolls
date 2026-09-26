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
  // Score lost per platinum ticket used: far below a must-pull, far above
  // any normal value, so platinum tickets are only spent to secure must-pulls.
  const PLATINUM_COST = 1000;

  // Tie-break between equal scores. Default keeps the most total resources
  // (food + tickets*150). keepFood keeps cat food first, so a tickets-only
  // route wins whenever one reaches the same score, and food (including
  // guaranteed rolls) is spent only when needed.
  //
  // Only when resources tie too, the banner preference decides: bannerBias[p]
  // is added once per cat rolled on banner p, and the higher total wins. It
  // never outranks score or resources, so it can't make a plan roll more.
  function cmpLeft(a, b, keepFood) {
    if (keepFood) return a.f - b.f || a.t - b.t;
    return a.cap - b.cap || a.f - b.f;
  }
  //
  // Platinum tickets are the scarcest resource, so among equal scores the
  // route that keeps more of them wins before anything else is compared.
  function beats(a, b, keepFood) {
    return (a.pt - b.pt || cmpLeft(a, b, keepFood) || a.pb - b.pb) > 0;
  }

  // Optional platinum ticket banner: opts.platinum = {pool, tickets}. A
  // platinum roll is a regular single roll on that pool paid with a platinum
  // ticket. Its act code is pools.length * 2. Each one costs PLATINUM_COST
  // score, so it is used only when it secures a must-pull.
  function platinumOf(opts) {
    const pl = opts.platinum;
    return pl && pl.pool && pl.tickets > 0 ? pl : null;
  }

  // Pinned cells: opts.pins = [{pool, k, g, id}] where pool indexes
  // opts.pools (pools.length for the platinum banner), k is the half
  // position, g marks a guaranteed cell (an 11-roll starting at k) and id is
  // the cat that must come out there. Each pin is a must-pull that needs the
  // cat and the position to match; a dupe reroll into another cat misses it.
  function pinTable(opts) {
    const map = new Map();
    (opts.pins || []).forEach((pin, i) => map.set(`${pin.pool}|${pin.k}|${pin.g ? 1 : 0}`, { i, id: pin.id }));
    return map;
  }
  // Pins hit by cats rolled on pool p starting at half position k0.
  function pinsHit(map, p, k0, cats) {
    const hits = [];
    if (!map.size) return hits;
    for (const c of cats) {
      const e = map.get(c.guaranteed ? `${p}|${k0}|1` : `${p}|${c.pos}|0`);
      if (e && e.id === c.id) hits.push(e.i);
    }
    return hits;
  }
  function missingPins(opts, steps) {
    const map = pinTable(opts), hit = new Set();
    for (const s of steps) pinsHit(map, s.pool, s.from, s.cats).forEach((i) => hit.add(i));
    return (opts.pins || []).filter((_, i) => !hit.has(i));
  }

  // Optional cap on the number of cats rolled (an 11-roll counts 11, a
  // step-up 15). Without a cap the count isn't tracked, so states merge as
  // before; with one it becomes part of the dominance check.
  function rollLimit(opts) {
    const lim = Math.floor(+opts.maxRolls);
    return lim > 0 ? lim : Infinity;
  }

  function multiSpec(pool) {
    if (pool.guaranteed === 15) return { count: 15, cost: STEP_UP_COST, guaranteed: true };
    return { count: 11, cost: MULTI_COST, guaranteed: pool.guaranteed === 11 };
  }

  // opts: {seed, startK, lastId, pools, food, tickets, targets:[{id, weight,
  //        dup, must}], copyBonus:{id: value}, uberBonus, legendBonus,
  //        allowMulti, keepFood, maxRolls, bannerBias:[per pool],
  //        platinum:{pool, tickets}, pins:[{pool, k, g, id}], cats}
  // Cats from platinum rolls only count when they are targets.
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
    const pins = pinTable(opts), pinBase = opts.targets.length;
    (opts.pins || []).forEach((_, i) => {
      weights.push(MUST_WEIGHT);
      mustMask |= 1 << (pinBase + i);
    });
    if (weights.length > 30) throw new Error('精準模式的目標加上指定格子最多 30 個');
    const pinMask = (p, k0, cats) => pinsHit(pins, p, k0, cats).reduce((m, i) => m | (1 << (pinBase + i)), 0);

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

    const limit = rollLimit(opts), counting = limit < Infinity;
    const bias = pools.map((_, p) => +(opts.bannerBias || [])[p] || 0);
    const plat = platinumOf(opts);
    function push(k, last, mask, f, t, b, n, pb, pt, parent, act) {
      if (n > limit) return;
      const i = k - startK;
      const bucket = buckets[i] || (buckets[i] = new Map());
      let byMask = bucket.get(last);
      if (!byMask) bucket.set(last, byMask = new Map());
      let list = byMask.get(mask);
      const cap = f + SINGLE_COST * t;
      if (list) {
        for (const e of list) {
          if (e.f >= f && e.cap >= cap && e.b >= b && e.n <= n && e.pb >= pb && e.pt >= pt) return;
        }
        let keep = 0;
        for (const e of list) {
          if (f >= e.f && cap >= e.cap && b >= e.b && n <= e.n && pb >= e.pb && pt >= e.pt) e.dead = true;
          else list[keep++] = e;
        }
        list.length = keep;
      } else {
        byMask.set(mask, list = []);
      }
      list.push({ mask, f, t, cap, b, n, pb, pt, parent, act, dead: false });
      labelCount++;
    }

    // Outcomes of every action from (k, last), shared by all labels there.
    function transitions(k, last) {
      return pools.map((pool, p) => {
        const r = E.rollAt(seeds, pool, k, last);
        const cat = { id: r.id, pos: k };
        const single = { next: r.next, last: lastKey(r.id, r.next), ...gainOf([r]) };
        single.mask |= pinMask(p, k, [cat]);
        const spec = multis[p];
        let multi = null;
        if (allowMulti) {
          const m = E.rollMulti(seeds, pool, k, last, spec.count, spec.guaranteed);
          multi = { next: m.next, last: lastKey(m.last, m.next), cost: spec.cost, ...gainOf(m.cats) };
          multi.mask |= pinMask(p, k, m.cats);
        }
        return { single, multi };
      }).concat(plat ? [platTransition(k, last)] : []);
    }

    function platTransition(k, last) {
      const r = E.rollAt(seeds, plat.pool, k, last);
      const b = bit.get(r.id);
      const mask = (b === undefined ? 0 : 1 << b) | pinMask(pools.length, k, [{ id: r.id, pos: k }]);
      return { plat: { next: r.next, last: lastKey(r.id, r.next), mask } };
    }

    function better(a, b) {
      if (!b) return true;
      const pen = (L) => (plat ? (plat.tickets - L.pt) * PLATINUM_COST : 0);
      const sa = valueOf(a.mask) + a.b - pen(a), sb = valueOf(b.mask) + b.b - pen(b);
      if (sa !== sb) return sa > sb;
      return beats(a, b, opts.keepFood);
    }

    push(startK, lastKey(opts.lastId || 0, startK), 0, opts.food, opts.tickets, 0, 0, 0, plat ? plat.tickets : 0, null, -1);
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
            const n1 = counting ? L.n + 1 : 0;
            for (let p = 0; p < tr.length; p++) {
              const { single: s, multi: m, plat: pr } = tr[p];
              if (pr) {
                if (L.pt > 0) push(pr.next, pr.last, L.mask | pr.mask, L.f, L.t, L.b, n1, L.pb, L.pt - 1, L, p * 2);
                continue;
              }
              if (canSingle) {
                if (L.t > 0) push(s.next, s.last, L.mask | s.mask, L.f, L.t - 1, L.b + s.bonus, n1, L.pb + bias[p], L.pt, L, p * 2);
                else push(s.next, s.last, L.mask | s.mask, L.f - SINGLE_COST, L.t, L.b + s.bonus, n1, L.pb + bias[p], L.pt, L, p * 2);
              }
              if (m && L.f >= m.cost) {
                push(m.next, m.last, L.mask | m.mask, L.f - m.cost, L.t, L.b + m.bonus, counting ? L.n + multis[p].count : 0,
                  L.pb + bias[p] * multis[p].count, L.pt, L, p * 2 + 1);
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
      ...r, got, missingMust, missingPins: missingPins(opts, r.steps),
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
    const plat = platinumOf(opts);
    let k = opts.startK || 0, last = opts.lastId || 0, f = opts.food, t = opts.tickets, pt = plat ? plat.tickets : 0;
    for (const a of acts) {
      const p = a >> 1, pool = pools[p];
      if (p === pools.length) {
        const r = E.rollAt(seeds, plat.pool, k, last);
        pt--;
        steps.push({ pool: p, type: 'plat', cost: 1, pay: 'platinum', from: k, next: r.next,
          cats: [mark({ id: r.id, rarity: r.rarity, pos: k, rerolled: r.rerolled })] });
        k = r.next; last = r.id;
      } else if (a & 1) {
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
    return { steps, end: { k, last, food: f, tickets: t, platinum: pt, seed: k === 0 ? opts.seed : seeds.at(k - 1) } };
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
    const plat = platinumOf(opts);
    for (const pool of plat ? [...pools, plat.pool] : pools) {
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
    // Pins get their own indices after the cats, each worth a must-pull.
    const pins = pinTable(opts), pinBase = values.length;
    (opts.pins || []).forEach(() => values.push(MUST_WEIGHT));
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

    const targetIdx = new Set(opts.targets.map((t) => index.get(t.id)).filter((x) => x !== undefined));
    (opts.pins || []).forEach((_, i) => targetIdx.add(pinBase + i));
    const pinIdx = (p, k0, cats) => pinsHit(pins, p, k0, cats).map((i) => pinBase + i);
    function transitions(k, last) {
      const idx = (list) => list.map((c) => index.get(c.id)).filter((x) => x !== undefined);
      const flat = (list) => list.reduce((a, c) => a + copyValue(c.id), 0);
      return pools.map((pool, p) => {
        const r = E.rollAt(seeds, pool, k, last);
        const single = { next: r.next, last: lastKey(r.id, r.next), idx: [...idx([r]), ...pinIdx(p, k, [{ id: r.id, pos: k }])], flat: flat([r]) };
        let multi = null;
        if (allowMulti) {
          const spec = multis[p];
          const m = E.rollMulti(seeds, pool, k, last, spec.count, spec.guaranteed);
          multi = { next: m.next, last: lastKey(m.last, m.next), cost: spec.cost, idx: [...idx(m.cats), ...pinIdx(p, k, m.cats)], flat: flat(m.cats) };
        }
        return { single, multi };
      }).concat(plat ? [platTransition(k, last, idx)] : []);
    }

    // Platinum rolls only score targets, and cost PLATINUM_COST each.
    function platTransition(k, last, idx) {
      const r = E.rollAt(seeds, plat.pool, k, last);
      const hit = [...idx([r]), ...pinIdx(pools.length, k, [{ id: r.id, pos: k }])].filter((i) => targetIdx.has(i));
      return { plat: { next: r.next, last: lastKey(r.id, r.next), idx: hit, flat: -PLATINUM_COST } };
    }

    const limit = rollLimit(opts), counting = limit < Infinity;
    const bias = pools.map((_, p) => +(opts.bannerBias || [])[p] || 0);
    function push(from, tr, f, t, act, rolls, pt = from.pt) {
      const n = counting ? from.n + rolls : 0;
      const pb = from.pb + (bias[act >> 1] || 0) * rolls;
      if (n > limit) return;
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
        for (const e of list) if (e.f >= f && e.cap >= cap && e.score >= score && e.n <= n && e.pb >= pb && e.pt >= pt) return;
        list = list.filter((e) => !(f >= e.f && cap >= e.cap && score >= e.score && n <= e.n && pb >= e.pb && pt >= e.pt));
        bucket.set(key, list);
      } else {
        bucket.set(key, list = []);
      }
      list.push({ last: tr.last, bits, h1, h2, score, f, t, cap, n, pb, pt, parent: from, act });
      labelCount++;
    }

    const better = (a, b) => !b || a.score > b.score || (a.score === b.score && beats(a, b, opts.keepFood));
    const startLast = lastKey(opts.lastId || 0, startK);
    buckets[0] = new Map([['start', [{ last: startLast, bits: new Uint32Array(words), h1: 0, h2: 0, score: 0,
      f: opts.food, t: opts.tickets, cap: opts.food + SINGLE_COST * opts.tickets, n: 0, pb: 0, pt: plat ? plat.tickets : 0, parent: null, act: -1 }]]]);
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
        for (const L of labels) L.rank = L.score + lambda * (opts.keepFood ? L.cap + L.f : L.cap) + L.pt * 1e-6 + L.pb * 1e-9;
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
          const { single: s, multi: m, plat: pr } = tr[p];
          if (pr) {
            if (L.pt > 0) push(L, pr, L.f, L.t, p * 2, 1, L.pt - 1);
            continue;
          }
          if (canSingle) {
            if (L.t > 0) push(L, s, L.f, L.t - 1, p * 2, 1);
            else push(L, s, L.f - SINGLE_COST, L.t, p * 2, 1);
          }
          if (m && L.f >= m.cost) push(L, m, L.f - m.cost, L.t, p * 2 + 1, multis[p].count);
        }
      }
    }

    const r = replay(opts, seeds, best);
    const gotIds = new Set(r.steps.flatMap((s) => s.cats.map((c) => c.id)));
    const got = opts.targets.filter((t) => gotIds.has(t.id));
    const missingMust = opts.targets.filter((t) => t.must && !gotIds.has(t.id));
    const pinsMissed = missingPins(opts, r.steps);
    const platUsed = r.steps.filter((x) => x.type === 'plat').length;
    return { ...r, got, missingMust, missingPins: pinsMissed, mustOk: !missingMust.length && !pinsMissed.length, score: best.score + platUsed * PLATINUM_COST, stats: { labels: labelCount } };
  }

  const api = { plan, planCollect, SINGLE_COST, MULTI_COST, STEP_UP_COST, multiSpec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BCPlanner = api;
})(typeof self !== 'undefined' ? self : this);
