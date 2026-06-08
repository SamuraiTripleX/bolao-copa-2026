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
    fixtureSource: "exemplo",
    profile: { id: "", name: "", isAdmin: false },
    expandedGames: new Set(),
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
    activateView(canUseProfile() ? "palpites" : "login");
    state.bootstrapped = true;
    render();
  }

  function bindElements() {
    const ids = [
      "connectionStatus", "loginTab", "authForm", "authName", "authInvite", "signOutButton",
      "totalGames", "savedGuesses", "openGames", "finishedGames", "nextGame",
      "fixtureSource", "phaseFilter", "statusFilter", "gamesList",
      "rankingList", "adminTab", "adminGamesList", "toast"
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
    } catch (_error) {
      state.profile = { id: "", name: "", isAdmin: false };
      state.guesses = [];
    }
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      profile: state.profile,
      guesses: state.guesses
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
    renderRanking();
    renderAdmin();
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
    if (getGameStatus(game) !== "finalizado") {
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
          ${guesses.map((guess) => {
            const score = calculateScore(game, guess);
            return `
              <div class="visible-guess-row">
                <span>${escapeHtml(guess.participantName)}</span>
                <span>${guess.goalsA} x ${guess.goalsB}</span>
                <span>${formatPoints(score.points)} pts</span>
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
      return "Prazo encerrado.";
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
      <article class="ranking-row">
        <div class="rank-position">${index + 1}</div>
        <div>
          <div class="ranking-name">${escapeHtml(row.name)}</div>
          <div class="ranking-detail">${row.exacts} exatos · ${row.results} resultados · ${row.games} jogos pontuados</div>
        </div>
        <div class="ranking-score">${formatPoints(row.points)}</div>
      </article>
    `).join("");
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
      const row = rows.get(userKey) || {
        name: guess.participantName || state.profile.name || "Participante",
        points: 0,
        exacts: 0,
        results: 0,
        games: 0
      };

      row.points += score.points;
      row.exacts += score.exact ? 1 : 0;
      row.results += score.result ? 1 : 0;
      row.games += score.points > 0 ? 1 : 0;
      rows.set(userKey, row);
    });

    return [...rows.values()].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.exacts !== a.exacts) return b.exacts - a.exacts;
      return b.results - a.results;
    });
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
    activateView("login");
    render();
  }

  function handleGamesListClick(event) {
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
      showToast(`Não consegui salvar: ${shortError(error)}`);
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
      render();
      showToast("Resultado salvo.");
    } finally {
      button.disabled = false;
    }
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

  function calculateScore(game, guess) {
    const realA = game.result.goalsA;
    const realB = game.result.goalsB;
    const guessA = guess.goalsA;
    const guessB = guess.goalsB;
    const exact = realA === guessA && realB === guessB;
    const result = resultType(realA, realB) === resultType(guessA, guessB);
    const sameDiff = realA - realB === guessA - guessB;
    const oneTeamGoals = realA === guessA || realB === guessB;

    let base = 0;
    if (exact) base = 10;
    else if (result && sameDiff) base = 7;
    else if (result && oneTeamGoals) base = 6;
    else if (result) base = 4;
    else if (oneTeamGoals) base = 1;

    const rarity = exact ? getExoticBonus(guessA, guessB) : 0;
    const points = Math.floor((base + rarity) * game.multiplier);

    return { points, exact, result };
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
})();
