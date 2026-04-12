(() => {
  'use strict';

  const BASE = window.FED_BASE || {};
  const sb = BASE.sb;

  if (!sb) {
    console.error('[FEDERAL_API] FED_BASE.sb não encontrado.');
    window.FEDERAL_API = {};
    return;
  }

  function uniqBy(items, getKey) {
    const map = new Map();
    (items || []).forEach((item) => {
      const key = getKey(item);
      if (!map.has(key)) map.set(key, item);
    });
    return [...map.values()];
  }

  function sortConcursos(rows) {
    return [...(rows || [])].sort((a, b) => {
      const dtCmp = String(a.dt_sorteio || '').localeCompare(String(b.dt_sorteio || ''));
      if (dtCmp !== 0) return dtCmp;
      return String(a.concurso || '').localeCompare(String(b.concurso || ''), undefined, { numeric: true });
    });
  }

  function distinctConcursos(rows) {
    const base = (rows || [])
      .filter(x => String(x.concurso || '').trim())
      .map((x) => ({
        concurso: String(x.concurso || '').trim(),
        dt_sorteio: x.dt_sorteio || null,
        ativo: x.ativo !== false
      }));

    return sortConcursos(
      uniqBy(base, (x) => `${x.concurso}__${x.dt_sorteio || ''}`)
    );
  }

  function normalizeLoterias(rows) {
    return (rows || []).map((row) => ({
      id: row.id ?? row.loteria_id ?? row.loja_id ?? null,
      nome: row.nome ?? row.loteria_nome ?? row.loja_nome ?? '',
      principal:
        row.principal === true ||
        row.is_principal === true ||
        row.loteria_principal === true ||
        row.loja_principal === true ||
        row.eh_principal === true,
      raw: row
    })).filter(x => x.id != null);
  }

  async function loadLoterias() {
    if (typeof BASE.loadLoterias === 'function') {
      const rows = await BASE.loadLoterias();
      return normalizeLoterias(rows);
    }

    const { data, error } = await sb
      .from('loterias')
      .select('*')
      .eq('ativo', true)
      .order('id');

    if (error) throw error;
    return normalizeLoterias(data || []);
  }

  async function loadFederais() {
    if (typeof BASE.loadFederais === 'function') {
      return await BASE.loadFederais();
    }

    const { data, error } = await sb
      .from('federais')
      .select('*')
      .order('dt_sorteio', { ascending: false })
      .order('concurso', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function loadConcursosByLoja(loteriaId) {
    if (!loteriaId) return [];

    const rows = await loadFederais();
    const filtrados = rows.filter(x => String(x.loteria_id) === String(loteriaId));
    return distinctConcursos(filtrados);
  }

  async function loadResumoFederal(filters = {}) {
    let query = sb
      .from('view_resumo_federal')
      .select('*');

    if (filters.loteriaId) {
      query = query.eq('loteria_id', filters.loteriaId);
    }

    if (filters.concurso) {
      query = query.eq('concurso', String(filters.concurso).trim());
    }

    if (filters.dataReferencia) {
      query = query.gte('dt_sorteio', filters.dataReferencia);
    }

    if (filters.dtIni) {
      query = query.gte('dt_sorteio', filters.dtIni);
    }

    if (filters.dtFim) {
      query = query.lte('dt_sorteio', filters.dtFim);
    }

    query = query
      .order('dt_sorteio', { ascending: true })
      .order('concurso', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function loadMovimentacoesFederal(filters = {}) {
    let query = sb
      .from('federal_movimentacoes')
      .select(`
  *,
  federais!inner(
    id,
    concurso,
    dt_sorteio,
    modalidade,
    valor_fracao,
    valor_custo,
    loteria_id
  )
`)
    if (filters.federalId) {
      query = query.eq('federal_id', filters.federalId);
    }

    if (filters.loteriaOrigem) {
      query = query.eq('loteria_origem', filters.loteriaOrigem);
    }

    if (filters.loteriaDestino) {
      query = query.eq('loteria_destino', filters.loteriaDestino);
    }

    if (filters.tipoEvento) {
      query = query.eq('tipo_evento', filters.tipoEvento);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    let rows = data || [];

    if (filters.concurso) {
      rows = rows.filter(x => String(x.federais?.concurso || '').trim() === String(filters.concurso).trim());
    }

    if (filters.dataReferencia) {
      rows = rows.filter(x => !x.federais?.dt_sorteio || x.federais.dt_sorteio >= filters.dataReferencia);
    }

    return rows;
  }

  async function loadVendasFuncionarioFederal(filters = {}) {
    let query = sb
      .from('view_federal_vendas_funcionario')
      .select('*');

    if (filters.federalId) {
      query = query.eq('federal_id', filters.federalId);
    }

    if (filters.loteriaId) {
      query = query.eq('loteria_id', filters.loteriaId);
    }

    if (filters.concurso) {
      query = query.eq('concurso', String(filters.concurso).trim());
    }

    if (filters.dataReferencia) {
      query = query.gte('dt_sorteio', filters.dataReferencia);
    }

    query = query
      .order('dt_sorteio', { ascending: false })
      .order('funcionario_nome', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function loadOperacaoExternaPorLoja(filters = {}) {
    const rows = await loadMovimentacoesFederal({
      loteriaOrigem: filters.loteriaOrigem,
      concurso: filters.concurso,
      dataReferencia: filters.dataReferencia,
      tipoEvento: 'TRANSFERENCIA'
    });

    const filtrados = rows.filter((m) => {
      if (!m.loteria_destino) return false;
      if (filters.federalId && String(m.federal_id) !== String(filters.federalId)) return false;
      return true;
    });

    const grupos = new Map();

    filtrados.forEach((m) => {
      const key = `${m.federal_id}__${m.loteria_destino}`;
      const valorFracao = Number(
        m.valor_fracao_real ||
        m.valor_fracao ||
        m.federais?.valor_fracao ||
        0
      );
      const valorCusto = Number(m.federais?.valor_custo || 0);

      if (!grupos.has(key)) {
        grupos.set(key, {
          federal_id: m.federal_id,
          concurso: m.federais?.concurso || '',
          loja_origem_id: m.loteria_origem,
          loja_destino_id: m.loteria_destino,
          qtd_enviada: 0,
          qtd_vendida_externa: 0,
          qtd_devolucao_externa: 0,
          qtd_cambista_externa: 0,
          qtd_retorno_origem: 0,
          valor_acerto: 0
        });
      }

      const g = grupos.get(key);
      const qtdVendida = Number(m.qtd_vendida || 0);
      const qtdDev = Number(m.qtd_devolucao_caixa || 0);
      const qtdCambista = Number(m.qtd_venda_cambista || 0);
      const qtdRetorno = Number(m.qtd_retorno_origem || 0);
      const valorCambista = Number(m.valor_cambista || 0);

      g.qtd_enviada += Number(m.qtd_fracoes || 0);
      g.qtd_vendida_externa += qtdVendida;
      g.qtd_devolucao_externa += qtdDev;
      g.qtd_cambista_externa += qtdCambista;
      g.qtd_retorno_origem += qtdRetorno;
      g.valor_acerto +=
        (qtdVendida * valorFracao) +
        (qtdDev * valorCusto) +
        (qtdCambista * valorCambista);
    });

    return [...grupos.values()];
  }

  async function loadResultadoFederal(filters = {}) {
    const rows = await loadResumoFederal({
      loteriaId: filters.loteriaId,
      concurso: filters.concurso,
      dtIni: filters.dtIni,
      dtFim: filters.dtFim
    });

    return rows;
  }

  async function rpcValidarExclusaoConcurso(concurso) {
    const { data, error } = await sb.rpc('rpc_federal_validar_exclusao_concurso', {
      p_concurso: String(concurso || '').trim()
    });

    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }

  window.FEDERAL_API = {
    sb,

    // reexporta o que já existe no FED_BASE
    $: BASE.$,
    fmtMoney: BASE.fmtMoney,
    fmtDate: BASE.fmtDate,
    startClock: BASE.startClock,
    showStatus: BASE.showStatus,
    fillSelect: BASE.fillSelect,
    requireSession: BASE.requireSession,
    lookupLoteriaName: BASE.lookupLoteriaName,
    lookupFederal: BASE.lookupFederal,
    nextWedOrSat: BASE.nextWedOrSat,
    nextQuaSabFrom: BASE.nextQuaSabFrom,

    // api da Federal
    loadLoterias,
    loadFederais,
    loadConcursosByLoja,
    loadResumoFederal,
    loadMovimentacoesFederal,
    loadVendasFuncionarioFederal,
    loadOperacaoExternaPorLoja,
    loadResultadoFederal,
    rpcValidarExclusaoConcurso,

    // helpers expostos
    distinctConcursos,
    normalizeLoterias
  };
})();
