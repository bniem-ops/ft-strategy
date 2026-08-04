// HAND-AUTHORED, like strategy.js. This is the recommendation ENGINE: a
// curated pool of synergy-driven "archetype squads" plus logic that filters
// and scores them against a player's actual setup (player count, expansion
// on/off, difficulty, known predators) or a custom hand-picked team.
//
// Design note: these are combinatorial inputs (1-6 players x expansion x
// 7 difficulty levels x arbitrary predator sets x arbitrary custom teams),
// so this is deliberately NOT a lookup table of pre-written text per
// combination — it's archetype data + functions that compute a result.

(function () {
  // Each archetype's `core` is an ordered wishlist: the most thematically
  // essential picks first, optional flex picks after. To size a squad for N
  // players: filter core to whatever's allowed (expansion on/off), then
  // take the first N. If fewer than N remain, the archetype can't fully
  // staff that player count and is skipped for that query.
  // `resilience` is a rough read on how well an archetype holds up against
  // a scarier Boss / wider predator pool at high difficulty: 'high' means
  // it has a genuine tank (Atilla the Hen) or broad role coverage; 'low'
  // means it leans on a gimmick with no dedicated damage-soak. Used to
  // reorder (not remove) results at difficulty 4+.
  const ARCHETYPES = [
    // ---- Solo (1 player) ----
    { id: 'solo-attrition', title: 'Attrition Fighter', tag: 'Solo', resilience: 'medium',
      core: ['Wyatt Chirp'], minPlayers: 1, maxPlayers: 1,
      blurb: 'Payback backfills a missed production roll with a free meal, and Thick Feathers shaves down every return hit — a self-sufficient grind pick that needs no teammates to function.',
      cardTip: 'Roly Poly\'s permanent Reward (when attacking, 4-6 reduces the Predator\'s return attack by 1) stacks with a grinder who\'s always trading blows solo — worth prioritizing as a kill target early.' },
    { id: 'solo-weatherproof', title: 'Weather-Proof Grinder', tag: 'Solo', resilience: 'medium',
      core: ['Cumberbill Rockefeather'], minPlayers: 1, maxPlayers: 1,
      blurb: 'By Stage 3 (Dandy) he\'s immune to ALL negative weather — solo play means you can\'t split weather risk across teammates, so removing the whole threat axis single-handedly is huge.',
      cardTip: 'Lunar Moth\'s Reward (ignore weather effects until the next card is drawn) covers the gap before you\'ve leveled to Stage 3\'s full immunity — a strong early kill while you\'re still a Chick or Pullet/Cockerel.' },
    { id: 'solo-egg-loop', title: 'Egg Economy Loop', tag: 'Solo', resilience: 'medium', requiresExpansion: true,
      core: ['Princess Layer'], minPlayers: 1, maxPlayers: 1,
      blurb: 'Doubles her own Lay Egg yield, funds Extra Action refreshes, and spends eggs to shrug off damage — a fully closed-loop kit with no "nearby teammate" abilities going to waste solo.',
      cardTip: 'Wild Grain has 0 health — a free kill — and its Reward is straight food, pure value for a build that\'s already engineered around resource surplus.' },

    // ---- Squads (2+) ----
    { id: 'balanced-core', title: 'Balanced Core', tag: 'All-Rounder', resilience: 'high',
      core: ['Atilla the Hen', 'Beowing', 'Princess Layer', 'General Tso', 'Shellock Holmes', 'Aracorn, Heir of Condor', 'Wingston Coophill', 'Cluck Norris'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'One tank, one universal buffer, one economy/control engine, then utility and a protected striker as the group grows. The safe, cohesive default if you don\'t want to lean into a theme.',
      cardTip: 'No one in this core is a dedicated card hoarder — Large Spider\'s permanent Reward (no Bonus Card hand limit) patches that gap for whoever lands the kill.' },

    { id: 'grub-guild', title: 'Grub Guild', tag: 'Grub Synergy', resilience: 'high',
      core: ['Shellock Holmes', 'Eggatha Christie', 'Atilla the Hen', 'Beowing', 'J.R.R. Yolkien', 'Princess Layer'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'Shellock Holmes strikes either Grub from anywhere and turns Grub hearts into a damage buffer; Eggatha\'s Tomb Raider keeps pressuring discarded Grubs. Doubles as prep work for a Sheriff of Rottingham fight, whose return attack scales off Grub deck health.',
      cardTip: 'This is the one archetype built to actually clear both Grub decks efficiently — prioritize Dragonfly (Reward: draw 3 Bonus Cards, keep 2, give 1 to a teammate) and Large Spider (permanent no-hand-limit); both compound with Shellock Holmes and J.R.R. Yolkien\'s card-heavy kits.' },

    { id: 'egg-economy', title: 'Egg Economy Engine', tag: 'Economy', resilience: 'low',
      core: ['General Tso', 'Annie Yolkley', 'Cluckleberry Finn', 'Beowing', 'Princess Layer', 'J.R.R. Yolkien'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'Annie Yolkley and Cluckleberry Finn overproduce and inflate the value of eggs; General Tso (or J.R.R. Yolkien) spends the surplus to fix bad die rolls on demand. A reliability engine built on economic surplus rather than raw stats.',
      cardTip: 'Beehive and Centipede both Reward +2 meals or +3 food on a kill — direct fuel for a team that\'s already converting surplus into reliability.' },

    { id: 'universal-buff', title: 'Universal Buff Core', tag: 'Support', resilience: 'high',
      core: ['Beowing', 'Atilla the Hen', 'General Tso', 'Madam Chickovsky', 'Wyatt Chirp', 'Cluck Norris'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'Battle Cry boosts every nearby teammate\'s dice on ANY roll — not just attacks — while weakening the Predator\'s. Build around Beowing and stack high-attack, roll-dependent teammates who benefit most.',
      cardTip: 'Beowing already buffs every nearby roll — a Bonus Card that lets you reroll (your own or a teammate\'s) stacks on top of that boosted result instead of just replacing bad luck, so hang onto one if you draw it.' },

    { id: 'weather-fortress', title: 'Weather-Immune Fortress', tag: 'Weather Denial', resilience: 'medium',
      core: ['Cumberbill Rockefeather', 'Madam Chickovsky', 'Eggatha Christie', 'Chickira', 'Aracorn, Heir of Condor', 'Beowing'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'Stacks weather immunities (Cumberbill goes fully immune by Stage 3; Madam Chickovsky and Eggatha cover specific cards) plus Chickira\'s ability to force a re-draw on whatever\'s left. Denies an entire threat category rather than out-fighting it.',
      cardTip: 'Lunar Moth\'s Reward and the Bonus Card that grants one turn of weather immunity both reinforce a team that\'s already denying weather as a threat — low priority to spend on this team, since you have redundancy already; save them for a teammate outside this core instead.' },

    { id: 'passive-sustain', title: 'Passive Sustain', tag: 'Sustain', resilience: 'medium',
      core: ['Beowing', 'Chickira', 'Madam Chickovsky', 'Wyatt Chirp', 'Cumberbill Rockefeather', 'Shellock Holmes'],
      minPlayers: 2, maxPlayers: 6,
      caution: 'No dedicated Damage role in the core lineup — plan on spending real actions/food on Attack rather than leaning on a big hitter\'s kit.',
      blurb: 'Three different passive heal triggers stacked on one team — Beowing\'s Berserker, Chickira\'s Shake it Off, and Madam Chickovsky\'s Ladies\' Aid — so the squad barely needs to spend an action on Heal at all. Wyatt Chirp adds a real Tank and Shellock Holmes covers Grub Control, the two roles the core trio is missing on its own.',
      cardTip: 'Earthworm\'s Reward (heal up to 3 of a teammate\'s health) is a free top-off that fits right in on a team already leaning on passive heal triggers instead of spending actions on Heal.' },

    { id: 'tank-glasscannon', title: 'Tank & Glass Cannon', tag: 'Tank + Damage', resilience: 'high',
      core: ['Atilla the Hen', 'Wingston Coophill', 'Broods Lee', 'Cluck Norris', 'Beowing', 'Shellock Holmes'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'Atilla intercepts damage meant for your fragile pieces and gets paid 2 eggs every time he does. Wingston punches above his stat line if protected; Broods Lee gets stronger the longer the team stays wounded.',
      cardTip: 'Wasp Swarm\'s Reward — dodge the attack, then the Predator\'s own base return attack gets dealt back to it — is a big tempo swing worth the risk for a team already leaning into aggressive trades.' },

    { id: 'mobility-recon', title: 'Mobility & Recon', tag: 'Utility', resilience: 'low',
      core: ['Cumberbill Rockefeather', 'Madam Chickovsky', 'Wingston Coophill', 'Shellock Holmes', 'Aracorn, Heir of Condor'],
      minPlayers: 2, maxPlayers: 5,
      blurb: 'Built around board coverage instead of raw combat: free movement, full Outside-action flexibility, and grub strikes from any location. Good for a team that wants to split up and multitask rather than deathball one location.',
      cardTip: 'Garden Snail\'s permanent Reward (tag along whenever a teammate moves) is a natural fit for a team already built around covering ground together instead of planting in one spot.' },

    { id: 'card-control', title: 'Card Control Engine', tag: 'Control', resilience: 'low',
      core: ['General Tso', 'Shellock Holmes', 'Beowing', 'J.R.R. Yolkien', 'Cluck Norris', 'Princess Layer'],
      minPlayers: 2, maxPlayers: 6,
      caution: 'Hard-countered by Chicksune, whose Stage 1 effect makes the whole team immune to Bonus Card effects — this archetype goes quiet against her specifically.',
      blurb: 'Draw-heavy, card-selection-heavy kit (Foresight, a bigger hand, egg-funded re-rolls) for players who like maximizing information and mitigating bad luck.',
      cardTip: 'Mosquitoes\' Reward (+2 Bonus Cards) is close to a must-kill for a team already built around maximizing card selection and information.' },

    { id: 'glass-cannon-gambit', title: 'Glass Cannon Gambit', tag: 'High Variance', resilience: 'low',
      core: ['Cluck Norris', 'Broods Lee', 'Wingston Coophill', 'Chickira', 'General Tso', 'Cluckleberry Finn'],
      minPlayers: 2, maxPlayers: 6,
      blurb: 'No dedicated tank — everyone leans into taking damage for resources or buffs. Higher skill ceiling and higher variance than the other archetypes, but a blast if your group likes risk over reliability.',
      cardTip: 'This archetype already treats its own health as a resource — Bonus Cards that trade -2 health for eggs, meals, or enemy damage are pure upside here instead of the risk they\'d be on a more defensive team.' },
  ];

  const RESILIENCE_RANK = { high: 0, medium: 1, low: 2 };

  function chickenExpansionMap() {
    const map = {};
    ((window.FLOCK_DATA && window.FLOCK_DATA.chickens) || []).forEach(c => { if (c.name) map[c.name] = c.expansion; });
    return map;
  }

  function rosterNames() {
    return ((window.FLOCK_DATA && window.FLOCK_DATA.chickens) || []).map(c => c.name).filter(Boolean);
  }

  // Which archetype-core entries are actually pickable given expansion on/off.
  function availableCore(archetype, expansionOn) {
    const tiers = chickenExpansionMap();
    return archetype.core.filter(name => expansionOn || tiers[name] !== 'Eggspansion');
  }

  // Names of the archetype's chickens that got excluded because expansion is off.
  function lockedByExpansion(archetype, expansionOn) {
    if (expansionOn) return [];
    const tiers = chickenExpansionMap();
    return archetype.core.filter(name => tiers[name] === 'Eggspansion');
  }

  // Substring-match a roster name inside free text (used for both combo
  // "chickens" entries and predator-guide "counters" entries, which are
  // written as prose like "Annie Yolkley or Princess Layer").
  function namesIn(text, roster) {
    return roster.filter(n => text.includes(n));
  }

  function suggestTeams({ players, expansion, difficulty, predators }) {
    const roster = rosterNames();
    const N = Math.max(1, Math.min(6, Number(players) || 1));
    const d = Number(difficulty) || 4;
    // Difficulty 4 is Normal (no modifiers); 1-3 are easier than Normal;
    // real extra difficulty (Boss/predator randomization) only starts at
    // 5+. Reorder toward higher-resilience archetypes from there instead
    // of the curated default order. This re-prioritizes, it never removes
    // an archetype — a fragile pick is still shown, just lower down, with
    // a caution note attached.
    const reorderByResilience = d >= 5;

    // Shows every archetype regardless of player count — min/maxPlayers no
    // longer excludes anything here (that distinction still lives on the
    // Archetypes tab's player-range text). Only a genuinely empty core
    // (nothing available under the current expansion setting) drops a card.
    let viable = ARCHETYPES.map(a => {
      const avail = availableCore(a, expansion);
      return { archetype: a, avail, locked: lockedByExpansion(a, expansion) };
    }).filter(x => x.avail.length > 0);

    if (reorderByResilience) {
      viable = [...viable].sort((x, y) => RESILIENCE_RANK[x.archetype.resilience] - RESILIENCE_RANK[y.archetype.resilience]);
    }

    const results = viable.map(({ archetype, avail, locked }) => {
      const squad = avail.slice(0, N);
      const covers = (predators || []).filter(predName => {
        const guide = (window.FLOCK_STRATEGY.predatorGuide || []).find(p => p.predator === predName);
        if (!guide) return false;
        return guide.counters.some(c => namesIn(c.chicken, squad).length > 0);
      });
      let caution = archetype.caution || null;
      if (d >= 5 && archetype.resilience === 'low') {
        const riskNote = `No dedicated tank — riskier at difficulty ${d}, where the Boss and/or predator pool is randomized to a tougher set. Consider designating your highest-health pick to soak damage.`;
        caution = caution ? `${caution} ${riskNote}` : riskNote;
      }
      return {
        id: archetype.id, title: archetype.title, tag: archetype.tag,
        blurb: archetype.blurb, caution, cardTip: archetype.cardTip || null,
        squad, covers,
        lockedCount: locked.length,
      };
    });

    return { results };
  }

  // --- Custom team analysis ---------------------------------------------
  // Best-fit named archetype for an arbitrary hand-picked team — not a
  // strict requirement (real teams rarely hit every core pick), just
  // "closest neighbor" by core-list overlap. Scoped to archetypes actually
  // sized for this many players, so a 1-chicken solo archetype can't show a
  // misleading 100% fit against an unrelated 4-player squad.
  function detectArchetype(teamNames) {
    const N = teamNames.length;
    if (!N) return null;
    const candidates = ARCHETYPES.filter(a => N >= a.minPlayers && N <= a.maxPlayers);
    const scored = candidates.map(a => {
      const matched = a.core.filter(name => teamNames.includes(name));
      return { archetype: a, matched, fit: matched.length / a.core.length };
    }).filter(s => s.matched.length > 0);
    if (!scored.length) return null;
    scored.sort((x, y) => y.fit - x.fit || y.matched.length - x.matched.length);
    const top = scored[0];
    return {
      id: top.archetype.id, title: top.archetype.title, tag: top.archetype.tag,
      matched: top.matched, total: top.archetype.core.length,
      cardTip: top.archetype.cardTip || null,
    };
  }

  function gapNote(gaps, difficulty) {
    if (!gaps.length) return 'Solid coverage across tank, economy, support, control, and damage.';
    const d = Number(difficulty) || 4;
    if (gaps.includes('Tank') && d >= 5) {
      return `No dedicated Tank on this team — a real risk at difficulty ${d}, where the Boss and/or predator pool is randomized to a tougher set. Designate whoever has the most health to absorb hits, or rethink the pick if you have the option.`;
    }
    return `No dedicated ${gaps.join(', ')} on this team — plan around the gap rather than relying on a specialist for it.`;
  }

  function analyzeTeam(teamNames, difficulty) {
    const roster = rosterNames();
    const arch = window.FLOCK_STRATEGY.archetypes || [];
    const picked = arch.filter(a => teamNames.includes(a.name));

    const roleCounts = {};
    picked.forEach(a => a.roles.forEach(r => { roleCounts[r] = (roleCounts[r] || 0) + 1; }));

    const KEY_ROLES = ['Tank', 'Economy', 'Support', 'Control', 'Damage', 'Utility'];
    const gaps = KEY_ROLES.filter(r => !roleCounts[r]);
    const gapMessage = gapNote(gaps, difficulty);

    const archetypeMatch = detectArchetype(teamNames);

    const combos = (window.FLOCK_STRATEGY.combos || []).map(combo => {
      const entries = combo.chickens.map(e => namesIn(e, roster)).filter(names => names.length > 0);
      if (!entries.length) return null;
      // Per slot, which of ITS matched roster names are actually on this team —
      // e.g. a "General Tso or J.R.R. Yolkien" slot only counts the one you picked.
      const matchedPerSlot = entries.map(names => names.filter(n => teamNames.includes(n)));
      const satisfiedSlots = matchedPerSlot.filter(names => names.length > 0);
      if (!satisfiedSlots.length) return null;
      const matchedChickens = [...new Set(matchedPerSlot.flat())];
      const satisfiedCount = satisfiedSlots.length;
      const totalSlots = entries.length;
      const status = satisfiedCount === totalSlots ? 'active' : 'partial';
      // Informational only — doesn't affect sorting/priority anywhere, just
      // lets the UI note when a detected synergy also happens to be part of
      // this team's closest-matching named archetype.
      const tiesToArchetype = !!(archetypeMatch && matchedChickens.some(n => archetypeMatch.matched.includes(n)));
      return { ...combo, status, satisfiedCount, totalSlots, matchedChickens, tiesToArchetype };
    }).filter(Boolean);

    // Leveling pace: sum of "meals to reach next stage" across stage 1 & 2
    // for each team member = total meals needed to fully level that bird.
    // Raw cost isn't the whole story though — a chicken whose kit is part of
    // a detected synergy is worth leveling ahead of a cheaper bench-warmer,
    // since it's their Stage 2/3 ability that actually realizes the combo.
    // An ACTIVE combo (every slot already filled on this team) outranks a
    // PARTIAL one (still missing a teammate) — rushing to level your half of
    // a combo you can't trigger yet shouldn't outrank a cheaper, unattached
    // pick just because a matching combo exists on paper.
    const comboTitlesByChicken = {};
    const activeComboByChicken = {};
    combos.forEach(c => {
      (c.matchedChickens || []).forEach(name => {
        (comboTitlesByChicken[name] = comboTitlesByChicken[name] || []).push(c.title);
        if (c.status === 'active') activeComboByChicken[name] = true;
      });
    });

    const dataChickens = (window.FLOCK_DATA && window.FLOCK_DATA.chickens) || [];
    const pace = teamNames.map(name => {
      const c = dataChickens.find(x => x.name === name);
      if (!c) return null;
      const total = c.stages.slice(0, 2).reduce((sum, s) => {
        const n = parseInt(s.mealsToNext, 10);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      return total ? { name, total, comboTitles: comboTitlesByChicken[name] || [], comboActive: !!activeComboByChicken[name] } : null;
    }).filter(Boolean);
    pace.sort((a, b) => {
      const rank = p => (p.comboActive ? 0 : (p.comboTitles.length ? 1 : 2));
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.total - b.total;
    });

    const grubPickers = picked.filter(a => a.roles.includes('Grub Control')).map(a => a.name);

    return { picked, gaps, gapMessage, archetypeMatch, combos, pace, grubPickers };
  }

  function predatorPriority(teamNames, predatorNames) {
    const roster = rosterNames();
    return (predatorNames || []).map(predName => {
      const guide = (window.FLOCK_STRATEGY.predatorGuide || []).find(p => p.predator === predName);
      if (!guide) return { predator: predName, favorable: false, guide: null };
      const matchedCounters = guide.counters.filter(c => namesIn(c.chicken, roster).some(n => teamNames.includes(n)));
      return { predator: predName, favorable: matchedCounters.length > 0, matchedCounters, guide };
    }).sort((a, b) => (a.favorable === b.favorable) ? 0 : (a.favorable ? -1 : 1));
    // favorable (engage early) sorted first, unfavorable (engage later) last
  }

  window.FLOCK_RECOMMEND = { ARCHETYPES, suggestTeams, analyzeTeam, predatorPriority, namesIn, rosterNames };
})();
