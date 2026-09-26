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
    uberBonus: 0.5, legendBonus: 1, allowMulti: true, stopAtTargets: true, keepFood: false, maxRolls: '',
    bannerBias: {}, // event key -> tie-break preference per roll on that banner
    platTickets: '', platKey: '', platMust: [], folded: ['platinum'],
    // Pinned table cells: {key: event key, k: half position, g: guaranteed
    // cell, id: the cat shown there when pinned}.
    pins: [], view: 'route', gridMore: 0, gridCollapsed: [],
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
    for (const k of ['seed', 'last', 'pos', 'food', 'tickets', 'maxRolls', 'platTickets', 'dateFrom', 'dateTo', 'lang', 'uberBonus', 'legendBonus',
      'rv2', 'rv3', 'rv4', 'rv5', 'dv2', 'dv3', 'dv4', 'dv5', 'beam']) {
      $(k).value = state[k];
    }
    $('allowMulti').checked = state.allowMulti;
    $('stopAtTargets').checked = state.stopAtTargets;
    $('keepFood').value = state.keepFood ? '1' : '0';
    $(state.mode === 'collect' ? 'modeCollect' : 'modeExact').checked = true;
    renderMode();
    renderBanners();
    renderPlat();
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
    state.platTickets = Math.max(0, parseInt($('platTickets').value, 10) || 0) || '';
    { const m = Math.floor(parseFloat($('maxRolls').value)); state.maxRolls = m > 0 ? m : ''; }
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
        const on = state.selected.includes(key);
        const bw = state.bannerBias[key] ?? 0;
        return `<label class="banner"><input type="checkbox" value="${key}" ${on ? 'checked' : ''}>
          <span class="t">${esc(shortName(ev.name))}</span>
          <span class="m"><span>${ev.start.slice(5)} ～ ${ev.end.slice(5)}</span><span>#${ev.id}</span>${g}${leg}</span>
          ${on ? `<span class="bw ${bw ? 'set' : ''}"><small>偏好</small><input type="number" min="0" step="any" value="${bw}" data-bw="${key}" aria-label="卡池偏好"></span>` : ''}</label>`;
      }).join('');
    }
    renderTable();
    renderPlat();
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
  // Values used when a cat's own fields are blank.
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

  // Platinum banner: the chosen one, or the newest that has started by the
  // end of the date range.
  function platKeys() {
    const pl = data().platinum || {};
    return Object.keys(pl).sort((a, b) => pl[b].start.localeCompare(pl[a].start));
  }
  function platKey() {
    const keys = platKeys();
    if (keys.includes(state.platKey)) return state.platKey;
    return keys.find((k) => data().platinum[k].start <= state.dateTo) || keys[0] || '';
  }

  function renderPlat() {
    const keys = platKeys(), key = platKey();
    $('platKey').innerHTML = keys.map((k) => {
      const ev = data().platinum[k];
      return `<option value="${k}" ${k === key ? 'selected' : ''}>${ev.start} 起・#${ev.id}（${data().pools[ev.id].length} 隻）</option>`;
    }).join('') || '<option value="">沒有資料</option>';
    const must = new Set(state.platMust);
    const n = +state.platTickets || 0;
    $('platCount').textContent = n || must.size ? `券 ${n} 張・必抽 ${must.size} 隻` : '';
    if (!key) { $('platList').innerHTML = ''; return; }
    const pool = E.buildPool(data(), key);
    const q = $('platFilter').value.trim(), only = $('platOnly').checked;
    const owned = new Set(state.owned);
    // Grouped by home series (computed in scripts/build-data.rb); older data
    // without groups falls back to rarity.
    const groups = data().platinum[key].groups
      || [5, 4].map((r) => ({ name: RARITY[r], ids: pool.slots[r] }));
    const show = (id) => (!q || catName(id).includes(q) || String(id) === q) && (!only || must.has(id));
    $('platList').innerHTML = groups.map((g) => {
      const list = g.ids.filter(show).sort((a, b) => b - a);
      if (!list.length) return '';
      const picked = list.filter((id) => must.has(id)).length;
      return `<div class="grp"><div class="gh">${esc(g.name)}<span>${list.length} 隻${picked ? `・已勾 ${picked}` : ''}</span></div>
        <div class="chips">${list.map((id) => `<button type="button" class="pc ${owned.has(id) ? 'own' : ''}" data-id="${id}" aria-pressed="${must.has(id)}"
          title="${RARITY[catRarity(id)]}${owned.has(id) ? '・已擁有' : ''}"><span class="dot r${catRarity(id)}"></span>${esc(catName(id))}</button>`).join('')}</div></div>`;
    }).join('') || '<p class="hint">沒有符合的角色。</p>';
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
    }

    // Platinum: must-pulls picked in section 6 join the targets.
    const platTickets = +state.platTickets || 0;
    const platPool = platTickets > 0 && platKey() ? E.buildPool(data(), platKey()) : null;
    for (const id of state.platMust) {
      const t = targets.find((x) => x.id === id);
      if (t) { t.must = true; t.star = true; }
      else targets.push({ id, weight: +prefOf(id).w || 10, dup: 0, must: true, star: true });
    }
    // Pinned cells on banners in this run. A pin whose cell now shows a
    // different cat (the seed or banner data changed) is dropped.
    const seeds = new E.Seeds(seed);
    const startK = E.parsePos(state.pos);
    const shown = platPool ? [...pools, platPool] : pools;
    const pins = [];
    let dropped = 0;
    state.pins = state.pins.filter((pin) => {
      const p = shown.findIndex((x) => x.key === pin.key);
      if (p < 0 || pin.k < startK) return true; // inactive for now, keep it
      if (cellCat(seeds, shown[p], pin.k, pin.g) !== pin.id) { dropped++; return false; }
      pins.push({ pool: p, k: pin.k, g: !!pin.g, id: pin.id });
      return true;
    });
    if (dropped) save();
    if (!collect && !targets.length && !pins.length) return showError('精準模式至少要替一隻角色設定優先度或必抽，或在表格裡指定格子。想多抽沒有的角色可以改用收集模式。');
    if (!collect && targets.length > 30) return showError(`精準模式最多 30 隻有優先度的角色，目前 ${targets.length} 隻。可以改用收集模式。`);

    const opts = {
      seeds, seed, startK, lastId: parseInt(state.last, 10) || 0, pins, droppedPins: dropped,
      pools, food: state.food, tickets: state.tickets,
      targets, copyBonus,
      uberBonus: collect || !state.stopAtTargets ? state.uberBonus : 0,
      legendBonus: collect || !state.stopAtTargets ? state.legendBonus : 0,
      bannerBias: pools.map((p) => +state.bannerBias[p.key] || 0),
      allowMulti: state.allowMulti, keepFood: state.keepFood, maxRolls: +state.maxRolls || 0, cats: data().cats,
      owned: state.owned, beam: state.beam,
      rarityValue: { 2: state.rv2, 3: state.rv3, 4: state.rv4, 5: state.rv5 },
      dupValue: { 2: state.dv2, 3: state.dv3, 4: state.dv4, 5: state.dv5 },
      platinum: platPool ? { pool: platPool, tickets: platTickets } : null,
    };
    $('results').classList.add('busy');
    $('run').textContent = '計算中…';
    setTimeout(() => {
      const t0 = performance.now();
      let res;
      try { res = collect ? P.planCollect(opts) : P.plan(opts); } catch (e) { $('results').classList.remove('busy'); $('run').textContent = '計算最佳路線'; return showError(e.message); }
      renderResult(res, opts, shown, performance.now() - t0, collect);
      $('results').classList.remove('busy');
      $('run').textContent = '計算最佳路線';
    }, 30);
  }

  function showError(msg) {
    $('results').classList.remove('tableMode');
    $('results').innerHTML = `<div class="verdict bad">${esc(msg)}</div>`;
    $('summaryBody').innerHTML = '<p class="hint">按「計算最佳路線」後會顯示這條路線的統計。</p>';
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
    const tallyOf = (steps) => {
      const tally = new Map();
      for (const c of steps.flatMap((s) => s.cats).filter((x) => x.id > 0)) {
        const e = tally.get(c.id) || { id: c.id, rarity: c.rarity, count: 0, fresh: false };
        e.count++;
        if (c.fresh) e.fresh = true;
        tally.set(c.id, e);
      }
      return tally;
    };
    // Everything pulled (for must-pull status), and the regular and platinum
    // pulls listed separately.
    const tally = tallyOf(res.steps);
    const regular = tallyOf(res.steps.filter((s) => s.type !== 'plat'));
    const platTally = tallyOf(res.steps.filter((s) => s.type === 'plat'));
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
      const list = [...regular.values()].filter((e) => e.rarity === r).sort((a, b) => byBanner(a.id, b.id));
      if (!list.length) return '';
      const copies = list.reduce((a, e) => a + e.count, 0);
      const fresh = list.filter((e) => e.fresh).length;
      return `<div class="fgroup">
        <div class="fh"><span class="dot r${r}"></span>${RARITY[r]}<span>${list.length} 種・${copies} 隻${fresh ? `・新 ${fresh}` : ''}</span></div>
        ${sections(list.map((e) => e.id), fsub, (ids) => `<div class="fchips">${ids.map((id) => chip(regular.get(id))).join('')}</div>`)}
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

    return `
      ${mustFail.length ? `<div class="verdict bad">必抽失敗 ${mustFail.length} 隻：${mustFail.map((t) => esc(catName(t.id))).join('、')}</div>` : ''}
      ${mustHtml}${pinsHtml(res, opts)}${missedHtml}
      ${groups}
      ${platTally.size ? `<div class="fgroup plat">
        <div class="fh">白金券抽到<span>${platTally.size} 種・${[...platTally.values()].reduce((a, e) => a + e.count, 0)} 隻</span></div>
        <div class="fchips">${[...platTally.values()].sort((a, b) => b.rarity - a.rarity || b.id - a.id).map(chip).join('')}</div>
      </div>` : ''}
      ${notGotHtml}
    `;
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
    res.steps.forEach((s, i) => {
      const g = groups[groups.length - 1];
      if (g && s.type !== 'multi' && g.type === s.type && g.pool === s.pool && g.pay === s.pay) {
        g.cats.push(...s.cats); g.next = s.next; g.food += s.pay === 'food' ? s.cost : 0; g.tix += s.pay === 'ticket' ? 1 : 0;
        g.plat += s.pay === 'platinum' ? 1 : 0;
        g.actEnd = i + 1;
      } else {
        groups.push({ type: s.type, pay: s.pay, pool: s.pool, from: s.from, next: s.next, lastBefore: last, cats: [...s.cats],
          food: s.pay === 'food' ? s.cost : 0, tix: s.pay === 'ticket' ? 1 : 0, plat: s.pay === 'platinum' ? 1 : 0,
          actStart: i, actEnd: i + 1 });
      }
      last = s.cats[s.cats.length - 1].id;
    });
    // Progress is counted in actions (a single roll, or a whole 11-roll /
    // step-up). Each action records where it leaves you, for resuming, and
    // the last table row it uses, for "rolled up to this row" (the
    // guaranteed uber is shown on the start row, so it doesn't count).
    const acts = [];
    {
      let food = 0, tix = 0, plat = 0, rolls = 0;
      for (const s of res.steps) {
        if (s.pay === 'food') food += s.cost; else if (s.pay === 'ticket') tix++; else if (s.pay === 'platinum') plat++;
        rolls += s.cats.length;
        acts.push({ step: s, next: s.next, lastAfter: s.cats[s.cats.length - 1].id, foodSpent: food, tixSpent: tix,
          platSpent: plat, rolls, endRow: Math.max(...s.cats.filter((c) => !c.guaranteed).map((c) => Math.floor(c.pos / 2) + 1)) });
      }
    }
    // Progress is tied to this exact route; a different route starts over.
    const sig = [opts.seed, opts.startK, opts.lastId, ...groups.map((g) => `${pools[g.pool].key}:${g.type}:${g.pay}:${g.from}:${g.cats.length}`)].join('|');
    currentRoute = { sig, groups, acts, opts, pools };
    const doneActs = progressActs();
    gridCtx = { res, opts, shown: pools };

    const must = opts.targets.filter((t) => t.must);
    const fresh = res.steps.flatMap((s) => s.cats).filter((c) => c.fresh);
    const freshBy = [5, 4, 3, 2].map((r) => [r, fresh.filter((c) => c.rarity === r).length]).filter(([, n]) => n);
    const freshText = freshBy.map(([r, n]) => `${RARITY[r]} ${n}`).join('、');
    let verdict;
    if (!res.steps.length) verdict = `<div class="verdict bad">以目前的資源，在勾選的卡池裡拿不到任何${collect ? '有分數的角色' : '目標'}。試試增加卡池或資源。</div>`;
    else if (collect && res.mustOk) verdict = `<div class="verdict ok">照下面的順序抽，可以拿到 ${fresh.length} 隻沒有的角色${freshText ? `（${freshText}）` : ''}${stars.length ? `，目標 ${res.got.length} / ${stars.length}` : ''}。</div>`;
    else if (!res.mustOk) {
      const miss = [...res.missingMust.map((t) => esc(catName(t.id))),
        ...(res.missingPins || []).map((p) => `${esc(catName(p.id))}（${pinLabel(pools, p)}）`)];
      verdict = `<div class="verdict bad">資源不足以拿到所有必抽角色，缺少：${miss.join('、')}。下面是在這個限制下分數最高的路線。</div>`;
    }
    else verdict = `<div class="verdict ok">${must.length ? '所有必抽角色都拿得到。' : ''}照下面的順序抽，可以拿到 ${res.got.length} / ${stars.length} 個目標。${
      opts.keepFood ? (usedFood ? `只用金券拿不到這個結果，需要用 ${usedFood} 罐頭。` : '只用金券就能完成，不用動到罐頭。') : ''}</div>`;

    const stepsHtml = groups.map((g, i) => {
      const pool = pools[g.pool];
      const ev = pool.event;
      const spec = P.multiSpec(pool);
      // Card color by how the roll is paid: ticket, food single, 11-roll, step-up.
      const kind = g.type === 'plat' ? 'k-plat' : g.type === 'single' ? (g.pay === 'ticket' ? 'k-ticket' : 'k-food')
        : spec.count === 15 ? 'k-step' : 'k-multi';
      const act = g.type === 'plat' ? `白金券單抽 × ${g.cats.length}`
        : g.type === 'single' ? `${g.pay === 'ticket' ? '金券' : '罐頭'}單抽 × ${g.cats.length}`
        : spec.count === 15 ? '階段轉蛋 3+5+7' : spec.guaranteed ? '保底 11 連' : '11 連';
      const cost = [g.plat ? `白金券 ${g.plat}` : '', g.tix ? `券 ${g.tix}` : '', g.food ? `罐頭 ${g.food}` : ''].filter(Boolean).join(' + ');
      const hit = g.cats.some((c) => targets.has(c.id));
      return `<div class="step" data-i="${i}">
        <div class="pos ${kind}">${E.posLabel(g.from)}<small>起</small></div>
        <div class="card ${kind}">
          <div class="hd"><span class="act">${act}</span><span class="bn">${esc(shortName(ev.name))}</span>${hit ? '<span class="hitTag">含目標</span>' : ''}<span class="cost">${cost}</span></div>
          <div class="cats">${g.cats.map((c) => catChip(c, targets, g.from)).join('')}</div>
          <div class="ft"><span>下一格 ${E.posLabel(g.next)}</span><a href="${seedLink(seeds, opts, g.from, g.lastBefore, pool.key)}" target="_blank" rel="noopener">在 bc.godfat.org 核對 ↗</a>
            <label class="doneBox"><input type="checkbox" data-step="${i}" ${doneActs >= g.actEnd ? 'checked' : ''}> <span>已抽</span></label></div>
        </div>
      </div>`;
    }).join('');

    const endKey = pools[0].key;
    const view = state.view === 'table' ? 'table' : 'route';
    // Keep the table and the page where they were (e.g. after pinning a
    // cell, which recalculates the route).
    const oldWrap = $('gridwrap');
    const keep = { left: oldWrap ? oldWrap.scrollLeft : 0, top: oldWrap ? oldWrap.scrollTop : 0, page: window.scrollY,
      results: $('results').scrollTop };
    $('results').style.minHeight = `${$('results').offsetHeight}px`;
    $('results').innerHTML = `
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-view="route" aria-selected="${view === 'route'}">路線</button>
        <button type="button" role="tab" data-view="table" aria-selected="${view === 'table'}">表格${opts.pins.length ? `・指定 ${opts.pins.length}` : ''}</button>
      </div>
      ${opts.droppedPins ? `<div class="verdict bad">有 ${opts.droppedPins} 個指定格子的角色和現在的表格不同（種子或卡池資料改變），已經取消。</div>` : ''}
      <div id="gridView" ${view === 'table' ? '' : 'hidden'}></div>
      <div id="routeView" ${view === 'route' ? '' : 'hidden'}>
      ${verdict}
      <div class="legend"><span class="kl k-ticket">金券單抽</span><span class="kl k-food">罐頭單抽</span><span class="kl k-multi">11 連</span><span class="kl k-step">階段轉蛋</span>${opts.platinum ? '<span class="kl k-plat">白金券</span>' : ''}</div>
      <div class="legend"><span class="cat tgt">目標</span><span class="cat">沒有的角色</span><span class="cat dup">已擁有或重複</span><span><sup>保底</sup> 保底超激</span><span><sup>重抽</sup> 稀有重複重抽</span></div>
      ${groups.length ? `<div class="progress" id="progress"></div>` : ''}
      <div class="timeline">${stepsHtml}</div>
      ${res.steps.length ? `<div class="panel endbox">
        <h2>抽完之後</h2>
        <div>新的種子 <code>${res.end.seed}</code>，上一隻 <code>${res.end.last}</code>（${esc(catName(res.end.last))}）。
        <a href="${seedLink(seeds, opts, res.end.k, res.end.last, endKey)}" target="_blank" rel="noopener">開啟抽完後的表格 ↗</a></div>
        <p class="hint">計算 ${Math.round(ms)} ms，檢查了 ${res.stats.labels.toLocaleString()} 個狀態。</p>
      </div>` : ''}
      </div>`;
    // Totals and the final summary live in the settings column (panel 7).
    $('summaryBody').innerHTML = `
      <div class="summary">
        ${collect ? `<div class="stat"><div class="k">新角色</div><div class="v">${fresh.length}<small> 隻</small></div></div>` : ''}
        ${stars.length ? `<div class="stat"><div class="k">目標</div><div class="v">${res.got.length}<small> / ${stars.length}</small></div></div>` : ''}
        <div class="stat"><div class="k">罐頭</div><div class="v">${usedFood}<small class="sub">用掉，剩 ${res.end.food}</small></div></div>
        <div class="stat"><div class="k">稀有轉蛋券</div><div class="v">${usedTix}<small class="sub">用掉，剩 ${res.end.tickets}</small></div></div>
        ${opts.platinum ? `<div class="stat"><div class="k">白金券</div><div class="v">${opts.platinum.tickets - res.end.platinum}<small class="sub">用掉，剩 ${res.end.platinum}</small></div></div>` : ''}
        <div class="stat"><div class="k">總抽數</div><div class="v">${rolls}<small> ${opts.maxRolls ? `/ 上限 ${opts.maxRolls} 抽` : '抽'}</small></div></div>
      </div>
      ${res.steps.length ? finalSummary(res, opts, targets, opts.pools) : ''}
    `;
    if (groups.length) renderProgress();
    if (view === 'table') {
      renderGrid();
      const wrap = $('gridwrap');
      wrap.scrollLeft = keep.left;
      wrap.scrollTop = keep.top;
      markStuckLanes();
    }
    $('results').style.minHeight = '';
    $('results').classList.toggle('tableMode', view === 'table');
    $('results').scrollTop = keep.results;
    window.scrollTo(window.scrollX, keep.page);
  }

  // Pinned cells in the final summary: hit or missed.
  function pinsHtml(res, opts) {
    if (!opts.pins.length) return '';
    const missed = new Set((res.missingPins || []).map((p) => `${p.pool}|${p.k}|${p.g}`));
    return `<div class="fline"><span class="fk">指定格子</span><div class="fchips">${opts.pins.map((p) => {
      const ok = !missed.has(`${p.pool}|${p.k}|${p.g}`);
      return `<span class="fc ${ok ? 'ok' : 'fail'}"><span class="dot r${catRarity(p.id)}"></span>${esc(catName(p.id))}<small>${pinLabel(gridCtx ? gridCtx.shown : opts.pools, p)}</small>${ok ? '<i class="b ok">抽到 ✓</i>' : '<i class="b fail">失敗 ✕</i>'}</span>`;
    }).join('')}</div></div>`;
  }

  // ---- Table view: the bc.godfat.org style grid with the route drawn on it.

  let gridCtx = null;

  // The cat a cell shows: the raw roll, or for a guaranteed cell the
  // guaranteed uber of an 11-roll (or step-up) starting there.
  function cellCat(seeds, pool, k, g) {
    if (!g) return E.rollAt(seeds, pool, k, 0).id;
    const spec = P.multiSpec(pool);
    return E.rollMulti(seeds, pool, k, 0, spec.count, true).cats.pop().id;
  }

  function pinLabel(pools, p) {
    const pool = pools[p.pool];
    return `${pool ? esc(shortName(pool.event.name).slice(0, 10)) : ''} ${E.posLabel(p.k)}${p.g ? ' 保底' : ''}`;
  }

  // Cell colors follow bc.godfat.org's basic highlighting. The major color
  // is the score band of the position (fixed thresholds, so a position has
  // the same color in every banner), unless the cat is owned or an exclusive.
  // The minor color (a strip on the left) shows the score band for owned
  // cats and otherwise repeats the major. Guaranteed cells have no score.
  function scoreBand(score) {
    if (score === undefined) return 'rare';
    if (score < 6470) return 'rare';
    if (score < 6970) return 'supa_fest';
    if (score < 9070) return 'supa';
    if (score < 9470) return 'uber_fest';
    if (score < 9940) return 'uber';
    if (score < 9970) return 'legend_fest';
    return 'legend';
  }
  function cellColors(id, score, owned, exclusive) {
    const band = scoreBand(score);
    if (owned.has(id)) return [exclusive.has(id) ? 'exclusive' : band === 'rare' ? 'owned' : band, 'owned'];
    if (exclusive.has(id)) return ['exclusive', 'exclusive'];
    return [band, band];
  }

  function stepKind(step, pool) {
    if (step.type === 'plat') return 'k-plat';
    if (step.type === 'single') return step.pay === 'ticket' ? 'k-ticket' : 'k-food';
    return P.multiSpec(pool).count === 15 ? 'k-step' : 'k-multi';
  }

  // Each banner is a column group: [A lane] A (A 保底) B (B 保底) [B lane],
  // with a gap between banners. Rolls are drawn as downward arrows in the
  // lane beside their track: A on the left, B on the right. A collapsed
  // banner keeps only its two lanes.
  function renderGrid() {
    if (!gridCtx) return;
    const { res, opts, shown } = gridCtx;
    const seeds = opts.seeds, nReg = opts.pools.length;
    const gCol = (p) => p < nReg && shown[p].guaranteed > 0;
    const folded = new Set(state.gridCollapsed || []);

    // Cells the route rolls, and the lane arrows for regular rolls.
    const hits = new Map(), lanes = new Map();
    let order = 0;
    for (const [ai, s] of res.steps.entries()) {
      const kind = stepKind(s, shown[s.pool]);
      for (const c of s.cats) {
        order++;
        const key = c.guaranteed ? `${s.pool}|${s.from}|1` : `${s.pool}|${c.pos}|0`;
        const h = hits.get(key) || { kind, order: [], id: c.id, act: ai };
        h.order.push(order);
        hits.set(key, h);
        if (!c.guaranteed) lanes.set(`${s.pool}|${c.pos}`, kind);
      }
    }
    const pinned = new Map(state.pins.map((p) => [`${p.key}|${p.k}|${p.g ? 1 : 0}`, p]));
    const owned = new Set(state.owned), exclusive = new Set(data().exclusives || []);

    const startRow = Math.floor(opts.startK / 2) + 1;
    const lastHit = Math.max(0, ...[...hits.keys()].map((k) => Math.floor(+k.split('|')[1] / 2) + 1));
    const endRow = Math.min(startRow + 400, Math.max(lastHit + 3, startRow + 29) + state.gridMore);

    // Lanes that carry arrows stick to the edges when scrolled out of view:
    // each gets a sticky left offset (stacked after the row numbers, in
    // column order) and a sticky right offset (stacked from the right edge).
    const RN_W = 52, LANE_W = 14;
    const active = [];
    shown.forEach((_, p) => ['a', 'b'].forEach((side) => {
      for (const key of lanes.keys()) {
        const [lp, lk] = key.split('|').map(Number);
        if (lp === p && (lk % 2 === 0) === (side === 'a') && lk >= opts.startK) { active.push(`${p}|${side}`); return; }
      }
    }));
    const stick = (p, side) => {
      const i = active.indexOf(`${p}|${side}`);
      return i < 0 ? '' : ` stick" data-lane="${i}" style="left:${RN_W + i * LANE_W}px;right:${(active.length - 1 - i) * LANE_W}px`;
    };
    gridLanes = { active, RN_W, LANE_W };
    const lane = (p, k, side) => {
      const kind = k >= opts.startK && lanes.get(`${p}|${k}`);
      return `<td class="lane ${side}${stick(p, side)}" title="${esc(shortName(shown[p].event.name))} ${side.toUpperCase()} 軌">${kind ? `<i class="la ${kind}"></i>` : ''}</td>`;
    };
    const gap = '<td class="gap"></td>';

    const head1 = shown.map((pool, p) => {
      const name = p >= nReg ? '白金轉蛋' : shortName(pool.event.name);
      if (folded.has(pool.key)) {
        return `<th colspan="2" class="bh fold" data-fold="${pool.key}" title="展開：${esc(pool.event.name)}">▸</th>${p < shown.length - 1 ? '<th class="gap"></th>' : ''}`;
      }
      const span = (gCol(p) ? 4 : 2) + 2;
      return `<th colspan="${span}" class="bh" data-fold="${pool.key}" title="收合：${esc(pool.event.name)}"><span>▾ ${esc(name)}</span></th>${p < shown.length - 1 ? '<th class="gap"></th>' : ''}`;
    }).join('');
    const head2 = shown.map((pool, p) => {
      const gapTh = p < shown.length - 1 ? '<th class="gap"></th>' : '';
      if (folded.has(pool.key)) return `<th class="lane a${stick(p, 'a')}">A</th><th class="lane b${stick(p, 'b')}">B</th>${gapTh}`;
      const gl = P.multiSpec(pool).count === 15 ? '階段保底' : '保底';
      return `<th class="lane a${stick(p, 'a')}"></th><th>A</th>${gCol(p) ? `<th class="gc">A ${gl}</th>` : ''}<th>B</th>${gCol(p) ? `<th class="gc">B ${gl}</th>` : ''}<th class="lane b${stick(p, 'b')}"></th>${gapTh}`;
    }).join('');

    const cell = (p, k, g) => {
      const pool = shown[p];
      if (k < opts.startK) return '<td class="past"></td>';
      let id, extra = '', score;
      if (g) {
        const spec = P.multiSpec(pool);
        const m = E.rollMulti(seeds, pool, k, 0, spec.count, true);
        id = m.cats[m.cats.length - 1].id;
        extra = `<small>→ ${E.posLabel(m.next)}</small>`;
      } else {
        const r = E.rollAt(seeds, pool, k, 0);
        id = r.id;
        score = seeds.at(k) % E.BASE;
        // A rare that repeats the cell above on the same track can be rerolled.
        if (r.rarity === E.RARE && k - 2 >= opts.startK && E.rollAt(seeds, pool, k - 2, 0).id === id) {
          extra = `<small>重→${esc(catName(E.rollAt(seeds, pool, k, id).id))}</small>`;
        }
      }
      const key = `${p}|${k}|${g ? 1 : 0}`;
      const h = hits.get(key), pin = pinned.get(`${pool.key}|${k}|${g ? 1 : 0}`);
      const cls = [`r${catRarity(id)}`, g ? 'gc' : '', h ? `hit ${h.kind}` : '', pin ? 'pin' : ''].join(' ');
      const [major, minor] = cellColors(id, score, owned, exclusive);
      const style = `--mj:var(--g-${major});--mn:var(--g-${minor})`;
      const got = h && h.id !== id ? `<small class="rr">實際：${esc(catName(h.id))}</small>` : '';
      const ord = h ? `<i class="ord">${h.order.join(',')}</i>` : '';
      return `<td class="${cls}" style="${style}" data-band="${major}" ${h ? `data-act="${h.act}"` : ''} data-cell="${key}" data-key="${pool.key}" data-k="${k}" data-g="${g ? 1 : 0}" data-id="${id}"
        title="${esc(catName(id))}（${E.posLabel(k)}${g ? ' 保底' : ''}）${pin ? '・已指定' : '・點一下指定必抽'}">${ord}<span class="nm">${esc(catName(id))}</span>${extra}${got}</td>`;
    };

    // Rows the planned route covers get a tinted row number, colored by how
    // that row's roll is paid; the last one gets a rule under it.
    const rowKind = new Map();
    for (const s of res.steps) {
      for (const c of s.cats) {
        const r = Math.floor(c.pos / 2) + 1;
        if (!c.guaranteed && !rowKind.has(r)) rowKind.set(r, stepKind(s, shown[s.pool]));
      }
    }
    const planEnd = Math.max(0, ...rowKind.keys());
    let rows = '';
    for (let n = startRow; n <= endRow; n++) {
      const kA = (n - 1) * 2, kB = kA + 1;
      const plan = n <= planEnd ? `plan ${rowKind.get(n) || ''}` : 'after';
      rows += `<tr class="${n === planEnd ? 'planend' : ''}"><th class="rn ${plan}" data-row="${n}" title="${n <= planEnd ? '規劃範圍內。' : '規劃範圍外。'}點一下：已經抽到這一列">${n}</th>${shown.map((pool, p) => {
        const tail = p < shown.length - 1 ? gap : '';
        if (folded.has(pool.key)) return lane(p, kA, 'a') + lane(p, kB, 'b') + tail;
        return lane(p, kA, 'a') + cell(p, kA, false) + (gCol(p) ? cell(p, kA, true) : '')
          + cell(p, kB, false) + (gCol(p) ? cell(p, kB, true) : '') + lane(p, kB, 'b') + tail;
      }).join('')}</tr>`;
    }

    $('gridView').innerHTML = `
      <div class="gridnote">
        <button type="button" id="clearPins" ${state.pins.length ? '' : 'disabled'}>取消全部指定</button>
        <details class="gridhelp"${state.gridHelp ? ' open' : ''}><summary>表格說明</summary>
          <ul>
            <li>點格子＝<b class="pinTag">指定</b>必抽：一定要在那一格抽到那隻角色。保底格代表從那一格開始 11 連拿到的保底超激。再點一次取消，路線會自動重算。</li>
            <li>點左邊列號＝已經抽到這一列。列號有底色＝這次規劃的範圍，顏色是那一列的抽法；抽過的列會變暗並打 ✓。</li>
            <li>A 軌的箭頭在卡池左側，B 軌在右側；捲出畫面的箭頭會疊在左右邊緣。格子左上角數字是第幾抽。</li>
            <li>點卡池名稱可以收合。按住表格拖曳可以捲動。底色依 bc.godfat.org：看那一格的分數區間，每個卡池同一格顏色相同。</li>
          </ul>
        </details>
      </div>
      <div class="legend compact"><span class="kl k-ticket">金券</span><span class="kl k-food">罐頭單抽</span><span class="kl k-multi">11 連</span><span class="kl k-step">階段</span>${opts.platinum ? '<span class="kl k-plat">白金券</span>' : ''}
        <span class="sep"></span>${[['rare', '稀有'], ['supa_fest', '激稀有（祭）'], ['supa', '激稀有'], ['uber_fest', '超激（祭）'], ['uber', '超激'],
        ['legend_fest', '傳說（祭）'], ['legend', '傳說'], ['owned', '已擁有'], ['exclusive', '限定']]
        .map(([b, t]) => `<span class="band" style="--mj:var(--g-${b})">${t}</span>`).join('')}</div>
      <div class="gridwrap" id="gridwrap">
        <style id="laneStyle"></style>
        <table class="grid"><thead><tr><th class="rn" rowspan="2">No.</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${rows}</tbody></table>
      </div>
      <button type="button" id="gridMore">再顯示 50 列</button>`;
    applyGridProgress();
    $('gridwrap').addEventListener('scroll', markStuckLanes, { passive: true });
    markStuckLanes();
    floatGridHeader();
  }

  // Which sticky lanes are currently stacked at an edge (away from their own
  // banner). Stacked lanes get a darker ground, and the inner edge of each
  // stack gets a thick rule so the stack reads apart from the table.
  let gridLanes = { active: [] };
  function markStuckLanes() {
    const wrap = $('gridwrap'), style = $('laneStyle');
    if (!wrap || !style) return;
    const { active, RN_W, LANE_W } = gridLanes;
    const heads = [...wrap.querySelectorAll('thead th.bh')];
    const view = wrap.clientWidth, x0 = wrap.scrollLeft;
    const left = [], right = [];
    active.forEach((id, i) => {
      const [p, side] = id.split('|');
      const bh = heads[+p];
      if (!bh) return;
      // Natural position of the lane: first or last column of its banner.
      const x = (side === 'a' ? bh.offsetLeft : bh.offsetLeft + bh.offsetWidth - LANE_W) - x0;
      if (x < RN_W + i * LANE_W - 0.5) left.push(i);
      else if (x > view - (active.length - i) * LANE_W + 0.5) right.push(i);
    });
    const sel = (i) => `#gridwrap [data-lane="${i}"]`;
    let css = [...left, ...right].map((i) => `${sel(i)}{background:var(--surface-2)!important}`).join('');
    // Keep the 1px divider on every lane; the stack's inner edge gets a
    // rule three times as thick in --stack-edge.
    if (left.length) css += `${sel(Math.max(...left))}{box-shadow:inset 1px 0 0 var(--line),inset -3px 0 0 var(--stack-edge)!important}`;
    if (right.length) css += `${sel(Math.min(...right))}{box-shadow:inset 3px 0 0 var(--stack-edge)!important}`;
    style.textContent = css;
  }
  window.addEventListener('resize', () => requestAnimationFrame(markStuckLanes));

  // Keep the table header on screen while the page scrolls past the table.
  function floatGridHeader() {
    const wrap = $('gridwrap');
    if (!wrap || wrap.offsetParent === null) return;
    const head = wrap.querySelector('thead');
    const r = wrap.getBoundingClientRect();
    const shift = Math.max(0, Math.min(-r.top, r.height - head.offsetHeight - 40));
    wrap.style.setProperty('--hdr-shift', `${shift}px`);
  }
  window.addEventListener('scroll', floatGridHeader, { passive: true });
  window.addEventListener('resize', floatGridHeader);

  // Drag the table to scroll it. A press that moves less than a few pixels
  // is still a click (pinning a cell).
  {
    let drag = null;
    document.addEventListener('pointerdown', (e) => {
      const wrap = e.target.closest && e.target.closest('#gridwrap');
      if (!wrap || e.button !== 0 || e.pointerType === 'touch') return;
      drag = { wrap, x: e.clientX, y: e.clientY, left: wrap.scrollLeft, top: wrap.scrollTop, moved: false };
    });
    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      drag.wrap.classList.add('dragging');
      drag.wrap.scrollLeft = drag.left - dx;
      drag.wrap.scrollTop = drag.top - dy;
    });
    document.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag.wrap.classList.remove('dragging');
      drag = null;
      if (moved) {
        // Swallow the click that ends a drag.
        const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 0);
      }
    });
  }

  let currentRoute = null;

  // Number of actions done on the current route.
  function progressActs() {
    const r = currentRoute;
    if (!r || !state.progress || state.progress.sig !== r.sig) return 0;
    return Math.min(+state.progress.acts || 0, r.acts.length);
  }
  function setProgress(n) {
    state.progress = { sig: currentRoute.sig, acts: n };
    save();
    renderProgress();
  }

  function renderProgress() {
    const r = currentRoute, n = progressActs(), acts = r.acts;
    const a = n ? acts[n - 1] : null, total = acts[acts.length - 1].rolls;
    const pbar = $('progress');
    if (pbar) {
      pbar.innerHTML = `
        <div class="pbar"><span style="width:${((a ? a.rolls : 0) / total) * 100}%"></span></div>
        <div class="ptext"><b>進度 ${a ? a.rolls : 0} / ${total} 抽</b>${a ? `<span>目前在 ${E.posLabel(a.next)}，已用罐頭 ${a.foodSpent}、金券 ${a.tixSpent}${a.platSpent ? `、白金券 ${a.platSpent}` : ''}</span>` : '<span>抽完就勾選該步右下角的「已抽」，或在表格點列號。</span>'}</div>
        ${n && n < acts.length ? '<button type="button" id="rebase">從目前進度重新規劃</button>' : ''}`;
      if ($('rebase')) armed($('rebase'), '從目前進度重新規劃', rebase);
    }
    let nextMarked = false;
    document.querySelectorAll('#results .step').forEach((el) => {
      const g = r.groups[+el.dataset.i];
      const done = n >= g.actEnd, part = n > g.actStart && n < g.actEnd;
      el.classList.toggle('done', done);
      el.classList.toggle('next', !done && !nextMarked);
      if (!done) nextMarked = true;
      const box = el.querySelector('input[data-step]');
      box.checked = done;
      box.indeterminate = part;
      box.nextElementSibling.textContent = part ? `已抽 ${n - g.actStart} / ${g.actEnd - g.actStart}` : '已抽';
    });
    applyGridProgress();
  }

  // Table view: rows up to the progress are ticked, rolled cells fade and the
  // row of the next roll is marked.
  function applyGridProgress() {
    const wrap = $('gridwrap');
    if (!wrap || !currentRoute) return;
    const n = progressActs(), acts = currentRoute.acts;
    const doneRow = n ? acts[n - 1].endRow : 0;
    const nextRow = n < acts.length ? Math.floor(acts[n].step.from / 2) + 1 : -1;
    wrap.querySelectorAll('th.rn[data-row]').forEach((th) => {
      const row = +th.dataset.row;
      th.classList.toggle('done', row <= doneRow);
      th.classList.toggle('next', row === nextRow);
    });
    wrap.querySelectorAll('td[data-act]').forEach((td) => td.classList.toggle('done', +td.dataset.act < n));
  }

  // Start a new plan from the checked-off position: the seed, last cat and
  // resources after the last done step. Cats already pulled become owned and
  // pulled targets lose their priority and must-pull.
  function rebase() {
    const r = currentRoute, n = progressActs();
    if (!r || !n) return;
    const g = r.acts[n - 1];
    const pulled = new Set(r.acts.slice(0, n).flatMap((x) => x.step.cats.map((c) => c.id)).filter((id) => id > 0));
    state.seed = String(g.next === 0 ? r.opts.seed : r.opts.seeds.at(g.next - 1));
    state.pos = '1A';
    state.last = String(g.lastAfter);
    state.food = Math.max(0, (+state.food || 0) - g.foodSpent);
    state.tickets = Math.max(0, (+state.tickets || 0) - g.tixSpent);
    if (g.platSpent) state.platTickets = Math.max(0, (+state.platTickets || 0) - g.platSpent) || '';
    state.platMust = state.platMust.filter((id) => !pulled.has(id));
    // Pins move with the new starting point; ones already passed are dropped.
    state.pins = state.pins.filter((pin) => pin.k >= g.next).map((pin) => ({ ...pin, k: pin.k - g.next }));
    if (+state.maxRolls) {
      state.maxRolls = Math.max(1, state.maxRolls - g.rolls);
    }
    state.owned = [...new Set([...state.owned, ...pulled])].sort((a, b) => a - b);
    for (const id of pulled) {
      const pr = state.prefs[id];
      if (!pr) continue;
      delete pr.w; delete pr.must;
      if (!isCustom(pr)) delete state.prefs[id];
    }
    state.progress = null;
    save(); fillForm(); run();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Tabs, and pinning table cells.
  $('results').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) {
      state.view = tab.dataset.view;
      save();
      $('results').querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      $('routeView').hidden = state.view !== 'route';
      $('gridView').hidden = state.view !== 'table';
      $('results').classList.toggle('tableMode', state.view === 'table');
      if (state.view === 'table') renderGrid();
      return;
    }
    if (e.target.closest('.gridhelp summary')) {
      state.gridHelp = !e.target.closest('details').open;
      save();
      return;
    }
    if (e.target.id === 'gridMore') { state.gridMore += 50; save(); renderGrid(); return; }
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      const set = new Set(state.gridCollapsed || []);
      set.has(fold.dataset.fold) ? set.delete(fold.dataset.fold) : set.add(fold.dataset.fold);
      state.gridCollapsed = [...set];
      save();
      const wrap = $('gridwrap'), left = wrap.scrollLeft, top = wrap.scrollTop;
      renderGrid();
      $('gridwrap').scrollLeft = left; $('gridwrap').scrollTop = top;
      return;
    }
    if (e.target.id === 'clearPins') { state.pins = []; save(); run(); return; }
    const rowTh = e.target.closest('th.rn[data-row]');
    if (rowTh && currentRoute) {
      // Rolled up to this row: every action that ends by here is done.
      const row = +rowTh.dataset.row, acts = currentRoute.acts;
      const upTo = (r) => { let n = 0; while (n < acts.length && acts[n].endRow <= r) n++; return n; };
      let n = upTo(row);
      if (n === progressActs() && n > 0) n = upTo(row - 1);
      setProgress(n);
      return;
    }
    const td = e.target.closest('td[data-cell]');
    if (!td) return;
    const pin = { key: td.dataset.key, k: +td.dataset.k, g: td.dataset.g === '1', id: +td.dataset.id };
    const i = state.pins.findIndex((p) => p.key === pin.key && p.k === pin.k && !!p.g === pin.g);
    if (i >= 0) state.pins.splice(i, 1); else state.pins.push(pin);
    save();
    run();
  });

  // Checking a step marks every earlier step too; unchecking clears later ones.
  $('results').addEventListener('change', (e) => {
    const i = e.target.dataset.step;
    if (i === undefined || !currentRoute) return;
    const g = currentRoute.groups[+i];
    setProgress(e.target.checked ? g.actEnd : g.actStart);
  });

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
    const key = e.target.dataset.bw;
    if (key) {
      const v = parseFloat(e.target.value);
      if (v > 0) state.bannerBias[key] = v; else delete state.bannerBias[key];
      e.target.closest('.bw').classList.toggle('set', key in state.bannerBias);
    } else {
      state.selected = [...$('banners').querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value);
      const scroll = $('banners').scrollTop;
      renderBanners();
      $('banners').scrollTop = scroll;
    }
    renderTable(); save();
  });
  document.querySelectorAll('input[name=mode]').forEach((el) => el.addEventListener('change', () => {
    state.mode = $('modeCollect').checked ? 'collect' : 'exact';
    renderMode(); renderTable(); save();
  }));
  $('stopAtTargets').addEventListener('change', () => { readForm(); renderMode(); renderTable(); });
  $('catFilter').addEventListener('input', renderTable);
  $('platFilter').addEventListener('input', renderPlat);
  $('platOnly').addEventListener('change', renderPlat);
  $('platTickets').addEventListener('change', () => { readForm(); renderPlat(); });
  $('platKey').addEventListener('change', (e) => { state.platKey = e.target.value; save(); renderPlat(); });
  $('platList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const id = +b.dataset.id, must = new Set(state.platMust);
    must.has(id) ? must.delete(id) : must.add(id);
    state.platMust = [...must];
    save(); renderPlat();
  });
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
  // Collapsible settings panels; which ones are folded is remembered.
  function applyFolds() {
    const folded = new Set(state.folded || []);
    document.querySelectorAll('.panel.fold').forEach((sec) => {
      const f = folded.has(sec.dataset.sec);
      sec.classList.toggle('collapsed', f);
      sec.querySelector('.foldbtn').setAttribute('aria-expanded', String(!f));
    });
  }
  document.querySelectorAll('.foldbtn').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.panel').dataset.sec;
    const folded = new Set(state.folded || []);
    folded.has(id) ? folded.delete(id) : folded.add(id);
    state.folded = [...folded];
    applyFolds(); save();
  }));

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
    state = { ...SAMPLE(), folded: state.folded };
    save(); fillForm(); run();
  });
  armed($('resetAll'), '全部重設', () => {
    try { localStorage.removeItem(STORE); } catch (e) { /* storage unavailable */ }
    state = DEFAULTS();
    $('url').value = ''; $('ownedInput').value = ''; $('catFilter').value = '';
    fillForm(); applyFolds(); showGuide();
  });

  function showGuide() {
    $('results').classList.remove('tableMode');
    $('summaryBody').innerHTML = '<p class="hint">按「計算最佳路線」後會顯示這條路線的統計。</p>';
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
  applyFolds();
  if (stored && state.seed && state.selected.length) run();
  else showGuide();
})();
