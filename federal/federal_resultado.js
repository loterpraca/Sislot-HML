(() => {
  'use strict';

  const API = window.FEDERAL_API || {};
  const fmtMoney = API.fmtMoney || ((v) => `R$ ${Number(v || 0).toFixed(2)}`);
  const fmtDate = API.fmtDate || ((v) => v || '—');
  const lookupLoteriaName = API.lookupLoteriaName || ((rows, id) => {
    const found = (rows || []).find(x => String(x.id) === String(id));
    return found?.nome || `Loja ${id}`;
  });

  const state = {
    root: null,
    ctx: null,
    rows: []
  };

  function q(sel) {
    return state.root?.querySelector(sel);
  }

  function showLocalStatus(message, kind = 'ok') {
    const el = q('#st-resultado');
    if (!el) return;

    if (!message) {
      el.className = 'status-bar';
      el.textContent = '';
      return;
    }

    el.className = `status-bar show ${kind}`;
    el.textContent = message;
  }

  function sum(rows, key) {
    return (rows || []).reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
  }

  function parseDate(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = String(dateStr).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d));
  }

  function getISOWeekInfo(dateStr) {
    const date = parseDate(dateStr);
    if (!date) return { year: '—', week: '—', label: 'Semana —' };

    const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);

    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);

    return {
      year: tmp.getUTCFullYear(),
      week: weekNo,
      label: `Semana ${String(weekNo).padStart(2, '0')}/${tmp.getUTCFullYear()}`
    };
  }

  function getMonthLabel(dateStr) {
    if (!dateStr) return 'Mês —';
    const [y, m] = String(dateStr).split('-');
    return `${String(m).padStart(2, '0')}/${y}`;
  }

  function getYearLabel(dateStr) {
    if (!dateStr) return 'Ano —';
    return String(dateStr).slice(0, 4);
  }

  function getGroupingMode() {
    return q('#fr-agrupamento')?.value || 'concurso';
  }

  function getLocalDateFilters() {
    return {
      dtIni: q('#fr-dt-ini')?.value || '',
      dtFim: q('#fr-dt-fim')?.value || ''
    };
  }

  function getRowsFilteredByLocalDate() {
    const { dtIni, dtFim } = getLocalDateFilters();

    return (state.rows || []).filter((row) => {
      const dt = row.dt_sorteio || '';
      if (dtIni && dt < dtIni) return false;
      if (dtFim && dt > dtFim) return false;
      return true;
    });
  }

  function buildShellKpis(rows) {
    const resultadoTotal = sum(rows, 'resultado');
    const qtdConcursos = new Set(rows.map(r => `${r.concurso}__${r.dt_sorteio || ''}`)).size;
    const qtdInicial = sum(rows, 'qtd_inicial');
    const custoTotal = rows.reduce((acc, r) => acc + (Number(r.qtd_inicial || 0) * Number(r.valor_custo || 0)), 0);
    const ticketMedio = qtdConcursos ? resultadoTotal / qtdConcursos : 0;
    const margemMedia = custoTotal ? (resultadoTotal / custoTotal) * 100 : 0;

    state.ctx.setKpis([
      { label: 'Resultado Total', value: fmtMoney(resultadoTotal), sub: 'Período filtrado' },
      { label: 'Concursos', value: qtdConcursos, sub: 'Quantidade apurada' },
      { label: 'Resultado Médio', value: fmtMoney(ticketMedio), sub: 'Por concurso' },
      { label: 'Carga Total', value: qtdInicial, sub: 'Qtd inicial somada' },
      { label: 'Margem Média', value: `${margemMedia.toFixed(1).replace('.', ',')}%`, sub: 'Sobre o custo total' },
      {
        label: 'Loja',
        value: lookupLoteriaName(state.ctx.loterias || [], state.ctx.lojaSelecionada),
        sub: state.ctx.concursoSelecionado ? `Concurso ${state.ctx.concursoSelecionado}` : 'Todos do filtro'
      }
    ]);
  }

  function groupRows(rows, mode) {
    const map = new Map();

    rows.forEach((row) => {
      let key = '';
      let label = '';

      if (mode === 'semana') {
        const w = getISOWeekInfo(row.dt_sorteio);
        key = `semana__${w.year}__${w.week}`;
        label = w.label;
      } else if (mode === 'mes') {
        label = getMonthLabel(row.dt_sorteio);
        key = `mes__${label}`;
      } else if (mode === 'ano') {
        label = getYearLabel(row.dt_sorteio);
        key = `ano__${label}`;
      } else {
        key = `concurso__${row.concurso}__${row.dt_sorteio || ''}`;
        label = `${row.concurso} • ${fmtDate(row.dt_sorteio)}`;
      }

      if (!map.has(key)) {
        map.set(key, {
          key,
          label,
          concursos: new Set(),
          dtIni: row.dt_sorteio || null,
          dtFim: row.dt_sorteio || null,
          qtd_inicial: 0,
          venda_total: 0,
          devolucao_total: 0,
          encalhe_total: 0,
          premio_total: 0,
          receitas_terceiros: 0,
          resultado_total: 0,
          custo_total: 0
        });
      }

      const g = map.get(key);
      g.concursos.add(String(row.concurso || '').trim());

      const vendaTotal = Number(row.qtd_venda_interna_total || 0) + Number(row.qtd_venda_externa || 0);
      const devolucaoTotal = Number(row.qtd_dev_cx_interna || 0) + Number(row.qtd_dev_cx_externa || 0);

      g.qtd_inicial += Number(row.qtd_inicial || 0);
      g.venda_total += vendaTotal;
      g.devolucao_total += devolucaoTotal;
      g.encalhe_total += Number(row.qtd_encalhe || 0);
      g.premio_total += Number(row.premio_encalhe_total || 0);
      g.receitas_terceiros += Number(row.receitas_terceiros || 0);
      g.resultado_total += Number(row.resultado || 0);
      g.custo_total += Number(row.qtd_inicial || 0) * Number(row.valor_custo || 0);

      if (row.dt_sorteio) {
        if (!g.dtIni || row.dt_sorteio < g.dtIni) g.dtIni = row.dt_sorteio;
        if (!g.dtFim || row.dt_sorteio > g.dtFim) g.dtFim = row.dt_sorteio;
      }
    });

    return [...map.values()].map((g) => ({
      ...g,
      qtd_concursos: g.concursos.size,
      margem_media: g.custo_total ? (g.resultado_total / g.custo_total) * 100 : 0,
      perc_venda: g.qtd_inicial ? (g.venda_total / g.qtd_inicial) * 100 : 0,
      perc_devolucao: g.qtd_inicial ? (g.devolucao_total / g.qtd_inicial) * 100 : 0,
      perc_encalhe: g.qtd_inicial ? (g.encalhe_total / g.qtd_inicial) * 100 : 0
    })).sort((a, b) => {
      if (mode === 'concurso') {
        return String(b.dtIni || '').localeCompare(String(a.dtIni || '')) ||
          String(b.label).localeCompare(String(a.label), undefined, { numeric: true });
      }
      return String(b.dtFim || '').localeCompare(String(a.dtFim || '')) ||
        String(b.label).localeCompare(String(a.label), undefined, { numeric: true });
    });
  }

  function renderEmpty(message) {
    q('#fr-content').innerHTML = `
      <div class="empty">
        <div class="empty-title">Sem resultado</div>
        <div class="empty-sub">${message || 'Nenhum dado encontrado para os filtros atuais.'}</div>
      </div>
    `;
  }

  function renderGroupCards(groups) {
    return `
      <div class="grid-2">
        ${groups.map((g) => `
          <section class="card">
            <div class="flex" style="justify-content:space-between;align-items:flex-start">
              <div>
                <div class="page-title" style="font-size:18px">${g.label}</div>
                <div class="page-sub">
                  ${g.dtIni ? `De ${fmtDate(g.dtIni)}` : ''}${g.dtFim ? ` até ${fmtDate(g.dtFim)}` : ''}
                </div>
              </div>

              <div class="inline-pills">
                <span class="pill">${g.qtd_concursos} concurso(s)</span>
                <span class="pill">Margem ${g.margem_media.toFixed(1).replace('.', ',')}%</span>
              </div>
            </div>

            <div class="grid-3" style="margin-top:14px">
              <div class="soft-card">
                <div class="field-label">Resultado</div>
                <div class="money ${Number(g.resultado_total || 0) >= 0 ? 'pos' : 'neg'}">${fmtMoney(g.resultado_total || 0)}</div>
              </div>

              <div class="soft-card">
                <div class="field-label">Qtd Inicial</div>
                <div class="money">${g.qtd_inicial}</div>
              </div>

              <div class="soft-card">
                <div class="field-label">Venda Total</div>
                <div class="money">${g.venda_total}</div>
              </div>

              <div class="soft-card">
                <div class="field-label">% Venda</div>
                <div class="money">${g.perc_venda.toFixed(1).replace('.', ',')}%</div>
              </div>

              <div class="soft-card">
                <div class="field-label">% Devolução</div>
                <div class="money">${g.perc_devolucao.toFixed(1).replace('.', ',')}%</div>
              </div>

              <div class="soft-card">
                <div class="field-label">% Encalhe</div>
                <div class="money">${g.perc_encalhe.toFixed(1).replace('.', ',')}%</div>
              </div>

              <div class="soft-card">
                <div class="field-label">Receitas Terceiros</div>
                <div class="money">${fmtMoney(g.receitas_terceiros || 0)}</div>
              </div>

              <div class="soft-card">
                <div class="field-label">Prêmio Encalhe</div>
                <div class="money">${fmtMoney(g.premio_total || 0)}</div>
              </div>

              <div class="soft-card">
                <div class="field-label">Custo Total</div>
                <div class="money">${fmtMoney(g.custo_total || 0)}</div>
              </div>
            </div>
          </section>
        `).join('')}
      </div>
    `;
  }

  function renderTable(groups) {
    return `
      <div class="table-wrap" style="margin-top:14px">
        <table class="table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Concursos</th>
              <th>Qtd Inicial</th>
              <th>Venda</th>
              <th>% Venda</th>
              <th>% Dev.</th>
              <th>% Encalhe</th>
              <th>Receitas Terceiros</th>
              <th>Prêmio</th>
              <th>Custo</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            ${groups.map((g) => `
              <tr>
                <td>${g.label}</td>
                <td class="mono">${g.qtd_concursos}</td>
                <td class="mono">${g.qtd_inicial}</td>
                <td class="mono">${g.venda_total}</td>
                <td class="mono">${g.perc_venda.toFixed(1).replace('.', ',')}%</td>
                <td class="mono">${g.perc_devolucao.toFixed(1).replace('.', ',')}%</td>
                <td class="mono">${g.perc_encalhe.toFixed(1).replace('.', ',')}%</td>
                <td class="money">${fmtMoney(g.receitas_terceiros || 0)}</td>
                <td class="money">${fmtMoney(g.premio_total || 0)}</td>
                <td class="money">${fmtMoney(g.custo_total || 0)}</td>
                <td class="money ${Number(g.resultado_total || 0) >= 0 ? 'pos' : 'neg'}">${fmtMoney(g.resultado_total || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function render() {
    const rows = getRowsFilteredByLocalDate();

    if (!rows.length) {
      state.ctx.setKpis([]);
      renderEmpty('Nenhum resultado encontrado para os filtros atuais.');
      return;
    }

    buildShellKpis(rows);

    const mode = getGroupingMode();
    const groups = groupRows(rows, mode);

    q('#fr-content').innerHTML = `
      <section class="card" style="margin-bottom:14px">
        <div class="grid-4">
          <div class="soft-card">
            <div class="field-label">Loja</div>
            <div class="money">${lookupLoteriaName(state.ctx.loterias || [], state.ctx.lojaSelecionada)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Concurso global</div>
            <div class="money">${state.ctx.concursoSelecionado || 'Todos do período'}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Agrupamento</div>
            <div class="money">${mode.toUpperCase()}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Registros</div>
            <div class="money">${rows.length}</div>
          </div>
        </div>
      </section>

      ${renderGroupCards(groups)}
      ${renderTable(groups)}
    `;
  }

  async function loadData(ctx) {
    const localFilters = getLocalDateFilters();

    state.rows = await API.loadResultadoFederal({
      loteriaId: ctx.lojaSelecionada,
      concurso: ctx.concursoSelecionado || undefined,
      dtIni: localFilters.dtIni || undefined,
      dtFim: localFilters.dtFim || undefined
    });
  }

  function bindEvents() {
    q('#fr-agrupamento')?.addEventListener('change', render);
    q('#fr-dt-ini')?.addEventListener('change', render);
    q('#fr-dt-fim')?.addEventListener('change', render);

    q('#fr-btn-mes')?.addEventListener('click', () => {
      const ref = String(state.ctx?.dataReferencia || '').slice(0, 7);
      if (!ref) return;

      q('#fr-dt-ini').value = `${ref}-01`;

      const [y, m] = ref.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      q('#fr-dt-fim').value = `${ref}-${String(lastDay).padStart(2, '0')}`;

      render();
    });

    q('#fr-btn-limpar')?.addEventListener('click', () => {
      q('#fr-dt-ini').value = '';
      q('#fr-dt-fim').value = '';
      q('#fr-agrupamento').value = 'concurso';
      render();
    });
  }

  function renderShell() {
    state.root.innerHTML = `
      <div id="st-resultado" class="status-bar"></div>

      <section class="card" style="margin-bottom:14px">
        <div class="grid-4">
          <div class="field">
            <label class="field-label">Agrupar por</label>
            <select id="fr-agrupamento">
              <option value="concurso">Concurso</option>
              <option value="semana">Semana</option>
              <option value="mes">Mês</option>
              <option value="ano">Ano</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">Data inicial</label>
            <input id="fr-dt-ini" type="date" />
          </div>

          <div class="field">
            <label class="field-label">Data final</label>
            <input id="fr-dt-fim" type="date" />
          </div>

          <div class="field">
            <label class="field-label">Ações</label>
            <div class="flex">
              <button id="fr-btn-mes" class="btn-secondary" type="button">Mês da referência</button>
              <button id="fr-btn-limpar" class="btn-primary" type="button">Limpar</button>
            </div>
          </div>
        </div>
      </section>

      <div id="fr-content"></div>
    `;
  }

  async function mount(root, ctx) {
    state.root = root;
    state.ctx = ctx;

    renderShell();
    bindEvents();
    await refresh(ctx);
  }

  async function refresh(ctx) {
    state.ctx = ctx;

    const perfil = String(ctx?.perfil || '').toUpperCase();
    if (!['ADMIN', 'SOCIO'].includes(perfil)) {
      ctx.setKpis([]);
      state.root.innerHTML = `
        <div class="empty">
          <div class="empty-title">Acesso restrito</div>
          <div class="empty-sub">Resultado disponível apenas para Sócio ou Administrador.</div>
        </div>
      `;
      return;
    }

    try {
      showLocalStatus('');
      await loadData(ctx);
      render();
    } catch (e) {
      const msg =
        e?.message ||
        e?.details ||
        e?.hint ||
        e?.error_description ||
        JSON.stringify(e) ||
        'Erro ao carregar resultado da Federal.';

      console.error('[FEDERAL_RESULTADO.refresh]', {
        raw: e,
        message: e?.message,
        details: e?.details,
        hint: e?.hint,
        code: e?.code
      });

      ctx.setKpis([]);
      showLocalStatus(msg, 'err');
      renderEmpty(msg);
    }
  }

  window.FEDERAL_RESULTADO = {
    mount,
    refresh
  };
})();
