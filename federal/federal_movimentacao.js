(() => {
  'use strict';

  const API = window.FEDERAL_API || {};
  const fmtMoney = API.fmtMoney || ((v) => `R$ ${Number(v || 0).toFixed(2)}`);
  const fmtDate = API.fmtDate || ((v) => v || '—');
  const lookupLoteriaName = API.lookupLoteriaName || ((rows, id) => {
    const found = (rows || []).find(x => String(x.id) === String(id));
    return found?.nome || `Loja ${id}`;
  });
  const lookupFederal = API.lookupFederal || ((rows, id) => {
    return (rows || []).find(x => String(x.id) === String(id)) || null;
  });

  const state = {
    root: null,
    ctx: null,
    loterias: [],
    federais: [],
    movimentos: [],
    editingMovId: null
  };

  function q(sel) {
    return state.root?.querySelector(sel);
  }

  function showLocalStatus(message, kind = 'ok') {
    const el = q('#st-mov');
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

  function calcAcertoPreview(m) {
    const valorFracao = Number(
      m.valor_fracao_real ||
      m.valor_fracao ||
      m.federais?.valor_fracao ||
      0
    );

    const valorCusto = Number(m.federais?.valor_custo || 0);
    const qtdVendida = Number(m.qtd_vendida || 0);
    const qtdDevCx = Number(m.qtd_devolucao_caixa || 0);
    const qtdCambista = Number(m.qtd_venda_cambista || 0);
    const valorCambista = Number(m.valor_cambista || 0);

    return (
      (qtdVendida * valorFracao) +
      (qtdDevCx * valorCusto) +
      (qtdCambista * valorCambista)
    );
  }

  function getBadgeStatusClass(status) {
    return String(status || '').toUpperCase() === 'PAGO' ? 'b-ok' : 'b-warn';
  }

  function getCurrentMov() {
    return state.editingMovId
      ? state.movimentos.find(x => String(x.id) === String(state.editingMovId)) || null
      : null;
  }

  function isTransferencia() {
    return q('#fm-tipo-evento')?.value === 'TRANSFERENCIA';
  }

  function canUseAcerto() {
    return !!state.editingMovId && isTransferencia() && !!q('#fm-destino')?.value;
  }

  function isPago() {
    return String(q('#fm-status-acerto')?.value || '').toUpperCase() === 'PAGO';
  }

  function mapTipo(tipoEvento) {
    if (tipoEvento === 'TRANSFERENCIA') return 'ENVIO';
    if (tipoEvento === 'DEVOLUCAO_CAIXA') return 'DEVOLUCAO_CAIXA';
    if (tipoEvento === 'VENDA_CAMBISTA') return 'CAMBISTA';
    return tipoEvento || 'ENVIO';
  }

  function buildKpis() {
    const movs = state.movimentos || [];
    const total = movs.length;
    const transferencias = movs.filter(x => x.tipo_evento === 'TRANSFERENCIA').length;
    const pagas = movs.filter(x => String(x.status_acerto || '').toUpperCase() === 'PAGO').length;
    const pendentes = movs.filter(x => String(x.status_acerto || '').toUpperCase() !== 'PAGO').length;
    const qtdEnviada = sum(movs, 'qtd_fracoes');
    const valorAcerto = movs.reduce((acc, m) => acc + calcAcertoPreview(m), 0);

    state.ctx.setKpis([
      { label: 'Movimentações', value: total, sub: 'Registros filtrados' },
      { label: 'Transferências', value: transferencias, sub: 'Com destino informado' },
      { label: 'Pendentes', value: pendentes, sub: 'Acerto não pago' },
      { label: 'Pagas', value: pagas, sub: 'Acerto quitado' },
      { label: 'Qtd Enviada', value: qtdEnviada, sub: 'Frações movimentadas' },
      { label: 'Acerto Preview', value: fmtMoney(valorAcerto), sub: 'Prévia operacional' }
    ]);
  }

  function fillSelectFromRows(el, rows, placeholder, valueKey = 'id', labelFn = (x) => x.nome) {
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

  function getFederaisFiltradas() {
    let rows = [...(state.federais || [])];

    if (state.ctx?.lojaSelecionada) {
      rows = rows.filter(x => String(x.loteria_id) === String(state.ctx.lojaSelecionada));
    }

    if (state.ctx?.concursoSelecionado) {
      rows = rows.filter(x => String(x.concurso) === String(state.ctx.concursoSelecionado));
    }

    if (state.ctx?.dataReferencia) {
      rows = rows.filter(x => !x.dt_sorteio || x.dt_sorteio >= state.ctx.dataReferencia);
    }

    rows.sort((a, b) => {
      const dtCmp = String(a.dt_sorteio || '').localeCompare(String(b.dt_sorteio || ''));
      if (dtCmp !== 0) return dtCmp;
      return String(a.concurso || '').localeCompare(String(b.concurso || ''), undefined, { numeric: true });
    });

    return rows;
  }

  function fillStaticSelects() {
    const lotLabel = x => `${x.id} • ${x.nome}`;
    fillSelectFromRows(q('#fm-origem'), state.loterias, 'Selecione...', 'id', lotLabel);
    fillSelectFromRows(q('#fm-destino'), state.loterias, 'Selecione...', 'id', lotLabel);

    const federais = getFederaisFiltradas();
    fillSelectFromRows(
      q('#fm-federal'),
      federais,
      'Selecione...',
      'id',
      x => `${x.concurso} • ${fmtDate(x.dt_sorteio)}`
    );
  }

  function applyDestinoFilter() {
    const origem = q('#fm-origem')?.value;
    const sel = q('#fm-destino');
    if (!sel) return;

    [...sel.options].forEach((opt) => {
      if (!opt.value) {
        opt.hidden = false;
        return;
      }
      opt.hidden = !!origem && opt.value === origem;
    });

    if (origem && sel.value === origem) sel.value = '';
  }

  function syncMovValorByTipo({ keepIfFilled = false } = {}) {
    const f = lookupFederal(state.federais, q('#fm-federal')?.value);
    if (!f) return;

    const tipo = q('#fm-tipo-evento')?.value;
    const valorEl = q('#fm-valor');
    if (!valorEl) return;

    if (keepIfFilled && valorEl.value) return;

    if (tipo === 'DEVOLUCAO_CAIXA') {
      valorEl.value = Number(f.valor_custo || 0).toFixed(2);
    } else if (tipo === 'VENDA_CAMBISTA') {
      valorEl.value = '';
    } else {
      valorEl.value = Number(f.valor_fracao || 0).toFixed(2);
    }

    updateMovTotal();
  }

  function updateMovTotal() {
    const qtd = Number(q('#fm-qtd')?.value || 0);
    const valor = Number(q('#fm-valor')?.value || 0);
    if (q('#fm-total')) {
      q('#fm-total').value = qtd && valor ? (qtd * valor).toFixed(2) : '';
    }
  }

  function updateResumoAcerto() {
    const qtd = Number(q('#fm-qtd')?.value || 0);
    const vendida = Number(q('#fm-qtd-vendida')?.value || 0);
    const devCaixa = Number(q('#fm-qtd-dev-caixa')?.value || 0);
    const cambista = Number(q('#fm-qtd-cambista')?.value || 0);
    const retorno = Number(q('#fm-qtd-retorno')?.value || 0);

    const saldo = qtd - (vendida + devCaixa + cambista + retorno);
    const host = q('#fm-resumo-acerto');
    if (!host) return;

    const badgeClass = saldo === 0 ? 'b-ok' : 'b-warn';
    const badgeText = saldo === 0 ? 'Conferido' : 'Diferença';

    host.innerHTML = `
      <div class="grid-3" style="margin-top:12px">
        <div class="soft-card">
          <div class="field-label">Qtd enviada</div>
          <div class="money">${qtd}</div>
        </div>

        <div class="soft-card">
          <div class="field-label">Baixas lançadas</div>
          <div class="money">${vendida + devCaixa + cambista + retorno}</div>
        </div>

        <div class="soft-card">
          <div class="field-label">Saldo conferência</div>
          <div class="money">${saldo}</div>
        </div>
      </div>

      <div class="flex" style="margin-top:10px">
        <span class="badge ${badgeClass}">${badgeText}</span>
        <span class="muted mono">Enviado = vendida + devolução caixa + cambista + retorno origem</span>
      </div>
    `;
  }

  function setCommonFieldsDisabled(disabled) {
    [
      '#fm-federal',
      '#fm-origem',
      '#fm-destino',
      '#fm-tipo-evento',
      '#fm-qtd',
      '#fm-valor',
      '#fm-data-mov'
    ].forEach((sel) => {
      const el = q(sel);
      if (el) el.disabled = disabled;
    });
  }

  function setAcertoFieldsDisabled(disabled) {
    [
      '#fm-qtd-vendida',
      '#fm-qtd-dev-caixa',
      '#fm-qtd-cambista',
      '#fm-valor-cambista',
      '#fm-qtd-retorno'
    ].forEach((sel) => {
      const el = q(sel);
      if (el) el.disabled = disabled;
    });
  }

  function toggleModoAcerto(forceValue) {
    const chk = q('#fm-modo-acerto');
    const box = q('#fm-bloco-acerto');
    const hint = q('#fm-acerto-hint');

    if (!chk || !box) return;

    if (!canUseAcerto()) {
      chk.checked = false;
      chk.disabled = true;
      box.style.display = 'none';
      setCommonFieldsDisabled(false);
      setAcertoFieldsDisabled(true);

      if (hint) {
        hint.textContent = state.editingMovId
          ? 'Acerto final disponível apenas para transferências com destino.'
          : 'Salve a movimentação primeiro para liberar o acerto final.';
      }
      return;
    }

    chk.disabled = isPago();

    if (typeof forceValue === 'boolean') {
      chk.checked = forceValue;
    }

    const on = chk.checked;
    box.style.display = on ? '' : 'none';

    setCommonFieldsDisabled(on);
    setAcertoFieldsDisabled(!on);

    if (hint) {
      hint.textContent = on
        ? 'Campos comuns travados. Edite apenas o desfecho financeiro.'
        : 'Ative para lançar vendida, devolução, cambista e retorno.';
    }
  }

  function clearMov() {
    state.editingMovId = null;

    q('#fm-federal').value = '';
    q('#fm-modalidade').value = 'Federal';
    q('#fm-origem').value = state.ctx?.lojaSelecionada || '';
    q('#fm-destino').value = '';
    q('#fm-dt-concurso').value = '';
    q('#fm-tipo-evento').value = 'TRANSFERENCIA';
    q('#fm-qtd').value = '';
    q('#fm-valor').value = '';
    q('#fm-total').value = '';
    q('#fm-data-mov').value = state.ctx?.dataReferencia || new Date().toISOString().slice(0, 10);
    q('#fm-status-acerto').value = 'PENDENTE';
    q('#fm-observacao').value = '';

    q('#fm-qtd-vendida').value = '';
    q('#fm-qtd-dev-caixa').value = '';
    q('#fm-qtd-cambista').value = '';
    q('#fm-valor-cambista').value = '';
    q('#fm-qtd-retorno').value = '';

    q('#fm-modo-acerto').checked = false;
    q('#fm-status-acerto').disabled = true;
    q('#btn-excluir-mov').style.display = 'none';

    q('#fm-resumo-selec').innerHTML = `
      <div class="empty-title">Selecione um concurso</div>
      <div class="empty-sub">Resumo rápido da origem escolhida.</div>
    `;

    updateResumoAcerto();
    applyDestinoFilter();
    toggleModoAcerto(false);
    syncMovValorByTipo();
  }

  function renderResumoSelecao() {
    const f = lookupFederal(state.federais, q('#fm-federal')?.value);
    const host = q('#fm-resumo-selec');
    if (!host) return;

    if (!f) {
      host.innerHTML = `
        <div class="empty-title">Selecione um concurso</div>
        <div class="empty-sub">Resumo rápido da origem escolhida.</div>
      `;
      return;
    }

    host.innerHTML = `
      <div class="inline-pills">
        <span class="pill">Modalidade Federal</span>
        <span class="pill">Origem ${lookupLoteriaName(state.loterias, f.loteria_id)}</span>
        <span class="pill">Concurso ${f.concurso}</span>
        <span class="pill">Data ${fmtDate(f.dt_sorteio)}</span>
        <span class="pill">Fração ${fmtMoney(f.valor_fracao)}</span>
        <span class="pill">Custo ${fmtMoney(f.valor_custo)}</span>
      </div>
    `;
  }

  function renderMovCards() {
    const host = q('#lista-mov-cards');
    if (!host) return;

    if (!state.movimentos.length) {
      host.innerHTML = `
        <div class="mov-empty">
          <div class="empty-title">Sem movimentações</div>
          <div class="empty-sub">Nenhuma movimentação encontrada para os filtros atuais.</div>
        </div>
      `;
      return;
    }

    host.innerHTML = state.movimentos.map((m) => {
      const origem = lookupLoteriaName(state.loterias, m.loteria_origem);
      const destino = m.loteria_destino
        ? lookupLoteriaName(state.loterias, m.loteria_destino)
        : '—';

      const concurso = m.federais?.concurso || '—';
      const modalidade = m.federais?.modalidade || 'Federal';
      const data = m.federais?.dt_sorteio ? fmtDate(m.federais.dt_sorteio) : '—';
      const tipoEvento = m.tipo_evento || m.tipo || '—';
      const status = m.status_acerto || 'PENDENTE';
      const statusClass = getBadgeStatusClass(status);

      const qtdEnviada = Number(m.qtd_fracoes || 0);
      const qtdVendida = Number(m.qtd_vendida || 0);
      const qtdDevCaixa = Number(m.qtd_devolucao_caixa || 0);
      const qtdCambista = Number(m.qtd_venda_cambista || 0);
      const qtdRetorno = Number(m.qtd_retorno_origem || 0);

      const valorAcerto = calcAcertoPreview(m);
      const criadoEm = m.created_at
        ? new Date(m.created_at).toLocaleDateString('pt-BR')
        : fmtDate(m.data_mov);

      return `
        <article class="mov-card" data-id="${m.id}" tabindex="0" role="button" aria-label="Abrir movimentação ${concurso}">
          <div class="mov-card-head">
            <div>
              <div class="mov-card-title">${modalidade} • Concurso ${concurso}</div>
              <div class="mov-card-sub">Sorteio ${data}</div>
            </div>

            <div class="mov-card-badges">
              <span class="badge b-info">${tipoEvento}</span>
              <span class="badge ${statusClass}">${status}</span>
            </div>
          </div>

          <div class="mov-card-route">
            <span>${origem}</span>
            <span class="arrow">→</span>
            <span>${destino}</span>
          </div>

          <div class="mov-card-grid">
            <div class="mov-mini">
              <div class="mov-mini-label">Enviado</div>
              <div class="mov-mini-value">${qtdEnviada}</div>
            </div>

            <div class="mov-mini">
              <div class="mov-mini-label">Vendida</div>
              <div class="mov-mini-value">${qtdVendida}</div>
            </div>

            <div class="mov-mini">
              <div class="mov-mini-label">Dev. caixa</div>
              <div class="mov-mini-value">${qtdDevCaixa}</div>
            </div>

            <div class="mov-mini">
              <div class="mov-mini-label">Cambista</div>
              <div class="mov-mini-value">${qtdCambista}</div>
            </div>

            <div class="mov-mini">
              <div class="mov-mini-label">Retorno</div>
              <div class="mov-mini-value">${qtdRetorno}</div>
            </div>

            <div class="mov-mini">
              <div class="mov-mini-label">Criado em</div>
              <div class="mov-mini-value">${criadoEm}</div>
            </div>
          </div>

          <div class="mov-card-foot">
            <div class="hint">Clique para abrir a edição</div>
            <div class="money">${fmtMoney(valorAcerto)}</div>
          </div>
        </article>
      `;
    }).join('');
  }

  function openDrawer(title, subtitle) {
    q('#fm-drawer-title').textContent = title || 'Movimentação';
    q('#fm-drawer-sub').textContent = subtitle || '';
    q('#fm-overlay').classList.add('show');
    q('#fm-drawer').classList.add('open');
  }

  function closeDrawer() {
    q('#fm-overlay').classList.remove('show');
    q('#fm-drawer').classList.remove('open');
  }

  function openNewMov() {
    clearMov();
    fillStaticSelects();

    const federais = getFederaisFiltradas();
    if (federais.length === 1) {
      q('#fm-federal').value = String(federais[0].id);
      syncFederalInfoFromSelect();
    }

    openDrawer(
      'Nova movimentação',
      `${lookupLoteriaName(state.loterias, state.ctx?.lojaSelecionada)} • ${state.ctx?.concursoSelecionado || 'Concurso corrente'}`
    );
  }

  function syncFederalInfoFromSelect({ keepIfFilled = false } = {}) {
    const f = lookupFederal(state.federais, q('#fm-federal')?.value);
    if (!f) return;

    q('#fm-modalidade').value = f.modalidade || 'Federal';
    q('#fm-origem').value = f.loteria_id;
    q('#fm-dt-concurso').value = f.dt_sorteio || '';

    applyDestinoFilter();
    syncMovValorByTipo({ keepIfFilled });
    renderResumoSelecao();
    updateResumoAcerto();
    toggleModoAcerto();
  }

  function editMov(id) {
    const m = state.movimentos.find(x => String(x.id) === String(id));
    if (!m) return;

    state.editingMovId = id;
    fillStaticSelects();

    q('#fm-federal').value = m.federal_id || '';
    q('#fm-modalidade').value = m.federais?.modalidade || 'Federal';
    q('#fm-origem').value = m.loteria_origem || '';
    q('#fm-destino').value = m.loteria_destino || '';
    q('#fm-dt-concurso').value = m.federais?.dt_sorteio || '';
    q('#fm-tipo-evento').value = m.tipo_evento || 'TRANSFERENCIA';
    q('#fm-qtd').value = m.qtd_fracoes ?? '';
    q('#fm-valor').value = m.valor_fracao_real || m.valor_fracao || '';
    q('#fm-total').value = Number(
      m.valor_total_real ||
      m.valor_total ||
      (Number(m.qtd_fracoes || 0) * Number(m.valor_fracao_real || m.valor_fracao || 0))
    ).toFixed(2);

    q('#fm-data-mov').value = m.data_mov || '';
    q('#fm-status-acerto').value = m.status_acerto || 'PENDENTE';
    q('#fm-observacao').value = m.observacao || '';

    q('#fm-qtd-vendida').value = m.qtd_vendida ?? '';
    q('#fm-qtd-dev-caixa').value = m.qtd_devolucao_caixa ?? '';
    q('#fm-qtd-cambista').value = m.qtd_venda_cambista ?? '';
    q('#fm-valor-cambista').value = m.valor_cambista ?? '';
    q('#fm-qtd-retorno').value = m.qtd_retorno_origem ?? '';

    q('#btn-excluir-mov').style.display = 'inline-flex';

    renderResumoSelecao();
    applyDestinoFilter();
    updateResumoAcerto();
    toggleModoAcerto(false);

    const titulo = `Movimentação • ${m.federais?.concurso || ''}`;
    const subtitulo = `${lookupLoteriaName(state.loterias, m.loteria_origem)}${m.loteria_destino ? ` → ${lookupLoteriaName(state.loterias, m.loteria_destino)}` : ''}`;
    openDrawer(titulo, subtitulo);

    if (isPago()) {
      q('#fm-modo-acerto').disabled = true;
      setCommonFieldsDisabled(true);
      setAcertoFieldsDisabled(true);
    }
  }

  async function deleteMov(id = state.editingMovId) {
    if (!id) return;
    if (!confirm('Apagar esta linha de movimentação?')) return;

    try {
      const { error } = await API.sb
        .from('federal_movimentacoes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      showLocalStatus('Movimentação apagada.', 'ok');
      closeDrawer();
      clearMov();
      await refresh(state.ctx);
    } catch (e) {
      const msg = e?.message || 'Erro ao apagar movimentação.';
      if (msg.includes('acerto PAGO')) {
        showLocalStatus('Movimentação com acerto PAGO não pode ser excluída.', 'err');
        return;
      }
      showLocalStatus(msg, 'err');
    }
  }

  async function saveMov() {
    try {
      const modoAcerto = q('#fm-modo-acerto')?.checked === true;
      const movAtual = getCurrentMov();

      if (modoAcerto) {
        if (!state.editingMovId) {
          showLocalStatus('Salve a movimentação primeiro para lançar o acerto.', 'err');
          return;
        }

        const payloadAcerto = {
          qtd_vendida: Number(q('#fm-qtd-vendida')?.value || 0),
          qtd_devolucao_caixa: Number(q('#fm-qtd-dev-caixa')?.value || 0),
          qtd_venda_cambista: Number(q('#fm-qtd-cambista')?.value || 0),
          valor_cambista: Number(q('#fm-valor-cambista')?.value || 0),
          qtd_retorno_origem: Number(q('#fm-qtd-retorno')?.value || 0),
          observacao: q('#fm-observacao')?.value.trim() || null,
          updated_at: new Date().toISOString(),
          editado_por: state.ctx?.usuario?.id || null,
          editado_em: new Date().toISOString()
        };

        const { error } = await API.sb
          .from('federal_movimentacoes')
          .update(payloadAcerto)
          .eq('id', state.editingMovId);

        if (error) throw error;

        showLocalStatus('Acerto final salvo.', 'ok');
        closeDrawer();
        clearMov();
        await refresh(state.ctx);
        return;
      }

      const federal = lookupFederal(state.federais, q('#fm-federal')?.value);
      const qtd = Number(q('#fm-qtd')?.value || 0);
      const valor = Number(q('#fm-valor')?.value || 0);
      const tipoEvento = q('#fm-tipo-evento')?.value;

      const payload = {
        federal_id: q('#fm-federal')?.value || null,
        loteria_origem: Number(q('#fm-origem')?.value || 0) || null,
        loteria_destino: tipoEvento === 'TRANSFERENCIA'
          ? (Number(q('#fm-destino')?.value || 0) || null)
          : null,
        tipo: mapTipo(tipoEvento),
        tipo_evento: tipoEvento,
        qtd_fracoes: qtd,
        valor_fracao: valor,
        valor_fracao_ref: Number(federal?.valor_fracao || 0),
        valor_fracao_real: valor,
        data_mov: q('#fm-data-mov')?.value || movAtual?.data_mov || new Date().toISOString().slice(0, 10),
        observacao: q('#fm-observacao')?.value.trim() || null,
        updated_at: new Date().toISOString()
      };

      if (!payload.federal_id || !payload.tipo_evento || !payload.qtd_fracoes || !payload.loteria_origem) {
        showLocalStatus('Preencha concurso, origem, evento e quantidade.', 'err');
        return;
      }

      if (payload.tipo_evento === 'TRANSFERENCIA' && !payload.loteria_destino) {
        showLocalStatus('Selecione a loja destino.', 'err');
        return;
      }

      if (state.editingMovId) {
        payload.editado_por = state.ctx?.usuario?.id || null;
        payload.editado_em = new Date().toISOString();

        const { error } = await API.sb
          .from('federal_movimentacoes')
          .update(payload)
          .eq('id', state.editingMovId);

        if (error) throw error;

        showLocalStatus('Movimentação atualizada.', 'ok');
      } else {
        payload.criado_por = state.ctx?.usuario?.id || null;
        payload.status_acerto = 'PENDENTE';

        const { error } = await API.sb
          .from('federal_movimentacoes')
          .insert(payload);

        if (error) throw error;

        showLocalStatus('Movimentação registrada.', 'ok');
      }

      closeDrawer();
      clearMov();
      await refresh(state.ctx);
    } catch (e) {
      const msg = e?.message || 'Erro ao salvar movimentação.';
      if (msg.includes('acerto PAGO')) {
        showLocalStatus('Movimentação com acerto PAGO não pode ser alterada.', 'err');
        return;
      }
      showLocalStatus(msg, 'err');
    }
  }

  async function loadData(ctx) {
    state.loterias = ctx.loterias || [];
    state.federais = await API.loadFederais();

    state.movimentos = await API.loadMovimentacoesFederal({
      loteriaOrigem: ctx.lojaSelecionada,
      concurso: ctx.concursoSelecionado || undefined,
      dataReferencia: ctx.dataReferencia
    });
  }

  function renderShell() {
    state.root.innerHTML = `
      <div id="st-mov" class="status-bar"></div>

      <section class="card" style="margin-bottom:14px">
        <div class="toolbar">
          <div class="toolbar-left">
            <button id="btn-nova-mov" class="btn-primary" type="button">Nova movimentação</button>
          </div>

          <div class="toolbar-right">
            <span class="pill">Loja ${lookupLoteriaName(state.ctx?.loterias || [], state.ctx?.lojaSelecionada)}</span>
            <span class="pill">Concurso ${state.ctx?.concursoSelecionado || 'Corrente'}</span>
            <span class="pill">Data ref ${fmtDate(state.ctx?.dataReferencia)}</span>
          </div>
        </div>
      </section>

      <div id="lista-mov-cards" class="mov-cards"></div>

      <div id="fm-overlay" class="overlay"></div>

      <aside id="fm-drawer" class="drawer">
        <div class="drawer-head">
          <div>
            <div id="fm-drawer-title" class="drawer-title">Movimentação</div>
            <div id="fm-drawer-sub" class="drawer-sub"></div>
          </div>

          <button id="btn-close-drawer-mov" class="btn-secondary" type="button">Fechar</button>
        </div>

        <div class="drawer-body">
          <div class="card" style="margin-bottom:14px">
            <div id="fm-resumo-selec" class="empty">
              <div class="empty-title">Selecione um concurso</div>
              <div class="empty-sub">Resumo rápido da origem escolhida.</div>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label class="field-label req">Concurso</label>
              <select id="fm-federal"></select>
            </div>

            <div class="field">
              <label class="field-label">Modalidade</label>
              <input id="fm-modalidade" type="text" readonly value="Federal" />
            </div>
          </div>

          <div class="grid-3" style="margin-top:14px">
            <div class="field">
              <label class="field-label req">Loja origem</label>
              <select id="fm-origem"></select>
            </div>

            <div class="field">
              <label class="field-label">Loja destino</label>
              <select id="fm-destino"></select>
            </div>

            <div class="field">
              <label class="field-label">Data do concurso</label>
              <input id="fm-dt-concurso" type="date" readonly />
            </div>
          </div>

          <div class="grid-4" style="margin-top:14px">
            <div class="field">
              <label class="field-label req">Tipo de evento</label>
              <select id="fm-tipo-evento">
                <option value="TRANSFERENCIA">TRANSFERÊNCIA</option>
                <option value="DEVOLUCAO_CAIXA">DEVOLUÇÃO CAIXA</option>
                <option value="VENDA_CAMBISTA">CAMBISTA</option>
              </select>
            </div>

            <div class="field">
              <label class="field-label req">Qtd frações</label>
              <input id="fm-qtd" type="number" min="0" step="1" />
            </div>

            <div class="field">
              <label class="field-label">Valor unitário</label>
              <input id="fm-valor" type="number" min="0" step="0.01" />
            </div>

            <div class="field">
              <label class="field-label">Valor total</label>
              <input id="fm-total" type="number" readonly />
            </div>
          </div>

          <div class="grid-2" style="margin-top:14px">
            <div class="field">
              <label class="field-label">Data da movimentação</label>
              <input id="fm-data-mov" type="date" />
            </div>

            <div class="field">
              <label class="field-label">Status acerto</label>
              <input id="fm-status-acerto" type="text" readonly />
            </div>
          </div>

          <div class="field" style="margin-top:14px">
            <label class="field-label">Observação</label>
            <textarea id="fm-observacao" placeholder="Observações da movimentação ou do acerto"></textarea>
          </div>

          <div class="card" style="margin-top:16px">
            <div class="flex" style="justify-content:space-between">
              <label class="flex" style="cursor:pointer">
                <input id="fm-modo-acerto" type="checkbox" />
                <span class="field-label" style="margin:0">Editar acerto final</span>
              </label>

              <span class="badge b-info">Transferência</span>
            </div>

            <div id="fm-acerto-hint" class="empty-sub" style="margin-top:10px">
              Salve a movimentação primeiro para liberar o acerto final.
            </div>

            <div id="fm-bloco-acerto" style="display:none;margin-top:14px">
              <div class="grid-3">
                <div class="field">
                  <label class="field-label">Qtd vendida</label>
                  <input id="fm-qtd-vendida" type="number" min="0" step="1" />
                </div>

                <div class="field">
                  <label class="field-label">Qtd devolução caixa</label>
                  <input id="fm-qtd-dev-caixa" type="number" min="0" step="1" />
                </div>

                <div class="field">
                  <label class="field-label">Qtd venda cambista</label>
                  <input id="fm-qtd-cambista" type="number" min="0" step="1" />
                </div>

                <div class="field">
                  <label class="field-label">Valor cambista</label>
                  <input id="fm-valor-cambista" type="number" min="0" step="0.01" />
                </div>

                <div class="field">
                  <label class="field-label">Qtd retorno origem</label>
                  <input id="fm-qtd-retorno" type="number" min="0" step="1" />
                </div>
              </div>

              <div id="fm-resumo-acerto"></div>
            </div>
          </div>
        </div>

        <div class="drawer-foot">
          <button id="btn-excluir-mov" class="btn-danger" type="button" style="display:none">Excluir</button>
          <button id="btn-cancel-drawer-mov" class="btn-secondary" type="button">Cancelar</button>
          <button id="btn-save-mov" class="btn-primary" type="button">Salvar</button>
        </div>
      </aside>
    `;
  }

  function bindEvents() {
    q('#btn-nova-mov')?.addEventListener('click', openNewMov);

    q('#lista-mov-cards')?.addEventListener('click', (e) => {
      const card = e.target.closest('.mov-card[data-id]');
      if (!card) return;
      editMov(card.dataset.id);
    });

    q('#lista-mov-cards')?.addEventListener('keydown', (e) => {
      const card = e.target.closest('.mov-card[data-id]');
      if (!card) return;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        editMov(card.dataset.id);
      }
    });

    q('#fm-federal')?.addEventListener('change', () => {
      syncFederalInfoFromSelect();
    });

    q('#fm-origem')?.addEventListener('change', applyDestinoFilter);

    q('#fm-tipo-evento')?.addEventListener('change', () => {
      syncMovValorByTipo();
      toggleModoAcerto(false);
    });

    ['#fm-qtd', '#fm-valor'].forEach((sel) => {
      q(sel)?.addEventListener('input', updateMovTotal);
    });

    ['#fm-qtd', '#fm-qtd-vendida', '#fm-qtd-dev-caixa', '#fm-qtd-cambista', '#fm-qtd-retorno']
      .forEach((sel) => {
        q(sel)?.addEventListener('input', updateResumoAcerto);
      });

    q('#fm-modo-acerto')?.addEventListener('change', () => {
      toggleModoAcerto();
    });

    q('#btn-save-mov')?.addEventListener('click', saveMov);
    q('#btn-excluir-mov')?.addEventListener('click', () => deleteMov());
    q('#btn-cancel-drawer-mov')?.addEventListener('click', () => {
      closeDrawer();
      clearMov();
    });
    q('#btn-close-drawer-mov')?.addEventListener('click', () => {
      closeDrawer();
      clearMov();
    });
    q('#fm-overlay')?.addEventListener('click', () => {
      closeDrawer();
      clearMov();
    });
  }

  async function mount(root, ctx) {
    state.root = root;
    state.ctx = ctx;

    renderShell();
    bindEvents();
    await refresh(ctx);
    clearMov();
  }

  async function refresh(ctx) {
    state.ctx = ctx;

    try {
      showLocalStatus('');
      await loadData(ctx);
      fillStaticSelects();
      renderMovCards();
      buildKpis();
    } catch (e) {
      const msg =
        e?.message ||
        e?.details ||
        e?.hint ||
        e?.error_description ||
        JSON.stringify(e) ||
        'Erro ao carregar movimentações da Federal.';
    
      console.error('[FEDERAL_MOVIMENTACAO.refresh]', {
        raw: e,
        message: e?.message,
        details: e?.details,
        hint: e?.hint,
        code: e?.code
      });
    
      state.ctx.setKpis([]);
      showLocalStatus(msg, 'err');
      q('#lista-mov-cards').innerHTML = `
        <div class="mov-empty">
          <div class="empty-title">Erro ao carregar</div>
          <div class="empty-sub">${msg}</div>
        </div>
      `;
    }
  }

  window.FEDERAL_MOVIMENTACAO = {
    mount,
    refresh
  };
})();
