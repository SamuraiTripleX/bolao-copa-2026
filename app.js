(function () {
  "use strict";

  const STORAGE_KEY = "bolao-copa-2026:v1";
  const CUTOFF_MINUTES = 5;
  const fallbackCountries = [
    { code: "BRA", short_name: "Brasil" },
    { code: "FRA", short_name: "Franca" },
    { code: "ARG", short_name: "Argentina" },
    { code: "GER", short_name: "Alemanha" },
    { code: "USA", short_name: "EUA" },
    { code: "MEX", short_name: "Mexico" },
    { code: "POR", short_name: "Portugal" },
    { code: "ESP", short_name: "Espanha" }
  ];
  const exoticBonus = new Map([
    ["1 x 1", 0], ["1 x 0", 0], ["0 x 0", 0], ["2 x 1", 0],
    ["2 x 0", 1], ["2 x 2", 1],
    ["3 x 1", 2], ["3 x 0", 2], ["3 x 2", 2],
    ["4 x 0", 3], ["4 x 1", 3], ["3 x 3", 3],
    ["4 x 2", 4], ["5 x 0", 4], ["5 x 1", 4],
    ["4 x 3", 5], ["6 x 0", 5], ["5 x 2", 5], ["6 x 1", 5],
    ["7 x 0", 5], ["4 x 4", 5], ["5 x 3", 5], ["6 x 2", 5],
    ["7 x 1", 5], ["8 x 0", 5], ["9 x 0", 5], ["8 x 1", 5],
    ["5 x 4", 5], ["7 x 2", 5], ["6 x 3", 5]
  ]);

  const state = {
    mode: "local",
    client: null,
    session: null,
    countries: new Map(),
    games: [],
    guesses: [],
    extraGuess: null,
    extraGuesses: [],
    extrasLoadError: "",
    fixtureSource: "exemplo",
    profile: { id: "", name: "", isAdmin: false },
    expandedGames: new Set(),
    deadlineTimer: null,
    bootstrapped: false,
    filters: { phase: "todos", status: "todos" }
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(handleFatalError);
  });

  async function init() {
    bindElements();
    bindEvents();
    loadLocalState();
    await configureSupabase();
    renderSession();
    await loadCountries();
    await loadGames();
    await loadGuesses({ silent: true });
    await loadExtraGuesses({ silent: true });
    activateView(canUseProfile() ? "palpites" : "login");
    state.bootstrapped = true;
    render();
    scheduleDeadlineWatcher();
  }

  function bindElements() {
    const ids = [
      "connectionStatus", "loginTab", "authForm", "authName", "authInvite", "signOutButton",
      "totalGames", "savedGuesses", "openGames", "finishedGames", "nextGame",
      "fixtureSource", "phaseFilter", "statusFilter", "gamesList",
      "rankingList", "adminTab", "adminGamesList", "extrasForm", "extraChampion",
      "extraRunnerUp", "extraSemi3", "extraSemi4", "extrasPreview", "extrasStatus", "toast"
    ];

    ids.forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => activateView(button.dataset.view));
    });

    els.authForm?.addEventListener("submit", handleAuthSubmit);
    els.signOutButton?.addEventListener("click", handleSignOut);
    els.phaseFilter?.addEventListener("change", () => {
      state.filters.phase = els.phaseFilter.value;
      renderGames();
    });
    els.statusFilter?.addEventListener("change", () => {
      state.filters.status = els.statusFilter.value;
      renderGames();
    });

    els.gamesList?.addEventListener("submit", handleGuessSubmit);
    els.gamesList?.addEventListener("click", handleGamesListClick);
    els.adminGamesList?.addEventListener("submit", handleResultSubmit);
    els.extrasForm?.addEventListener("submit", handleExtrasSubmit);
    [els.extraChampion, els.extraRunnerUp, els.extraSemi3, els.extraSemi4].forEach((select) => {
      select?.addEventListener("change", renderExtras);
    });
  }

  function handleFatalError(error) {
    console.error(error);
    if (els.connectionStatus) {
      els.connectionStatus.textContent = "Erro ao carregar. Atualize a página.";
    }
    showToast("Erro ao carregar o bolão.");
  }

  function activateView(viewName) {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === viewName);
    });
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("is-active", view.id === `view-${viewName}`);
    });
  }

  async function configureSupabase() {
    const config = window.BOLAO_SUPABASE || {};
    const key = config.publishableKey || config.anonKey || "";
    const enabled = Boolean(config.enabled && config.url && key && window.supabase);

    if (!enabled) {
      state.mode = "local";
      return;
    }

    state.mode = "supabase";
    state.client = window.supabase.createClient(config.url, key);

    const { data } = await state.client.auth.getSession();
    state.session = data.session || null;

    state.client.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      await loadProfile();
      await loadGuesses({ silent: true });
      await loadExtraGuesses({ silent: true });

      if (state.bootstrapped) {
        if (canUseProfile() && document.getElementById("view-login")?.classList.contains("is-active")) {
          activateView("palpites");
        }
        render();
      }
    });

    await loadProfile();
  }

  function loadLocalState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      state.profile = saved.profile || state.profile;
      state.guesses = Array.isArray(saved.guesses) ? saved.guesses : [];
      state.extraGuess = saved.extraGuess || null;
      state.extraGuesses = state.extraGuess ? [state.extraGuess] : [];
    } catch (_error) {
      state.profile = { id: "", name: "", isAdmin: false };
      state.guesses = [];
      state.extraGuess = null;
      state.extraGuesses = [];
    }
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      profile: state.profile,
      guesses: state.guesses,
      extraGuess: state.extraGuess
    }));
  }

  async function loadCountries() {
    const data = await loadJson("paises.json", { countries: fallbackCountries });
    const countries = Array.isArray(data.countries) ? data.countries : fallbackCountries;
    state.countries = new Map(countries.map((country) => [country.code, country]));
  }

  async function loadGames() {
    if (state.mode === "supabase") {
      const { data, error } = await state.client
        .from("jogos")
        .select("*")
        .order("inicio", { ascending: true });

      state.fixtureSource = "supabase";

      if (error) {
        console.error(error);
        state.games = [];
        showToast(`Não consegui carregar jogos: ${shortError(error)}`);
        return false;
      }

      state.games = Array.isArray(data) ? data.map(mapSupabaseGame) : [];
      return true;
    }

    const data = await loadJson("jogos.json", { games: [] });
    state.games = Array.isArray(data.games) ? data.games.map(mapJsonGame) : [];
    state.fixtureSource = data.source || "arquivo";
    return true;
  }

  async function loadGuesses(options = {}) {
    if (state.mode !== "supabase" || !state.session || !state.profile.id) {
      if (state.mode === "supabase") {
        state.guesses = [];
      }
      return true;
    }

    const [visibleResult, allVisibleResult, ownResult] = await Promise.all([
      state.client.rpc("palpites_visiveis"),
      state.client
        .from("palpites")
        .select("id,jogo_id,participante_id,gols_a,gols_b,classificado_code,enviado_em,updated_at,participantes(nome)")
        .order("updated_at", { ascending: false }),
      state.client
        .from("palpites")
        .select("id,jogo_id,participante_id,gols_a,gols_b,classificado_code,enviado_em,updated_at")
        .eq("participante_id", state.profile.id)
    ]);

    const guesses = [];
    let loadedAnything = false;

    if (visibleResult.error) {
      console.error(visibleResult.error);
    } else {
      loadedAnything = true;
      guesses.push(...(visibleResult.data || []).map((guess) => mapGuessRow(guess, guess.participante_nome)));
    }

    if (allVisibleResult.error) {
      console.error(allVisibleResult.error);
    } else {
      loadedAnything = true;
      guesses.push(...(allVisibleResult.data || []).map((guess) => mapGuessRow(guess, guess.participantes?.nome)));
    }

    if (ownResult.error) {
      console.error(ownResult.error);
    } else {
      loadedAnything = true;
      guesses.push(...(ownResult.data || []).map((guess) => mapGuessRow(guess, state.profile.name)));
    }

    if (!loadedAnything) {
      if (!options.silent) {
        showToast(`Não consegui carregar palpites: ${shortError(visibleResult.error || allVisibleResult.error || ownResult.error)}`);
      }
      return false;
    }

    state.guesses = mergeGuessRows(guesses);
    return true;
  }

  async function loadExtraGuesses(options = {}) {
    state.extrasLoadError = "";

    if (state.mode !== "supabase" || !state.session || !state.profile.id) {
      if (state.mode === "supabase") {
        state.extraGuess = null;
        state.extraGuesses = [];
      }
      return true;
    }

    const [visibleResult, ownResult] = await Promise.all([
      state.client.rpc("palpites_extras_visiveis"),
      state.client
        .from("palpites_extras")
        .select("id,participante_id,campeao_code,vice_code,semifinalista_3_code,semifinalista_4_code,updated_at")
        .eq("participante_id", state.profile.id)
        .maybeSingle()
    ]);

    const extras = [];
    let loadedAnything = false;

    if (visibleResult.error) {
      console.error(visibleResult.error);
    } else {
      loadedAnything = true;
      extras.push(...(visibleResult.data || []).map((row) => mapExtraGuessRow(row, row.participante_nome)));
    }

    if (ownResult.error) {
      console.error(ownResult.error);
    } else if (ownResult.data) {
      loadedAnything = true;
      extras.push(mapExtraGuessRow(ownResult.data, state.profile.name));
    }

    if (!loadedAnything) {
      state.extraGuess = null;
      state.extraGuesses = [];
      state.extrasLoadError = shortError(visibleResult.error || ownResult.error);
      if (!options.silent) {
        showToast(`NÃ£o consegui carregar extras: ${state.extrasLoadError}`);
      }
      return false;
    }

    state.extraGuesses = mergeExtraGuessRows(extras);
    state.extraGuess = state.extraGuesses.find((extra) => extra.participantId === state.profile.id) || null;
    return true;
  }

  function mapGuessRow(guess, participantName) {
    return {
      id: guess.id,
      gameId: guess.jogo_id,
      participantId: guess.participante_id,
      goalsA: guess.gols_a,
      goalsB: guess.gols_b,
      qualifiedCode: guess.classificado_code,
      updatedAt: guess.updated_at,
      participantName: participantName || "Participante"
    };
  }

  function mergeGuessRows(guesses) {
    const rows = new Map();
    guesses.forEach((guess) => {
      const key = guessKey(guess);
      const current = rows.get(key);
      rows.set(key, mergeGuessData(current, guess));
    });
    return [...rows.values()];
  }

  function mergeGuessIntoState(guess) {
    state.guesses = mergeGuessRows([...state.guesses, guess]);
  }

  function mergeGuessData(current, next) {
    if (!current) {
      return next;
    }

    if (hasRealParticipantName(current) && !hasRealParticipantName(next)) {
      return { ...next, participantName: current.participantName };
    }

    return next;
  }

  function guessKey(guess) {
    return guess.id || `${guess.participantId}:${guess.gameId}`;
  }

  function hasRealParticipantName(guess) {
    return Boolean(guess?.participantName && guess.participantName !== "Participante");
  }

  function mapExtraGuessRow(extra, participantName) {
    return {
      id: extra.id,
      participantId: extra.participante_id,
      participantName: participantName || "Participante",
      championCode: extra.campeao_code,
      runnerUpCode: extra.vice_code,
      semifinalist3Code: extra.semifinalista_3_code,
      semifinalist4Code: extra.semifinalista_4_code,
      updatedAt: extra.updated_at
    };
  }

  function mergeExtraGuessRows(extras) {
    const rows = new Map();
    extras.forEach((extra) => {
      const key = extra.participantId || extra.id;
      const current = rows.get(key);
      rows.set(key, mergeExtraGuessData(current, extra));
    });
    return [...rows.values()];
  }

  function mergeExtraGuessData(current, next) {
    if (!current) {
      return next;
    }

    if (hasRealParticipantName(current) && !hasRealParticipantName(next)) {
      return { ...next, participantName: current.participantName };
    }

    return next;
  }

  async function loadProfile() {
    if (state.mode !== "supabase" || !state.session) {
      if (state.mode === "supabase") {
        state.profile = { id: "", name: "", isAdmin: false };
      }
      return;
    }

    const { data, error } = await state.client
      .from("participante_dispositivos")
      .select("participante_id,participantes(nome,is_admin)")
      .eq("auth_user_id", state.session.user.id)
      .maybeSingle();

    if (!error && data) {
      state.profile = {
        id: data.participante_id || "",
        name: data.participantes?.nome || "",
        isAdmin: Boolean(data.participantes?.is_admin)
      };
      return;
    }

    state.profile = { id: "", name: "", isAdmin: false };
  }

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (_error) {
      return fallback;
    }
  }

  function mapJsonGame(game) {
    return {
      id: game.id,
      code: game.codigo || game.id,
      stage: game.fase || "Fase de grupos",
      round: game.rodada || "",
      startsAt: game.inicio,
      teamA: game.time_a_code,
      teamB: game.time_b_code,
      multiplier: Number(game.multiplicador || 1),
      knockout: Boolean(game.mata_mata),
      status: game.status || "aberto",
      result: Number.isInteger(game.gols_a) && Number.isInteger(game.gols_b)
        ? { goalsA: game.gols_a, goalsB: game.gols_b, qualifiedCode: game.classificado_code }
        : null
    };
  }

  function mapSupabaseGame(game) {
    return {
      id: game.id,
      code: game.codigo || game.id,
      stage: game.fase,
      round: game.rodada || "",
      startsAt: game.inicio,
      teamA: game.time_a_code,
      teamB: game.time_b_code,
      multiplier: Number(game.multiplicador || 1),
      knockout: Boolean(game.mata_mata),
      status: game.status,
      result: Number.isInteger(game.gols_a) && Number.isInteger(game.gols_b)
        ? { goalsA: game.gols_a, goalsB: game.gols_b, qualifiedCode: game.classificado_code }
        : null
    };
  }

  function render() {
    renderSession();
    renderPhaseFilter();
    renderSummary();
    renderGames();
    renderExtras();
    renderRanking();
    renderAdmin();
  }

  function scheduleDeadlineWatcher() {
    clearTimeout(state.deadlineTimer);

    if (!state.bootstrapped || state.games.length === 0) {
      return;
    }

    const now = Date.now();
    const nextCutoff = state.games
      .filter((game) => getGameStatus(game) === "aberto")
      .map((game) => cutoffDate(game.startsAt).getTime())
      .filter((time) => Number.isFinite(time) && time > now)
      .sort((a, b) => a - b)[0];
    const delay = nextCutoff
      ? Math.min(Math.max(nextCutoff - now + 1000, 1000), 60000)
      : 60000;

    state.deadlineTimer = setTimeout(handleDeadlineTick, delay);
  }

  async function handleDeadlineTick() {
    if (!state.bootstrapped) {
      return;
    }

    await loadGuesses({ silent: true });
    render();
    scheduleDeadlineWatcher();
  }

  function renderSession() {
    const isSupabase = state.mode === "supabase";
    const isLinked = Boolean(state.session && state.profile.id);

    if (els.connectionStatus) {
      els.connectionStatus.textContent = isSupabase
        ? (isLinked ? `Conectado como ${state.profile.name}` : "Entre com o convite")
        : "Modo local sem banco";
    }

    if (els.authForm) els.authForm.hidden = !isSupabase || isLinked;
    if (els.signOutButton) els.signOutButton.hidden = !isSupabase || !isLinked;
    if (els.loginTab) els.loginTab.hidden = false;
    if (els.adminTab) els.adminTab.hidden = !(isSupabase && state.profile.isAdmin);

    if (els.adminTab?.hidden && document.getElementById("view-admin")?.classList.contains("is-active")) {
      activateView("palpites");
    }

    if (els.loginTab?.hidden && document.getElementById("view-login")?.classList.contains("is-active")) {
      activateView("palpites");
    }
  }

  function renderPhaseFilter() {
    const current = els.phaseFilter.value || "todos";
    const phases = [...new Set(state.games.map((game) => game.stage).filter(Boolean))];
    els.phaseFilter.innerHTML = [
      `<option value="todos">Todas as fases</option>`,
      ...phases.map((phase) => `<option value="${escapeAttr(phase)}">${escapeHtml(phase)}</option>`)
    ].join("");
    els.phaseFilter.value = phases.includes(current) ? current : "todos";
    state.filters.phase = els.phaseFilter.value;
  }

  function renderSummary() {
    const statuses = state.games.map(getGameStatus);
    const saved = state.games.filter((game) => getMyGuess(game.id)).length;
    const next = state.games
      .filter((game) => getGameStatus(game) === "aberto")
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];

    els.totalGames.textContent = state.games.length;
    els.savedGuesses.textContent = saved;
    els.openGames.textContent = statuses.filter((status) => status === "aberto").length;
    els.finishedGames.textContent = statuses.filter((status) => status === "finalizado").length;
    els.fixtureSource.textContent = "";
    els.fixtureSource.hidden = true;

    els.nextGame.innerHTML = next
      ? `<strong>Próximo:</strong> ${teamName(next.teamA)} x ${teamName(next.teamB)}<br>${formatDateTime(next.startsAt)}`
      : "Nenhum jogo aberto.";
  }

  function renderGames() {
    const filtered = state.games.filter((game) => {
      const phaseOk = state.filters.phase === "todos" || game.stage === state.filters.phase;
      const statusOk = state.filters.status === "todos" || getGameStatus(game) === state.filters.status;
      return phaseOk && statusOk;
    });

    if (filtered.length === 0) {
      const message = state.games.length === 0 && state.mode === "supabase"
        ? "Nenhum jogo veio do Supabase. Confira se os jogos foram cadastrados na tabela jogos."
        : "Nenhum jogo neste filtro.";
      els.gamesList.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }

    els.gamesList.innerHTML = filtered.map(renderGameCard).join("");
  }

  function renderGameCard(game) {
    const status = getGameStatus(game);
    const guess = getMyGuess(game.id);
    const locked = status !== "aberto" || !canUseProfile();
    const statusLabel = status === "finalizado" ? "Finalizado" : status === "bloqueado" ? "Bloqueado" : "Aberto";
    const badgeClass = status === "finalizado" ? "badge-finished" : status === "bloqueado" ? "badge-locked" : "";
    const resultLine = game.result
      ? `<div class="result-line">Resultado: ${game.result.goalsA} x ${game.result.goalsB}</div>`
      : "";
    const saveLabel = guess ? "Atualizar" : "Salvar";

    return `
      <article class="game-card" data-game-id="${escapeAttr(game.id)}">
        <div>
          <div class="game-meta">
            <span class="badge ${badgeClass}">${statusLabel}</span>
            <span>${escapeHtml(game.stage)}</span>
            <span>${escapeHtml(game.round)}</span>
            <time datetime="${escapeAttr(game.startsAt)}">${formatDateTime(game.startsAt)}</time>
            <span>x${formatMultiplier(game.multiplier)}</span>
          </div>
          <div class="teams">
            ${renderTeam(game.teamA)}
            ${renderTeam(game.teamB)}
          </div>
        </div>
        <form class="guess-form">
          <div class="score-grid guess-score-grid">
            <label class="score-field score-field-left">
              <span class="sr-only">Placar ${escapeHtml(teamName(game.teamA))}</span>
              ${renderScoreFlag(game.teamA)}
              <input class="score-input" name="goalsA" type="number" inputmode="numeric" min="0" max="20" aria-label="Placar ${escapeAttr(teamName(game.teamA))}" value="${guess?.goalsA ?? ""}" ${locked ? "disabled" : ""}>
            </label>
            <div class="score-separator">x</div>
            <label class="score-field score-field-right">
              <span class="sr-only">Placar ${escapeHtml(teamName(game.teamB))}</span>
              <input class="score-input" name="goalsB" type="number" inputmode="numeric" min="0" max="20" aria-label="Placar ${escapeAttr(teamName(game.teamB))}" value="${guess?.goalsB ?? ""}" ${locked ? "disabled" : ""}>
              ${renderScoreFlag(game.teamB)}
            </label>
          </div>
          ${resultLine}
          ${renderVisibleGuesses(game)}
          <div class="card-actions">
            <div class="game-note">${cardNote(game, status)}</div>
            <button class="button button-primary" type="submit" ${locked ? "disabled" : ""}>${saveLabel}</button>
          </div>
        </form>
      </article>
    `;
  }

  function renderExtras() {
    if (!els.extrasForm) return;

    const draft = currentExtraDraft();
    const editable = extrasEditable();
    const disabled = !canUseProfile() || !editable;

    updateCountrySelect(els.extraChampion, draft.championCode, [
      draft.runnerUpCode,
      draft.semifinalist3Code,
      draft.semifinalist4Code
    ], disabled);
    updateCountrySelect(els.extraRunnerUp, draft.runnerUpCode, [
      draft.championCode,
      draft.semifinalist3Code,
      draft.semifinalist4Code
    ], disabled);
    updateCountrySelect(els.extraSemi3, draft.semifinalist3Code, [
      draft.championCode,
      draft.runnerUpCode,
      draft.semifinalist4Code
    ], disabled);
    updateCountrySelect(els.extraSemi4, draft.semifinalist4Code, [
      draft.championCode,
      draft.runnerUpCode,
      draft.semifinalist3Code
    ], disabled);

    if (els.extrasPreview) {
      els.extrasPreview.innerHTML = [
        extraChip("Campeão", draft.championCode),
        extraChip("Vice", draft.runnerUpCode),
        extraChip("Semifinalista", draft.semifinalist3Code),
        extraChip("Semifinalista", draft.semifinalist4Code)
      ].join("");
    }

    const button = els.extrasForm.querySelector("button[type='submit']");
    if (button) {
      button.disabled = disabled;
      button.textContent = state.extraGuess ? "Atualizar extras" : "Salvar extras";
    }

    if (!els.extrasStatus) return;
    if (!canUseProfile()) {
      els.extrasStatus.textContent = "Entre com o convite para salvar seus extras.";
    } else if (!editable) {
      els.extrasStatus.textContent = "Extras bloqueados: semifinal/final já liberou pontuação.";
    } else if (state.extrasLoadError) {
      els.extrasStatus.textContent = "Extras precisam do SQL novo no Supabase.";
    } else if (state.extraGuess?.updatedAt) {
      els.extrasStatus.textContent = `Salvo em ${formatDateTime(state.extraGuess.updatedAt)}.`;
    } else {
      els.extrasStatus.textContent = "Escolha quatro seleções diferentes.";
    }
  }

  function currentExtraDraft() {
    return {
      championCode: els.extraChampion?.value || state.extraGuess?.championCode || "",
      runnerUpCode: els.extraRunnerUp?.value || state.extraGuess?.runnerUpCode || "",
      semifinalist3Code: els.extraSemi3?.value || state.extraGuess?.semifinalist3Code || "",
      semifinalist4Code: els.extraSemi4?.value || state.extraGuess?.semifinalist4Code || ""
    };
  }

  function updateCountrySelect(select, currentValue, blockedCodes, disabled) {
    if (!select) return;
    select.innerHTML = renderCountryOptions(currentValue, blockedCodes);
    select.value = currentValue || "";
    select.disabled = disabled;
  }

  function renderCountryOptions(currentValue, blockedCodes) {
    const blocked = new Set(blockedCodes.filter(Boolean));
    const options = countryOptions();
    return [
      `<option value="">Selecione</option>`,
      ...options.map((country) => {
        const disabled = blocked.has(country.code) && country.code !== currentValue ? " disabled" : "";
        return `<option value="${escapeAttr(country.code)}"${disabled}>${escapeHtml(country.short_name || country.code)}</option>`;
      })
    ].join("");
  }

  function countryOptions() {
    return [...state.countries.values()]
      .sort((a, b) => String(a.short_name || a.code).localeCompare(String(b.short_name || b.code), "pt-BR"));
  }

  function extraChip(label, code) {
    if (!code) {
      return `<div class="extra-chip is-empty"><strong>${escapeHtml(label)}</strong><span>Selecione</span></div>`;
    }

    return `
      <div class="extra-chip">
        ${renderScoreFlag(code)}
        <div>
          <strong>${escapeHtml(teamName(code))}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      </div>
    `;
  }

  function extrasEditable() {
    const results = getExtraResults();
    return !results.hasSemifinals && !results.hasFinal;
  }

  function renderTeam(code) {
    return `
      <div class="team">
        <img class="flag" src="flags/${escapeAttr(code)}.png" alt="Bandeira ${escapeAttr(teamName(code))}">
        <div class="team-name">${escapeHtml(teamName(code))}</div>
      </div>
    `;
  }

  function renderScoreFlag(code) {
    return `<img class="score-flag" src="flags/${escapeAttr(code)}.png" alt="">`;
  }

  function renderVisibleGuesses(game) {
    const status = getGameStatus(game);

    if (status === "aberto") {
      return "";
    }

    const guesses = state.guesses
      .filter((guess) => guess.gameId === game.id)
      .sort((a, b) => a.participantName.localeCompare(b.participantName, "pt-BR"));
    const panelId = `guesses-${game.id}`;

    if (guesses.length === 0) {
      return `<div class="visible-guesses"><strong>Palpites</strong><span>Nenhum palpite salvo.</span></div>`;
    }

    return `
      <details class="visible-guesses">
        <summary class="guesses-toggle" aria-controls="${escapeAttr(panelId)}">
          <span class="label-closed">Ver palpites (${guesses.length})</span>
          <span class="label-open">Ocultar palpites (${guesses.length})</span>
        </summary>
        <div id="${escapeAttr(panelId)}" class="guesses-panel">
          <div class="visible-guess-row visible-guess-head">
            <span>Participante</span>
            <span>Palpite</span>
            <span>Pontos</span>
          </div>
          ${guesses.map((guess) => {
            const score = game.result ? calculateScore(game, guess) : null;
            const points = score ? formatPoints(score.points) : "-";
            return `
              <div class="visible-guess-row">
                <span class="guess-name">${escapeHtml(guess.participantName)}</span>
                <span class="guess-score">${guess.goalsA} x ${guess.goalsB}</span>
                ${score ? `
                  <button class="guess-points" type="button" data-score-toggle aria-expanded="false" aria-label="Ver explicação da pontuação">${points}</button>
                  <div class="score-reason" hidden>${escapeHtml(score.reason)}</div>
                ` : `<span class="guess-points">${points}</span>`}
              </div>
            `;
          }).join("")}
        </div>
      </details>
    `;
  }

  function cardNote(game, status) {
    if (!canUseProfile()) {
      return "";
    }
    if (status === "finalizado") {
      return "Palpites liberados.";
    }
    if (status === "bloqueado") {
      return "Prazo encerrado. Palpites liberados.";
    }
    return `Fecha ${formatDateTime(cutoffDate(game.startsAt))}`;
  }

  function renderRanking() {
    const scores = calculateRanking();

    if (scores.length === 0) {
      els.rankingList.innerHTML = `<div class="empty-state">Ranking aguardando jogos finalizados.</div>`;
      return;
    }

    els.rankingList.innerHTML = scores.map((row, index) => `
      <article class="ranking-card" data-pos="${index + 1}">
        <div class="card-main">
          <div class="rank-badge">
            ${index + 1}
            ${rankMedal(index)}
          </div>
          <div class="card-identity">
            <div class="card-name">
              ${escapeHtml(row.name)}
              ${row.participantId === state.profile.id ? `<span class="card-name-you">Você</span>` : ""}
            </div>
            <div class="card-subtitle">${rankingSubtitle(row, index, scores)}</div>
          </div>
          <div class="card-score">
            <div class="card-score-value">${formatPoints(row.points)}</div>
            <div class="card-score-label">pontos</div>
          </div>
        </div>
        <div class="card-stats">
          <div class="stat">
            <span class="stat-icon">🎯</span>
            <span class="stat-value">${row.exacts}</span>
            <span class="stat-label">Exatos</span>
          </div>
          <div class="stat">
            <span class="stat-icon">✓</span>
            <span class="stat-value">${row.results}</span>
            <span class="stat-label">Resultados</span>
          </div>
          <div class="stat">
            <span class="stat-icon">⚽</span>
            <span class="stat-value">${row.games}</span>
            <span class="stat-label">Jogos</span>
          </div>
          <div class="stat">
            <span class="stat-icon">★</span>
            <span class="stat-value">${formatPoints(row.extras)}</span>
            <span class="stat-label">Extras</span>
          </div>
        </div>
      </article>
    `).join("");
  }

  function rankMedal(index) {
    const medals = ["🥇", "🥈", "🥉"];
    return medals[index] ? `<span class="rank-medal">${medals[index]}</span>` : "";
  }

  function rankingSubtitle(row, index, scores) {
    if (index === 0) {
      return "Líder do ranking";
    }

    const leader = scores[0];
    const diff = Math.max(0, leader.points - row.points);

    if (diff === 0) {
      return "Empatado na liderança";
    }

    return `${formatPoints(diff)} pts atrás do líder`;
  }

  function renderAdmin() {
    if (!els.adminGamesList) return;

    if (!state.profile.isAdmin) {
      els.adminGamesList.innerHTML = "";
      return;
    }

    if (state.games.length === 0) {
      els.adminGamesList.innerHTML = `<div class="empty-state">Nenhum jogo cadastrado.</div>`;
      return;
    }

    els.adminGamesList.innerHTML = state.games
      .slice()
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
      .map(renderAdminGameCard)
      .join("");
  }

  function renderAdminGameCard(game) {
    const status = getGameStatus(game);
    const result = game.result || {};

    return `
      <article class="game-card" data-admin-game-id="${escapeAttr(game.id)}">
        <div>
          <div class="game-meta">
            <span class="badge ${status === "finalizado" ? "badge-finished" : status === "bloqueado" ? "badge-locked" : ""}">${escapeHtml(statusLabel(status))}</span>
            <span>${escapeHtml(game.stage)}</span>
            <span>${escapeHtml(game.round)}</span>
            <time datetime="${escapeAttr(game.startsAt)}">${formatDateTime(game.startsAt)}</time>
          </div>
          <div class="teams">
            ${renderTeam(game.teamA)}
            ${renderTeam(game.teamB)}
          </div>
        </div>
        <form class="admin-form">
          <div class="score-grid">
            <label class="field">
              <span>${escapeHtml(teamName(game.teamA))}</span>
              <input class="score-input" name="goalsA" type="number" inputmode="numeric" min="0" max="20" value="${result.goalsA ?? ""}">
            </label>
            <div class="score-separator">x</div>
            <label class="field">
              <span>${escapeHtml(teamName(game.teamB))}</span>
              <input class="score-input" name="goalsB" type="number" inputmode="numeric" min="0" max="20" value="${result.goalsB ?? ""}">
            </label>
          </div>
          <div class="card-actions">
            <div class="game-note">Salvar libera os palpites deste jogo.</div>
            <button class="button button-primary" type="submit">${game.result ? "Corrigir resultado" : "Finalizar jogo"}</button>
          </div>
        </form>
      </article>
    `;
  }

  function calculateRanking() {
    const rows = new Map();

    state.guesses.forEach((guess) => {
      const game = state.games.find((item) => item.id === guess.gameId);
      if (!game || getGameStatus(game) !== "finalizado" || !game.result) {
        return;
      }

      const score = calculateScore(game, guess);
      const userKey = guess.participantId || "local";
      const row = rankingRow(rows, userKey, guess.participantName || state.profile.name || "Participante");

      row.points += score.points;
      row.exacts += score.exact ? 1 : 0;
      row.results += score.result ? 1 : 0;
      row.games += score.points > 0 ? 1 : 0;
      rows.set(userKey, row);
    });

    const extraResults = getExtraResults();
    state.extraGuesses.forEach((extra) => {
      const score = calculateExtraScore(extra, extraResults);
      if (!score.available && score.points === 0) {
        return;
      }

      const userKey = extra.participantId || "local";
      const row = rankingRow(rows, userKey, extra.participantName || state.profile.name || "Participante");
      row.points += score.points;
      row.extras += score.points;
      rows.set(userKey, row);
    });

    return [...rows.values()].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.exacts !== a.exacts) return b.exacts - a.exacts;
      return b.results - a.results;
    });
  }

  function rankingRow(rows, key, name) {
    return rows.get(key) || {
      participantId: key,
      name,
      points: 0,
      exacts: 0,
      results: 0,
      games: 0,
      extras: 0
    };
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const name = els.authName.value.trim();
    const invite = els.authInvite.value.trim();

    if (!name || !invite) {
      showToast("Informe nome e convite.");
      return;
    }

    let createdSession = false;
    if (!state.session) {
      const { data, error } = await state.client.auth.signInAnonymously();
      if (error) {
        showToast("Ative o login anônimo no Supabase.");
        return;
      }
      state.session = data.session || null;
      createdSession = true;
    }

    const { data, error } = await state.client.rpc("vincular_dispositivo", {
      p_nome: name,
      p_convite: invite
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      if (createdSession) {
        await state.client.auth.signOut();
        state.session = null;
      }
      showToast("Nome ou convite inválido.");
      return;
    }

    state.profile = {
      id: data[0].participante_id,
      name: data[0].nome,
      isAdmin: Boolean(data[0].is_admin)
    };
    els.authInvite.value = "";
    await loadGuesses({ silent: true });
    await loadExtraGuesses({ silent: true });
    activateView("palpites");
    render();
    showToast("Dispositivo vinculado.");
    return;

  }

  async function handleSignOut() {
    if (state.mode === "supabase") {
      await state.client.auth.signOut();
    }
    state.session = null;
    state.profile = { id: "", name: "", isAdmin: false };
    state.guesses = [];
    state.extraGuess = null;
    state.extraGuesses = [];
    activateView("login");
    render();
  }

  function handleGamesListClick(event) {
    const scoreToggle = event.target.closest("[data-score-toggle]");
    if (scoreToggle) {
      event.preventDefault();
      const row = scoreToggle.closest(".visible-guess-row");
      const reason = row?.querySelector(".score-reason");
      if (!reason) return;

      const expanded = scoreToggle.getAttribute("aria-expanded") === "true";
      scoreToggle.setAttribute("aria-expanded", String(!expanded));
      reason.hidden = expanded;
      row.classList.toggle("is-score-open", !expanded);
      return;
    }

    const toggle = event.target.closest("[data-toggle-guesses]");
    if (!toggle) {
      return;
    }

    event.preventDefault();
    const gameId = toggle.dataset.toggleGuesses;
    if (state.expandedGames.has(gameId)) {
      state.expandedGames.delete(gameId);
    } else {
      state.expandedGames.add(gameId);
    }
    renderGames();
  }

  async function handleGuessSubmit(event) {
    event.preventDefault();
    const form = event.target.closest("form");
    const card = event.target.closest("[data-game-id]");
    const game = state.games.find((item) => item.id === card.dataset.gameId);

    if (!game) return;
    if (getGameStatus(game) !== "aberto") {
      showToast("Prazo encerrado para este jogo.");
      return;
    }

    const formData = new FormData(form);
    const goalsA = parseScore(formData.get("goalsA"));
    const goalsB = parseScore(formData.get("goalsB"));
    if (goalsA === null || goalsB === null) {
      showToast("Informe os dois placares.");
      return;
    }

    if (!canUseProfile()) {
      showToast("Entre com o convite.");
      return;
    }

    const button = form.querySelector("button[type='submit']");
    button.disabled = true;

    try {
      const savedGuess = await saveGuess(game, { goalsA, goalsB });
      mergeGuessIntoState(savedGuess);
      await loadGuesses({ silent: true });
      if (!getMyGuess(game.id)) {
        mergeGuessIntoState(savedGuess);
      }
      render();
      showToast("Palpite salvo.");
    } catch (error) {
      console.error(error);
      await loadGuesses({ silent: true });
      render();
      showToast(guessSaveErrorMessage(error, game));
    } finally {
      button.disabled = false;
    }
  }

  async function handleResultSubmit(event) {
    event.preventDefault();

    if (!state.profile.isAdmin) {
      showToast("Acesso restrito ao admin.");
      return;
    }

    const form = event.target.closest("form");
    const card = event.target.closest("[data-admin-game-id]");
    const game = state.games.find((item) => item.id === card?.dataset.adminGameId);

    if (!game) return;

    const formData = new FormData(form);
    const goalsA = parseScore(formData.get("goalsA"));
    const goalsB = parseScore(formData.get("goalsB"));

    if ((goalsA === null) !== (goalsB === null)) {
      showToast("Informe os dois gols ou deixe os dois vazios.");
      return;
    }

    if (goalsA === null || goalsB === null) {
      showToast("Informe o placar final.");
      return;
    }

    const button = form.querySelector("button[type='submit']");
    button.disabled = true;

    try {
      await saveResult(game, { goalsA, goalsB });
      await loadGames();
      await loadGuesses();
      await loadExtraGuesses();
      render();
      showToast("Resultado salvo.");
    } finally {
      button.disabled = false;
    }
  }

  async function handleExtrasSubmit(event) {
    event.preventDefault();

    if (!canUseProfile()) {
      showToast("Entre com o convite.");
      return;
    }

    if (!extrasEditable()) {
      showToast("Extras bloqueados.");
      return;
    }

    const formData = new FormData(event.target);
    const extra = {
      championCode: String(formData.get("championCode") || ""),
      runnerUpCode: String(formData.get("runnerUpCode") || ""),
      semifinalist3Code: String(formData.get("semifinalist3Code") || ""),
      semifinalist4Code: String(formData.get("semifinalist4Code") || "")
    };

    const validation = validateExtraGuess(extra);
    if (validation) {
      showToast(validation);
      return;
    }

    const button = event.target.querySelector("button[type='submit']");
    button.disabled = true;

    try {
      const savedExtra = await saveExtraGuess(extra);
      mergeExtraGuessIntoState(savedExtra);
      await loadExtraGuesses({ silent: true });
      if (!state.extraGuess) {
        mergeExtraGuessIntoState(savedExtra);
      }
      render();
      showToast("Extras salvos.");
    } catch (error) {
      console.error(error);
      await loadExtraGuesses({ silent: true });
      render();
      showToast(`NÃ£o consegui salvar extras: ${shortError(error)}`);
    } finally {
      button.disabled = false;
    }
  }

  function validateExtraGuess(extra) {
    const codes = [
      extra.championCode,
      extra.runnerUpCode,
      extra.semifinalist3Code,
      extra.semifinalist4Code
    ];

    if (codes.some((code) => !code)) {
      return "Escolha campeão, vice e os outros 2 semifinalistas.";
    }

    if (new Set(codes).size !== codes.length) {
      return "Escolha quatro seleções diferentes.";
    }

    return "";
  }

  async function saveGuess(game, guess) {
    if (state.mode === "supabase") {
      const { data, error } = await state.client
        .from("palpites")
        .upsert({
          jogo_id: game.id,
          participante_id: state.profile.id,
          gols_a: guess.goalsA,
          gols_b: guess.goalsB,
          classificado_code: null
        }, { onConflict: "participante_id,jogo_id" })
        .select("id,jogo_id,participante_id,gols_a,gols_b,classificado_code,enviado_em,updated_at")
        .single();

      if (error) {
        throw error;
      }
      return mapGuessRow(data, state.profile.name);
    }

    const existingIndex = state.guesses.findIndex((item) => item.gameId === game.id);
    const localGuess = {
      id: `local-${game.id}`,
      gameId: game.id,
      participantId: "local",
      goalsA: guess.goalsA,
      goalsB: guess.goalsB,
      qualifiedCode: null,
      updatedAt: new Date().toISOString(),
      participantName: state.profile.name || "Participante"
    };

    if (existingIndex >= 0) {
      state.guesses.splice(existingIndex, 1, localGuess);
    } else {
      state.guesses.push(localGuess);
    }

    saveLocalState();
    return localGuess;
  }

  async function saveExtraGuess(extra) {
    if (state.mode === "supabase") {
      const { data, error } = await state.client
        .from("palpites_extras")
        .upsert({
          participante_id: state.profile.id,
          campeao_code: extra.championCode,
          vice_code: extra.runnerUpCode,
          semifinalista_3_code: extra.semifinalist3Code,
          semifinalista_4_code: extra.semifinalist4Code
        }, { onConflict: "participante_id" })
        .select("id,participante_id,campeao_code,vice_code,semifinalista_3_code,semifinalista_4_code,updated_at")
        .single();

      if (error) {
        throw error;
      }

      return mapExtraGuessRow(data, state.profile.name);
    }

    const localExtra = {
      id: "local-extras",
      participantId: "local",
      participantName: state.profile.name || "Participante",
      championCode: extra.championCode,
      runnerUpCode: extra.runnerUpCode,
      semifinalist3Code: extra.semifinalist3Code,
      semifinalist4Code: extra.semifinalist4Code,
      updatedAt: new Date().toISOString()
    };

    state.extraGuess = localExtra;
    state.extraGuesses = [localExtra];
    saveLocalState();
    return localExtra;
  }

  function mergeExtraGuessIntoState(extra) {
    state.extraGuesses = mergeExtraGuessRows([...state.extraGuesses, extra]);
    state.extraGuess = state.extraGuesses.find((item) => item.participantId === extra.participantId) || extra;
  }

  async function saveResult(game, result) {
    if (state.mode !== "supabase") {
      showToast("Resultados só são salvos no Supabase.");
      return;
    }

    const payload = {
      status: "finalizado",
      gols_a: result.goalsA,
      gols_b: result.goalsB,
      classificado_code: null
    };

    const { error } = await state.client
      .from("jogos")
      .update(payload)
      .eq("id", game.id);

    if (error) {
      showToast("O Supabase rejeitou o resultado.");
      throw error;
    }
  }

  function canUseProfile() {
    if (state.mode === "supabase") {
      return Boolean(state.session && state.profile.id);
    }
    return Boolean(state.profile.name);
  }

  function getMyGuess(gameId) {
    if (state.mode === "supabase") {
      return state.guesses.find((guess) => guess.gameId === gameId && guess.participantId === state.profile.id);
    }
    return state.guesses.find((guess) => guess.gameId === gameId);
  }

  function getGameStatus(game) {
    if (game.status === "finalizado") return "finalizado";
    if (game.status === "bloqueado") return "bloqueado";
    if (!game.startsAt) return game.status || "aberto";
    return new Date() >= cutoffDate(game.startsAt) ? "bloqueado" : "aberto";
  }

  function statusLabel(status) {
    if (status === "finalizado") return "Finalizado";
    if (status === "bloqueado") return "Bloqueado";
    return "Aberto";
  }

  function cutoffDate(value) {
    return new Date(new Date(value).getTime() - CUTOFF_MINUTES * 60 * 1000);
  }

  function getExtraResults() {
    const semifinalists = new Set();
    state.games
      .filter((game) => isSemifinalGame(game) && getGameStatus(game) === "finalizado" && game.result)
      .forEach((game) => {
        semifinalists.add(game.teamA);
        semifinalists.add(game.teamB);
      });

    const finalGame = state.games.find((game) => isFinalGame(game) && getGameStatus(game) === "finalizado" && game.result);
    const champion = finalGame ? gameWinner(finalGame) : "";
    const runnerUp = finalGame && champion ? gameLoser(finalGame, champion) : "";

    return {
      semifinalists,
      champion,
      runnerUp,
      hasSemifinals: semifinalists.size >= 4,
      hasFinal: Boolean(champion && runnerUp)
    };
  }

  function calculateExtraScore(extra, results = getExtraResults()) {
    let points = 0;

    if (results.hasFinal) {
      if (extra.championCode === results.champion) points += 20;
      if (extra.runnerUpCode === results.runnerUp) points += 12;
    }

    if (results.hasSemifinals) {
      extraSemifinalists(extra).forEach((code) => {
        if (results.semifinalists.has(code)) points += 5;
      });
    }

    return {
      points,
      available: results.hasSemifinals || results.hasFinal
    };
  }

  function extraSemifinalists(extra) {
    return [...new Set([
      extra.championCode,
      extra.runnerUpCode,
      extra.semifinalist3Code,
      extra.semifinalist4Code
    ].filter(Boolean))];
  }

  function isSemifinalGame(game) {
    const text = normalizeText(`${game.stage} ${game.round}`);
    return text.includes("semifinal") || text.includes("semi final") || text.includes("semi-final");
  }

  function isFinalGame(game) {
    if (isSemifinalGame(game)) return false;

    const round = normalizeText(game.round || "");
    const stage = normalizeText(game.stage || "");
    const excluded = /(quartas|oitavas|terceiro|3o|3º|disputa)/;

    if (round && !excluded.test(round)) {
      return round === "final" || round === "grande final";
    }

    return !round && !excluded.test(stage) && (stage === "final" || stage === "grande final");
  }

  function gameWinner(game) {
    if (game.result?.qualifiedCode && [game.teamA, game.teamB].includes(game.result.qualifiedCode)) {
      return game.result.qualifiedCode;
    }
    if (!game.result) return "";
    if (game.result.goalsA > game.result.goalsB) return game.teamA;
    if (game.result.goalsB > game.result.goalsA) return game.teamB;
    return "";
  }

  function gameLoser(game, winnerCode) {
    if (!winnerCode) return "";
    if (game.teamA === winnerCode) return game.teamB;
    if (game.teamB === winnerCode) return game.teamA;
    return "";
  }

  function calculateScore(game, guess) {
    const realA = game.result.goalsA;
    const realB = game.result.goalsB;
    const guessA = guess.goalsA;
    const guessB = guess.goalsB;
    const realResult = resultType(realA, realB);
    const guessResult = resultType(guessA, guessB);
    const exact = realA === guessA && realB === guessB;
    const result = realResult === guessResult;
    const sameDiff = realA - realB === guessA - guessB;
    const oneTeamGoals = realA === guessA || realB === guessB;
    const totalGoals = realA + realB === guessA + guessB;

    let base = 0;
    if (exact) base = 10;
    else if (result && realResult === "D") base = 5;
    else if (result && sameDiff) base = 6;
    else if (result && oneTeamGoals) base = 5;
    else if (result) base = 4;
    else if (oneTeamGoals || totalGoals) base = 1;

    if (!exact && result && realResult !== "D" && totalGoals && base === 4) {
      base += 1;
    }

    const rarity = exact ? getExoticBonus(guessA, guessB) : 0;
    const multiplier = Number(game.multiplier || 1);
    const points = Math.floor((base + rarity) * multiplier);
    const reason = scoreReason(game, {
      realA,
      realB,
      guessA,
      guessB,
      realResult,
      exact,
      result,
      sameDiff,
      oneTeamGoals,
      totalGoals,
      base,
      rarity,
      multiplier
    }, points);

    return { points, exact, result, totalGoals, reason };
  }

  function scoreReason(game, score, points) {
    const multiplierNote = score.multiplier === 1
      ? ""
      : ` Multiplicador ${formatMultiplier(score.multiplier)} aplicado: ${formatPoints(points)} pts.`;

    if (score.exact) {
      const rarityNote = score.rarity > 0 ? ` + ${score.rarity} de bônus por placar raro` : "";
      return `Placar exato: 10 pontos${rarityNote}.${multiplierNote}`;
    }

    if (score.result && score.realResult === "D") {
      return `Acertou o empate. Empate não exato vale 5 pontos.${multiplierNote}`;
    }

    if (score.result && score.sameDiff) {
      return `Acertou o vencedor e o saldo de gols. Base: 6 pontos.${multiplierNote}`;
    }

    if (score.result && score.oneTeamGoals) {
      return `Acertou o vencedor e o número de gols ${matchedTeamGoalsText(game, score)}. Base: 5 pontos.${multiplierNote}`;
    }

    if (score.result && score.totalGoals) {
      return `Acertou o vencedor e o total de gols da partida (${score.realA + score.realB}). Base: 5 pontos.${multiplierNote}`;
    }

    if (score.result) {
      return `Acertou o vencedor. Base: 4 pontos.${multiplierNote}`;
    }

    if (score.oneTeamGoals) {
      return `Acertou o número de gols ${matchedTeamGoalsText(game, score)}. Base: 1 ponto.${multiplierNote}`;
    }

    if (score.totalGoals) {
      return `Acertou o total de gols da partida (${score.realA + score.realB}). Base: 1 ponto.${multiplierNote}`;
    }

    return `Não acertou vencedor, empate, gols de time nem total de gols.`;
  }

  function matchedTeamGoalsText(game, score) {
    const matches = [];
    if (score.realA === score.guessA) {
      matches.push(teamArticle(game.teamA));
    }
    if (score.realB === score.guessB) {
      matches.push(teamArticle(game.teamB));
    }
    return matches.join(" e ");
  }

  function teamArticle(code) {
    const articles = {
      ARG: "da Argentina",
      AUS: "da Austrália",
      AUT: "da Áustria",
      BEL: "da Bélgica",
      BRA: "do Brasil",
      CAN: "do Canadá",
      COL: "da Colômbia",
      CRO: "da Croácia",
      DEN: "da Dinamarca",
      ECU: "do Equador",
      EGY: "do Egito",
      ENG: "da Inglaterra",
      ESP: "da Espanha",
      FRA: "da França",
      GER: "da Alemanha",
      ITA: "da Itália",
      JPN: "do Japão",
      MEX: "do México",
      MAR: "do Marrocos",
      NED: "dos Países Baixos",
      NOR: "da Noruega",
      PAR: "do Paraguai",
      POL: "da Polônia",
      POR: "de Portugal",
      SEN: "do Senegal",
      SUI: "da Suíça",
      USA: "dos EUA",
      URU: "do Uruguai"
    };
    return articles[code] || `de ${teamName(code)}`;
  }

  function resultType(a, b) {
    if (a > b) return "A";
    if (a < b) return "B";
    return "D";
  }

  function getExoticBonus(a, b) {
    const key = `${Math.max(a, b)} x ${Math.min(a, b)}`;
    return exoticBonus.has(key) ? exoticBonus.get(key) : 5;
  }

  function parseScore(value) {
    if (value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 20 ? parsed : null;
  }

  function teamName(code) {
    return state.countries.get(code)?.short_name || code;
  }

  function formatDateTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function formatMultiplier(value) {
    return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  }

  function formatPoints(value) {
    return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  let toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2600);
  }

  function shortError(error) {
    const message = error?.message || error?.details || "erro desconhecido";
    return message.length > 110 ? `${message.slice(0, 107)}...` : message;
  }

  function guessSaveErrorMessage(error, game) {
    const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;

    if (getGameStatus(game) !== "aberto" || /row-level security|policy|42501/i.test(text)) {
      return "Prazo encerrado para este jogo.";
    }

    return `Não consegui salvar: ${shortError(error)}`;
  }
})();
