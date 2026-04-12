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
    resumo: [],
    operacaoExterna: []
  };

  function sum(rows, key) {
    return (rows || []).reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
  }

  function percent(part, total) {
    const p = Number(part || 0);
    const t = Number(total || 0);
    if (!t) return '0,0%';
    return `${((p / t) * 100).toFixed(1).replace('.', ',')}%`;
  }

  function concursoLabel(ctx, rows) {
    if (ctx?.concursoSelecionado) return ctx.concursoSelecionado;
    if (rows?.length === 1) return rows[0].concurso || '—';
    return 'Corrente';
  }

  function buildKpis(rows, ctx) {
    const qtdInicial = sum(rows, 'qtd_inicial');
    const qtdTransferida = sum(rows, 'qtd_enviada_liquida');
    const estoqueAtual = sum(rows, 'estoque_atual');
    const vendaTotal = rows.reduce((acc, row) => {
      return acc + Number(row.qtd_venda_interna_total || 0) + Number(row.qtd_venda_externa || 0);
    }, 0);

    const devolucaoTotal = rows.reduce((acc, row) => {
      return acc + Number(row.qtd_dev_cx_interna || 0) + Number(row.qtd_dev_cx_externa || 0);
    }, 0);

    const encalheTotal = sum(rows, 'qtd_encalhe');

    ctx.setKpis([
      {
        label: 'Qtd Inicial',
        value: qtdInicial,
        sub: `Concurso ${concursoLabel(ctx, rows)}`
      },
      {
        label: 'Qtd Transferida',
        value: qtdTransferida,
        sub: 'Envio líquido para terceiros'
      },
      {
        label: 'Estoque Atual',
        value: estoqueAtual,
        sub: 'Saldo operacional atual'
      },
      {
        label: 'Venda Total',
        value: vendaTotal,
        sub: 'Interna + externa'
      },
      {
        label: '% Venda',
        value: percent(vendaTotal, qtdInicial),
        sub: 'Sobre a carga inicial'
      },
      {
        label: '% Dev. Caixa',
        value: percent(devolucaoTotal, qtdInicial),
        sub: 'Interna + externa'
      },
      {
        label: '% Encalhe',
        value: percent(encalheTotal, qtdInicial),
        sub: 'Sobre a carga inicial'
      }
    ]);
  }

  function renderEmpty(message) {
    state.root.innerHTML = `
      <div class="empty">
        <div class="empty-title">Catálogo sem dados</div>
        <div class="empty-sub">${message || 'Nenhum concurso encontrado para os filtros atuais.'}</div>
      </div>
    `;
  }

  function renderOperacaoExterna(row) {
    const grupos = state.operacaoExterna.filter(
      x => String(x.federal_id) === String(row.federal_id)
    );

    if (!grupos.length) {
      return `
        <div class="soft-card">
          <div class="sep" style="margin-top:0">
            <span class="sep-label">Operação externa</span>
            <div class="sep-line"></div>
          </div>
          <div class="empty-sub">Sem operação externa registrada para este concurso.</div>
        </div>
      `;
    }

    return `
      <div class="soft-card">
        <div class="sep" style="margin-top:0">
          <span class="sep-label">Operação externa por destino</span>
          <div class="sep-line"></div>
          <span class="sep-count">${grupos.length}</span>
        </div>

        <div class="grid-2">
          ${grupos.map((g) => `
            <div class="card">
              <div class="flex" style="justify-content:space-between">
                <div>
                  <div class="page-sub" style="margin:0">Destino</div>
                  <div class="page-title" style="font-size:18px">${lookupLoteriaName(state.ctx.loterias, g.loja_destino_id)}</div>
                </div>
                <span class="badge b-info">Transferência</span>
              </div>

              <div class="grid-3" style="margin-top:12px">
                <div class="soft-card">
                  <div class="field-label">Enviada</div>
                  <div class="money">${Number(g.qtd_enviada || 0)}</div>
                </div>

                <div class="soft-card">
                  <div class="field-label">Venda</div>
                  <div class="money">${Number(g.qtd_vendida_externa || 0)}</div>
                </div>

                <div class="soft-card">
                  <div class="field-label">Devolução</div>
                  <div class="money">${Number(g.qtd_devolucao_externa || 0)}</div>
                </div>

                <div class="soft-card">
                  <div class="field-label">Cambista</div>
                  <div class="money">${Number(g.qtd_cambista_externa || 0)}</div>
                </div>

                <div class="soft-card">
                  <div class="field-label">Retorno</div>
                  <div class="money">${Number(g.qtd_retorno_origem || 0)}</div>
                </div>

                <div class="soft-card">
                  <div class="field-label">Acerto</div>
                  <div class="money">${fmtMoney(g.valor_acerto || 0)}</div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderResumoCard(row) {
    const vendaTotal = Number(row.qtd_venda_interna_total || 0) + Number(row.qtd_venda_externa || 0);
    const devolucaoTotal = Number(row.qtd_dev_cx_interna || 0) + Number(row.qtd_dev_cx_externa || 0);

    return `
      <section class="card" style="margin-bottom:14px">
        <div class="flex" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="page-title" style="font-size:20px">
              ${row.modalidade || 'Federal'} • Concurso ${row.concurso}
            </div>
            <div class="page-sub">
              ${row.loja_origem || lookupLoteriaName(state.ctx.loterias, row.loteria_id)} • Sorteio ${fmtDate(row.dt_sorteio)}
            </div>
          </div>

          <div class="inline-pills">
            <span class="pill">Fração ${fmtMoney(row.valor_fracao || 0)}</span>
            <span class="pill">Custo ${fmtMoney(row.valor_custo || 0)}</span>
            <span class="pill">Resultado ${fmtMoney(row.resultado || 0)}</span>
          </div>
        </div>

        <div class="sep">
          <span class="sep-label">Resumo operacional</span>
          <div class="sep-line"></div>
        </div>

        <div class="grid-4">
          <div class="soft-card">
            <div class="field-label">Qtd Inicial</div>
            <div class="money">${Number(row.qtd_inicial || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Venda Total</div>
            <div class="money">${vendaTotal}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Devolução Total</div>
            <div class="money">${devolucaoTotal}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Estoque Atual</div>
            <div class="money">${Number(row.estoque_atual || 0)}</div>
          </div>
        </div>

        <div class="grid-4" style="margin-top:12px">
          <div class="soft-card">
            <div class="field-label">Venda Interna</div>
            <div class="money">${Number(row.qtd_venda_interna_total || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Venda Externa</div>
            <div class="money">${Number(row.qtd_venda_externa || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Dev. Caixa Interna</div>
            <div class="money">${Number(row.qtd_dev_cx_interna || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Dev. Caixa Externa</div>
            <div class="money">${Number(row.qtd_dev_cx_externa || 0)}</div>
          </div>
        </div>

        <div class="grid-4" style="margin-top:12px">
          <div class="soft-card">
            <div class="field-label">Encalhe</div>
            <div class="money">${Number(row.qtd_encalhe || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Prêmio Encalhe</div>
            <div class="money">${fmtMoney(row.premio_encalhe_total || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Qtd Transferida</div>
            <div class="money">${Number(row.qtd_enviada_liquida || 0)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Receitas Terceiros</div>
            <div class="money">${fmtMoney(row.receitas_terceiros || 0)}</div>
          </div>
        </div>

        <div style="margin-top:14px">
          ${renderOperacaoExterna(row)}
        </div>
      </section>
    `;
  }

  function renderHeader(ctx) {
    return `
      <section class="card" style="margin-bottom:14px">
        <div class="grid-4">
          <div class="soft-card">
            <div class="field-label">Loja</div>
            <div class="money">${lookupLoteriaName(ctx.loterias, ctx.lojaSelecionada)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Concurso</div>
            <div class="money">${ctx.concursoSelecionado || 'Corrente'}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Data de referência</div>
            <div class="money">${fmtDate(ctx.dataReferencia)}</div>
          </div>

          <div class="soft-card">
            <div class="field-label">Qtd de registros</div>
            <div class="money">${state.resumo.length}</div>
          </div>
        </div>
      </section>
    `;
  }

  function render() {
    const ctx = state.ctx;

    if (!state.resumo.length) {
      ctx.setKpis([]);
      renderEmpty('Nenhum concurso encontrado para a loja e data de referência selecionadas.');
      return;
    }

    buildKpis(state.resumo, ctx);

    state.root.innerHTML = `
      ${renderHeader(ctx)}
      ${state.resumo.map(renderResumoCard).join('')}
    `;
  }

  async function loadData(ctx) {
    const filters = {
      loteriaId: ctx.lojaSelecionada,
      concurso: ctx.concursoSelecionado || undefined,
      dataReferencia: ctx.dataReferencia
    };

    const [resumo, operacaoExterna] = await Promise.all([
      API.loadResumoFederal(filters),
      API.loadOperacaoExternaPorLoja({
        loteriaOrigem: ctx.lojaSelecionada,
        concurso: ctx.concursoSelecionado || undefined,
        dataReferencia: ctx.dataReferencia
      })
    ]);

    state.resumo = resumo || [];
    state.operacaoExterna = operacaoExterna || [];
  }

  async function mount(root, ctx) {
    state.root = root;
    state.ctx = ctx;

    state.root.innerHTML = `
      <div class="empty">
        <div class="empty-title">Carregando catálogo...</div>
      </div>
    `;

    await refresh(ctx);
  }

  async function refresh(ctx) {
    state.ctx = ctx;

    try {
      ctx.showStatus('');
      await loadData(ctx);
      render();
    } catch (e) {
      console.error('[FEDERAL_CATALOGO.refresh]', e);
      ctx.setKpis([]);
      ctx.showStatus(e?.message || 'Erro ao carregar catálogo da Federal.', 'err');
      renderEmpty('Erro ao carregar os dados do catálogo.');
    }
  }

  window.FEDERAL_CATALOGO = {
    mount,
    refresh
  };
})();
