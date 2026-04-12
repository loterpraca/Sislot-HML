(() => {
  'use strict';

  const API = {
    ...(window.FED_BASE || {}),
    ...(window.FEDERAL_API || {})
  };

  const $ = (id) => document.getElementById(id);

  const ROOTS = {
    catalogo: 'federal-catalogo-root',
    cadastro: 'federal-cadastro-root',
    movimentacao: 'federal-movimentacao-root',
    resultado: 'federal-resultado-root'
  };

  const MODULES = {
    catalogo: () => window.FEDERAL_CATALOGO,
    cadastro: () => window.FEDERAL_CADASTRO,
    movimentacao: () => window.FEDERAL_MOVIMENTACAO,
    resultado: () => window.FEDERAL_RESULTADO
  };

  const state = {
    usuario: null,
    perfil: '',
    loterias: [],
    loteriaPrincipalId: null,
    lojaSelecionada: null,
    concursoSelecionado: null,
    dataReferencia: todayISO(),
    concursos: [],
    activeTab: 'catalogo',
    mounted: {
      catalogo: false,
      cadastro: false,
      movimentacao: false,
      resultado: false
    }
  };

  function todayISO() {
    const now = new Date();
    const tz = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tz).toISOString().slice(0, 10);
  }

  function normalizePerfil(value) {
    return String(value || '').trim().toUpperCase();
  }

  function normalizeLoterias(rows) {
    return (rows || []).map((row) => {
      const id = row.id ?? row.loteria_id ?? row.loja_id ?? null;
      const nome = row.nome ?? row.loteria_nome ?? row.loja_nome ?? `Loja ${id ?? ''}`;
      const principal =
        row.principal === true ||
        row.is_principal === true ||
        row.loteria_principal === true ||
        row.loja_principal === true ||
        row.eh_principal === true;

      return {
        id,
        nome,
        principal,
        raw: row
      };
    }).filter(x => x.id != null);
  }

  function distinctConcursos(rows) {
    const map = new Map();

    (rows || []).forEach((row) => {
      const concurso = String(row.concurso || '').trim();
      if (!concurso) return;

      const dt = row.dt_sorteio || null;
      const key = `${concurso}__${dt || ''}`;

      if (!map.has(key)) {
        map.set(key, {
          concurso,
          dt_sorteio: dt,
          ativo: row.ativo !== false
        });
      }
    });

    return [...map.values()].sort((a, b) => {
      const da = String(a.dt_sorteio || '');
      const db = String(b.dt_sorteio || '');
      if (da !== db) return da.localeCompare(db);
      return String(a.concurso).localeCompare(String(b.concurso), undefined, { numeric: true });
    });
  }

  function findLoteriaPrincipal(loterias) {
    if (!loterias.length) return null;
    return (
      loterias.find(x => x.principal) ||
      loterias.find(x => x.raw?.principal === true) ||
      loterias.find(x => x.raw?.is_principal === true) ||
      loterias[0]
    );
  }

  function getConcursoCorrente(concursos, dataReferencia) {
    const ref = String(dataReferencia || '').trim();
    if (!concursos?.length) return null;

    const futuros = concursos
      .filter(c => c.dt_sorteio && c.dt_sorteio >= ref)
      .sort((a, b) => {
        const dtCmp = String(a.dt_sorteio).localeCompare(String(b.dt_sorteio));
        if (dtCmp !== 0) return dtCmp;
        return String(a.concurso).localeCompare(String(b.concurso), undefined, { numeric: true });
      });

    if (futuros.length) return futuros[0];

    return [...concursos].sort((a, b) => {
      const dtCmp = String(b.dt_sorteio || '').localeCompare(String(a.dt_sorteio || ''));
      if (dtCmp !== 0) return dtCmp;
      return String(b.concurso).localeCompare(String(a.concurso), undefined, { numeric: true });
    })[0] || null;
  }

  function fillSelect(el, rows, placeholder, valueKey = 'id', labelFn = (x) => x.nome) {
    if (!el) return;

    el.innerHTML = '';

    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder || 'Selecione...';
    el.appendChild(first);

    (rows || []).forEach((row) => {
      const opt = document.createElement('option');
      opt.value = row[valueKey];
      opt.textContent = labelFn(row);
      el.appendChild(opt);
    });
  }

  function showGlobalStatus(message, kind = 'ok') {
    const el = $('st-federal-global');
    if (!el) return;

    if (!message) {
      el.className = 'status-bar';
      el.textContent = '';
      return;
    }

    el.className = `status-bar show ${kind}`;
    el.textContent = message;
  }

  function setKpis(items = []) {
    const host = $('federal-kpis-shell');
    if (!host) return;

    if (!Array.isArray(items) || !items.length) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = items.map((item) => `
      <div class="kpi">
        <div class="kpi-label">${item.label || ''}</div>
        <div class="kpi-value">${item.value ?? ''}</div>
        <div class="kpi-sub">${item.sub || ''}</div>
      </div>
    `).join('');
  }

  function getContext() {
    return {
      usuario: state.usuario,
      perfil: state.perfil,
      loterias: state.loterias,
      loteriaPrincipalId: state.loteriaPrincipalId,
      lojaSelecionada: state.lojaSelecionada,
      concursoSelecionado: state.concursoSelecionado,
      dataReferencia: state.dataReferencia,
      concursos: state.concursos,
      setKpis,
      showStatus: showGlobalStatus,
      goTab
    };
  }

  async function loadConcursosDaLoja(loteriaId) {
    if (!loteriaId) return [];

    if (typeof API.loadConcursosByLoja === 'function') {
      const rows = await API.loadConcursosByLoja(loteriaId);
      return distinctConcursos(rows);
    }

    if (typeof API.loadFederais === 'function') {
      const rows = await API.loadFederais();
      const filtrados = (rows || []).filter(x => String(x.loteria_id) === String(loteriaId));
      return distinctConcursos(filtrados);
    }

    return [];
  }

  async function syncConcursos({ preserveCurrent = false } = {}) {
    state.concursos = await loadConcursosDaLoja(state.lojaSelecionada);

    const concursoEl = $('fed-filtro-concurso');
    fillSelect(
      concursoEl,
      state.concursos,
      'Concurso corrente...',
      'concurso',
      (x) => x.dt_sorteio ? `${x.concurso} • ${x.dt_sorteio}` : `${x.concurso}`
    );

    let escolhido = null;

    if (preserveCurrent && state.concursoSelecionado) {
      escolhido = state.concursos.find(x => String(x.concurso) === String(state.concursoSelecionado)) || null;
    }

    if (!escolhido) {
      escolhido = getConcursoCorrente(state.concursos, state.dataReferencia);
    }

    state.concursoSelecionado = escolhido?.concurso || '';
    if (concursoEl) concursoEl.value = state.concursoSelecionado || '';
  }

  function syncLojaSelect() {
    const lojaEl = $('fed-filtro-loja');
    fillSelect(
      lojaEl,
      state.loterias,
      'Selecione a loja...',
      'id',
      (x) => `${x.id} • ${x.nome}`
    );

    if (lojaEl && state.lojaSelecionada) {
      lojaEl.value = String(state.lojaSelecionada);
    }
  }

  function applyResultTabPermission() {
    const btn = $('tab-resultado');
    if (!btn) return;

    const canSee = ['ADMIN', 'SOCIO'].includes(state.perfil);
    btn.style.display = canSee ? '' : 'none';

    if (!canSee && state.activeTab === 'resultado') {
      goTab('catalogo', { updateHash: false });
    }
  }

  function setActiveTabUI(tab) {
    state.activeTab = tab;

    document.querySelectorAll('#federal-tabs .tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.querySelectorAll('.tab-panel[data-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === tab);
    });
  }

  async function mountOrRefreshActiveModule() {
    const tab = state.activeTab;
    const mod = MODULES[tab]?.();
    const root = $(ROOTS[tab]);
    if (!mod || !root) return;

    const ctx = getContext();

    if (!state.mounted[tab] && typeof mod.mount === 'function') {
      await mod.mount(root, ctx);
      state.mounted[tab] = true;
      return;
    }

    if (typeof mod.refresh === 'function') {
      await mod.refresh(ctx);
    }
  }

  async function goTab(tab, opts = {}) {
    const updateHash = opts.updateHash !== false;
    const canSeeResult = ['ADMIN', 'SOCIO'].includes(state.perfil);

    if (tab === 'resultado' && !canSeeResult) {
      tab = 'catalogo';
    }

    setActiveTabUI(tab);

    if (updateHash) {
      window.location.hash = `#${tab}`;
    }

    await mountOrRefreshActiveModule();
  }

  async function refreshActiveModule() {
    await mountOrRefreshActiveModule();
    window.dispatchEvent(new CustomEvent('federal:context-changed', {
      detail: getContext()
    }));
  }

  async function handleLojaChange() {
    state.lojaSelecionada = $('fed-filtro-loja')?.value || '';
    await syncConcursos({ preserveCurrent: false });
    await refreshActiveModule();
  }

  async function handleConcursoChange() {
    state.concursoSelecionado = $('fed-filtro-concurso')?.value || '';
    await refreshActiveModule();
  }

  async function handleDataChange() {
    state.dataReferencia = $('fed-data-ref')?.value || todayISO();
    await syncConcursos({ preserveCurrent: false });
    await refreshActiveModule();
  }

  function bindEvents() {
    document.querySelectorAll('#federal-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => goTab(btn.dataset.tab));
    });

    $('fed-filtro-loja')?.addEventListener('change', handleLojaChange);
    $('fed-filtro-concurso')?.addEventListener('change', handleConcursoChange);
    $('fed-data-ref')?.addEventListener('change', handleDataChange);

    $('fed-btn-hoje')?.addEventListener('click', async () => {
      state.dataReferencia = todayISO();
      $('fed-data-ref').value = state.dataReferencia;
      await syncConcursos({ preserveCurrent: false });
      await refreshActiveModule();
    });

    $('fed-btn-refresh')?.addEventListener('click', async () => {
      await syncConcursos({ preserveCurrent: true });
      await refreshActiveModule();
    });

    $('btn-voltar-menu')?.addEventListener('click', () => {
  if (window.SISLOT_SECURITY?.irParaInicio) {
    window.SISLOT_SECURITY.irParaInicio();
    return;
  }
  history.back();
});

    window.addEventListener('hashchange', async () => {
      const hash = String(window.location.hash || '').replace('#', '').trim();
      const next = hash || 'catalogo';
      await goTab(next, { updateHash: false });
    });
  }

  async function bootstrapSessionAndStores() {
    const sessionResult = typeof API.requireSession === 'function'
      ? await API.requireSession()
      : null;

    if (!sessionResult) return false;

    state.usuario = sessionResult.usuario || sessionResult.user || sessionResult;
    state.perfil = normalizePerfil(
      sessionResult.perfil ||
      sessionResult.usuario?.perfil ||
      sessionResult.user?.perfil ||
      state.usuario?.perfil
    );

    let loterias = [];

    if (Array.isArray(sessionResult.lojasPermitidas) && sessionResult.lojasPermitidas.length) {
      loterias = normalizeLoterias(sessionResult.lojasPermitidas);
    } else if (typeof API.loadLoterias === 'function') {
      loterias = normalizeLoterias(await API.loadLoterias());
    }

    state.loterias = loterias;

    const principal = findLoteriaPrincipal(state.loterias);
    state.loteriaPrincipalId = principal?.id || null;
    state.lojaSelecionada = principal?.id || state.loterias[0]?.id || '';

    return true;
  }

  async function bootstrap() {
    try {
      if (typeof API.startClock === 'function') {
        API.startClock('relogio');
      }

      const ok = await bootstrapSessionAndStores();
      if (!ok) return;

      if ($('fed-data-ref')) {
        $('fed-data-ref').value = state.dataReferencia;
      }

      syncLojaSelect();
      applyResultTabPermission();
      await syncConcursos({ preserveCurrent: false });

      const initialHash = String(window.location.hash || '').replace('#', '').trim();
      const initialTab = initialHash || 'catalogo';

      bindEvents();
      await goTab(initialTab, { updateHash: false });

      window.FEDERAL_SHELL = {
        getContext,
        goTab,
        setKpis,
        showStatus: showGlobalStatus,
        refresh: refreshActiveModule,
        state
      };
    } catch (e) {
      console.error('[FEDERAL_SHELL.bootstrap]', e);
      showGlobalStatus(e?.message || 'Erro ao iniciar a Federal.', 'err');
    }
  }

  bootstrap();
})();
