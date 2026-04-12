(() => {
  'use strict';

  if (!window.SISLOT_CONFIG) {
    console.error('[FED_BASE] SISLOT_CONFIG não encontrado.');
    return;
  }

  if (!window.SISLOT_UTILS) {
    console.error('[FED_BASE] SISLOT_UTILS não encontrado.');
    return;
  }

  if (!window.SISLOT_SECURITY) {
    console.error('[FED_BASE] SISLOT_SECURITY não encontrado.');
    return;
  }

  const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
  );

  const U = window.SISLOT_UTILS;
  const S = window.SISLOT_SECURITY;

  function normalizeLoterias(rows = []) {
    return rows.map((row) => ({
      id: row.id ?? row.loteria_id ?? row.loja_id ?? null,
      nome: row.nome ?? row.loteria_nome ?? row.loja_nome ?? '',
      slug: row.slug ?? row.loteria_slug ?? '',
      codigo: row.codigo ?? row.loteria_codigo ?? '',
      cod_loterico: row.cod_loterico ?? '',
      principal:
        row.principal === true ||
        row.is_principal === true ||
        row.loteria_principal === true ||
        row.loja_principal === true ||
        row.eh_principal === true,
      raw: row
    })).filter(x => x.id != null);
  }

  async function requireSession() {
    const ctx = await S.protegerPagina('movimentacao');
    if (!ctx) return null;

    return {
      usuario: ctx.usuario,
      perfil: ctx.usuario?.perfil || '',
      lojasPermitidas: normalizeLoterias(ctx.lojasPermitidas || []),
      lojaInicial: ctx.lojaInicial
        ? {
            id: ctx.lojaInicial.loteria_id,
            nome: ctx.lojaInicial.loteria_nome,
            slug: ctx.lojaInicial.loteria_slug,
            codigo: ctx.lojaInicial.loteria_codigo,
            cod_loterico: ctx.lojaInicial.cod_loterico,
            principal: !!ctx.lojaInicial.principal
          }
        : null,
      rotaInicio: ctx.rotaInicio
    };
  }

  async function loadLoterias() {
    const ctx = await S.protegerPagina('movimentacao');
    if (!ctx) return [];
    return normalizeLoterias(ctx.lojasPermitidas || []);
  }

  async function loadFederais() {
    const { data, error } = await sb
      .from('federais')
      .select('*')
      .order('dt_sorteio', { ascending: false })
      .order('concurso', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  function lookupLoteriaName(rows, id) {
    const found = (rows || []).find(x => String(x.id) === String(id));
    return found?.nome || `Loja ${id}`;
  }

  function lookupFederal(rows, id) {
    return (rows || []).find(x => String(x.id) === String(id)) || null;
  }

  function nextWedOrSat(fromDate = null) {
    const base = fromDate ? new Date(`${fromDate}T12:00:00`) : new Date();
    const d = new Date(base);

    for (let i = 0; i < 14; i++) {
      const day = d.getDay();
      if (day === 3 || day === 6) {
        return d.toISOString().slice(0, 10);
      }
      d.setDate(d.getDate() + 1);
    }

    return base.toISOString().slice(0, 10);
  }

  function nextQuaSabFrom(dateStr, step = 1) {
    const base = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
    const dir = step >= 0 ? 1 : -1;
    const d = new Date(base);

    do {
      d.setDate(d.getDate() + dir);
    } while (![3, 6].includes(d.getDay()));

    return d.toISOString().slice(0, 10);
  }

  window.FED_BASE = {
    sb,
    $: U.$,
    fmtMoney: U.fmtBRL,
    fmtDate: U.fmtData,
    startClock: U.startClock,
    showStatus: U.setStatus,
    fillSelect: U.fillSelect,
    requireSession,
    loadLoterias,
    loadFederais,
    lookupLoteriaName,
    lookupFederal,
    nextWedOrSat,
    nextQuaSabFrom
  };
})();
