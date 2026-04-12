(() => {
  'use strict';

  const API = window.FEDERAL_API || {};
  const fmtMoney = API.fmtMoney || ((v) => `R$ ${Number(v || 0).toFixed(2)}`);
  const fmtDate = API.fmtDate || ((v) => v || '—');
  const nextWedOrSat = API.nextWedOrSat || (() => '');
  const nextQuaSabFrom = API.nextQuaSabFrom || ((d) => d || '');

  const state = {
    root: null,
    ctx: null,
    federais: [],
    editingCadastroConcurso: null
  };

  const QTD_PADRAO = {
    qua: { centro: 80, boulevard: 80, lotobel: 60, santa: 0, via: 0 },
    sab: { centro: 80, boulevard: 70, lotobel: 120, santa: 0, via: 0 }
  };

  function q(sel) {
    return state.root?.querySelector(sel);
  }

  function qq(sel) {
    return [...(state.root?.querySelectorAll(sel) || [])];
  }

  function normalizeName(nome) {
    const n = String(nome || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (n.includes('boulevard')) return 'boulevard';
    if (n.includes('lotobel')) return 'lotobel';
    if (n.includes('centro')) return 'centro';
    if (n.includes('santa')) return 'santa';
    if (n.includes('via')) return 'via';
    return '';
  }

  function showLocalStatus(message, kind = 'ok') {
    const el = q('#st-cadastro');
    if (!el) return;

    if (!message) {
      el.className = 'status-bar';
      el.textContent = '';
      return;
    }

    el.className = `status-bar show ${kind}`;
    el.textContent = message;
  }

  function getQtdInputId(loteriaId) {
    return `cad-qtd-${loteriaId}`;
  }

  function getQtdInput(loteriaId) {
    return q(`#${CSS.escape(getQtdInputId(loteriaId))}`);
  }

  function applyFederalType(tipo) {
    if (tipo === 'ESPECIAL') {
      q('#cad-valor-fracao').value = '10.00';
      q('#cad-valor-custo').value = '8.04';
    } else {
      q('#cad-valor-fracao').value = '4.00';
      q('#cad-valor-custo').value = '3.21';
    }
  }

  function suggestNextConcurso() {
    const nums = state.federais
      .map(f => parseInt(f.concurso, 10))
      .filter(n => !isNaN(n));

    return nums.length ? String(Math.max(...nums) + 1) : '';
  }

  function suggestNextSorteio() {
    if (!state.federais.length) return nextWedOrSat();

    const dates = state.federais
      .map(f => f.dt_sorteio)
      .filter(Boolean)
      .sort()
      .reverse();

    return nextQuaSabFrom(dates[0], 1);
  }

  function fillQtdPadraoCadastro() {
    const rawDate = q('#cad-dt-sorteio').value;
    const d = rawDate ? new Date(`${rawDate}T12:00:00`) : new Date();
    const day = d.getDay();
    const pad = day === 6 ? QTD_PADRAO.sab : QTD_PADRAO.qua;

    (state.ctx?.loterias || []).forEach((lot) => {
      const key = normalizeName(lot.nome);
      const input = getQtdInput(lot.id);
      if (!input) return;
      input.value = Number(pad[key] ?? 0);
    });
  }

  function setCadastroDefaults() {
    state.editingCadastroConcurso = null;

    q('#cad-concurso').value = suggestNextConcurso();
    q('#cad-dt-sorteio').value = suggestNextSorteio();
    q('#cad-tipo').value = 'COMUM';
    q('#cad-fracoes-bilhete').value = '10';

    applyFederalType('COMUM');
    fillQtdPadraoCadastro();
  }

  function groupByConcurso(rows) {
    const grouped = Object.values(
      (rows || []).reduce((acc, f) => {
        const key = String(f.concurso || '').trim();
        if (!key) return acc;

        if (!acc[key]) {
          acc[key] = {
            concurso: f.concurso,
            dt_sorteio: f.dt_sorteio,
            valor_fracao: f.valor_fracao,
            valor_custo: f.valor_custo,
            qt_fracoes_bilhete: f.qt_fracoes_bilhete,
            itens: []
          };
        }

        acc[key].itens.push(f);
        return acc;
      }, {})
    );

    return grouped.sort((a, b) =>
      String(b.concurso).localeCompare(String(a.concurso), undefined, { numeric: true })
    );
  }

  function renderQtdFields() {
    const loterias = state.ctx?.loterias || [];

    return loterias.map((lot) => `
      <div class="field">
        <label class="field-label">${lot.nome}</label>
        <input
          id="${getQtdInputId(lot.id)}"
          type="number"
          min="0"
          step="1"
          value="0"
        />
      </div>
    `).join('');
  }

  function renderCadastroList() {
    const grupos = groupByConcurso(state.federais);
    q('#cnt-cadastros').textContent = String(grupos.length);

    const host = q('#tbody-cadastro');
    if (!host) return;

    if (!grupos.length) {
      host.innerHTML = `
        <tr>
          <td colspan="10">
            <div class="empty">
              <div class="empty-title">Nenhum concurso cadastrado</div>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    host.innerHTML = grupos.map((g) => {
      const tipo = Number(g.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
      const totalIni = g.itens.reduce((a, x) => a + Number(x.qtd_recebidas || 0), 0);
      const totalDev = g.itens.reduce((a, x) => a + Number(x.qtd_devolvidas || 0), 0);
      const totalEnc = g.itens.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);

      return `
        <tr>
          <td>Todos</td>
          <td class="mono">${g.concurso}</td>
          <td class="mono">${fmtDate(g.dt_sorteio)}</td>
          <td><span class="badge ${tipo === 'COMUM' ? 'b-info' : 'b-warn'}">${tipo}</span></td>
          <td class="money">${fmtMoney(g.valor_fracao)}</td>
          <td class="money">${fmtMoney(g.valor_custo)}</td>
          <td class="mono">${totalIni}</td>
          <td class="mono">${totalDev}</td>
          <td class="mono">${totalEnc}</td>
          <td>
            <div class="flex" style="flex-wrap:nowrap;gap:6px">
              <button class="btn-amber" data-action="editar" data-concurso="${g.concurso}" type="button">Editar</button>
              <button class="btn-danger" data-action="excluir" data-concurso="${g.concurso}" type="button">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function refreshCadastroData() {
    state.federais = await API.loadFederais();
  }

  function editCadastro(concurso) {
    const itens = state.federais.filter(x => String(x.concurso) === String(concurso));
    const f = itens[0];
    if (!f) return;

    state.editingCadastroConcurso = String(concurso);

    q('#cad-concurso').value = f.concurso;
    q('#cad-dt-sorteio').value = f.dt_sorteio;
    q('#cad-tipo').value = Number(f.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
    q('#cad-valor-fracao').value = f.valor_fracao;
    q('#cad-valor-custo').value = f.valor_custo;
    q('#cad-fracoes-bilhete').value = f.qt_fracoes_bilhete;

    (state.ctx?.loterias || []).forEach((lot) => {
      const item = itens.find(x => String(x.loteria_id) === String(lot.id));
      const input = getQtdInput(lot.id);
      if (input) input.value = item?.qtd_recebidas || 0;
    });
  }

  async function deleteCadastro(concurso) {
    const concursoTrim = String(concurso || '').trim();
    if (!concursoTrim) return;

    if (!confirm(`Excluir o concurso ${concursoTrim} em todas as loterias?`)) return;

    try {
      const info = await API.rpcValidarExclusaoConcurso(concursoTrim);

      if (!info) {
        showLocalStatus('Não foi possível validar a exclusão.', 'err');
        return;
      }

      if (!info.pode_excluir) {
        showLocalStatus(`Exclusão bloqueada: ${info.motivo}`, 'err');
        return;
      }

      const { error } = await API.sb
        .from('federais')
        .delete()
        .eq('concurso', concursoTrim);

      if (error) throw error;

      if (String(state.editingCadastroConcurso || '').trim() === concursoTrim) {
        state.editingCadastroConcurso = null;
        setCadastroDefaults();
      }

      showLocalStatus(`Concurso ${concursoTrim} excluído.`, 'ok');
      await refresh(state.ctx);
    } catch (e) {
      showLocalStatus(e?.message || 'Erro ao excluir concurso.', 'err');
    }
  }

  async function saveCadastro() {
    try {
      const concurso = q('#cad-concurso').value.trim();
      const dt_sorteio = q('#cad-dt-sorteio').value;
      const valor_fracao = Number(q('#cad-valor-fracao').value || 0);
      const valor_custo = Number(q('#cad-valor-custo').value || 0);
      const qt_fracoes_bilhete = Number(q('#cad-fracoes-bilhete').value || 10);

      if (!concurso || !dt_sorteio) {
        showLocalStatus('Preencha concurso e data.', 'err');
        return;
      }

      const mapa = (state.ctx?.loterias || []).map((lot) => ({
        id: lot.id,
        qtd: Number(getQtdInput(lot.id)?.value || 0)
      }));

      if (!mapa.length) {
        showLocalStatus('Nenhuma loteria disponível para cadastro.', 'err');
        return;
      }

      if (state.editingCadastroConcurso) {
        for (const item of mapa) {
          const { error } = await API.sb
            .from('federais')
            .update({
              concurso,
              dt_sorteio,
              valor_fracao,
              valor_custo,
              qt_fracoes_bilhete,
              qtd_recebidas: item.qtd,
              updated_at: new Date().toISOString()
            })
            .eq('concurso', state.editingCadastroConcurso)
            .eq('loteria_id', item.id);

          if (error) throw error;
        }

        showLocalStatus('Concurso atualizado em todas as loterias.', 'ok');
      } else {
        for (const item of mapa) {
          const { error } = await API.sb
            .from('federais')
            .insert({
              loteria_id: item.id,
              modalidade: 'Federal',
              concurso,
              dt_sorteio,
              valor_fracao,
              valor_custo,
              qt_fracoes_bilhete,
              qtd_recebidas: item.qtd,
              qtd_devolvidas: 0,
              qtd_encalhe: 0,
              ativo: true,
              criado_por: state.ctx?.usuario?.id || null,
              updated_at: new Date().toISOString()
            });

          if (error) throw error;
        }

        showLocalStatus('Federais cadastradas para todas as loterias.', 'ok');
      }

      await refresh(state.ctx);
      setCadastroDefaults();
    } catch (e) {
      showLocalStatus(e?.message || 'Erro ao salvar cadastro.', 'err');
    }
  }

  function bindEvents() {
    q('#btn-salvar-cadastro')?.addEventListener('click', saveCadastro);
    q('#btn-limpar-cadastro')?.addEventListener('click', () => {
      showLocalStatus('');
      setCadastroDefaults();
    });

    q('#cad-tipo')?.addEventListener('change', (e) => {
      applyFederalType(e.target.value);
    });

    q('#cad-dt-sorteio')?.addEventListener('change', fillQtdPadraoCadastro);

    q('#cad-data-prev')?.addEventListener('click', () => {
      q('#cad-dt-sorteio').value = nextQuaSabFrom(
        q('#cad-dt-sorteio').value || suggestNextSorteio(),
        -1
      );
      fillQtdPadraoCadastro();
    });

    q('#cad-data-next')?.addEventListener('click', () => {
      q('#cad-dt-sorteio').value = nextQuaSabFrom(
        q('#cad-dt-sorteio').value || suggestNextSorteio(),
        1
      );
      fillQtdPadraoCadastro();
    });

    q('#tbody-cadastro')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const concurso = btn.dataset.concurso;
      if (btn.dataset.action === 'editar') editCadastro(concurso);
      if (btn.dataset.action === 'excluir') deleteCadastro(concurso);
    });
  }

  function renderShell() {
    state.root.innerHTML = `
      <div id="st-cadastro" class="status-bar"></div>

      <section class="card" style="margin-bottom:14px">
        <div class="sep" style="margin-top:0">
          <span class="sep-label">Novo concurso</span>
          <div class="sep-line"></div>
        </div>

        <div class="grid-4">
          <div class="field">
            <label class="field-label req">Concurso</label>
            <input id="cad-concurso" type="text" />
          </div>

          <div class="field">
            <label class="field-label req">Data do sorteio</label>
            <div class="flex" style="flex-wrap:nowrap">
              <button id="cad-data-prev" class="btn-secondary" type="button">◀</button>
              <input id="cad-dt-sorteio" type="date" />
              <button id="cad-data-next" class="btn-secondary" type="button">▶</button>
            </div>
          </div>

          <div class="field">
            <label class="field-label">Tipo</label>
            <select id="cad-tipo">
              <option value="COMUM">COMUM</option>
              <option value="ESPECIAL">ESPECIAL</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label">Frações por bilhete</label>
            <input id="cad-fracoes-bilhete" type="number" min="1" step="1" />
          </div>
        </div>

        <div class="grid-2" style="margin-top:14px">
          <div class="field">
            <label class="field-label">Valor da fração</label>
            <input id="cad-valor-fracao" type="number" min="0" step="0.01" />
          </div>

          <div class="field">
            <label class="field-label">Valor de custo</label>
            <input id="cad-valor-custo" type="number" min="0" step="0.01" />
          </div>
        </div>

        <div class="sep">
          <span class="sep-label">Distribuição por loteria</span>
          <div class="sep-line"></div>
        </div>

        <div class="grid-3" id="cad-grid-qtd">
          ${renderQtdFields()}
        </div>

        <div class="toolbar" style="margin-top:16px">
          <div class="toolbar-left">
            <button id="btn-salvar-cadastro" class="btn-primary" type="button">Salvar</button>
            <button id="btn-limpar-cadastro" class="btn-secondary" type="button">Limpar</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="sep" style="margin-top:0">
          <span class="sep-label">Concursos cadastrados</span>
          <div class="sep-line"></div>
          <span class="sep-count" id="cnt-cadastros">0</span>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Lojas</th>
                <th>Concurso</th>
                <th>Sorteio</th>
                <th>Tipo</th>
                <th>Fração</th>
                <th>Custo</th>
                <th>Qtd Inicial</th>
                <th>Devolvida</th>
                <th>Encalhe</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="tbody-cadastro"></tbody>
          </table>
        </div>
      </section>
    `;
  }

  async function mount(root, ctx) {
    state.root = root;
    state.ctx = ctx;

    renderShell();
    bindEvents();
    await refresh(ctx);
    setCadastroDefaults();
  }

  async function refresh(ctx) {
    state.ctx = ctx;

    try {
      showLocalStatus('');
      await refreshCadastroData();
      renderCadastroList();
    } catch (e) {
      console.error('[FEDERAL_CADASTRO.refresh]', e);
      showLocalStatus(e?.message || 'Erro ao carregar cadastro da Federal.', 'err');
    }
  }

  window.FEDERAL_CADASTRO = {
    mount,
    refresh
  };
})();
