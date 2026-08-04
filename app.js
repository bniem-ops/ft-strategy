(function () {
  const DATA = window.FLOCK_DATA || { chickens: [], predators: [], weather: { seasons: {}, eggspansion: [], unsorted: [] } };

  const state = {
    search: '', openCards: new Set(), openStage: {},
    strategySection: 'teams',
    setup: null, wizardOpen: false, wizardDraft: null, wizardStep: 1,
    compareA: null, compareB: null, myTeam: [],
    sessionCode: null, sessionData: null, isHost: false, playerName: '', joinError: null,
    rulesOpen: false, rulesSearch: '',
  };

  const appEl = document.getElementById('app');
  const progressEl = document.getElementById('progress');
  const wizardRoot = document.getElementById('wizard-root');
  const rulesRoot = document.getElementById('rules-root');
  const setupBtn = document.getElementById('setup-btn');
  const rulesBtn = document.getElementById('rules-btn');

  function defaultDraft() { return { players: 3, expansion: false, difficulty: 4, predators: [null, null, null] }; }

  // Both "my team" (N player slots) and "known predators" (3 slots) use the
  // same fixed-length-with-nulls shape so a dropdown-per-slot UI has a
  // stable position to bind to. pad/truncate rather than reject, so a
  // player-count change later doesn't have to be a special case.
  function normalizeSlots(arr, n) {
    const a = (arr || []).slice(0, n);
    while (a.length < n) a.push(null);
    return a;
  }

  function normalizeMyTeamSlots(n) {
    state.myTeam = normalizeSlots(state.myTeam, n);
  }

  // Used by the wizard's "This is my pick" button (local mode) — drops the
  // pick into the first open player slot instead of appending, since the
  // team is now a fixed N-slot array, not an open-ended list.
  function addToMyTeam(name) {
    normalizeMyTeamSlots(state.setup ? state.setup.players : 1);
    if (state.myTeam.includes(name)) return;
    const emptyIdx = state.myTeam.indexOf(null);
    state.myTeam[emptyIdx !== -1 ? emptyIdx : 0] = name;
  }
  function loadSetup() {
    try {
      const raw = localStorage.getItem('flockSetup');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt storage */ }
    return null;
  }
  function saveSetup(setup) {
    state.setup = setup;
    try { localStorage.setItem('flockSetup', JSON.stringify(setup)); } catch (e) { /* storage unavailable */ }
  }

  if (setupBtn) {
    setupBtn.addEventListener('click', () => {
      state.wizardDraft = state.setup ? { ...state.setup, predators: [...state.setup.predators] } : defaultDraft();
      state.wizardOpen = true;
      state.wizardStep = 1;
      render();
    });
  }

  if (rulesBtn) {
    rulesBtn.addEventListener('click', () => {
      state.rulesOpen = true;
      renderRulesModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.rulesOpen) {
      state.rulesOpen = false;
      renderRulesModal();
    }
  });

  // ---------------------------------------------------------------------
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function val(v, placeholder = 'Not yet transcribed') {
    return v == null
      ? `<span class="value unknown">${placeholder}</span>`
      : `<span class="value">${esc(v)}</span>`;
  }

  function statBlock(label, v) {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value ${v == null ? 'unknown' : ''}">${v == null ? '—' : esc(v)}</div></div>`;
  }

  // ---------------------------------------------------------------------
  // Progress summary
  // ---------------------------------------------------------------------
  function updateProgress() {
    if (!progressEl) return;
    const namedChickens = DATA.chickens.filter(c => c.name).length;
    const statFullChickens = DATA.chickens.filter(c => c.name && c.stages.every(s => s.health && s.attackStrength && s.production)).length;

    const namedPredators = DATA.predators.filter(p => p.name).length;
    const statFullPredators = DATA.predators.filter(p => p.name && p.stages.every(s => s.healthMultiplier && s.effect)).length;

    const allWeather = [...Object.values(DATA.weather.seasons || {}).flat(), ...(DATA.weather.eggspansion || [])];
    const weatherFull = allWeather.filter(w => w.name && w.effect).length;

    const issues = [];
    if (namedChickens < DATA.chickens.length) issues.push(`${DATA.chickens.length - namedChickens} chicken slot${DATA.chickens.length - namedChickens > 1 ? 's' : ''} unnamed`);
    else if (statFullChickens < namedChickens) issues.push(`${namedChickens - statFullChickens} chicken${namedChickens - statFullChickens > 1 ? 's' : ''} missing stats`);
    if (namedPredators < DATA.predators.length) issues.push(`${DATA.predators.length - namedPredators} predator slot${DATA.predators.length - namedPredators > 1 ? 's' : ''} unnamed`);
    else if (statFullPredators < namedPredators) issues.push(`${namedPredators - statFullPredators} predator${namedPredators - statFullPredators > 1 ? 's' : ''} missing stats`);
    if (weatherFull < allWeather.length) issues.push(`${allWeather.length - weatherFull} weather card${allWeather.length - weatherFull > 1 ? 's' : ''} incomplete`);

    if (issues.length) {
      progressEl.textContent = `⚠ ${issues.join(' · ')}`;
      progressEl.style.display = '';
    } else {
      progressEl.textContent = '';
      progressEl.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------
  // CHICKENS
  // ---------------------------------------------------------------------

  // Abilities stack — a chicken keeps every prior stage's abilities on top
  // of its new one (rulebook p.13). Renders the cumulative set for the
  // selected stage plus its stat grid; shared by the browsable chicken card
  // and the always-open compare card in the setup wizard.
  function chickenStageContent(c, openStageIdx) {
    const stage = c.stages[openStageIdx];
    const cumulativeAbilities = c.stages
      .slice(0, openStageIdx + 1)
      .flatMap(s => s.abilities.map(a => ({ ...a, gainedAtStage: s.stage })));
    const abilities = cumulativeAbilities.length
      ? cumulativeAbilities.map(a => `
          <div class="ability">
            <div class="aname">
              ${a.name ? esc(a.name) : '<span class="unknown">Unnamed ability</span>'}
              ${a.gainedAtStage !== stage.stage ? `<span class="stage-badge">from Stage ${a.gainedAtStage}</span>` : ''}
            </div>
            <div class="atext ${a.text ? '' : 'unknown'}">${a.text ? esc(a.text) : 'Not yet transcribed'}</div>
          </div>`).join('')
      : `<div class="note">No abilities recorded through this stage yet.</div>`;

    return `
      <div class="stat-grid">
        ${statBlock('Health', stage.health)}
        ${statBlock('Attack Strength', stage.attackStrength)}
        ${statBlock('Production', stage.production)}
        ${stage.mealsToNext !== undefined && openStageIdx < c.stages.length - 1 ? statBlock('Meals to next stage', stage.mealsToNext) : ''}
      </div>
      ${abilities}`;
  }

  // Role chips + one-line summary, sourced from the same archetypes data
  // that used to back a standalone "Roles" tab — folded directly onto each
  // chicken's card instead, since it's the same chicken either way.
  function chickenRoleBlock(c) {
    const arch = window.FLOCK_STRATEGY && window.FLOCK_STRATEGY.archetypes
      ? window.FLOCK_STRATEGY.archetypes.find(a => a.name === c.name)
      : null;
    if (!arch) return '';
    return `
      <div class="ability">
        ${roleChips(arch.roles)}
        <div class="atext">${esc(arch.summary)}</div>
      </div>`;
  }

  function renderChickenCard(c, idx) {
    const key = 'chk-' + idx;
    const isOpen = state.openCards.has(key);
    const name = c.name || `Eggspansion slot #${idx + 1}`;
    const openStageIdx = state.openStage[key] ?? 0;

    const stageTabs = c.stages.map((s, i) => `
      <button class="stage-tab ${i === openStageIdx ? 'active' : ''}" data-key="${key}" data-stage="${i}">
        ${esc(s.label.split(' ')[0] || 'Stage ' + s.stage)}
      </button>`).join('');

    return `
      <div class="card chicken-card ${isOpen ? 'open' : ''}" data-key="${key}">
        <div class="card-head" data-toggle="${key}">
          <div class="card-title">
            <span class="name">${esc(name)}</span>
            <span class="sub">${c.breed ? esc(c.breed) : 'Breed unknown'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="chevron">▶</span>
          </div>
        </div>
        <div class="card-body">
          ${chickenRoleBlock(c)}
          <div class="stage-tabs">${stageTabs}</div>
          ${chickenStageContent(c, openStageIdx)}
          ${c.flavorQuote ? `<div class="flavor">"${esc(c.flavorQuote)}"</div>` : ''}
        </div>
      </div>`;
  }

  function renderChickens() {
    const q = state.search.trim().toLowerCase();
    const items = DATA.chickens
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (!q) return true;
        const hay = [c.name, c.breed, ...c.stages.flatMap(s => s.abilities.map(a => a.name + ' ' + a.text))].join(' ').toLowerCase();
        return hay.includes(q);
      });

    if (!items.length) return `<div class="empty-state">No chickens match "${esc(state.search)}"</div>`;
    return items.map(({ c, i }) => renderChickenCard(c, i)).join('');
  }

  // ---------------------------------------------------------------------
  // PREDATORS
  // ---------------------------------------------------------------------
  // Threat/counters/caution, sourced from the same predatorGuide data that
  // used to back a standalone "Predator Guide" tab — folded directly onto
  // each predator's card instead, same reasoning as chickenRoleBlock above.
  function predatorGuideBlock(p) {
    const STRAT = window.FLOCK_STRATEGY;
    const guide = STRAT && STRAT.predatorGuide ? STRAT.predatorGuide.find(g => g.predator === p.name) : null;
    if (!guide) return '';
    return `
      <div class="ability">
        <div class="aname">Threat</div>
        <div class="atext">${esc(guide.threat)}</div>
      </div>
      <div class="section-title" style="margin:10px 0 4px 0;">Best counters</div>
      ${guide.counters.map(c => `
        <div class="ability">
          <div class="aname" style="color:var(--accent-2);">${esc(c.chicken)}</div>
          <div class="atext">${esc(c.why)}</div>
        </div>`).join('')}
      ${guide.caution ? `<div class="note" style="margin-top:6px;">⚠ ${esc(guide.caution)}</div>` : ''}`;
  }

  function renderPredatorCard(p, idx) {
    const key = 'pred-' + idx;
    const isOpen = state.openCards.has(key);
    const name = p.name || `Eggspansion slot #${idx + 1}`;
    const openStageIdx = state.openStage[key] ?? 0;
    const stage = p.stages[openStageIdx];

    const stageTabs = p.stages.map((s, i) => `
      <button class="stage-tab ${i === openStageIdx ? 'active' : ''}" data-key="${key}" data-stage="${i}">Stage ${s.stage}</button>`).join('');

    return `
      <div class="card predator-card ${isOpen ? 'open' : ''}" data-key="${key}">
        <div class="card-head" data-toggle="${key}">
          <div class="card-title">
            <span class="name">${esc(name)}</span>
            <span class="sub">${p.species ? esc(p.species) : 'Species unknown'}${p.note ? ' · ' + esc(p.note) : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="chevron">▶</span>
          </div>
        </div>
        <div class="card-body">
          <div class="stage-tabs">${stageTabs}</div>
          <div class="stat-grid">
            ${statBlock('Health Multiplier', stage.healthMultiplier)}
            ${statBlock('Return Attack (claws)', stage.returnAttack)}
          </div>
          <div class="ability">
            <div class="aname">Predator Effect</div>
            <div class="atext ${stage.effect ? '' : 'unknown'}">${stage.effect ? esc(stage.effect) : 'Not yet transcribed'}</div>
          </div>
          <div class="loot">
            <div class="label">Loot Drop</div>
            ${p.lootDrop ? esc(p.lootDrop) : '<span class="value unknown">Not yet transcribed</span>'}
          </div>
          ${predatorGuideBlock(p)}
        </div>
      </div>`;
  }

  function renderPredators() {
    const q = state.search.trim().toLowerCase();
    const items = DATA.predators
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        if (!q) return true;
        const hay = [p.name, p.species, p.note, p.lootDrop, ...p.stages.map(s => s.effect)].join(' ').toLowerCase();
        return hay.includes(q);
      });

    if (!items.length) return `<div class="empty-state">No predators match "${esc(state.search)}"</div>`;
    return items.map(({ p, i }) => renderPredatorCard(p, i)).join('');
  }

  // ---------------------------------------------------------------------
  // WEATHER
  // ---------------------------------------------------------------------
  function weatherCard(w) {
    return `
      <div class="card open" style="cursor:default;">
        <div class="card-body" style="border-top:none;padding-top:14px;">
          <div class="ability">
            <div class="aname">${w.name ? esc(w.name) : '<span class="unknown">Unnamed card</span>'}</div>
            <div class="atext ${w.effect ? '' : 'unknown'}">${w.effect ? esc(w.effect) : 'Not yet transcribed'}</div>
            <div class="note">${w.phaseLength ? 'Phase length: ' + esc(w.phaseLength) + ' days' : (w.season ? 'Season: ' + esc(w.season) : '')}${w.note ? ' · ' + esc(w.note) : ''}</div>
          </div>
        </div>
      </div>`;
  }

  function renderWeather() {
    const q = state.search.trim().toLowerCase();
    const seasons = ['spring', 'summer', 'fall'];
    let out = '';
    seasons.forEach(season => {
      const cards = (DATA.weather.seasons[season] || []).filter(w => {
        if (!q) return true;
        return [w.name, w.effect].join(' ').toLowerCase().includes(q);
      });
      if (!cards.length && q) return;
      out += `<div class="section-title">${season} deck</div>`;
      out += cards.length ? cards.map(weatherCard).join('') : `<div class="empty-state">No cards yet</div>`;
    });

    const eggs = (DATA.weather.eggspansion || []).filter(w => !q || [w.name, w.effect].join(' ').toLowerCase().includes(q));
    if (eggs.length || !q) {
      out += `<div class="section-title">Eggspansion cards</div>`;
      out += eggs.length ? eggs.map(weatherCard).join('') : `<div class="empty-state">No cards yet</div>`;
    }

    const unsorted = (DATA.weather.unsorted || []).filter(w => !q || [w.name, w.effect].join(' ').toLowerCase().includes(q));
    if (unsorted.length) {
      out += `<div class="section-title">Unsorted (season unknown)</div>`;
      out += unsorted.map(weatherCard).join('');
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // RULES
  // ---------------------------------------------------------------------
  function ruleTable(t) {
    return `
      ${t.title ? `<div class="section-title" style="margin:10px 4px 6px 4px;">${esc(t.title)}</div>` : ''}
      <div class="rules-table-wrap">
        <table class="rules-table">
          <thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function ruleSectionCard(s) {
    let inner = `<div class="ability"><div class="aname">${esc(s.title)}</div>`;
    inner += s.body.map(p => `<div class="atext" style="margin-bottom:6px;">${esc(p)}</div>`).join('');
    inner += `</div>`;
    if (s.tables) inner += s.tables.map(ruleTable).join('');
    else if (s.table) inner += ruleTable(s.table);
    return staticCard(inner);
  }

  function renderRules() {
    const RULES = window.FLOCK_RULES;
    if (!RULES) return `<div class="empty-state">Rules data not loaded.</div>`;
    const q = state.rulesSearch.trim().toLowerCase();
    const items = RULES.sections.filter(s => {
      if (!q) return true;
      const hay = [s.title, ...s.body, ...(s.table ? s.table.rows.flat() : []), ...(s.tables ? s.tables.flatMap(t => t.rows.flat()) : [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
    let out = q ? '' : staticCard(`<div class="ability"><div class="atext">${esc(RULES.intro)}</div></div>`);
    if (!items.length) return out + `<div class="empty-state">No rules match "${esc(state.rulesSearch)}"</div>`;
    return out + items.map(ruleSectionCard).join('');
  }

  // ---------------------------------------------------------------------
  // STRATEGY
  // ---------------------------------------------------------------------
  const STRAT = window.FLOCK_STRATEGY;

  function staticCard(inner, extraClass = '') {
    return `<div class="card open ${extraClass}" style="cursor:default;"><div class="card-body" style="border-top:none;padding-top:14px;">${inner}</div></div>`;
  }
  function roleChips(list) {
    return `<div style="margin:4px 0 6px 0;">${list.map(r => `<span class="role-chip">${esc(r)}</span>`).join('')}</div>`;
  }

  // The 13 named team archetypes (Balanced Core, Grub Guild, etc.), shown
  // as a static reference list independent of any Setup state — contrast
  // with Team Comps, which shows the same archetypes reordered/annotated
  // by your current difficulty and Eggspansion setting.
  function renderSquadArchetypes() {
    const REC = window.FLOCK_RECOMMEND;
    if (!REC) return `<div class="empty-state">Strategy data not loaded.</div>`;
    const q = state.search.trim().toLowerCase();
    const items = REC.ARCHETYPES.filter(a => !q || [a.title, a.tag, a.blurb, ...a.core].join(' ').toLowerCase().includes(q));
    if (!items.length) return `<div class="empty-state">No archetypes match "${esc(state.search)}"</div>`;
    return items.map(a => staticCard(`
      <div class="ability">
        <div class="aname">${esc(a.title)} <span class="stage-badge">${esc(a.tag)}</span></div>
        <div class="sub" style="margin:2px 0 6px 0;">${a.minPlayers === a.maxPlayers ? `${a.minPlayers} player` : `${a.minPlayers}–${a.maxPlayers} players`} · ${esc(a.resilience)} resilience${a.requiresExpansion ? ' · needs Eggspansion' : ''}</div>
        <div class="atext">${esc(a.blurb)}</div>
        ${roleChips(a.core)}
        ${a.caution ? `<div class="note">⚠ ${esc(a.caution)}</div>` : ''}
        ${a.cardTip ? `<div class="note">🃏 ${esc(a.cardTip)}</div>` : ''}
      </div>`)).join('');
  }

  function renderTeamComps() {
    const REC = window.FLOCK_RECOMMEND;
    if (!STRAT || !REC) return `<div class="empty-state">Strategy data not loaded.</div>`;
    if (!state.setup) {
      return staticCard(`
        <div class="ability">
          <div class="aname">Set up your game to see tailored comps</div>
          <div class="atext">Tap 🎲 My Game above and answer player count, Eggspansion, and difficulty — the suggestions here are computed from that, not a fixed list.</div>
        </div>`);
    }

    const setup = state.setup;
    const { results: allResults } = REC.suggestTeams({ players: setup.players, expansion: setup.expansion, difficulty: setup.difficulty });

    const q = state.search.trim().toLowerCase();
    const results = !q ? allResults : allResults.filter(r => {
      const hay = [r.title, r.tag, r.blurb, ...r.squad].join(' ').toLowerCase();
      return hay.includes(q);
    });

    let out = '';

    if (!allResults.length) {
      out += `<div class="empty-state">No archetypes available — try toggling Eggspansion on.</div>`;
    } else if (!results.length) {
      out += `<div class="empty-state">No archetypes match "${esc(state.search)}"</div>`;
    } else {
      out += results.map(r => staticCard(`
        <div class="ability">
          <div class="aname">${esc(r.title)} <span class="stage-badge">${esc(r.tag)}</span></div>
          <div class="atext">${esc(r.blurb)}</div>
          ${roleChips(r.squad)}
          ${r.caution ? `<div class="note">⚠ ${esc(r.caution)}</div>` : ''}
          ${r.cardTip ? `<div class="note">🃏 ${esc(r.cardTip)}</div>` : ''}
          ${r.lockedCount ? `<div class="note">+${r.lockedCount} more pick${r.lockedCount > 1 ? 's' : ''} available for this archetype with Eggspansion on</div>` : ''}
        </div>`)).join('');
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // COMPARE CHICKENS
  // ---------------------------------------------------------------------
  function parseNum(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

  function chickenQuickStats(c) {
    const healthSum = c.stages.reduce((s, st) => s + (parseNum(st.health) || 0), 0);
    const attackSum = c.stages.reduce((s, st) => s + (parseNum(st.attackStrength) || 0), 0);
    const mealsSum = c.stages.slice(0, 2).reduce((s, st) => s + (parseNum(st.mealsToNext) || 0), 0);
    const rollThresholds = c.stages.slice(1).map(st => {
      const m = (st.production || '').match(/(\d)-6/);
      return m ? Number(m[1]) : null;
    }).filter(n => n != null);
    const avgThreshold = rollThresholds.length ? (rollThresholds.reduce((a, b) => a + b, 0) / rollThresholds.length) : null;
    const abilityTexts = c.stages.flatMap(st => st.abilities.map(a => a.text || ''));
    const cardDependent = abilityTexts.some(t => /bonus card/i.test(t));
    return { healthSum, attackSum, mealsSum, avgThreshold, cardDependent };
  }

  function quickTakeCard(nameA, nameB) {
    const cA = DATA.chickens.find(c => c.name === nameA);
    const cB = DATA.chickens.find(c => c.name === nameB);
    if (!cA || !cB) return '';
    const qa = chickenQuickStats(cA), qb = chickenQuickStats(cB);

    const bullets = [];
    if (qa.healthSum !== qb.healthSum) {
      const higher = qa.healthSum > qb.healthSum ? nameA : nameB;
      bullets.push(`${higher} has more total health across all 3 stages (${Math.max(qa.healthSum, qb.healthSum)} vs ${Math.min(qa.healthSum, qb.healthSum)}) — tankier, better for soaking hits.`);
    }
    if (qa.attackSum !== qb.attackSum) {
      const higher = qa.attackSum > qb.attackSum ? nameA : nameB;
      bullets.push(`${higher} has more total attack strength across all 3 stages (${Math.max(qa.attackSum, qb.attackSum)} vs ${Math.min(qa.attackSum, qb.attackSum)}) — hits harder, wastes less food on weak attacks.`);
    }
    if (qa.mealsSum != null && qb.mealsSum != null && qa.mealsSum !== qb.mealsSum) {
      const faster = qa.mealsSum < qb.mealsSum ? nameA : nameB;
      bullets.push(`${faster} levels faster — needs fewer total meals to reach Stage 3 (${Math.min(qa.mealsSum, qb.mealsSum)} vs ${Math.max(qa.mealsSum, qb.mealsSum)}).`);
    }
    if (qa.avgThreshold != null && qb.avgThreshold != null && qa.avgThreshold !== qb.avgThreshold) {
      const better = qa.avgThreshold < qb.avgThreshold ? nameA : nameB;
      bullets.push(`${better} has better production-roll odds on average (needs ${(qa.avgThreshold < qb.avgThreshold ? qa.avgThreshold : qb.avgThreshold)}-6 vs ${(qa.avgThreshold < qb.avgThreshold ? qb.avgThreshold : qa.avgThreshold)}-6) — more reliable egg income.`);
    }
    if (qa.cardDependent !== qb.cardDependent) {
      const safer = !qa.cardDependent ? nameA : nameB;
      bullets.push(`${safer}'s kit doesn't depend on Bonus Cards — untouched by Chicksune's card-lockdown effect, where the other isn't.`);
    }

    return staticCard(`
      <div class="ability">
        <div class="aname">Quick take</div>
        ${bullets.length ? bullets.map(b => `<div class="atext" style="margin-bottom:6px;">• ${b}</div>`).join('') : '<div class="atext">These two are close on the numbers — the difference comes down to playstyle (see roles below).</div>'}
      </div>`);
  }

  // ---------------------------------------------------------------------
  // KNOWN PREDATORS (inline, relocated out of the setup wizard — see note
  // where it's rendered: predators aren't revealed until after chickens
  // are picked, so this only makes sense once the board is actually set up)
  // ---------------------------------------------------------------------
  const BOSS_ROW = staticCard(`
    <div class="ability">
      <div class="aname">4th Predator (the Boss)</div>
      <div class="atext">Stays face-down until the last regular Predator falls — always a surprise.</div>
    </div>`, 'predator-card');

  // Shared by the local (state.setup.predators) and live-session
  // (Firestore data.predators) known-predator pickers — 3 fixed slots
  // instead of an open checklist, same reasoning as the chicken picker:
  // "3 known predators, boss unknown" is the actual game state, not "up to
  // 3 of however many."
  function predatorSlotsMarkup(known, expansionOn, attrName) {
    const choices = DATA.predators.filter(p => p.name && (expansionOn || p.expansion !== 'Eggspansion')).map(p => p.name).sort();
    const slots = known.map((picked, i) => {
      const options = choices.filter(name => name === picked || !known.includes(name));
      return staticCard(`
        <div class="ability">
          <div class="aname">Predator ${i + 1}</div>
          <select class="searchbar" data-${attrName}="${i}" style="margin-top:6px;">
            <option value="">— unknown —</option>
            ${options.map(name => `<option value="${esc(name)}" ${name === picked ? 'selected' : ''}>${esc(name)}</option>`).join('')}
          </select>
        </div>`, 'predator-card');
    }).join('');
    return slots + BOSS_ROW;
  }

  function renderKnownPredatorsPicker() {
    if (!state.setup) return '';
    const known = normalizeSlots(state.setup.predators, 3);
    return `
      <div class="section-title" style="margin:14px 4px 8px 4px;">Known predators <span class="modal-optional">(once the board's revealed)</span></div>
      ${predatorSlotsMarkup(known, state.setup.expansion, 'known-predator-slot')}`;
  }

  // ---------------------------------------------------------------------
  // MY TEAM
  // ---------------------------------------------------------------------
  // Shared by the local "My Team" builder and the live table session view —
  // both just feed a list of chicken names into the same analysis engine.
  function renderTeamAnalysis(teamNames, difficulty, knownPredators) {
    const REC = window.FLOCK_RECOMMEND;
    if (!teamNames.length || !REC) return '';

    const analysis = REC.analyzeTeam(teamNames, difficulty);
    let out = staticCard(`
      <div class="ability">
        <div class="aname">Role coverage</div>
        ${roleChips(analysis.picked.flatMap(a => a.roles))}
        <div class="atext" style="margin-top:6px;">${esc(analysis.gapMessage)}</div>
      </div>`);

    if (analysis.archetypeMatch) {
      const am = analysis.archetypeMatch;
      out += staticCard(`
        <div class="ability">
          <div class="aname">Closest archetype: ${esc(am.title)} <span class="stage-badge">${esc(am.tag)}</span></div>
          <div class="atext" style="margin-top:2px;">${am.matched.length} chicken${am.matched.length > 1 ? 's' : ''} on this team fit${am.matched.length > 1 ? '' : 's'} this archetype</div>
          ${roleChips(am.matched)}
          ${am.cardTip ? `<div class="note">🃏 ${esc(am.cardTip)}</div>` : ''}
        </div>`);
    }

    if (analysis.combos.length) {
      out += `<div class="section-title">Synergies in this team</div>`;
      out += analysis.combos.map(c => staticCard(`
        <div class="ability">
          <div class="aname">${esc(c.title)} <span class="stage-badge">${c.status === 'active' ? '🔗' : '🧩'} ${c.satisfiedCount}/${c.totalSlots} chickens</span></div>
          ${roleChips(c.matchedChickens || [])}
          <div class="atext">${esc(c.synergy)}</div>
          ${c.tiesToArchetype ? `<div class="note" style="color:var(--accent-2);font-style:normal;margin-top:4px;">✓ Ties into your closest archetype, ${esc(analysis.archetypeMatch.title)}</div>` : ''}
        </div>`)).join('');
    }

    if (analysis.pace.length) {
      out += `<div class="section-title">Leveling pace</div>`;
      const top = analysis.pace[0];
      const cheapestTotal = Math.min(...analysis.pace.map(p => p.total));
      const topReason = top.comboActive
        ? (top.total === cheapestTotal
            ? `cheapest pick, and it's what ${top.comboTitles.map(esc).join(' & ')} needs`
            : `costs a bit more, but it's what ${top.comboTitles.map(esc).join(' & ')} needs — worth it over a cheaper bench-warmer`)
        : top.comboTitles.length
          ? (top.total === cheapestTotal
              ? `cheapest pick, and it sets up ${top.comboTitles.map(esc).join(' & ')} once you add the other piece`
              : `costs a bit more, but it sets up ${top.comboTitles.map(esc).join(' & ')} once you add the other piece`)
          : `cheapest to unlock their full kit`;
      out += staticCard(`
        <div class="ability">
          <div class="atext">Total meals to reach Stage 3 — ${analysis.pace.map(p => `${esc(p.name)} (${p.total}${p.comboActive ? ' 🔗' : (p.comboTitles.length ? ' 🧩' : '')})`).join(', ')}. Feed <strong>${esc(top.name)}</strong> first — ${topReason}.</div>
          ${analysis.pace.some(p => p.comboActive) ? '<div class="note" style="margin-top:6px;">🔗 = part of an active synergy detected above — weighted ahead of everything else.</div>' : ''}
          ${analysis.pace.some(p => !p.comboActive && p.comboTitles.length) ? '<div class="note" style="margin-top:2px;">🧩 = sets up a synergy that\'s still missing a teammate — weighted above non-synergy picks, below active ones.</div>' : ''}
        </div>`);
    }

    if (analysis.grubPickers.length) {
      out += staticCard(`
        <div class="ability">
          <div class="aname">Early game: prioritize Grubs</div>
          <div class="atext">${analysis.grubPickers.map(esc).join(', ')} turn Grub kills into real value — clear Grubs early rather than ignoring them, especially if Sheriff of Rottingham is in the Predator pool this game.</div>
        </div>`);
    }

    if (knownPredators && knownPredators.length) {
      const priority = REC.predatorPriority(teamNames, knownPredators);
      out += `<div class="section-title">Suggested engagement order</div>`;
      out += priority.map((p, i) => staticCard(`
        <div class="ability">
          <div class="aname">${i + 1}. ${esc(p.predator)} <span class="stage-badge">${p.favorable ? 'Engage early' : 'Save for later'}</span></div>
          <div class="atext">${p.favorable
            ? `Your team already counters this — ${p.matchedCounters.map(m => esc(m.chicken)).join(', ')}.`
            : `No natural counter on this team yet. Level up and stock resources before engaging, or let the fight come to you.`}</div>
        </div>`, 'predator-card')).join('');
    }

    return out;
  }

  // "My Team" is session-aware: local checkbox picker normally, or the live
  // Firestore-backed roster once a session is active (see LIVE TABLE SESSION
  // below) — same tab either way rather than a separate one that only
  // exists while a session happens to be running.
  function renderMyTeam() {
    if (state.sessionCode) {
      ensureSessionSubscription();
      return renderMyTeamLive();
    }
    return renderMyTeamLocal();
  }

  // Compact stats shown right in a <select> option's text — native options
  // can't hold rich markup, so this is plain text with icons standing in
  // for the labels: heart=health, sword=attack, basket=meals to Stage 3.
  function chickenOptionLabel(name) {
    const c = DATA.chickens.find(x => x.name === name);
    if (!c) return name;
    const s3 = c.stages[2], s2 = c.stages[1];
    const h = s3 && s3.health != null ? s3.health : '?';
    const a = s3 && s3.attackStrength != null ? s3.attackStrength : '?';
    const m = s2 && s2.mealsToNext != null ? s2.mealsToNext : '?';
    return `${name} — ❤${h} ⚔${a} 🧺${m}`;
  }

  // Fuller version of the same 3 numbers, shown as a stat-grid card under
  // whichever dropdown currently has this chicken selected.
  function chickenStage3StatCard(c) {
    const s3 = c.stages[2], s2 = c.stages[1];
    return `<div class="stat-grid" style="margin-top:10px;grid-template-columns:repeat(3,1fr);">
      ${statBlock('Health', s3 ? s3.health : null)}
      ${statBlock('Attack', s3 ? s3.attackStrength : null)}
      ${statBlock('Meals to Stage 3', s2 ? s2.mealsToNext : null)}
    </div>`;
  }

  function renderMyTeamLocal() {
    const REC = window.FLOCK_RECOMMEND;

    if (!state.setup) {
      return staticCard(`
        <div class="ability">
          <div class="aname">Set up your game to build a team</div>
          <div class="atext">Tap 🎲 My Game above and answer player count, Eggspansion, and difficulty — My Team is sized to how many players you're actually playing with.</div>
        </div>`);
    }

    const n = state.setup.players;
    normalizeMyTeamSlots(n);
    const roster = DATA.chickens.filter(c => c.name).map(c => c.name).sort();

    let out = staticCard(`
      <div class="ability">
        <div class="aname">Pick your team (${n} player${n > 1 ? 's' : ''})</div>
        <div class="atext">One chicken per player — get tailored advice below as you fill each slot.</div>
      </div>
      ${state.myTeam.some(Boolean) ? `<button class="btn-secondary" id="clear-myteam" type="button" style="margin-top:10px;">Clear team</button>` : ''}`);

    out += state.myTeam.map((picked, i) => {
      const chicken = picked ? DATA.chickens.find(c => c.name === picked) : null;
      const options = roster.filter(name => name === picked || !state.myTeam.includes(name));
      return staticCard(`
        <div class="ability">
          <div class="aname">Player ${i + 1}</div>
          <select class="searchbar" data-myteam-slot="${i}" style="margin:6px 0 0 0;">
            <option value="">— choose a chicken —</option>
            ${options.map(name => `<option value="${esc(name)}" ${name === picked ? 'selected' : ''}>${esc(chickenOptionLabel(name))}</option>`).join('')}
          </select>
          ${chicken ? chickenStage3StatCard(chicken) : ''}
        </div>`, 'chicken-card');
    }).join('');

    const teamNames = state.myTeam.filter(Boolean);
    if (!teamNames.length || !REC) {
      out += `<div class="empty-state">Pick at least one chicken above to see analysis.</div>`;
      return out;
    }

    out += renderTeamAnalysis(teamNames, state.setup.difficulty, state.setup.predators.filter(Boolean));

    if (!state.setup.predators.some(Boolean)) {
      out += staticCard(`
        <div class="ability">
          <div class="aname">Know any predators yet?</div>
          <div class="atext">Add them once the board's revealed to get a suggested engagement order.</div>
        </div>`);
    }
    out += renderKnownPredatorsPicker();

    return out;
  }

  // ---------------------------------------------------------------------
  // LIVE TABLE SESSION
  // ---------------------------------------------------------------------
  // Each player picks their own chicken on their own device (wizard step
  // 2, live mode); everyone converges here. Firestore is the source of
  // truth (state.sessionData), kept in sync via a single live subscription
  // that re-renders the whole app on every update — same full-rebuild
  // model the rest of the app already uses.
  let sessionUnsub = null;
  let sessionSubscribedCode = null;

  function ensureSessionSubscription() {
    if (!state.sessionCode || !window.FLOCK_SESSION) return;
    if (sessionSubscribedCode === state.sessionCode) return;
    if (sessionUnsub) { sessionUnsub(); sessionUnsub = null; }
    sessionSubscribedCode = state.sessionCode;
    sessionUnsub = window.FLOCK_SESSION.subscribe(state.sessionCode, (data) => {
      state.sessionData = data;
      render();
    });
  }

  function sessionPredatorChecklist(data) {
    const known = normalizeSlots(data.predators, 3);
    return predatorSlotsMarkup(known, data.expansion, 'session-predator-slot');
  }

  function renderMyTeamLive() {
    const data = state.sessionData;
    let out = staticCard(`
      <div class="ability">
        <div class="aname">Session <span class="stage-badge">${esc(state.sessionCode)}</span></div>
        <div class="atext">${data ? `${data.players} player${data.players > 1 ? 's' : ''} · Eggspansion ${data.expansion ? 'On' : 'Off'} · Difficulty ${esc(data.difficulty)}` : 'Connecting…'}</div>
      </div>`);
    if (!data) return out;

    const picks = Object.values(data.picks || {});
    const pickedNames = picks.map(p => p.chicken);
    const waitingCount = Math.max(0, (data.players || 0) - picks.length);

    out += `<div class="chicken-picker" data-scroll-id="session-picks-list">`;
    out += picks.map(p => `<div class="check-row"><strong>${esc(p.name)}</strong>&nbsp;— ${esc(p.chicken)}</div>`).join('');
    if (waitingCount > 0) {
      out += Array.from({ length: waitingCount }).map(() => `<div class="check-row text-muted">Waiting for a player…</div>`).join('');
    }
    out += `</div>`;

    if (pickedNames.length) {
      out += renderTeamAnalysis(pickedNames, data.difficulty, (data.predators || []).filter(Boolean));
    } else {
      out += `<div class="empty-state">No picks yet — once someone locks in a chicken, it shows up here for everyone.</div>`;
    }

    out += `
      <div class="section-title" style="margin-top:14px;">Known predators <span class="modal-optional">(syncs to everyone)</span></div>
      ${sessionPredatorChecklist(data)}`;

    return out;
  }

  function renderCombos() {
    if (!STRAT) return `<div class="empty-state">Strategy data not loaded.</div>`;
    const q = state.search.trim().toLowerCase();
    const items = STRAT.combos.filter(c => !q || [c.title, c.synergy, ...c.chickens].join(' ').toLowerCase().includes(q));
    if (!items.length) return `<div class="empty-state">No combos match "${esc(state.search)}"</div>`;
    return items.map(c => staticCard(`
      <div class="ability">
        <div class="aname">${esc(c.title)}</div>
        ${roleChips(c.chickens)}
        <div class="atext">${esc(c.synergy)}</div>
      </div>`)).join('');
  }

  function renderStrategy() {
    const sections = [
      { key: 'chickens', label: 'Chickens' },
      { key: 'predators', label: 'Predators' },
      { key: 'weather', label: 'Weather' },
      { key: 'teams', label: 'Team Comps' },
      { key: 'myteam', label: 'My Team' },
      { key: 'squads', label: 'Archetypes' },
      { key: 'combos', label: 'Combos' },
    ];
    const active = state.strategySection || 'teams';
    const nav = `<div class="stage-tabs">${sections.map(s => `<button class="stage-tab ${s.key === active ? 'active' : ''}" data-strat="${s.key}">${esc(s.label)}</button>`).join('')}</div>`;

    let body = '';
    if (active === 'chickens') body = renderChickens();
    else if (active === 'predators') body = renderPredators();
    else if (active === 'weather') body = renderWeather();
    else if (active === 'squads') body = renderSquadArchetypes();
    else if (active === 'teams') body = renderTeamComps();
    else if (active === 'myteam') body = renderMyTeam();
    else body = renderCombos();

    const searchPlaceholders = {
      chickens: 'Search chickens & abilities…', predators: 'Search predators & effects…', weather: 'Search weather cards…',
      squads: 'Search…', combos: 'Search…', teams: 'Search team comps…',
    };
    const searchableSections = ['chickens', 'predators', 'weather', 'squads', 'combos', 'teams'];
    const rawDataSections = ['weather'];
    return {
      nav, body,
      searchable: searchableSections.includes(active),
      searchPlaceholder: searchPlaceholders[active] || 'Search…',
      showLegend: !rawDataSections.includes(active),
    };
  }

  // ---------------------------------------------------------------------
  // SETUP WIZARD
  // ---------------------------------------------------------------------
  // Step 1 mirrors actual game order: chickens are picked before any
  // predator is ever revealed, so this only asks Eggspansion/Players/
  // Difficulty. Step 2 is the card-format compare-and-pick — the moment of
  // being handed two Chicken Books and choosing one. Known predators moved
  // out entirely; see renderKnownPredatorsPicker(), used on the My Team view
  // once the board is actually set up (Team Comps stays scenario-agnostic —
  // just suggested squads for your player count/expansion/difficulty).
  function pillRow(items) {
    return `<div class="stage-tabs">${items.join('')}</div>`;
  }

  function goToStrategySection(section) {
    state.wizardOpen = false;
    state.strategySection = section;
    render();
  }

  function renderWizardStep1(d) {
    const expansionPills = [
      `<button class="stage-tab ${!d.expansion ? 'active' : ''}" data-expansion="no">No</button>`,
      `<button class="stage-tab ${d.expansion ? 'active' : ''}" data-expansion="yes">Yes</button>`,
    ];

    const playerPills = [1, 2, 3, 4, 5, 6].map(n => {
      const disabled = n === 6 && !d.expansion;
      return `<button class="stage-tab ${d.players === n ? 'active' : ''}" ${disabled ? 'disabled' : ''} data-players="${n}">${n}${disabled ? ' 🔒' : ''}</button>`;
    });

    const difficultyPills = [1, 2, 3, 4, 5, 6, 7, 8].map(n =>
      `<button class="stage-tab ${d.difficulty === n ? 'active' : ''}" data-difficulty="${n}">${n}${n === 4 ? ' (Normal)' : ''}</button>`);

    return `
      <div class="modal-backdrop" id="wizard-backdrop">
        <div class="modal-card">
          <h2>Set up your game</h2>
          <p class="modal-sub">Answer what you know before chickens are dealt — reopen this anytime from the 🎲 My Game button.</p>

          <div class="modal-field">
            <label>Eggspansion pack?</label>
            ${pillRow(expansionPills)}
          </div>

          <div class="modal-field">
            <label>Players</label>
            ${pillRow(playerPills)}
          </div>

          <div class="modal-field">
            <label>Difficulty <span class="modal-optional">(4 = Normal; 1-3 are easier, 5-8 are harder)</span></label>
            ${pillRow(difficultyPills)}
          </div>

          <div class="modal-actions-col">
            <button class="btn-primary" id="wizard-compare" type="button">Compare &amp; pick a chicken →</button>
            <div class="modal-actions">
              <button class="btn-secondary" id="wizard-skip" type="button">Skip for now</button>
              <button class="btn-secondary" id="wizard-browse" type="button">Just show suggestions</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function wireWizardStep1(d) {
    wizardRoot.querySelectorAll('[data-expansion]').forEach(el => {
      el.addEventListener('click', () => {
        d.expansion = el.dataset.expansion === 'yes';
        if (!d.expansion) {
          if (d.players === 6) d.players = 5;
          d.predators = d.predators.map(name => {
            if (!name) return name;
            const p = DATA.predators.find(x => x.name === name);
            return p && p.expansion === 'Eggspansion' ? null : name;
          });
        }
        renderWizard();
      });
    });
    wizardRoot.querySelectorAll('[data-players]').forEach(el => {
      el.addEventListener('click', () => { if (!el.disabled) { d.players = Number(el.dataset.players); renderWizard(); } });
    });
    wizardRoot.querySelectorAll('[data-difficulty]').forEach(el => {
      el.addEventListener('click', () => { d.difficulty = Number(el.dataset.difficulty); renderWizard(); });
    });
    const skipBtn = document.getElementById('wizard-skip');
    if (skipBtn) skipBtn.addEventListener('click', () => { state.wizardOpen = false; render(); });
    const browseBtn = document.getElementById('wizard-browse');
    if (browseBtn) browseBtn.addEventListener('click', () => {
      saveSetup({ ...d, predators: [...d.predators] });
      goToStrategySection('teams');
    });
    const compareBtn = document.getElementById('wizard-compare');
    if (compareBtn) compareBtn.addEventListener('click', () => {
      saveSetup({ ...d, predators: [...d.predators] });
      state.wizardStep = 1.5;
      renderWizard();
    });
    const backdrop = document.getElementById('wizard-backdrop');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { state.wizardOpen = false; render(); } });
  }

  // Step 1.5: local-only vs. live table session (Firebase-backed — see
  // session.js). Host creates a session doc and gets a join code; joiners
  // enter that code and inherit the host's expansion/players/difficulty.
  function renderWizardStep15(d) {
    const sessionReady = !!(window.FLOCK_SESSION && window.FLOCK_SESSION.isConfigured());
    return `
      <div class="modal-backdrop" id="wizard-backdrop">
        <div class="modal-card">
          <h2>How are you using this?</h2>
          <p class="modal-sub">Compare solo, or sync picks live with everyone at the table.</p>

          <div class="modal-actions-col">
            <button class="btn-primary" id="mode-local" type="button">Just this device →</button>
            <button class="btn-secondary" id="mode-host" type="button" ${sessionReady ? '' : 'disabled'}>
              Host a live session${sessionReady ? '' : ' (needs Firebase setup)'}
            </button>
            <div class="modal-field" style="margin:0;">
              <label>Join with a code</label>
              <div style="display:flex;gap:8px;">
                <input type="text" id="join-code-input" maxlength="4" placeholder="ABCD" class="searchbar" style="margin-bottom:0;text-transform:uppercase;" ${sessionReady ? '' : 'disabled'}>
                <button class="btn-secondary" id="mode-join" type="button" style="flex:0 0 90px;" ${sessionReady ? '' : 'disabled'}>Join</button>
              </div>
            </div>
          </div>
          ${state.joinError ? `<div class="note" style="color:var(--danger);margin-top:10px;">${esc(state.joinError)}</div>` : ''}
          <div class="modal-actions" style="margin-top:14px;">
            <button class="btn-secondary" id="wizard-back15" type="button">← Back</button>
          </div>
        </div>
      </div>`;
  }

  function wireWizardStep15(d) {
    const localBtn = document.getElementById('mode-local');
    if (localBtn) localBtn.addEventListener('click', () => { state.wizardStep = 2; renderWizard(); });

    const hostBtn = document.getElementById('mode-host');
    if (hostBtn) hostBtn.addEventListener('click', async () => {
      hostBtn.disabled = true; hostBtn.textContent = 'Starting session…';
      try {
        const code = await window.FLOCK_SESSION.createSession({ expansion: d.expansion, players: d.players, difficulty: d.difficulty });
        state.sessionCode = code;
        state.isHost = true;
        state.joinError = null;
        state.wizardStep = 1.6;
        renderWizard();
      } catch (err) {
        state.joinError = 'Could not start a session — check your connection.';
        renderWizard();
      }
    });

    const joinBtn = document.getElementById('mode-join');
    if (joinBtn) joinBtn.addEventListener('click', async () => {
      const input = document.getElementById('join-code-input');
      const code = (input.value || '').trim().toUpperCase();
      if (!code) return;
      joinBtn.disabled = true; joinBtn.textContent = '…';
      try {
        const session = await window.FLOCK_SESSION.joinSession(code);
        if (!session) {
          state.joinError = `No session found for code "${code}".`;
          renderWizard();
          return;
        }
        state.sessionCode = code;
        state.isHost = false;
        state.joinError = null;
        d.expansion = session.expansion;
        d.players = session.players;
        d.difficulty = session.difficulty;
        state.wizardStep = 1.6;
        renderWizard();
      } catch (err) {
        state.joinError = 'Could not join — check your connection and the code.';
        renderWizard();
      }
    });

    const backBtn = document.getElementById('wizard-back15');
    if (backBtn) backBtn.addEventListener('click', () => { state.wizardStep = 1; state.joinError = null; renderWizard(); });
    const backdrop = document.getElementById('wizard-backdrop');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { state.wizardOpen = false; render(); } });
  }

  // Step 1.6: name entry, shown once a session exists (just hosted or just
  // joined) — the last stop before comparing/picking a chicken.
  function renderWizardStep16() {
    const savedName = (() => { try { return localStorage.getItem('flockPlayerName') || ''; } catch (e) { return ''; } })();
    return `
      <div class="modal-backdrop" id="wizard-backdrop">
        <div class="modal-card">
          <h2>${state.isHost ? "You're hosting!" : 'Joined the session'}</h2>
          <p class="modal-sub">${state.isHost ? 'Share this code with everyone at the table:' : `Connected to session ${esc(state.sessionCode)}.`}</p>
          ${state.isHost ? `<div class="session-code">${esc(state.sessionCode)}</div>` : ''}
          <div class="modal-field">
            <label>Your name</label>
            <input type="text" id="player-name-input" class="searchbar" style="margin-bottom:0;" placeholder="e.g. Sam" value="${esc(savedName)}" maxlength="24">
          </div>
          <div class="modal-actions-col">
            <button class="btn-primary" id="wizard-to-compare" type="button">Compare &amp; pick a chicken →</button>
          </div>
        </div>
      </div>`;
  }

  function wireWizardStep16() {
    const btn = document.getElementById('wizard-to-compare');
    if (btn) btn.addEventListener('click', () => {
      const input = document.getElementById('player-name-input');
      const name = (input.value || '').trim() || 'Player';
      state.playerName = name;
      try { localStorage.setItem('flockPlayerName', name); } catch (e) { /* storage unavailable */ }
      state.wizardStep = 2;
      renderWizard();
    });
    const backdrop = document.getElementById('wizard-backdrop');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { state.wizardOpen = false; render(); } });
  }

  // Always-open compare card for the wizard's step 2 — distinct from the
  // browsable chicken card (no collapse header, has a pick button), but
  // shares chickenStageContent() so stat/ability rendering can't drift.
  function chickenCompareCard(c, which) {
    const key = 'wiz-' + which;
    const openStageIdx = state.openStage[key] ?? 0;
    const stageTabs = c.stages.map((s, i) => `
      <button class="stage-tab ${i === openStageIdx ? 'active' : ''}" data-key="${key}" data-stage="${i}">
        ${esc(s.label.split(' ')[0] || 'Stage ' + s.stage)}
      </button>`).join('');

    return `
      <div class="card open compare-card chicken-card">
        <div class="card-body" style="border-top:none;padding-top:14px;">
          <select class="searchbar" data-compare="${which}" style="margin-bottom:10px;">
            ${DATA.chickens.filter(x => x.name).map(x => x.name).sort().map(n => `<option value="${esc(n)}" ${n === c.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
          <div class="card-title" style="margin-bottom:6px;">
            <span class="name">${esc(c.name)}</span>
            <span class="sub">${c.breed ? esc(c.breed) : 'Breed unknown'}</span>
          </div>
          <div class="stage-tabs">${stageTabs}</div>
          ${chickenStageContent(c, openStageIdx)}
          <button class="btn-primary pick-btn" data-pick="${esc(c.name)}" type="button">This is my pick →</button>
        </div>
      </div>`;
  }

  function renderWizardStep2(d) {
    const roster = DATA.chickens.filter(c => c.name).map(c => c.name).sort();
    if (!state.compareA) state.compareA = roster[0];
    if (!state.compareB) state.compareB = roster.find(n => n !== state.compareA) || roster[1];
    const cA = DATA.chickens.find(c => c.name === state.compareA);
    const cB = DATA.chickens.find(c => c.name === state.compareB);

    return `
      <div class="modal-backdrop" id="wizard-backdrop">
        <div class="modal-card modal-card-wide">
          <h2>Compare &amp; pick your chicken</h2>
          <p class="modal-sub">You're handed two Chicken Books at the start of the game — compare them, then lock in the one you're keeping.</p>
          ${quickTakeCard(state.compareA, state.compareB)}
          <div class="compare-cards">
            ${chickenCompareCard(cA, 'a')}
            ${chickenCompareCard(cB, 'b')}
          </div>
          <div class="modal-actions" style="margin-top:14px;">
            <button class="btn-secondary" id="wizard-back" type="button">← Back</button>
          </div>
        </div>
      </div>`;
  }

  function wireWizardStep2() {
    wizardRoot.querySelectorAll('[data-compare]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.dataset.compare === 'a') state.compareA = el.value; else state.compareB = el.value;
        renderWizard();
      });
    });
    wizardRoot.querySelectorAll('.stage-tab[data-key]').forEach(el => {
      el.addEventListener('click', () => {
        state.openStage[el.dataset.key] = Number(el.dataset.stage);
        renderWizard();
      });
    });
    wizardRoot.querySelectorAll('[data-pick]').forEach(el => {
      el.addEventListener('click', async () => {
        const name = el.dataset.pick;
        if (state.sessionCode) {
          const originalText = el.textContent;
          el.disabled = true; el.textContent = 'Saving…';
          try {
            await window.FLOCK_SESSION.submitPick(state.sessionCode, state.playerName, name);
            goToStrategySection('myteam');
          } catch (err) {
            el.disabled = false; el.textContent = originalText;
          }
          return;
        }
        addToMyTeam(name);
        goToStrategySection('myteam');
      });
    });
    const backBtn = document.getElementById('wizard-back');
    if (backBtn) backBtn.addEventListener('click', () => { state.wizardStep = 1.5; renderWizard(); });
    const backdrop = document.getElementById('wizard-backdrop');
    if (backdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { state.wizardOpen = false; render(); } });
  }

  function renderWizard() {
    if (!wizardRoot) return;
    if (!state.wizardOpen || !state.wizardDraft) { wizardRoot.innerHTML = ''; return; }
    const d = state.wizardDraft;
    if (state.wizardStep === 2) {
      wizardRoot.innerHTML = renderWizardStep2(d);
      wireWizardStep2();
    } else if (state.wizardStep === 1.6) {
      wizardRoot.innerHTML = renderWizardStep16();
      wireWizardStep16();
    } else if (state.wizardStep === 1.5) {
      wizardRoot.innerHTML = renderWizardStep15(d);
      wireWizardStep15(d);
    } else {
      wizardRoot.innerHTML = renderWizardStep1(d);
      wireWizardStep1(d);
    }
  }

  // Rules is a popup over the home screen rather than a page you navigate
  // away to, so it lives in its own root (like the setup wizard) with its
  // own scoped search state instead of sharing the home page's search bar.
  function renderRulesModal() {
    if (!rulesRoot) return;
    if (!state.rulesOpen) { rulesRoot.innerHTML = ''; return; }
    const wasFocused = document.activeElement && document.activeElement.id === 'rules-search';
    const caret = wasFocused ? document.activeElement.selectionStart : null;
    rulesRoot.innerHTML = `
      <div class="modal-backdrop" id="rules-backdrop">
        <div class="modal-card modal-card-wide">
          <div class="modal-title-row">
            <h2>📜 Rules</h2>
            <button class="modal-close" id="rules-close" type="button" aria-label="Close rules">✕</button>
          </div>
          <input type="text" class="searchbar" id="rules-search" placeholder="Search rules…" value="${esc(state.rulesSearch)}">
          <div>${renderRules()}</div>
        </div>
      </div>`;

    const backdrop = document.getElementById('rules-backdrop');
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { state.rulesOpen = false; renderRulesModal(); }
    });
    document.getElementById('rules-close').addEventListener('click', () => {
      state.rulesOpen = false;
      renderRulesModal();
    });
    const search = document.getElementById('rules-search');
    search.addEventListener('input', (e) => { state.rulesSearch = e.target.value; renderRulesModal(); });
    if (wasFocused) {
      search.focus({ preventScroll: true });
      search.setSelectionRange(caret, caret);
    }
  }

  // ---------------------------------------------------------------------
  function render() {
    const wasSearchFocused = document.activeElement && document.activeElement.id === 'search';
    // Scrollable pickers (chicken/predator checklists) get rebuilt from scratch
    // on every state change, which would otherwise snap them back to the top
    // every time a single checkbox is toggled — save/restore their scroll offset
    // across the rebuild instead.
    const scrollPositions = {};
    appEl.querySelectorAll('[data-scroll-id]').forEach(el => {
      scrollPositions[el.dataset.scrollId] = el.scrollTop;
    });
    updateProgress();

    const { nav, body, searchable, searchPlaceholder, showLegend } = renderStrategy();
    const html = `
      ${STRAT && showLegend ? `<div class="legend">${esc(STRAT.legend)}</div>` : ''}
      ${nav}
      ${searchable ? `<input type="text" class="searchbar" id="search" placeholder="${searchPlaceholder}" value="${esc(state.search)}">` : ''}
      <div id="list">${body}</div>`;

    appEl.innerHTML = html;

    appEl.querySelectorAll('[data-scroll-id]').forEach(el => {
      const pos = scrollPositions[el.dataset.scrollId];
      if (pos) el.scrollTop = pos;
    });

    const search = document.getElementById('search');
    if (search) {
      search.addEventListener('input', (e) => { state.search = e.target.value; render(); });
      if (wasSearchFocused) {
        search.focus({ preventScroll: true });
        search.setSelectionRange(state.search.length, state.search.length);
      }
    }

    appEl.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.toggle;
        if (state.openCards.has(key)) state.openCards.delete(key);
        else state.openCards.add(key);
        render();
      });
    });

    appEl.querySelectorAll('.stage-tab').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.dataset.strat) {
          state.strategySection = el.dataset.strat;
          state.search = '';
          render();
          return;
        }
        const key = el.dataset.key;
        state.openStage[key] = Number(el.dataset.stage);
        render();
      });
    });

    appEl.querySelectorAll('[data-myteam-slot]').forEach(el => {
      el.addEventListener('change', () => {
        const i = Number(el.dataset.myteamSlot);
        state.myTeam[i] = el.value || null;
        render();
      });
    });

    const clearMyTeamBtn = document.getElementById('clear-myteam');
    if (clearMyTeamBtn) {
      clearMyTeamBtn.addEventListener('click', () => {
        state.myTeam = state.myTeam.map(() => null);
        render();
      });
    }

    appEl.querySelectorAll('[data-known-predator-slot]').forEach(el => {
      el.addEventListener('change', () => {
        if (!state.setup) return;
        const i = Number(el.dataset.knownPredatorSlot);
        const predators = normalizeSlots(state.setup.predators, 3);
        predators[i] = el.value || null;
        saveSetup({ ...state.setup, predators });
        render();
      });
    });

    appEl.querySelectorAll('[data-session-predator-slot]').forEach(el => {
      el.addEventListener('change', () => {
        if (!state.sessionCode || !state.sessionData || !window.FLOCK_SESSION) return;
        const i = Number(el.dataset.sessionPredatorSlot);
        const predators = normalizeSlots(state.sessionData.predators, 3);
        predators[i] = el.value || null;
        window.FLOCK_SESSION.setKnownPredators(state.sessionCode, predators);
      });
    });

    renderWizard();
    renderRulesModal();
  }

  state.setup = loadSetup();
  state.wizardDraft = state.setup ? { ...state.setup, predators: [...state.setup.predators] } : defaultDraft();
  state.wizardStep = 1;
  if (!state.setup) state.wizardOpen = true;
  render();
})();
