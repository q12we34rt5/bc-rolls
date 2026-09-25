(function () {
  'use strict';

  const E = window.BCEngine, P = window.BCPlanner;
  const $ = (id) => document.getElementById(id);
  const RARITY = { 2: '稀有', 3: '激稀有', 4: '超激稀有', 5: '傳說稀有' };
  const STORE = 'bc-roll-planner.v1';

  const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time

  // First visit: nothing filled in except today's date and the options.
  const DEFAULTS = () => ({
    lang: 'tw', seed: '', last: '', pos: '1A',
    food: '', tickets: '', dateFrom: today(), dateTo: today(),
    selected: [],
    // Per-cat settings: w = first copy value, d = each extra copy, must.
    prefs: {},
    uberBonus: 0.5, legendBonus: 1, allowMulti: true, stopAtTargets: true, keepFood: false,
    mode: 'exact', rv2: 0.2, rv3: 1, rv4: 5, rv5: 8, dv2: 0, dv3: 0, dv4: 0.5, dv5: 1, beam: 1000, owned: [],
  });

  // Loaded by the 載入範例 button.
  const SAMPLE = () => ({
    ...DEFAULTS(),
    seed: '2020607346', last: '47',
    food: 3000, tickets: 5, dateFrom: '2026-09-30', dateTo: '2026-09-30',
    selected: ['2026-09-30_947', '2026-09-28_1081'],
    prefs: { 699: { w: 10, must: true }, 635: { w: 8 }, 262: { w: 6 } },
  });

  const stored = load();
  let state = { ...DEFAULTS(), ...stored };
  if (state.date) { // settings saved before date ranges existed
    state.dateFrom = state.dateTo = state.date;
    delete state.date;
  }
  if (state.targets) { // settings saved before per-cat preferences existed
    state.prefs = {};
    for (const t of state.targets) state.prefs[t.id] = { w: t.weight, d: t.dup || undefined, must: t.must };
    delete state.targets;
  }
  const data = () => window.BC_DATA[state.lang] || window.BC_DATA.tw;
  const catName = (id) => (data().cats[id] || [`#${id}`])[0];
  const catRarity = (id) => (data().cats[id] || [0, 0])[1];

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  // bc.godfat.org's owned list: a bitmask of cat ids written in base 62.
  // Translated from battle-cats-rolls lib/battle-cats-rolls/owned.rb,
  // Copyright (c) 2018-2026, Lin Jen-Shin (godfat), Apache License 2.0.
  const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function decodeOwned(code) {
    if (!/^[0-9A-Za-z]+$/.test(code)) return [];
    let n = 0n;
    for (const ch of code) n = n * 62n + BigInt(DIGITS.indexOf(ch));
    const ids = [];
    for (let id = 0; n > 0n; id++, n >>= 1n) if (n & 1n) ids.push(id);
    return ids;
  }
  function encodeOwned(ids) {
    let n = 0n;
    for (const id of new Set(ids)) n |= 1n << BigInt(id);
    let out = '';
    while (n > 0n) { out = DIGITS[Number(n % 62n)] + out; n /= 62n; }
    return out;
  }

  function shortName(name) {
    return name.replace(/[★☆].*$/, '').trim();
  }

  // Events open on any day in [from, to]. The same gacha with the same rates
  // and guarantee in several events is listed once (the newest); if the
  // settings differ (e.g. a guaranteed rerun) each version is listed.
  function bannersIn(from, to) {
    if (to < from) [from, to] = [to, from];
    const evs = data().events;
    const bySig = new Map();
    for (const key of Object.keys(evs).sort()) {
      const ev = evs[key];
      if (ev.start <= to && from <= ev.end) {
        bySig.set([ev.id, ev.rare, ev.supa, ev.uber, ev.legend, ev.guaranteed].join('/'), key);
      }
    }
    return [...bySig.values()].sort((a, b) => evs[a].start.localeCompare(evs[b].start) || evs[a].id - evs[b].id);
  }

  function fillForm() {
    for (const k of ['seed', 'last', 'pos', 'food', 'tickets', 'dateFrom', 'dateTo', 'lang', 'uberBonus', 'legendBonus',
      'rv2', 'rv3', 'rv4', 'rv5', 'dv2', 'dv3', 'dv4', 'dv5', 'beam']) {
      $(k).value = state[k];
    }
    $('allowMulti').checked = state.allowMulti;
    $('stopAtTargets').checked = state.stopAtTargets;
    $('keepFood').value = state.keepFood ? '1' : '0';
    $(state.mode === 'collect' ? 'modeCollect' : 'modeExact').checked = true;
    renderMode();
    renderBanners();
  }

  function readForm() {
    state.seed = $('seed').value.trim();
    state.last = $('last').value.trim();
    state.pos = $('pos').value.trim() || '1A';
    state.food = Math.max(0, parseInt($('food').value, 10) || 0);
    state.tickets = Math.max(0, parseInt($('tickets').value, 10) || 0);
    state.uberBonus = Math.max(0, parseFloat($('uberBonus').value) || 0);
    state.legendBonus = Math.max(0, parseFloat($('legendBonus').value) || 0);
    state.allowMulti = $('allowMulti').checked;
    state.stopAtTargets = $('stopAtTargets').checked;
    state.keepFood = $('keepFood').value === '1';
    for (const k of ['rv2', 'rv3', 'rv4', 'rv5', 'dv2', 'dv3', 'dv4', 'dv5']) state[k] = Math.max(0, parseFloat($(k).value) || 0);
    state.beam = Math.max(50, parseInt($('beam').value, 10) || 1000);
    save();
  }

  function renderMode() {
    $('exactOpts').hidden = state.mode === 'collect';
    $('collectOpts').hidden = state.mode !== 'collect';
    $('bonusRow').querySelectorAll('input').forEach((el) => { el.disabled = state.stopAtTargets; });
  }

  function renderBanners() {
    const evs = data().events;
    const keys = bannersIn(state.dateFrom, state.dateTo);
    state.selected = state.selected.filter((k) => keys.includes(k));
    if (!keys.length) {
      $('banners').innerHTML = '<p class="hint">這天沒有資料中的稀有轉蛋。換一個日期試試。</p>';
    } else {
      $('banners').innerHTML = keys.map((key) => {
        const ev = evs[key];
        const g = ev.guaranteed === 11 ? '<span class="tag g">保底 11 連</span>'
          : ev.guaranteed === 15 ? '<span class="tag g">階段轉蛋</span>' : '';
        const leg = ev.legend ? '<span>含傳說</span>' : '';
        return `<label class="banner"><input type="checkbox" value="${key}" ${state.selected.includes(key) ? 'checked' : ''}>
          <span class="t">${esc(shortName(ev.name))}</span>
          <span class="m"><span>${ev.start.slice(5)} ～ ${ev.end.slice(5)}</span><span>#${ev.id}</span>${g}${leg}</span></label>`;
      }).join('');
    }
    renderTable();
  }

  function selectedPools() {
    return state.selected.map((k) => E.buildPool(data(), k));
  }

  function poolCatIds() {
    const ids = new Set();
    for (const pool of selectedPools()) Object.values(pool.slots).flat().forEach((id) => ids.add(id));
    return ids;
  }

  const prefOf = (id) => state.prefs[id] || {};
  const isSet = (v) => v !== undefined && v !== null && v !== '';
  const isCustom = (pr) => isSet(pr.w) || isSet(pr.d) || pr.must;
  const isStar = (pr) => (isSet(pr.w) && +pr.w > 0) || pr.must;

  // Defaults shown as placeholders and used when a field is blank.
  function defaults(id) {
    const r = catRarity(id);
    if (state.mode !== 'collect') {
      if (state.stopAtTargets) return { w: 0, d: 0 };
      return { w: 0, d: r === 4 ? state.uberBonus : r === 5 ? state.legendBonus : 0 };
    }
    const d = state['dv' + r] || 0;
    return { w: state.owned.includes(id) ? (isSet(prefOf(id).d) ? +prefOf(id).d : d) : state['rv' + r] || 0, d };
  }

  function rowHtml(id) {
    const pr = prefOf(id), df = defaults(id), own = state.owned.includes(id);
    return `<div class="crow ${isCustom(pr) ? 'custom' : ''} ${own ? 'owned' : ''}" data-id="${id}">
      <span class="nm" title="${esc(catName(id))} #${id}">${esc(catName(id))}<small>${id}</small></span>
      <input type="checkbox" data-f="owned" ${own ? 'checked' : ''} aria-label="已擁有 ${esc(catName(id))}">
      <input type="number" data-f="w" min="0" step="any" value="${isSet(pr.w) ? pr.w : ''}" placeholder="${df.w}" aria-label="優先度">
      <input type="number" data-f="d" min="0" step="any" value="${isSet(pr.d) ? pr.d : ''}" placeholder="${df.d}" aria-label="重複時分數">
      <input type="checkbox" data-f="must" ${pr.must ? 'checked' : ''} aria-label="必抽">
    </div>`;
  }

  function updateCounts() {
    const custom = Object.values(state.prefs).filter(isCustom).length;
    const must = Object.values(state.prefs).filter((p) => p.must).length;
    $('prefCount').textContent = custom ? `已設定 ${custom} 隻${must ? `，必抽 ${must}` : ''}` : '';
    $('ownedCount').textContent = state.owned.length ? `已登記 ${state.owned.length} 隻` : '';
  }

  let tableGroups = {};

  function setOwned(ids, on) {
    const owned = new Set(state.owned);
    for (const id of ids) on ? owned.add(id) : owned.delete(id);
    state.owned = [...owned].sort((a, b) => a - b);
    save();
    renderTable();
  }

  // Cats listed by banner (in section 2's order), then id descending. A cat
  // in several banners goes under the first one. sections() splits a sorted
  // list into per-banner runs; headings only appear with 2+ banners.
  function bannerGrouping() {
    const banners = bannersIn(state.dateFrom, state.dateTo).filter((k) => state.selected.includes(k));
    const bannerOf = new Map();
    banners.forEach((key, i) => {
      const pool = E.buildPool(data(), key);
      Object.values(pool.slots).flat().forEach((id) => { if (!bannerOf.has(id)) bannerOf.set(id, i); });
    });
    const byBanner = (a, b) => (bannerOf.get(a) ?? 1e9) - (bannerOf.get(b) ?? 1e9) || b - a;
    function sections(sorted, heading, body) {
      const runs = [];
      for (const id of sorted) {
        const i = bannerOf.get(id) ?? -1;
        if (!runs.length || runs[runs.length - 1].i !== i) runs.push({ i, ids: [] });
        runs[runs.length - 1].ids.push(id);
      }
      return runs.map((run) => (banners.length > 1 && run.i >= 0
        ? heading(shortName(data().events[banners[run.i]].name)) : '') + body(run.ids)).join('');
    }
    return { byBanner, sections };
  }

  function renderTable() {
    updateCounts();
    const q = $('catFilter').value.trim();
    const only = $('onlyCustom').checked;
    const inPools = poolCatIds();
    const match = (id) => (!q || catName(id).includes(q) || String(id) === q) && (!only || isCustom(prefOf(id)));
    const ids = [...inPools].filter(match);
    const outside = Object.keys(state.prefs).map(Number).filter((id) => !inPools.has(id) && isCustom(prefOf(id)) && match(id))
      .sort((a, b) => b - a);
    // Keep groups the viewer opened or closed as they were.
    const wasOpen = new Map([...$('ctable').querySelectorAll('details[data-g]')].map((d) => [d.dataset.g, d.open]));
    tableGroups = {};
    const head = (g, list) => {
      tableGroups[g] = list;
      return '<div class="chead"><span>角色</span><span>擁有</span><span>優先度</span><span>重複</span><span>必抽</span></div>';
    };
    // Select-all buttons on each group's title row, for the rows listed there.
    const ownBtns = (g) => `<span class="gb">
        <button type="button" data-own="${g}" data-on="1">全部擁有</button>
        <button type="button" data-own="${g}" data-on="0">全部取消</button></span>`;
    const { byBanner, sections } = bannerGrouping();
    const rows = (list) => sections(list, (name) => `<div class="bsub">${esc(name)}</div>`,
      (ids) => ids.map(rowHtml).join(''));
    const groups = [5, 4, 3, 2].map((r) => {
      const list = ids.filter((id) => catRarity(id) === r).sort(byBanner);
      if (!list.length) return '';
      const set = list.filter((id) => isCustom(prefOf(id))).length;
      const own = list.filter((id) => state.owned.includes(id)).length;
      const open = wasOpen.has(String(r)) ? wasOpen.get(String(r)) : r >= 4 || set || q || only;
      return `<details class="r${r}" data-g="${r}" ${open ? 'open' : ''}><summary><span class="dot"></span>${RARITY[r]}
        <span class="c">${list.length} 隻・擁有 ${own}${set ? `・設定 ${set}` : ''}</span>${ownBtns(r)}</summary>${head(r, list)}${rows(list)}</details>`;
    }).join('');
    const other = outside.length ? `<details open data-g="x"><summary>不在勾選卡池 <span class="c">設定會保留，換卡池時生效</span>${ownBtns('x')}</summary>${head('x', outside)}${outside.map(rowHtml).join('')}</details>` : '';
    const scroll = $('ctable').scrollTop;
    $('ctable').innerHTML = groups + other || `<p class="hint">${inPools.size ? '沒有符合的角色。' : '先勾選卡池。'}</p>`;
    $('ctable').scrollTop = scroll;
  }

  function importOwned(text) {
    text = text.trim();
    if (!text) return 0;
    let ids = [];
    const m = /[?&]o=([0-9A-Za-z]+)/.exec(text);
    if (m) ids = decodeOwned(m[1]);
    else {
      const tokens = text.split(/[\s,，、;；]+/).filter(Boolean);
      const byName = new Map(Object.entries(data().cats).map(([id, c]) => [c[0], +id]));
      const single = tokens.length === 1 && /[A-Za-z]/.test(tokens[0]) && /^[0-9A-Za-z]+$/.test(tokens[0]) && !byName.has(tokens[0]);
      if (single) ids = decodeOwned(tokens[0]);
      else for (const t of tokens) {
        if (/^\d+$/.test(t)) ids.push(+t);
        else if (byName.has(t)) ids.push(byName.get(t));
      }
    }
    const before = state.owned.length;
    state.owned = [...new Set([...state.owned, ...ids])].sort((a, b) => a - b);
    save();
    renderTable();
    return state.owned.length - before;
  }

  function flash(msg) {
    $('ownedMsg').textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { $('ownedMsg').textContent = ''; }, 4000);
  }

  function applyUrl(text) {
    let u;
    try { u = new URL(text.trim()); } catch (e) { return; }
    const q = u.searchParams;
    if (q.get('lang') && window.BC_DATA[q.get('lang')]) state.lang = q.get('lang');
    if (q.get('seed')) state.seed = q.get('seed');
    state.last = q.get('last') || '';
    state.pos = q.get('pos') || '1A';
    const ev = q.get('event');
    if (ev && data().events[ev]) {
      const e = data().events[ev];
      const today = new Date().toISOString().slice(0, 10);
      const d = today >= e.start && today <= e.end ? today : e.start;
      if (!(state.dateFrom <= d && d <= state.dateTo)) state.dateFrom = state.dateTo = d;
      if (!state.selected.includes(ev)) state.selected.push(ev);
    }
    if (q.get('o')) importOwned('?o=' + q.get('o'));
    fillForm();
    save();
  }

  function run() {
    readForm();
    const seed = Number(state.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      return showError('種子碼要是 0 到 4294967295 的整數。可以直接貼上 bc.godfat.org 的網址。');
    }
    if (!state.selected.length) return showError('至少要勾選一個卡池。');
    const collect = state.mode === 'collect';
    const pools = selectedPools();
    const inPools = poolCatIds();
    const custom = Object.keys(state.prefs).map(Number).filter((id) => inPools.has(id) && isCustom(prefOf(id)));
    let targets, copyBonus = {};
    if (collect) {
      targets = custom.map((id) => {
        const pr = prefOf(id), df = defaults(id);
        return { id, weight: isSet(pr.w) ? +pr.w : df.w, dup: isSet(pr.d) ? +pr.d : df.d, must: !!pr.must, star: isStar(pr) };
      });
    } else {
      const stop = state.stopAtTargets;
      targets = custom.filter((id) => isStar(prefOf(id))).map((id) => {
        const pr = prefOf(id);
        return { id, weight: +pr.w || 0, dup: !stop && isSet(pr.d) ? +pr.d : 0, must: !!pr.must, star: true };
      });
      if (!stop) for (const id of custom) if (!isStar(prefOf(id)) && isSet(prefOf(id).d)) copyBonus[id] = +prefOf(id).d;
      if (!targets.length) return showError('精準模式至少要替一隻角色設定優先度或必抽。想多抽沒有的角色可以改用收集模式。');
      if (targets.length > 30) return showError(`精準模式最多 30 隻有優先度的角色，目前 ${targets.length} 隻。可以改用收集模式。`);
    }

    const seeds = new E.Seeds(seed);
    const opts = {
      seeds, seed, startK: E.parsePos(state.pos), lastId: parseInt(state.last, 10) || 0,
      pools, food: state.food, tickets: state.tickets,
      targets, copyBonus,
      uberBonus: collect || !state.stopAtTargets ? state.uberBonus : 0,
      legendBonus: collect || !state.stopAtTargets ? state.legendBonus : 0,
      allowMulti: state.allowMulti, keepFood: state.keepFood, cats: data().cats,
      owned: state.owned, beam: state.beam,
      rarityValue: { 2: state.rv2, 3: state.rv3, 4: state.rv4, 5: state.rv5 },
      dupValue: { 2: state.dv2, 3: state.dv3, 4: state.dv4, 5: state.dv5 },
    };
    $('results').classList.add('busy');
    $('run').textContent = '計算中…';
    setTimeout(() => {
      const t0 = performance.now();
      let res;
      try { res = collect ? P.planCollect(opts) : P.plan(opts); } catch (e) { $('results').classList.remove('busy'); $('run').textContent = '計算最佳路線'; return showError(e.message); }
      renderResult(res, opts, pools, performance.now() - t0, collect);
      $('results').classList.remove('busy');
      $('run').textContent = '計算最佳路線';
    }, 30);
  }

  function showError(msg) {
    $('results').innerHTML = `<div class="verdict bad">${esc(msg)}</div>`;
  }

  function seedLink(seeds, opts, k, last, eventKey) {
    const s = k === 0 ? opts.seed : seeds.at(k - 1);
    const o = state.owned.length ? `&o=${encodeOwned(state.owned)}` : '';
    return `https://bc.godfat.org/?seed=${s}${last ? `&last=${last}` : ''}&event=${eventKey}&lang=${state.lang}${o}`;
  }

  function catChip(c, targets, from) {
    const t = targets.get(c.id);
    const cls = [`cat r${c.rarity}`, t ? 'tgt' : '', t && t.must ? 'must' : '', c.fresh || t ? '' : 'dup'].join(' ');
    const mark = c.guaranteed ? '<sup>保底</sup>' : c.rerolled ? '<sup>重抽</sup>' : '';
    const note = c.fresh ? '新角色' : '已擁有或重複';
    return `<span class="${cls}" title="${RARITY[c.rarity] || ''}・${note}"><span class="p">${c.guaranteed ? E.posLabel(from) + 'G' : E.posLabel(c.pos)}</span>${esc(catName(c.id))}${mark}</span>`;
  }

  // End-of-plan tally: must-pull status, missed targets, and every cat
  // obtained grouped by rarity with copy counts.
  function finalSummary(res, opts, targets, pools) {
    const all = res.steps.flatMap((s) => s.cats).filter((c) => c.id > 0);
    const tally = new Map();
    for (const c of all) {
      const e = tally.get(c.id) || { id: c.id, rarity: c.rarity, count: 0, fresh: false };
      e.count++;
      if (c.fresh) e.fresh = true;
      tally.set(c.id, e);
    }
    const must = opts.targets.filter((t) => t.must);
    const mustOk = must.filter((t) => tally.has(t.id));
    const mustFail = must.filter((t) => !tally.has(t.id));
    const missed = [...targets.values()].filter((t) => !t.must && !tally.has(t.id));

    const chip = (e) => {
      const t = targets.get(e.id);
      const cls = ['fc', `r${e.rarity}`, t ? 'tgt' : '', t && t.must ? 'must' : '', e.fresh || t ? '' : 'dup'].join(' ');
      const tags = [
        t && t.must ? '<i class="b ok">必抽 ✓</i>' : t ? '<i class="b tg">目標</i>' : '',
        e.fresh ? '<i class="b nw">新</i>' : '<i class="b dp">重複</i>',
      ].join('');
      return `<span class="${cls}"><span class="dot r${e.rarity}"></span>${esc(catName(e.id))}${e.count > 1 ? `<b class="x">×${e.count}</b>` : ''}${tags}</span>`;
    };
    const { byBanner, sections } = bannerGrouping();
    const fsub = (name) => `<div class="fsub">${esc(name)}</div>`;

    const mustHtml = must.length ? `<div class="fline">
        <span class="fk">必抽</span>
        <div class="fchips">
          ${mustOk.map((t) => `<span class="fc ok"><span class="dot r${catRarity(t.id)}"></span>${esc(catName(t.id))}<i class="b ok">抽到 ✓</i></span>`).join('')}
          ${mustFail.map((t) => `<span class="fc fail"><span class="dot r${catRarity(t.id)}"></span>${esc(catName(t.id))}<i class="b fail">失敗 ✕</i></span>`).join('')}
        </div>
      </div>` : '';
    const missedHtml = missed.length ? `<div class="fline">
        <span class="fk">沒抽到的目標</span>
        <div class="fchips">${missed.map((t) => `<span class="fc miss"><span class="dot r${catRarity(t.id)}"></span>${esc(catName(t.id))}</span>`).join('')}</div>
      </div>` : '';
    const groups = [5, 4, 3, 2].map((r) => {
      const list = [...tally.values()].filter((e) => e.rarity === r).sort((a, b) => byBanner(a.id, b.id));
      if (!list.length) return '';
      const copies = list.reduce((a, e) => a + e.count, 0);
      const fresh = list.filter((e) => e.fresh).length;
      return `<div class="fgroup">
        <div class="fh"><span class="dot r${r}"></span>${RARITY[r]}<span>${list.length} 種・${copies} 隻${fresh ? `・新 ${fresh}` : ''}</span></div>
        ${sections(list.map((e) => e.id), fsub, (ids) => `<div class="fchips">${ids.map((id) => chip(tally.get(id))).join('')}</div>`)}
      </div>`;
    }).join('');

    // Cats in the selected banners this route never reaches.
    const inBanners = new Map();
    pools.forEach((pool) => Object.values(pool.slots).flat().forEach((id) => {
      if (!inBanners.has(id)) inBanners.set(id, []);
      const names = inBanners.get(id), name = shortName(pool.event.name);
      if (!names.includes(name)) names.push(name);
    }));
    const owned = new Set(state.owned);
    const notGot = [...inBanners.keys()].filter((id) => !tally.has(id));
    const notGotHtml = notGot.length ? `<div class="fgroup">
        <div class="fh">卡池中沒抽到的角色<span>${notGot.length} 種・其中沒擁有 ${notGot.filter((id) => !owned.has(id)).length} 種</span></div>
        ${[5, 4, 3, 2].map((r) => {
          const list = notGot.filter((id) => catRarity(id) === r).sort(byBanner);
          if (!list.length) return '';
          const lacking = list.filter((id) => !owned.has(id)).length;
          return `<details class="nd" ${r >= 4 ? 'open' : ''}>
            <summary><span class="dot r${r}"></span>${RARITY[r]}<span>${list.length} 種・沒擁有 ${lacking}</span></summary>
            ${sections(list, fsub, (ids) => `<div class="fchips">${ids.map((id) => {
              const t = targets.get(id);
              const cls = ['fc', 'ng', `r${r}`, t ? (t.must ? 'fail' : 'miss') : '', owned.has(id) ? 'dup' : ''].join(' ');
              const tag = owned.has(id) ? '<i class="b dp">已擁有</i>' : '<i class="b nw">沒擁有</i>';
              return `<span class="${cls}" title="出現在：${esc(inBanners.get(id).join('、'))}"><span class="dot r${r}"></span>${esc(catName(id))}${tag}</span>`;
            }).join('')}</div>`)}
          </details>`;
        }).join('')}
      </div>` : '';

    return `<section class="panel final">
      <h2>最終統計</h2>
      ${mustFail.length ? `<div class="verdict bad">必抽失敗 ${mustFail.length} 隻：${mustFail.map((t) => esc(catName(t.id))).join('、')}</div>` : ''}
      ${mustHtml}${missedHtml}
      ${groups}
      ${notGotHtml}
    </section>`;
  }

  function renderResult(res, opts, pools, ms, collect) {
    const seeds = opts.seeds;
    const targets = new Map(opts.targets.filter((t) => t.star).map((t) => [t.id, t]));
    const stars = opts.targets.filter((t) => t.star);
    res.got = res.got.filter((t) => t.star);
    const usedFood = opts.food - res.end.food, usedTix = opts.tickets - res.end.tickets;
    const rolls = res.steps.reduce((a, s) => a + s.cats.length, 0);

    // Group consecutive singles on the same banner paid the same way.
    const groups = [];
    let last = opts.lastId;
    for (const s of res.steps) {
      const g = groups[groups.length - 1];
      if (g && s.type === 'single' && g.type === 'single' && g.pool === s.pool && g.pay === s.pay) {
        g.cats.push(...s.cats); g.next = s.next; g.food += s.pay === 'food' ? s.cost : 0; g.tix += s.pay === 'ticket' ? 1 : 0;
      } else {
        groups.push({ type: s.type, pay: s.pay, pool: s.pool, from: s.from, next: s.next, lastBefore: last, cats: [...s.cats],
          food: s.pay === 'food' ? s.cost : 0, tix: s.pay === 'ticket' ? 1 : 0 });
      }
      last = s.cats[s.cats.length - 1].id;
    }

    const must = opts.targets.filter((t) => t.must);
    const fresh = res.steps.flatMap((s) => s.cats).filter((c) => c.fresh);
    const freshBy = [5, 4, 3, 2].map((r) => [r, fresh.filter((c) => c.rarity === r).length]).filter(([, n]) => n);
    const freshText = freshBy.map(([r, n]) => `${RARITY[r]} ${n}`).join('、');
    let verdict;
    if (!res.steps.length) verdict = `<div class="verdict bad">以目前的資源，在勾選的卡池裡拿不到任何${collect ? '有分數的角色' : '目標'}。試試增加卡池或資源。</div>`;
    else if (collect && res.mustOk) verdict = `<div class="verdict ok">照下面的順序抽，可以拿到 ${fresh.length} 隻沒有的角色${freshText ? `（${freshText}）` : ''}${stars.length ? `，目標 ${res.got.length} / ${stars.length}` : ''}。</div>`;
    else if (!res.mustOk) verdict = `<div class="verdict bad">資源不足以拿到所有必抽角色，缺少：${res.missingMust.map((t) => esc(catName(t.id))).join('、')}。下面是在這個限制下分數最高的路線。</div>`;
    else verdict = `<div class="verdict ok">${must.length ? '所有必抽角色都拿得到。' : ''}照下面的順序抽，可以拿到 ${res.got.length} / ${stars.length} 個目標。${
      opts.keepFood ? (usedFood ? `只用金券拿不到這個結果，需要用 ${usedFood} 罐頭。` : '只用金券就能完成，不用動到罐頭。') : ''}</div>`;

    const stepsHtml = groups.map((g) => {
      const pool = pools[g.pool];
      const ev = pool.event;
      const spec = P.multiSpec(pool);
      // Card color by how the roll is paid: ticket, food single, 11-roll, step-up.
      const kind = g.type === 'single' ? (g.pay === 'ticket' ? 'k-ticket' : 'k-food')
        : spec.count === 15 ? 'k-step' : 'k-multi';
      const act = g.type === 'single' ? `${g.pay === 'ticket' ? '金券' : '罐頭'}單抽 × ${g.cats.length}`
        : spec.count === 15 ? '階段轉蛋 3+5+7' : spec.guaranteed ? '保底 11 連' : '11 連';
      const cost = [g.tix ? `券 ${g.tix}` : '', g.food ? `罐頭 ${g.food}` : ''].filter(Boolean).join(' + ');
      const hit = g.cats.some((c) => targets.has(c.id));
      return `<div class="step">
        <div class="pos ${kind}">${E.posLabel(g.from)}<small>起</small></div>
        <div class="card ${kind}">
          <div class="hd"><span class="act">${act}</span><span class="bn">${esc(shortName(ev.name))}</span>${hit ? '<span class="hitTag">含目標</span>' : ''}<span class="cost">${cost}</span></div>
          <div class="cats">${g.cats.map((c) => catChip(c, targets, g.from)).join('')}</div>
          <div class="ft"><span>下一格 ${E.posLabel(g.next)}</span><a href="${seedLink(seeds, opts, g.from, g.lastBefore, pool.key)}" target="_blank" rel="noopener">在 bc.godfat.org 核對 ↗</a></div>
        </div>
      </div>`;
    }).join('');

    const endKey = pools[0].key;
    $('results').innerHTML = `
      ${verdict}
      <div class="summary">
        ${collect ? `<div class="stat"><div class="k">新角色</div><div class="v">${fresh.length}<small> 隻</small></div></div>` : ''}
        ${stars.length ? `<div class="stat"><div class="k">目標</div><div class="v">${res.got.length}<small> / ${stars.length}</small></div></div>` : ''}
        <div class="stat"><div class="k">罐頭</div><div class="v">${usedFood}<small> 用掉，剩 ${res.end.food}</small></div></div>
        <div class="stat"><div class="k">稀有轉蛋券</div><div class="v">${usedTix}<small> 用掉，剩 ${res.end.tickets}</small></div></div>
        <div class="stat"><div class="k">總抽數</div><div class="v">${rolls}<small> 抽</small></div></div>
      </div>
      ${res.steps.length ? finalSummary(res, opts, targets, pools) : ''}
      <div class="legend"><span class="kl k-ticket">金券單抽</span><span class="kl k-food">罐頭單抽</span><span class="kl k-multi">11 連</span><span class="kl k-step">階段轉蛋</span></div>
      <div class="legend"><span class="cat tgt">目標</span><span class="cat">沒有的角色</span><span class="cat dup">已擁有或重複</span><span><sup>保底</sup> 保底超激</span><span><sup>重抽</sup> 稀有重複重抽</span></div>
      <div class="timeline">${stepsHtml}</div>
      ${res.steps.length ? `<div class="panel endbox">
        <h2>抽完之後</h2>
        <div>新的種子 <code>${res.end.seed}</code>，上一隻 <code>${res.end.last}</code>（${esc(catName(res.end.last))}）。
        <a href="${seedLink(seeds, opts, res.end.k, res.end.last, endKey)}" target="_blank" rel="noopener">開啟抽完後的表格 ↗</a></div>
        <p class="hint">計算 ${Math.round(ms)} ms，檢查了 ${res.stats.labels.toLocaleString()} 個狀態。</p>
      </div>` : ''}`;
  }

  // Events
  $('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $('url').addEventListener('input', (e) => { if (/seed=/.test(e.target.value)) applyUrl(e.target.value); });
  $('lang').addEventListener('change', (e) => {
    state.lang = e.target.value;
    fillForm(); save();
  });
  for (const k of ['dateFrom', 'dateTo']) {
    $(k).addEventListener('change', (e) => {
      state[k] = e.target.value;
      if (k === 'dateFrom' && (!state.dateTo || state.dateTo < state.dateFrom)) $('dateTo').value = state.dateTo = state.dateFrom;
      renderBanners(); save();
    });
  }
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    const add = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const n = +b.dataset.range;
    state.dateTo = n ? add(state.dateFrom, n) : state.dateFrom;
    $('dateTo').value = state.dateTo;
    renderBanners(); save();
  }));
  $('banners').addEventListener('change', (e) => {
    state.selected = [...$('banners').querySelectorAll('input:checked')].map((x) => x.value);
    renderTable(); save();
  });
  document.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', () => {
    state.mode = $('modeCollect').checked ? 'collect' : 'exact';
    renderMode(); renderTable(); save();
  }));
  $('stopAtTargets').addEventListener('change', () => { readForm(); renderMode(); renderTable(); });
  $('catFilter').addEventListener('input', renderTable);
  $('ctable').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-own]');
    if (!b) return;
    e.preventDefault(); // a button inside <summary> would also toggle the group
    setOwned(tableGroups[b.dataset.own] || [], b.dataset.on === '1');
  });
  $('onlyCustom').addEventListener('change', renderTable);
  for (const k of ['uberBonus', 'legendBonus', 'rv2', 'rv3', 'rv4', 'rv5', 'dv2', 'dv3', 'dv4', 'dv5']) {
    $(k).addEventListener('change', () => { readForm(); renderTable(); });
  }
  $('ctable').addEventListener('change', (e) => {
    const row = e.target.closest('.crow');
    if (!row) return;
    const id = +row.dataset.id, f = e.target.dataset.f;
    if (f === 'owned') {
      const owned = new Set(state.owned);
      e.target.checked ? owned.add(id) : owned.delete(id);
      state.owned = [...owned].sort((a, b) => a - b);
      save();
      return renderTable(); // refresh the group's 擁有 count
    } else {
      const pr = { ...prefOf(id) };
      if (f === 'must') pr.must = e.target.checked || undefined;
      else pr[f] = e.target.value === '' ? undefined : Math.max(0, parseFloat(e.target.value) || 0);
      if (isCustom(pr)) state.prefs[id] = pr; else delete state.prefs[id];
    }
    save();
    // Re-render only this row so focus stays in the table.
    const tmp = document.createElement('div');
    tmp.innerHTML = rowHtml(id);
    const fresh = tmp.firstElementChild;
    row.className = fresh.className;
    row.querySelectorAll('input[type=number]').forEach((el, i) => { el.placeholder = fresh.querySelectorAll('input[type=number]')[i].placeholder; });
    updateCounts();
  });
  $('ownedImport').addEventListener('click', () => {
    const n = importOwned($('ownedInput').value);
    flash(n ? `新增 ${n} 隻。` : '沒有新增。請確認格式是 o= 代碼、編號或完整角色名稱。');
    if (n) $('ownedInput').value = '';
  });
  $('ownedCopy').addEventListener('click', () => {
    const code = encodeOwned(state.owned);
    if (!code) return flash('目前沒有已擁有的角色。');
    const done = () => flash('已複製 o= 代碼。');
    const fallback = () => { $('ownedInput').value = code; $('ownedInput').select(); flash('請手動複製上面選取的代碼。'); };
    try { navigator.clipboard.writeText(code).then(done, fallback); } catch (e) { fallback(); }
  });
  $('ownedClear').addEventListener('click', (e) => {
    if (e.target.dataset.armed) {
      state.owned = []; save(); renderTable();
      delete e.target.dataset.armed; e.target.textContent = '全部清除';
      flash('已清除。');
    } else {
      e.target.dataset.armed = '1'; e.target.textContent = '再按一次確認清除';
      setTimeout(() => { delete e.target.dataset.armed; e.target.textContent = '全部清除'; }, 3000);
    }
  });
  // Header actions. Both replace the current settings, so they ask for a
  // second click first.
  function armed(btn, label, action) {
    btn.addEventListener('click', () => {
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = '再按一次確認';
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
        return;
      }
      delete btn.dataset.armed;
      btn.textContent = label;
      action();
    });
  }
  armed($('loadSample'), '載入範例', () => {
    state = SAMPLE();
    save(); fillForm(); run();
  });
  armed($('resetAll'), '全部重設', () => {
    try { localStorage.removeItem(STORE); } catch (e) { /* storage unavailable */ }
    state = DEFAULTS();
    $('url').value = ''; $('ownedInput').value = ''; $('catFilter').value = '';
    fillForm(); showGuide();
  });

  function showGuide() {
    $('results').innerHTML = `<section class="panel guide">
      <h2>開始使用</h2>
      <ol>
        <li><b>找到你的種子碼。</b>到 <a href="https://bc.godfat.org/?lang=tw" target="_blank" rel="noopener">bc.godfat.org</a> 找出自己的種子，把網址貼到左邊第 1 區，種子碼、上一隻角色、卡池會自動帶入。</li>
        <li><b>填入罐頭和稀有轉蛋券（金券）的數量。</b></li>
        <li><b>勾選可以切換的卡池。</b>可以選一段日期，列出這段時間開過的卡池。</li>
        <li><b>在第 5 區設定角色。</b>替想要的角色填優先度、勾必抽；已經有的角色勾「擁有」，或在第 4 區貼上 o= 代碼匯入。</li>
        <li><b>按「計算最佳路線」。</b></li>
      </ol>
      <p class="hint">想先看看結果長什麼樣子，可以按右上角的「載入範例」。你的設定會自動存在這個瀏覽器裡，下次打開會還原。</p>
    </section>`;
  }

  fillForm();
  if (stored && state.seed && state.selected.length) run();
  else showGuide();
})();
