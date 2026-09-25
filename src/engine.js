// Battle Cats rare gacha simulation, ported from battle-cats-rolls
// (lib/battle-cats-rolls/gacha.rb).
//
// Positions are counted in half rolls: k = 2*(n-1) for nA and 2*(n-1)+1 for
// nB. A regular roll at k reads rarity from S[k] and slot from S[k+1], then
// moves to k+2. A rerolled dupe rare or a guaranteed uber costs one extra
// seed, which is why those switch tracks.
(function (root) {
  'use strict';

  const RARE = 2, SUPA = 3, UBER = 4, LEGEND = 5;
  const BASE = 10000;

  function advance(x) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 15)) >>> 0;
    return x;
  }

  // Lazily extended seed stream. S(0) is the seed after the first advance,
  // matching Gacha#initialize.
  class Seeds {
    constructor(seed) {
      this.s = [advance(seed >>> 0)];
    }
    at(k) {
      const s = this.s;
      while (s.length <= k) s.push(advance(s[s.length - 1]));
      return s[k];
    }
  }

  function buildPool(data, eventKey) {
    const ev = data.events[eventKey];
    if (!ev) throw new Error('unknown event ' + eventKey);
    const slots = { [RARE]: [], [SUPA]: [], [UBER]: [], [LEGEND]: [] };
    for (const id of data.pools[ev.id]) {
      const cat = data.cats[id];
      if (cat && slots[cat[1]]) slots[cat[1]].push(id);
    }
    return {
      key: eventKey, event: ev, slots,
      rare: ev.rare, supa: ev.supa, uber: ev.uber,
      guaranteed: ev.guaranteed,
    };
  }

  function rarityOf(pool, score) {
    const rs = pool.rare + pool.supa;
    if (score < pool.rare) return RARE;
    if (score < rs) return SUPA;
    if (score < rs + pool.uber) return UBER;
    return LEGEND;
  }

  // One regular roll at half position k, given the id of the last cat
  // obtained (0 if none / unknown). Returns {id, rarity, next, rerolled}.
  function rollAt(seeds, pool, k, lastId) {
    const score = seeds.at(k) % BASE;
    const rarity = rarityOf(pool, score);
    const slots = pool.slots[rarity];
    if (!slots.length) return { id: -1, rarity, next: k + 2, rerolled: false };

    const slotSeed = seeds.at(k + 1);
    let slot = slotSeed % slots.length;
    const id = slots[slot];

    if (rarity === RARE && id > 0 && id === lastId) {
      const pool2 = slots.slice();
      const dupes = slots.filter((x) => x === id).length;
      let nid = id, steps = 0;
      for (let i = 1; i <= dupes; i++) {
        pool2.splice(slot, 1);
        slot = seeds.at(k + 1 + i) % pool2.length;
        nid = pool2[slot];
        steps = i;
        if (nid !== id) break;
      }
      return { id: nid, rarity, next: k + 2 + steps, rerolled: true };
    }
    return { id, rarity, next: k + 2, rerolled: false };
  }

  // Multi roll of `count` cats. With guaranteed=true, the last one is a
  // guaranteed uber that consumes a single seed. Returns {cats, next, last}.
  function rollMulti(seeds, pool, k, lastId, count, guaranteed) {
    const cats = [];
    const regular = guaranteed ? count - 1 : count;
    for (let i = 0; i < regular; i++) {
      const r = rollAt(seeds, pool, k, lastId);
      cats.push({ id: r.id, rarity: r.rarity, pos: k, rerolled: r.rerolled });
      k = r.next;
      lastId = r.id;
    }
    if (guaranteed) {
      const ubers = pool.slots[UBER];
      const id = ubers.length ? ubers[seeds.at(k) % ubers.length] : -1;
      cats.push({ id, rarity: UBER, pos: k, guaranteed: true });
      k += 1;
      lastId = id;
    }
    return { cats, next: k, last: lastId };
  }

  function posLabel(k) {
    return (Math.floor(k / 2) + 1) + (k % 2 ? 'B' : 'A');
  }

  function parsePos(label) {
    const m = /^\s*(\d+)\s*([AaBb])?\s*$/.exec(label || '');
    if (!m) return 0;
    return (parseInt(m[1], 10) - 1) * 2 + (m[2] && m[2].toUpperCase() === 'B' ? 1 : 0);
  }

  const api = {
    RARE, SUPA, UBER, LEGEND, BASE,
    advance, Seeds, buildPool, rollAt, rollMulti, posLabel, parsePos,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BCEngine = api;
})(typeof self !== 'undefined' ? self : this);
