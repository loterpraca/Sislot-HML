'use strict';

/* ════════════════════════════════════════════════════════════
   SISLOT — Conferência de Caixa  |  JS v3.0
   ─────────────────────────────────────────────────────────
   Estrutura:
     1. BOOTSTRAP
     2. LOJA_CONFIG — tema por loja
     3. ESTADO GLOBAL
     4. API — queries reestruturadas
        4a. Infraestrutura
        4b. qResumoEsquerda  → vw_fechamentos_html
        4c. qProdutosDireita → fechamento_produtos
        4d. qFederaisDireita → federal_vendas + federais
        4e. qBoloesDireita   → fechamento_boloes enriquecido
        4f. qClientesDireita → cliente_fechamento_cadastro+extrato
        4g. qClienteLancamentos → cliente_fechamento_extrato
        4h. qClienteItens    → cliente_fechamento_itens
     5. LOJA_CTRL — tema e troca cíclica
     6. VIEWER — módulo principal de UI
        6a. init
        6b. Relógio e período
        6c. Filtros e eventos
        6d. Carregamento de dados
        6e. Abas de dias
        6f. Seleção e carregamento
        6g. Renderização esquerda
        6h. Renderização direita — Produtos + Federais
        6i. Renderização direita — Bolões
        6j. Renderização direita — Dívidas/Clientes
        6k. Estados da UI
        6l. Accordion
        6m. Edição / ações
        6n. Modais e toast
        6o. Utilitários
════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   1. BOOTSTRAP
════════════════════════════════════════════════════════════ */
let _supabase = null;
let _ctx      = null;

async function _bootstrap() {
  if (!window.SISLOT_CONFIG) {
    document.body.innerHTML = '<p style="color:#ff4f4f;padding:32px;font-family:monospace">Erro: sislot-config.js ausente.</p>';
    return;
  }

  _supabase = window.supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
  );

  try {
    _ctx = await window.SISLOT_SECURITY.protegerPagina(_supabase, {
      perfisPermitidos: ['OPERADOR', 'GERENTE', 'SOCIO', 'ADMIN'],
    });
  } catch (err) {
    console.error('[SISLOT] Falha na proteção de página:', err);
    return;
  }

  VIEWER.init();
}

document.addEventListener('DOMContentLoaded', _bootstrap);


/* ════════════════════════════════════════════════════════════
   2. LOJA_CONFIG — mapeamento de slug → metadados de tema
════════════════════════════════════════════════════════════ */
const LOJA_CONFIG = {
  'boulevard':   { nome: 'Boulevard',   slug: 'boulevard',   acento: '#00c896' },
  'centro':      { nome: 'Centro',      slug: 'centro',      acento: '#f0a732' },
  'lotobel':     { nome: 'Lotobel',     slug: 'lotobel',     acento: '#b09eff' },
  'santa-tereza':{ nome: 'Sta. Tereza', slug: 'santa-tereza',acento: '#ff7eb3' },
  'via-brasil':  { nome: 'Via Brasil',  slug: 'via-brasil',  acento: '#4da6ff' },
};

// Converte nome da loja em slug para CSS
function _slugificar(nome) {
  if (!nome) return '';
  return nome.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}


/* ════════════════════════════════════════════════════════════
   3. ESTADO GLOBAL
════════════════════════════════════════════════════════════ */
const ESTADO = {
  mes:              new Date().getMonth() + 1,
  ano:              new Date().getFullYear(),
  diaAtivo:         null,
  lojaFiltro:       '',
  funcFiltro:       '',

  fechamentosDoMes: [],
  fechamentoAtual:  null,
  fechamentoIdx:    0,

  // Dados da direita
  produtosAtuais:   [],
  federaisAtuais:   [],
  boloesAtuais:     [],   // shape: { grupos[], total_geral_boloes }
  clientesAtuais:   [],   // shape: qClientesDireita

  modoEdicao: false,
};


/* ════════════════════════════════════════════════════════════
   4. API — queries reestruturadas
════════════════════════════════════════════════════════════ */
const API = {

  /* ── 4a. Infraestrutura ── */

  async buscarLojasDoUsuario() {
    if (_ctx?.lojasPermitidas?.length) {
      return _ctx.lojasPermitidas.map(l => ({ id: l.loteria_id, nome: l.nome }));
    }
    const { data, error } = await _supabase
      .from('view_usuarios_acesso')
      .select('loteria_id, nome')
      .eq('usuario_id', _ctx.usuario.id)
      .eq('ativo', true)
      .order('nome');
    if (error) throw error;
    return (data || []).map(l => ({ id: l.loteria_id, nome: l.nome }));
  },

  async buscarFuncionarios(lojaIds) {
    let q = _supabase.from('vw_usuarios_loterias_ativos').select('usuario_id, usuario_nome, loteria_id').order('usuario_nome');
    if (lojaIds?.length) q = q.in('loteria_id', lojaIds);
    const { data, error } = await q;
    if (error) throw error;
    const vistos = new Set();
    return (data || []).filter(u => { if (vistos.has(u.usuario_id)) return false; vistos.add(u.usuario_id); return true; })
      .map(u => ({ id: u.usuario_id, nome: u.usuario_nome }));
  },

  /* ── 4b. qResumoEsquerda — fonte: vw_fechamentos_html ── */

  async qResumoEsquerda(mes, ano, lojaId, usuarioId) {
    const mesStr  = String(mes).padStart(2, '0');
    const dataIni = `${ano}-${mesStr}-01`;
    const dataFim = new Date(ano, mes, 0).toISOString().split('T')[0];

    let q = _supabase
      .from('vw_fechamentos_html')
      .select('*')
      .gte('data_ref', dataIni)
      .lte('data_ref', dataFim)
      .order('data_ref', { ascending: true })
      .order('created_at', { ascending: true });

    const lojaIds = (_ctx.lojasPermitidas || []).map(l => l.loteria_id);
    if (lojaIds.length) q = q.in('loteria_id', lojaIds);
    if (lojaId)    q = q.eq('loteria_id', lojaId);
    if (usuarioId) q = q.eq('usuario_id', usuarioId);

    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(f => this._normalizarFechamento(f));
  },

  _normalizarFechamento(f) {
    return {
      id:               f.id,
      data:             f.data_ref,
      loteria_id:       f.loteria_id,
      loja_nome:        f.nome || f.loja_nome || '—',
      usuario_id:       f.usuario_id,
      funcionario_nome: f.funcionario_nome || f.criado_por || '—',
      status:           f.status || 'fechado',
      criado_em:        f.created_at,
      canal_venda:      f.canal_venda,
      sobrescrito_por:  f.sobrescrito_por,
      relatorio:        Number(f.relatorio        || 0),
      deposito:         Number(f.deposito          || 0),
      troco_ini:        Number(f.troco_inicial     || 0),
      troco_sob:        Number(f.troco_sobra       || 0),
      pix_cnpj:         Number(f.pix_cnpj          || 0),
      pix_dif:          Number(f.diferenca_pix     || 0),
      premio_rasp:      Number(f.premio_raspadinha || 0),
      resgate_tele:     Number(f.resgate_telesena  || 0),
      total_produtos:   Number(f.total_produtos    || 0),
      total_federais:   Number(f.total_federais    || 0),
      total_boloes:     Number(f.total_boloes      || 0),
      total_fiado:      Number(f.total_fiado       || 0),
      total_debitos:    Number(f.total_debitos     || 0),
      total_creditos:   Number(f.total_creditos    || 0),
      quebra:           Number(f.quebra            || 0),
      justificativa:    f.justificativa || '',
    };
  },

  /* ── 4c. qProdutosDireita ── */

  async qProdutosDireita(fechamentoId) {
    const { data, error } = await _supabase
      .from('fechamento_produtos')
      .select('id, descricao, tipo, qtd_vendida, valor_unitario, total')
      .eq('fechamento_id', fechamentoId);
    if (error) throw error;
    return (data || []).map(p => ({
      item_id:       p.id,
      tipo:          p.tipo,
      titulo:        p.descricao || '—',
      descricao:     p.descricao,
      quantidade:    Number(p.qtd_vendida   || 0),
      valor_unitario:Number(p.valor_unitario|| 0),
      subtotal:      Number(p.total        || 0),
    }));
  },

  /* ── 4d. qFederaisDireita ── */

  async qFederaisDireita(fechamentoId) {
    const { data: vendas, error: ev } = await _supabase
      .from('federal_vendas')
      .select('id, federal_id, qtd_vendida, valor_unitario, valor_liquido')
      .eq('fechamento_id', fechamentoId);
    if (ev) throw ev;

    const fedIds = [...new Set((vendas || []).map(f => f.federal_id).filter(Boolean))];
    let fedMap   = {};

    if (fedIds.length) {
      const { data: feds, error: ef } = await _supabase
        .from('federais')
        .select('id, modalidade, concurso')
        .in('id', fedIds);
      if (ef) throw ef;
      fedMap = Object.fromEntries((feds || []).map(f => [String(f.id), f]));
    }

    return (vendas || []).map(v => {
      const fed      = fedMap[String(v.federal_id)] || {};
      const modalidade = fed.modalidade || 'Federal';
      const concurso   = fed.concurso   || '';
      return {
        item_id:       v.id,
        federal_id:    v.federal_id,
        modalidade,
        concurso,
        titulo:        concurso ? `${modalidade} #${concurso}` : modalidade,
        quantidade:    Number(v.qtd_vendida    || 0),
        valor_unitario:Number(v.valor_unitario || 0),
        subtotal:      Number(v.valor_liquido  || 0),
      };
    });
  },

  /* ── 4e. qBoloesDireita ── */

  async qBoloesDireita(fechamentoId) {
    // Tenta usar view enriquecida; se não existir, faz JOIN manual
    let rows;
    try {
      const { data, error } = await _supabase
        .from('vw_fechamento_boloes_enriquecidos')
        .select('*')
        .eq('fechamento_id', fechamentoId);
      if (error) throw error;
      rows = data || [];
    } catch (_) {
      // Fallback: dados básicos de fechamento_boloes
      const { data, error } = await _supabase
        .from('fechamento_boloes')
        .select('id, bolao_id, tipo, modalidade, concurso, qtd_vendida, valor_cota, subtotal')
        .eq('fechamento_id', fechamentoId);
      if (error) throw error;
      rows = (data || []).map(r => ({ ...r, codigo_loterico: null, qtd_jogos: null, qtd_dezenas: null }));
    }

    // Agrupa por modalidade
    const gruposMap = new Map();
    let totalGeral  = 0;

    rows.forEach(b => {
      const modalidade = b.modalidade || 'Outros';
      const subtotal   = Number(b.subtotal || (b.qtd_vendida * b.valor_cota) || 0);
      totalGeral += subtotal;

      if (!gruposMap.has(modalidade)) gruposMap.set(modalidade, { modalidade, total_modalidade: 0, itens: [] });
      const grupo = gruposMap.get(modalidade);
      grupo.total_modalidade += subtotal;
      grupo.itens.push({
        item_id:        b.id,
        bolao_id:       b.bolao_id,
        modalidade:     b.modalidade,
        concurso:       b.concurso,
        tipo:           b.tipo,
        codigo_loterico:b.codigo_loterico,
        qtd_jogos:      b.qtd_jogos,
        qtd_dezenas:    b.qtd_dezenas,
        valor_cota:     Number(b.valor_cota  || 0),
        cotas_vendidas: Number(b.qtd_vendida || 0),
        subtotal,
        });
    });

    return {
      grupos: [...gruposMap.values()],
      total_geral_boloes: totalGeral,
    };
  },

  /* ── 4f. qClientesDireita ── */

  async qClientesDireita(fechamentoId) {
    // Fonte principal: cliente_fechamento_cadastro
    const { data: cads, error: ec } = await _supabase
      .from('cliente_fechamento_cadastro')
      .select('cliente_id, cliente_nome, telefone, documento, observacao_cliente')
      .eq('fechamento_id', fechamentoId);
    if (ec) throw ec;

    if (!cads?.length) return [];

    const clienteIds = cads.map(c => c.cliente_id);

    // Busca totais por cliente via extrato
    const { data: exts, error: ee } = await _supabase
      .from('cliente_fechamento_extrato')
      .select('cliente_id, valor_total, id')
      .eq('fechamento_id', fechamentoId)
      .in('cliente_id', clienteIds);
    if (ee) throw ee;

    // Agrega totais por cliente
    const totaisMap = {};
    const qtdMap    = {};
    (exts || []).forEach(e => {
      const cid = String(e.cliente_id);
      totaisMap[cid] = (totaisMap[cid] || 0) + Number(e.valor_total || 0);
      qtdMap[cid]    = (qtdMap[cid]    || 0) + 1;
    });

    return cads.map(c => {
      const cid   = String(c.cliente_id);
      const total = totaisMap[cid] || 0;
      return {
        cliente_id:                c.cliente_id,
        cliente_nome:              c.cliente_nome || '—',
        telefone:                  c.telefone,
        documento:                 c.documento,
        observacao_cliente:        c.observacao_cliente,
        total_cliente_no_fechamento: total,
        qtd_lancamentos:           qtdMap[cid] || 0,
        status_visual:             total > 200 ? 'alto' : total > 50 ? 'medio' : 'baixo',
      };
    }).sort((a, b) => b.total_cliente_no_fechamento - a.total_cliente_no_fechamento);
  },

  /* ── 4g. qClienteLancamentos ── */

  async qClienteLancamentos(fechamentoId, clienteId) {
    const { data, error } = await _supabase
      .from('cliente_fechamento_extrato')
      .select('id, cliente_id, tipo_movimento, forma_pagamento, status, valor_total, observacao, data_movimento, gera_credito_fechamento, gera_abatimento_divida, gera_pix_quitacao')
      .eq('fechamento_id', fechamentoId)
      .eq('cliente_id', clienteId)
      .order('data_movimento', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  /* ── 4h. qClienteItens ── */

  async qClienteItens(extratoId) {
    const { data, error } = await _supabase
      .from('cliente_fechamento_itens')
      .select('extrato_id, tipo_origem, bolao_id, federal_id, raspadinha_id, telesena_item_id, data_venda, descricao, modalidade, concurso, produto, qtd_jogos, qtd_dezenas, valor_unitario, qtd_vendida')
      .eq('extrato_id', extratoId);
    if (error) throw error;
    return (data || []).map(i => ({
      ...i,
      subtotal: Number(i.valor_unitario || 0) * Number(i.qtd_vendida || 1),
    }));
  },
};


/* ════════════════════════════════════════════════════════════
   5. LOJA_CTRL — tema e troca cíclica
════════════════════════════════════════════════════════════ */
const LOJA_CTRL = {
  loteriaAtiva: null,
  todasLojas:   [],

  // Recebe array de { id, nome } e armazena
  setLojas(lojas) {
    this.todasLojas = lojas;
  },

  // Resolve qual loja inicial usar
  resolverLojaInicial(fechamento) {
    if (fechamento?.loja_nome) {
      const slug = _slugificar(fechamento.loja_nome);
      if (LOJA_CONFIG[slug]) { this.trocarLoja(slug); return; }
    }
    // Fallback: primeira loja disponível
    if (this.todasLojas.length) {
      const slug = _slugificar(this.todasLojas[0].nome);
      this.trocarLoja(slug);
    }
  },

  // Aplica tema visual ao body via data-loja
  aplicarTemaLoja(slug) {
    document.body.setAttribute('data-loja', slug || '');
  },

  // Troca para a loja com o slug dado
  trocarLoja(slug) {
    const cfg = LOJA_CONFIG[slug];
    this.loteriaAtiva = cfg ? { slug, ...cfg } : null;
    this.aplicarTemaLoja(slug);
    this.sincronizarUIComLojaAtiva();
  },

  // Avança para a próxima loja em ciclo
  trocarLojaPorOffset(offset = 1) {
    const slugs   = Object.keys(LOJA_CONFIG);
    const idx     = this.loteriaAtiva ? slugs.indexOf(this.loteriaAtiva.slug) : -1;
    const proximo = slugs[(idx + offset + slugs.length) % slugs.length];
    this.trocarLoja(proximo);
  },

  // Atualiza os elementos da UI com a loja ativa
  sincronizarUIComLojaAtiva() {
    const cfg  = this.loteriaAtiva;
    const nome = cfg?.nome || 'SISLOT';

    // Chip da loja no header
    const chipNome = document.getElementById('loja-chip-nome');
    if (chipNome) chipNome.textContent = nome;

    // Nome na brand
    const brandNome = document.querySelector('.brand-name');
    if (brandNome) brandNome.textContent = 'SISLOT';

    // Logo (opcional — mantém o original)
    // document.getElementById('logoImg')?.setAttribute('src', `./icons/${cfg?.slug || 'loterpraca'}.png`);
  },
};


/* ════════════════════════════════════════════════════════════
   6. VIEWER — módulo principal de UI
════════════════════════════════════════════════════════════ */
const VIEWER = {

  /* ── 6a. init ── */

  async init() {
    this._initRelogio();
    this._initPeriodo();
    this._initEventos();

    try {
      const lojas = await API.buscarLojasDoUsuario();
      LOJA_CTRL.setLojas(lojas);
      this._popularSelectLojas(lojas);
      await this._carregarFuncionarios();
      await this.recarregar();
    } catch (err) {
      console.error('[VIEWER.init]', err);
      this.toast('Erro ao inicializar a página.', 'erro');
    }
  },

  /* ── 6b. Relógio e período ── */

  _initRelogio() {
    const el   = document.getElementById('app-clock');
    const tick = () => { if (el) el.textContent = new Date().toLocaleTimeString('pt-BR'); };
    tick();
    setInterval(tick, 1000);
  },

  _initPeriodo() {
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const selMes = document.getElementById('sel-mes');
    MESES.forEach((nome, i) => {
      const op = document.createElement('option');
      op.value       = i + 1;
      op.textContent = nome;
      if (i + 1 === ESTADO.mes) op.selected = true;
      selMes.appendChild(op);
    });

    const selAno = document.getElementById('sel-ano');
    const anoAtual = new Date().getFullYear();
    for (let a = anoAtual - 3; a <= anoAtual + 1; a++) {
      const op = document.createElement('option');
      op.value       = a;
      op.textContent = a;
      if (a === ESTADO.ano) op.selected = true;
      selAno.appendChild(op);
    }
    this._atualizarPeriodoLabel();
  },

  _atualizarPeriodoLabel() {
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const el = document.getElementById('periodo-label');
    if (el) el.textContent = `${MESES[ESTADO.mes - 1]} / ${ESTADO.ano}`;
  },

  /* ── 6c. Filtros e eventos ── */

  _initEventos() {
    document.getElementById('sel-mes').addEventListener('change', e => {
      ESTADO.mes = parseInt(e.target.value);
      ESTADO.diaAtivo = null;
      this._atualizarPeriodoLabel();
      this.recarregar();
    });

    document.getElementById('sel-ano').addEventListener('change', e => {
      ESTADO.ano = parseInt(e.target.value);
      ESTADO.diaAtivo = null;
      this._atualizarPeriodoLabel();
      this.recarregar();
    });

    document.getElementById('sel-loja').addEventListener('change', async e => {
      ESTADO.lojaFiltro = e.target.value;
      ESTADO.diaAtivo   = null;
      await this._carregarFuncionarios();
      this.recarregar();
    });

    document.getElementById('sel-func').addEventListener('change', e => {
      ESTADO.funcFiltro = e.target.value;
      this.recarregar();
    });

    document.getElementById('btn-inicio').addEventListener('click', () => this.abrirModal('modal-inicio'));
    document.getElementById('btn-sair'  ).addEventListener('click', () => this.abrirModal('modal-sair'));

    // Clique cíclico no chip da loja
    document.getElementById('loja-chip')?.addEventListener('click', () => {
      LOJA_CTRL.trocarLojaPorOffset(1);
    });

    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) this.fecharModal(m.id); });
    });
  },

  _popularSelectLojas(lojas) {
    const sel = document.getElementById('sel-loja');
    while (sel.options.length > 1) sel.remove(1);
    lojas.forEach(l => {
      const op = document.createElement('option');
      op.value       = l.id;
      op.textContent = l.nome;
      sel.appendChild(op);
    });
    if (lojas.length === 1) {
      sel.value = lojas[0].id;
      ESTADO.lojaFiltro = String(lojas[0].id);
    }
  },

  async _carregarFuncionarios() {
    const lojaIds = ESTADO.lojaFiltro
      ? [ESTADO.lojaFiltro]
      : (_ctx.lojasPermitidas || []).map(l => String(l.loteria_id));
    let funcionarios = [];
    try {
      funcionarios = await API.buscarFuncionarios(lojaIds);
    } catch (err) {
      console.error('[_carregarFuncionarios]', err);
    }
    const sel = document.getElementById('sel-func');
    while (sel.options.length > 1) sel.remove(1);
    funcionarios.forEach(f => {
      const op = document.createElement('option');
      op.value       = f.id;
      op.textContent = f.nome;
      sel.appendChild(op);
    });
    const ids = funcionarios.map(f => String(f.id));
    if (ESTADO.funcFiltro && !ids.includes(ESTADO.funcFiltro)) {
      ESTADO.funcFiltro = '';
      sel.value = '';
    }
  },

  /* ── 6d. Carregamento de dados ── */

  async recarregar() {
    const btn = document.getElementById('btn-atualizar');
    if (btn) btn.classList.add('girando');
    try {
      ESTADO.fechamentosDoMes = await API.qResumoEsquerda(
        ESTADO.mes, ESTADO.ano, ESTADO.lojaFiltro || null, ESTADO.funcFiltro || null
      );
      this._gerarAbasDias();
      if (ESTADO.diaAtivo) {
        await this._selecionarDia(ESTADO.diaAtivo, true);
      } else {
        this._mostrarEstadoInicial();
      }
    } catch (err) {
      console.error('[recarregar]', err);
      this.toast('Erro ao carregar dados do mês.', 'erro');
    } finally {
      if (btn) btn.classList.remove('girando');
    }
  },

  /* ── 6e. Abas de dias ── */

  _gerarAbasDias() {
    const container   = document.getElementById('dias-scroll');
    const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];
    const DIAS_FULL   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    const totalDias  = new Date(ESTADO.ano, ESTADO.mes, 0).getDate();
    const hoje       = new Date();
    const ehMesAtual = hoje.getMonth() + 1 === ESTADO.mes && hoje.getFullYear() === ESTADO.ano;

    const diasComDados = {};
    ESTADO.fechamentosDoMes.forEach(f => {
      const dia = parseInt(f.data.split('-')[2]);
      if (!diasComDados[dia]) diasComDados[dia] = [];
      diasComDados[dia].push(f);
    });

    container.innerHTML = '';

    for (let d = 1; d <= totalDias; d++) {
      const data    = new Date(ESTADO.ano, ESTADO.mes - 1, d);
      const dow     = data.getDay();
      const ehFds   = dow === 0 || dow === 6;
      const ehHoje  = ehMesAtual && d === hoje.getDate();
      const temDados = !!diasComDados[d];
      const temQuebra= temDados && diasComDados[d].some(f => Math.abs(f.quebra) > 0.01);
      const ehAtivo  = d === ESTADO.diaAtivo;

      const tab = document.createElement('button');
      tab.className = ['dia-tab', temDados ? 'tem-dados' : 'sem-dados', temQuebra ? 'tem-quebra' : '', ehFds ? 'fds' : '', ehHoje ? 'hoje' : '', ehAtivo ? 'ativo' : ''].filter(Boolean).join(' ');
      tab.dataset.dia = d;
      tab.title = `${String(d).padStart(2,'0')} — ${DIAS_FULL[dow]}${temDados ? ' (tem fechamento)' : ''}`;
      tab.innerHTML = `<div class="dia-num-wrap"><span class="dia-num">${d}</span></div><span class="dia-dow-label">${DIAS_SEMANA[dow]}</span><span class="dia-dot"></span>`;
      tab.addEventListener('click', () => this._selecionarDia(d));
      container.appendChild(tab);
    }

    setTimeout(() => {
      const alvo = ESTADO.diaAtivo || (ehMesAtual ? hoje.getDate() : 1);
      this._scrollParaDia(alvo);
    }, 50);
  },

  _scrollParaDia(dia) {
    document.querySelector(`.dia-tab[data-dia="${dia}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  },

  scrollDias(dir) {
    document.getElementById('dias-scroll').scrollBy({ left: dir * 160, behavior: 'smooth' });
  },

  /* ── 6f. Seleção e carregamento ── */

  async _selecionarDia(dia, silencioso = false) {
    ESTADO.diaAtivo      = dia;
    ESTADO.fechamentoIdx = 0;

    document.querySelectorAll('.dia-tab').forEach(t => t.classList.toggle('ativo', parseInt(t.dataset.dia) === dia));

    const diaStr  = String(dia).padStart(2, '0');
    const mesStr  = String(ESTADO.mes).padStart(2, '0');
    const dataRef = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const lista   = ESTADO.fechamentosDoMes.filter(f => f.data === dataRef);

    if (!lista.length) { this._mostrarSemDados(dia); return; }

    this._mostrarLoading();
    try {
      await this._carregarFechamento(lista, 0);
    } catch (err) {
      console.error('[_selecionarDia]', err);
      this.toast('Erro ao carregar fechamento.', 'erro');
      this._mostrarSemDados(dia);
    }
  },

  async _carregarFechamento(lista, idx) {
    const fech = lista[idx];
    ESTADO.fechamentoAtual = fech;

    // Busca dados da direita em paralelo
    const [produtos, federais, boloes, clientes] = await Promise.all([
      API.qProdutosDireita(fech.id),
      API.qFederaisDireita(fech.id),
      API.qBoloesDireita(fech.id),
      API.qClientesDireita(fech.id),
    ]);

    ESTADO.produtosAtuais = produtos;
    ESTADO.federaisAtuais = federais;
    ESTADO.boloesAtuais   = boloes;
    ESTADO.clientesAtuais = clientes;

    // Aplica tema da loja do fechamento
    LOJA_CTRL.resolverLojaInicial(fech);

    this._renderizarPainelEsq(fech, lista);
    this._renderizarPainelDir(fech, produtos, federais, boloes, clientes);
  },

  _trocarFechamento(idx) {
    const diaStr  = String(ESTADO.diaAtivo).padStart(2, '0');
    const mesStr  = String(ESTADO.mes).padStart(2, '0');
    const dataRef = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const lista   = ESTADO.fechamentosDoMes.filter(f => f.data === dataRef);
    ESTADO.fechamentoIdx = idx;
    this._carregarFechamento(lista, idx);
  },

  /* ── 6g. Renderização esquerda ── */

  _renderizarPainelEsq(fech, lista) {
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const DIAS  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    this._setPainelEsqEstado('dados');

    // Status
    const statusMap = { fechado: 'Fechado', pendente: 'Pendente', revisao: 'Em Revisão' };
    const led = document.getElementById('fech-status-led');
    led.className = 'status-led ' + (fech.status !== 'fechado' ? fech.status : '');
    document.getElementById('fech-status-txt').textContent = statusMap[fech.status] || fech.status;

    // Hora
    const hora = fech.criado_em ? new Date(fech.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    document.getElementById('fech-hora').textContent = hora;

    // Múltiplos fechamentos
    const multiFech = document.getElementById('multi-fech');
    if (lista.length > 1) {
      multiFech.style.display = 'block';
      document.getElementById('mf-tabs').innerHTML = lista.map((f, i) =>
        `<button class="mf-tab ${i === ESTADO.fechamentoIdx ? 'ativo' : ''}" onclick="VIEWER._trocarFechamento(${i})">${this._esc(f.funcionario_nome.split(' ')[0])}</button>`
      ).join('');
    } else {
      multiFech.style.display = 'none';
    }

    // Identificação
    const inicial = fech.funcionario_nome ? fech.funcionario_nome.charAt(0).toUpperCase() : '?';
    document.getElementById('func-avatar').textContent   = inicial;
    document.getElementById('func-nome').textContent     = fech.funcionario_nome;
    document.getElementById('func-loja-txt').textContent = fech.loja_nome;

    // Data
    const dataObj = new Date(fech.data + 'T12:00:00');
    document.getElementById('data-dia').textContent = String(dataObj.getDate()).padStart(2, '0');
    document.getElementById('data-mes').textContent = MESES[dataObj.getMonth()];
    document.getElementById('data-dow').textContent = DIAS[dataObj.getDay()];

    // Totais — valores já calculados pelo banco, não recalcular
    document.getElementById('rc-relatorio').textContent   = this._moeda(fech.relatorio);
    document.getElementById('rc-deposito').textContent    = this._moeda(fech.deposito);
    document.getElementById('rc-pix').textContent         = this._moeda(fech.pix_cnpj + fech.pix_dif);
    document.getElementById('rc-produtos').textContent    = this._moeda(fech.total_produtos);
    document.getElementById('rc-federais').textContent    = this._moeda(fech.total_federais);
    document.getElementById('rc-boloes').textContent      = this._moeda(fech.total_boloes);
    document.getElementById('rc-dividas').textContent     = this._moeda(fech.total_fiado);

    // Balanço
    document.getElementById('bl-deb').textContent  = this._moeda(fech.total_debitos);
    document.getElementById('bl-cred').textContent = this._moeda(fech.total_creditos);

    // Quebra
    const quebra   = fech.quebra;
    const quebraEl = document.getElementById('quebra-card');
    document.getElementById('qc-valor').textContent = this._moeda(Math.abs(quebra));
    quebraEl.className = 'quebra-card';
    document.getElementById('qc-desc').textContent = Math.abs(quebra) < 0.01 ? 'Caixa equilibrado' : quebra < 0 ? 'Caixa negativo' : 'Caixa positivo';
    if (quebra < 0 && Math.abs(quebra) >= 0.01) quebraEl.classList.add('negativa');
    if (quebra > 0 && Math.abs(quebra) >= 0.01) quebraEl.classList.add('positiva');

    // Justificativa
    const justBox = document.getElementById('justificativa-box');
    if (fech.justificativa?.trim()) {
      justBox.style.display = 'block';
      document.getElementById('just-content').textContent = fech.justificativa;
    } else {
      justBox.style.display = 'none';
    }

    // Campos adicionais
    document.getElementById('ca-troco-ini').textContent    = this._moeda(fech.troco_ini);
    document.getElementById('ca-troco-sob').textContent    = this._moeda(fech.troco_sob);
    document.getElementById('ca-pix-dif').textContent      = this._moeda(fech.pix_dif);
    document.getElementById('ca-premio-rasp').textContent  = this._moeda(fech.premio_rasp);
    document.getElementById('ca-resgate-tele').textContent = this._moeda(fech.resgate_tele);
    document.getElementById('ca-canal').textContent        = fech.canal_venda || '—';
    document.getElementById('ca-sobrescrito').textContent  = fech.sobrescrito_por || '—';
    document.getElementById('ca-id').textContent           = '#' + fech.id;
  },

  /* ── 6h. Renderização direita — Produtos + Federais lado a lado ── */

  _renderizarProdutosFederais(produtos, federais) {
    const countP   = document.getElementById('count-produtos-fed');
    const stotalP  = document.getElementById('stotal-produtos-fed');
    const colProd  = document.getElementById('col-produtos');
    const colFed   = document.getElementById('col-federais');

    const totalP = produtos.reduce((s, p) => s + p.subtotal, 0);
    const totalF = federais.reduce((s, f) => s + f.subtotal, 0);
    const total  = totalP + totalF;

    countP.textContent  = `${produtos.length + federais.length} itens`;
    stotalP.textContent = this._moeda(total);

    // Renderiza produtos
    if (produtos.length) {
      colProd.innerHTML = `
        <div class="pf-col-titulo">Produtos (${produtos.length})</div>
        ${produtos.map(p => this._htmlPfCard(p, false)).join('')}
        <div class="pf-total-row">
          <span class="pf-total-label">Total</span>
          <span class="pf-total-val">${this._moeda(totalP)}</span>
        </div>
      `;
    } else {
      colProd.innerHTML = '<div class="pf-col-titulo">Produtos</div><div class="pf-vazio">Sem produtos registrados</div>';
    }

    // Renderiza federais
    if (federais.length) {
      colFed.innerHTML = `
        <div class="pf-col-titulo">Federais (${federais.length})</div>
        ${federais.map(f => this._htmlPfCard(f, true)).join('')}
        <div class="pf-total-row">
          <span class="pf-total-label">Total</span>
          <span class="pf-total-val">${this._moeda(totalF)}</span>
        </div>
      `;
    } else {
      colFed.innerHTML = '<div class="pf-col-titulo">Federais</div><div class="pf-vazio">Sem federais registrados</div>';
    }
  },

  _htmlPfCard(item, isFederal) {
    let tipoBadge, tipoClass;
    if (isFederal) {
      tipoBadge = 'FED'; tipoClass = 'pf-tipo-fed';
    } else {
      const t = (item.tipo || '').toUpperCase();
      if (t === 'RASPADINHA') { tipoBadge = 'RSP'; tipoClass = 'pf-tipo-rasp'; }
      else if (t === 'TELESENA') { tipoBadge = 'TEL'; tipoClass = 'pf-tipo-tele'; }
      else { tipoBadge = t.substring(0,3) || 'PRD'; tipoClass = 'pf-tipo-outro'; }
    }
    return `
      <div class="pf-card">
        <div class="pf-tipo-badge ${tipoClass}">${tipoBadge}</div>
        <div class="pf-info">
          <div class="pf-nome" title="${this._esc(item.titulo)}">${this._esc(item.titulo)}</div>
          <div class="pf-meta">
            <span class="pf-qtd">${item.quantidade}x</span>
            <span class="pf-x">·</span>
            <span class="pf-unit">${this._moeda(item.valor_unitario)}</span>
          </div>
        </div>
        <div class="pf-subtotal">${this._moeda(item.subtotal)}</div>
      </div>
    `;
  },

  /* ── 6i. Renderização direita — Bolões ── */

  _renderizarBoloes(boloesData) {
    const { grupos, total_geral_boloes } = boloesData;
    const count  = document.getElementById('count-boloes');
    const stotal = document.getElementById('stotal-boloes');
    const body   = document.getElementById('boloes-body');

    const totalItens = grupos.reduce((s, g) => s + g.itens.length, 0);
    count.textContent  = `${totalItens} itens`;
    stotal.textContent = this._moeda(total_geral_boloes);

    if (!totalItens) {
      body.innerHTML = '<div class="boloes-vazio">Nenhum bolão registrado</div>';
      return;
    }

    body.innerHTML = grupos.map(g => `
      <div class="bolao-grupo">
        <div class="bolao-grupo-header">
          <span class="bolao-grupo-titulo">${this._esc(g.modalidade)}</span>
          <span class="bolao-grupo-total">${this._moeda(g.total_modalidade)}</span>
        </div>
        <div class="bolao-grupo-grid">
          ${g.itens.map(b => this._htmlBolaoCard(b)).join('')}
        </div>
      </div>
    `).join('') + `
      <div class="boloes-total-geral">
        <span class="btg-label">Total Geral — Bolões</span>
        <span class="btg-val">${this._moeda(total_geral_boloes)}</span>
      </div>
    `;
  },

  _htmlBolaoCard(b) {
    const tipo     = (b.tipo || '').toUpperCase();
    const tipoClass = tipo === 'INTERNO' ? 'bc-tipo-int' : 'bc-tipo-ext';
    const concurso = b.concurso ? `Concurso ${b.concurso}` : 'Concurso —';

    const detalhes = [];
    if (b.cotas_vendidas)  detalhes.push(['Cotas Vendidas', b.cotas_vendidas]);
    if (b.valor_cota)      detalhes.push(['Valor/Cota',     this._moeda(b.valor_cota)]);
    if (b.qtd_jogos)       detalhes.push(['Jogos',          b.qtd_jogos]);
    if (b.qtd_dezenas)     detalhes.push(['Dezenas',        b.qtd_dezenas]);
    if (!detalhes.length)  detalhes.push(['Cotas', b.cotas_vendidas || '—'], ['Valor', this._moeda(b.valor_cota)]);

    return `
      <div class="bolao-card" data-tipo="${this._esc(tipo)}">
        <div class="bc-header">
          <span class="bc-modalidade">${this._esc(b.modalidade || '—')}</span>
          <span class="bc-tipo-chip ${tipoClass}">${tipo || '—'}</span>
        </div>
        <div class="bc-concurso">${this._esc(concurso)}</div>
        <div class="bc-details">
          ${detalhes.slice(0, 4).map(([l, v]) => `
            <div class="bc-detail">
              <span class="bc-detail-label">${l}</span>
              <span class="bc-detail-val">${v}</span>
            </div>
          `).join('')}
        </div>
        <div class="bc-footer">
          <span class="bc-footer-label">Subtotal</span>
          <span class="bc-subtotal">${this._moeda(b.subtotal)}</span>
        </div>
      </div>
    `;
  },

  /* ── 6j. Renderização direita — Clientes/Dívidas ── */

  _renderizarClientes(clientes) {
    const count  = document.getElementById('count-clientes');
    const stotal = document.getElementById('stotal-clientes');
    const body   = document.getElementById('clientes-body');

    const totalGeral = clientes.reduce((s, c) => s + c.total_cliente_no_fechamento, 0);
    count.textContent  = `${clientes.length} clientes`;
    stotal.textContent = this._moeda(totalGeral);

    if (!clientes.length) {
      body.innerHTML = '<div class="clientes-vazio">Nenhuma dívida de cliente registrada</div>';
      return;
    }

    body.innerHTML = clientes.map(c => this._htmlClienteCard(c)).join('') + `
      <div class="dividas-total-geral">
        <span class="dtg-label">Total Dívidas</span>
        <span class="dtg-val">${this._moeda(totalGeral)}</span>
      </div>
    `;

    // Bind eventos de expansão
    body.querySelectorAll('.cliente-header').forEach(el => {
      el.addEventListener('click', () => this._toggleCliente(el.closest('.cliente-card')));
    });
  },

  _htmlClienteCard(c) {
    const inicial = c.cliente_nome.charAt(0).toUpperCase();
    return `
      <div class="cliente-card" data-cliente-id="${c.cliente_id}">
        <div class="cliente-header">
          <div class="cliente-avatar">${inicial}</div>
          <div class="cliente-info">
            <div class="cliente-nome">${this._esc(c.cliente_nome)}</div>
            <div class="cliente-meta">
              <span class="cliente-qtd">${c.qtd_lancamentos} lançamento${c.qtd_lancamentos !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="cliente-total">
            <div class="ct-label">Total</div>
            <div class="ct-valor">${this._moeda(c.total_cliente_no_fechamento)}</div>
          </div>
          <div class="cliente-chevron">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 6l5 5 5-5"/></svg>
          </div>
        </div>
        <div class="cliente-detalhe" id="detalhe-cliente-${c.cliente_id}">
          <div class="cliente-loading"><div class="mini-ring"></div><span>Carregando...</span></div>
        </div>
      </div>
    `;
  },

  async _toggleCliente(card) {
    const isExpandido = card.classList.contains('expandido');
    // Fecha todos
    document.querySelectorAll('.cliente-card.expandido').forEach(c => c.classList.remove('expandido'));

    if (!isExpandido) {
      card.classList.add('expandido');
      const clienteId = card.dataset.clienteId;
      const detalhe   = card.querySelector('.cliente-detalhe');

      // Só carrega se ainda estiver no estado de loading
      if (detalhe.querySelector('.cliente-loading')) {
        try {
          const lancamentos = await API.qClienteLancamentos(ESTADO.fechamentoAtual.id, clienteId);
          this._renderizarLancamentosCliente(detalhe, lancamentos, clienteId);
        } catch (err) {
          detalhe.innerHTML = '<div class="cliente-loading" style="color:var(--red)">Erro ao carregar lançamentos.</div>';
        }
      }
    }
  },

  _renderizarLancamentosCliente(detalhe, lancamentos, clienteId) {
    if (!lancamentos.length) {
      detalhe.innerHTML = '<div class="cliente-loading" style="font-style:italic">Nenhum lançamento encontrado.</div>';
      return;
    }

    const totalCliente = lancamentos.reduce((s, l) => s + Number(l.valor_total || 0), 0);

    detalhe.innerHTML = lancamentos.map(l => this._htmlLancamentoCard(l)).join('') + `
      <div class="cliente-total-rodape">
        <span class="ctr-label">Total do Cliente</span>
        <span class="ctr-val">${this._moeda(totalCliente)}</span>
      </div>
    `;

    // Bind eventos de expansão de lançamentos
    detalhe.querySelectorAll('.lancamento-header').forEach(el => {
      el.addEventListener('click', () => this._toggleLancamento(el.closest('.lancamento-card')));
    });
  },

  _htmlLancamentoCard(l) {
    const data = l.data_movimento ? new Date(l.data_movimento).toLocaleDateString('pt-BR') : '—';
    return `
      <div class="lancamento-card" data-extrato-id="${l.id}">
        <div class="lancamento-header">
          <div class="lanc-ico" style="background:var(--amber-g);color:var(--amber)">
            <i class="fas fa-receipt" style="font-size:8px"></i>
          </div>
          <div class="lanc-info">
            <div class="lanc-tipo">${this._esc(l.tipo_movimento || 'Lançamento')}</div>
            <div class="lanc-data">${data} · ${this._esc(l.forma_pagamento || '—')}</div>
          </div>
          <div class="lanc-valor">${this._moeda(l.valor_total)}</div>
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;margin-left:4px;transition:transform .2s"><path d="M3 6l5 5 5-5"/></svg>
        </div>
        <div class="lancamento-itens"></div>
      </div>
    `;
  },

  async _toggleLancamento(card) {
    const isAberto = card.classList.contains('aberto');
    card.querySelectorAll('.lancamento-card.aberto').forEach(c => c.classList.remove('aberto'));

    if (!isAberto) {
      card.classList.add('aberto');
      const extratoId = card.dataset.extratoId;
      const itensEl   = card.querySelector('.lancamento-itens');

      if (!itensEl.children.length) {
        itensEl.innerHTML = '<div style="padding:8px 12px;font-size:10px;color:var(--text-dim)">Carregando itens...</div>';
        try {
          const itens = await API.qClienteItens(extratoId);
          this._renderizarItensLancamento(itensEl, itens);
        } catch (err) {
          itensEl.innerHTML = '<div style="padding:8px 12px;font-size:10px;color:var(--red)">Erro ao carregar itens.</div>';
        }
      }

      // Anima chevron
      const chevron = card.querySelector('.lancamento-header svg');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
    } else {
      const chevron = card.querySelector('.lancamento-header svg');
      if (chevron) chevron.style.transform = '';
    }
  },

  _renderizarItensLancamento(container, itens) {
    if (!itens.length) {
      container.innerHTML = '<div style="padding:8px 12px;font-size:10px;color:var(--text-dim);font-style:italic">Sem itens detalhados.</div>';
      return;
    }

    const ICO_MAP = {
      BOLAO:     { cls: 'ico-bolao',   txt: 'BOL' },
      FEDERAL:   { cls: 'ico-federal', txt: 'FED' },
      RASPADINHA:{ cls: 'ico-rasp',    txt: 'RSP' },
      TELESENA:  { cls: 'ico-tele',    txt: 'TEL' },
      CONTA:     { cls: 'ico-conta',   txt: 'CON' },
    };

    container.innerHTML = itens.map(i => {
      const ico   = ICO_MAP[(i.tipo_origem || '').toUpperCase()] || { cls: 'ico-conta', txt: 'OUT' };
      const meta  = [i.modalidade, i.concurso, i.produto].filter(Boolean).join(' · ');
      return `
        <div class="item-card">
          <div class="item-tipo-ico ${ico.cls}">${ico.txt}</div>
          <div class="item-info">
            <div class="item-descricao">${this._esc(i.descricao || meta || '—')}</div>
            ${meta ? `<div class="item-meta">${this._esc(meta)}</div>` : ''}
          </div>
          <div class="item-subtotal">${this._moeda(i.subtotal)}</div>
        </div>
      `;
    }).join('');
  },

  /* ── 6h→k: renderizarPainelDir (orquestra tudo) ── */

  _renderizarPainelDir(fech, produtos, federais, boloes, clientes) {
    document.getElementById('detalhe-area').style.display   = 'flex';
    document.getElementById('detalhe-area').classList.add('fade-in');
    document.getElementById('dir-grid-bg').classList.add('oculto');
    document.getElementById('dir-vazio-center').classList.add('oculto');

    // Barra de contexto
    const dataObj = new Date(fech.data + 'T12:00:00');
    document.getElementById('ctx-data').textContent = dataObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    document.getElementById('ctx-func').textContent = fech.funcionario_nome;
    document.getElementById('ctx-loja').textContent = fech.loja_nome;
    const totGeral = fech.total_produtos + fech.total_federais + fech.total_boloes + fech.total_fiado;
    document.getElementById('ctx-total-geral').textContent = this._moeda(totGeral);

    // Renderiza as três seções
    this._renderizarProdutosFederais(produtos, federais);
    this._renderizarBoloes(boloes);
    this._renderizarClientes(clientes);
  },

  /* ── 6k. Estados da UI ── */

  _setPainelEsqEstado(estado) {
    ['esq-vazio','esq-loading','esq-sem-dados','esq-dados'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const mapa = { vazio: 'esq-vazio', loading: 'esq-loading', sem: 'esq-sem-dados', dados: 'esq-dados' };
    const el = document.getElementById(mapa[estado]);
    if (el) el.style.display = '';
  },

  _mostrarEstadoInicial() {
    this._setPainelEsqEstado('vazio');
    document.getElementById('detalhe-area').style.display = 'none';
    document.getElementById('dir-grid-bg').classList.remove('oculto');
    document.getElementById('dir-vazio-center').classList.remove('oculto');
  },

  _mostrarLoading() {
    this._setPainelEsqEstado('loading');
    document.getElementById('detalhe-area').style.display = 'none';
  },

  _mostrarSemDados(dia) {
    this._setPainelEsqEstado('sem');
    const d = String(dia).padStart(2,'0'), m = String(ESTADO.mes).padStart(2,'0');
    document.getElementById('esq-sem-dados-txt').textContent = `Nenhum fechamento registrado para ${d}/${m}/${ESTADO.ano}.`;
    document.getElementById('detalhe-area').style.display = 'none';
    document.getElementById('dir-grid-bg').classList.remove('oculto');
    document.getElementById('dir-vazio-center').classList.add('oculto');
  },

  /* ── 6l. Accordion ── */

  toggleSecao(headerEl) {
    headerEl.closest('.sec').classList.toggle('collapsed');
  },

  /* ── 6m. Edição / ações ── */

  toggleEdicao() {
    ESTADO.modoEdicao = !ESTADO.modoEdicao;
    const btn = document.getElementById('btn-editar');
    if (btn) btn.innerHTML = ESTADO.modoEdicao ? '<i class="fas fa-times"></i> Cancelar' : '<i class="fas fa-pen"></i> Editar';
    this.toast(ESTADO.modoEdicao ? 'Modo de edição ativado' : 'Edição cancelada', 'info');
  },

  iniciarNovo() {
    const d = String(ESTADO.diaAtivo || new Date().getDate()).padStart(2,'0');
    const m = String(ESTADO.mes).padStart(2,'0');
    window.location.href = `./fechamento-caixa.html?data=${ESTADO.ano}-${m}-${d}${ESTADO.lojaFiltro ? '&loja=' + ESTADO.lojaFiltro : ''}`;
  },

  imprimir() { window.print(); },

  /* ── 6n. Modais e toast ── */

  abrirModal(id)  { document.getElementById(id).classList.add('aberto'); },
  fecharModal(id) { document.getElementById(id).classList.remove('aberto'); },

  irInicio() { this.fecharModal('modal-inicio'); window.location.href = './index.html'; },

  async sair() {
    this.fecharModal('modal-sair');
    try { await _supabase.auth.signOut(); } catch (e) { console.warn(e); }
    window.location.href = './login.html';
  },

  _toastTimer: null,

  toast(msg, tipo = 'ok') {
    const el  = document.getElementById('toast');
    const ico = document.getElementById('toast-ico');
    const txt = document.getElementById('toast-msg');
    ico.textContent = { ok: '✓', erro: '✕', info: 'ℹ', aviso: '⚠' }[tipo] || '✓';
    txt.textContent = msg;
    el.style.borderColor = { ok: 'rgba(0,200,150,.3)', erro: 'rgba(255,79,79,.3)', info: 'rgba(77,166,255,.3)', aviso: 'rgba(240,167,50,.3)' }[tipo] || '';
    el.classList.add('visivel');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visivel'), 3000);
  },

  /* ── 6o. Utilitários ── */

  _moeda(val) {
    return (parseFloat(val) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
};
