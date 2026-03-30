/* ════════════════════════════════════════════════════════════
   SISLOT — Conferência de Caixa  |  JavaScript v3.0
   Integração Supabase + sislot-security.js
   ─────────────────────────────────────────────────────────
   Estrutura:
     1. BOOTSTRAP — autenticação e contexto de segurança
     2. ESTADO GLOBAL
     3. API — funções de acesso ao banco (Supabase)
     4. VIEWER — módulo principal de UI
        4a. Inicialização
        4b. Relógio e período
        4c. Filtros e eventos
        4d. Carregamento de dados
        4e. Abas de dias
        4f. Seleção de dia e carregamento
        4g. Renderização do painel esquerdo
        4h. Renderização do painel direito (tabelas)
        4i. Estados da UI
        4j. Controles das seções (accordion)
        4k. Edição
        4l. Modais
        4m. Toast
        4n. Cálculos
        4o. Utilitários
════════════════════════════════════════════════════════════ */

'use strict';

/* ════════════════════════════════════════════════════════════
   1. BOOTSTRAP — autenticação e contexto de segurança

   O sislot-security.js expõe window.SISLOT_SECURITY.
   Ele resolve o usuário via Supabase Auth (auth.uid() →
   tabela usuarios) e devolve:
     ctx.usuario        — { id, nome, email, perfil, ... }
     ctx.lojasPermitidas — array de { loteria_id, nome, ... }
   A página só monta se protegerPagina() resolver com sucesso.
════════════════════════════════════════════════════════════ */

let _supabase = null;   // cliente Supabase (window.supabase criado pelo CDN)
let _ctx      = null;   // contexto de segurança resolvido

async function _bootstrap() {
  // O sislot-config.js define window.SISLOT_CONFIG = { supabaseUrl, supabaseKey }
  if (!window.SISLOT_CONFIG) {
    console.error('[SISLOT] sislot-config.js não carregou ou não definiu SISLOT_CONFIG.');
    document.body.innerHTML = '<p style="color:#ff4f4f;padding:32px;font-family:monospace">Erro de configuração: sislot-config.js ausente.</p>';
    return;
  }

  // Cria o cliente Supabase (supabase-js CDN expõe window.supabase.createClient)
  _supabase = window.supabase.createClient(
  window.SISLOT_CONFIG.url,
  window.SISLOT_CONFIG.anonKey
);

  // Protege a página via camada de segurança padrão do SISLOT
  try {
    _ctx = await window.SISLOT_SECURITY.protegerPagina(_supabase, {
      // Perfis que podem acessar a conferência de caixa
      perfisPermitidos: ['OPERADOR', 'GERENTE', 'SOCIO', 'ADMIN'],
    });
  } catch (err) {
    // protegerPagina já faz redirect para login em caso de falha;
    // só cai aqui se houver erro inesperado.
    console.error('[SISLOT] Falha na proteção de página:', err);
    return;
  }

  // Com contexto resolvido, inicializa o viewer
  VIEWER.init();
}

document.addEventListener('DOMContentLoaded', _bootstrap);


/* ════════════════════════════════════════════════════════════
   2. ESTADO GLOBAL
════════════════════════════════════════════════════════════ */

const ESTADO = {
  mes:              new Date().getMonth() + 1,
  ano:              new Date().getFullYear(),
  diaAtivo:         null,
  lojaFiltro:       '',   // loteria_id selecionada no select (string)
  funcFiltro:       '',   // usuario_id selecionado no select (string)

  // Cache de dados do mês atual
  fechamentosDoMes: [],

  // Fechamento atualmente exibido
  fechamentoAtual:  null,
  fechamentoIdx:    0,    // índice quando há múltiplos fechamentos no mesmo dia

  // Dados das tabelas filhas do fechamento ativo
  produtosAtuais:   [],
  boloesAtuais:     [],
  dividasAtuais:    [],

  // Controle de UI
  secoesAbertas:    { produtos: true, boloes: true, dividas: true, geral: false },
  modoEdicao:       false,
};


/* ════════════════════════════════════════════════════════════
   3. API — funções de acesso ao banco via Supabase

   Todas as funções retornam dados normalizados para o
   formato que o VIEWER espera. Erros são lançados para
   que o chamador decida o que exibir ao usuário.
════════════════════════════════════════════════════════════ */

const API = {

  /* ──────────────────────────────────────────────────────────
     3a. Lojas permitidas para o usuário logado
     Usa ctx.lojasPermitidas resolvido pela camada de segurança.
     Fallback: consulta view_usuarios_acesso direto.
  ─────────────────────────────────────────────────────────── */
  async buscarLojasDoUsuario() {
    // ctx.lojasPermitidas já vem do sislot-security — prefira sempre isso
    if (_ctx && _ctx.lojasPermitidas && _ctx.lojasPermitidas.length > 0) {
      return _ctx.lojasPermitidas.map(l => ({
        id:   l.loteria_id,
        nome: l.nome,
      }));
    }

    // Fallback: consulta direta à view
    const { data, error } = await _supabase
      .from('view_usuarios_acesso')
      .select('loteria_id, nome')
      .eq('usuario_id', _ctx.usuario.id)
      .eq('ativo', true)
      .order('nome');

    if (error) throw error;
    return (data || []).map(l => ({ id: l.loteria_id, nome: l.nome }));
  },

  /* ──────────────────────────────────────────────────────────
     3b. Funcionários vinculados às lojas permitidas
     Fonte: vw_usuarios_loterias_ativos
     Retorna lista única de usuários (deduplicada por id).
  ─────────────────────────────────────────────────────────── */
 async buscarFuncionarios(lojaIds) {
  let query = _supabase
    .from('vw_usuarios_loterias_ativos')
    .select('usuario_id, usuario_nome, loteria_id')
    .order('usuario_nome');

  if (lojaIds && lojaIds.length > 0) {
    query = query.in('loteria_id', lojaIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const vistos = new Set();
  return (data || [])
    .filter(u => {
      if (vistos.has(u.usuario_id)) return false;
      vistos.add(u.usuario_id);
      return true;
    })
    .map(u => ({
      id: u.usuario_id,
      nome: u.usuario_nome
    }));
},

  /* ──────────────────────────────────────────────────────────
     3c. Fechamentos do mês
     Fonte: vw_fechamentos_html — view oficial de leitura.
     Normaliza os campos da view para o formato interno.
  ─────────────────────────────────────────────────────────── */
  async buscarFechamentosDoMes(mes, ano, lojaId, usuarioId) {
    const mesStr   = String(mes).padStart(2, '0');
    const dataIni  = `${ano}-${mesStr}-01`;
    // Último dia do mês
    const dataFim  = new Date(ano, mes, 0).toISOString().split('T')[0];

    let query = _supabase
      .from('vw_fechamentos_html')
      .select('*')
      .gte('data_ref', dataIni)
      .lte('data_ref', dataFim)
      .order('data_ref', { ascending: true })
      .order('created_at', { ascending: true });

    // Aplica restrição de lojas permitidas (segurança multi-loja)
    const lojaIdsPermitidas = (_ctx.lojasPermitidas || []).map(l => l.loteria_id);
    if (lojaIdsPermitidas.length > 0) {
      query = query.in('loteria_id', lojaIdsPermitidas);
    }

    // Filtros opcionais de UI
    if (lojaId)    query = query.eq('loteria_id', lojaId);
    if (usuarioId) query = query.eq('usuario_id', usuarioId);

    const { data, error } = await query;
    if (error) throw error;

    // Normaliza campos da view para o formato que o VIEWER consome
    return (data || []).map(f => this._normalizarFechamento(f));
  },

  /* ──────────────────────────────────────────────────────────
     Normaliza um registro da vw_fechamentos_html para o
     formato interno do VIEWER. Centraliza o mapeamento de
     nomes de colunas — se a view mudar, ajusta só aqui.
  ─────────────────────────────────────────────────────────── */
  _normalizarFechamento(f) {
    return {
      // Identificação
      id:               f.id,
      data:             f.data_ref,               // 'YYYY-MM-DD'
      loteria_id:       f.loteria_id,
      loja_nome:        f.nome || f.loja_nome || '—',
      usuario_id:       f.usuario_id,
      funcionario_nome: f.funcionario_nome || f.criado_por || '—',
      status:           f.status || 'fechado',
      criado_em:        f.created_at,
      canal_venda:      f.canal_venda,
      sobrescrito_por:  f.sobrescrito_por,

      // Valores financeiros
      relatorio:        Number(f.relatorio      || 0),
      deposito:         Number(f.deposito        || 0),
      troco_ini:        Number(f.troco_inicial   || 0),
      troco_sob:        Number(f.troco_sobra     || 0),
      pix_cnpj:         Number(f.pix_cnpj        || 0),
      pix_dif:          Number(f.diferenca_pix   || 0),
      premio_rasp:      Number(f.premio_raspadinha || 0),
      resgate_tele:     Number(f.resgate_telesena  || 0),

      // Totais já calculados pelo banco (use-os; não recalcule)
      total_produtos:   Number(f.total_produtos  || 0),
      total_federais:   Number(f.total_federais  || 0),
      total_boloes:     Number(f.total_boloes    || 0),
      total_fiado:      Number(f.total_fiado     || 0),
      total_debitos:    Number(f.total_debitos   || 0),
      total_creditos:   Number(f.total_creditos  || 0),
      quebra:           Number(f.quebra          || 0),

      justificativa:    f.justificativa || '',
    };
  },

  /* ──────────────────────────────────────────────────────────
     3d. Produtos de um fechamento
     Fonte: fechamento_produtos + JOIN produtos
     Federais (federal_vendas) são buscados separadamente e
     mesclados na mesma lista, normalizados com tipo='FEDERAL'.
  ─────────────────────────────────────────────────────────── */
   async buscarProdutos(fechamentoId) {
    const { data: produtosRows, error: errProd } = await _supabase
      .from('fechamento_produtos')
      .select('id, descricao, tipo, qtd_vendida, valor_unitario, total')
      .eq('fechamento_id', fechamentoId);

    if (errProd) throw errProd;

    const { data: vendasFed, error: errFed } = await _supabase
      .from('federal_vendas')
      .select('id, federal_id, qtd_vendida, valor_unitario, valor_liquido')
      .eq('fechamento_id', fechamentoId);

    if (errFed) throw errFed;

    const federalIds = [...new Set((vendasFed || []).map(f => f.federal_id).filter(Boolean))];

    let federaisRows = [];
    if (federalIds.length > 0) {
      const { data, error } = await _supabase
        .from('federais')
        .select('id, modalidade, concurso')
        .in('id', federalIds);

      if (error) throw error;
      federaisRows = data || [];
    }

    const mapaFederal = Object.fromEntries(
      federaisRows.map(f => [String(f.id), f])
    );

    const produtos = (produtosRows || []).map(p => ({
      id: p.id,
      nome: p.descricao || '—',
      tipo: p.tipo,
      quantidade: Number(p.qtd_vendida || 0),
      valor_unit: Number(p.valor_unitario || 0),
      total: Number(p.total || 0),
    }));

    const federais = (vendasFed || []).map(f => {
      const fed = mapaFederal[String(f.federal_id)] || {};
      const modalidade = fed.modalidade || 'Federal';
      const concurso = fed.concurso || '';

      return {
        id: f.id,
        nome: concurso ? `${modalidade} #${concurso}` : modalidade,
        tipo: 'FEDERAL',
        quantidade: Number(f.qtd_vendida || 0),
        valor_unit: Number(f.valor_unitario || 0),
        total: Number(f.valor_liquido || 0),
      };
    });

    return [...produtos, ...federais];
  },

  async buscarBoloes(fechamentoId) {
    const { data, error } = await _supabase
      .from('fechamento_boloes')
      .select(`
        id,
        bolao_id,
        tipo,
        modalidade,
        concurso,
        qtd_vendida,
        valor_cota,
        subtotal
      `)
      .eq('fechamento_id', fechamentoId);

    if (error) throw error;

    return (data || []).map(b => {
      const nome =
        (b.concurso ? `${b.modalidade} ${b.concurso}` : b.modalidade) || '—';

      return {
        id: b.id,
        descricao: nome,
        tipo: b.tipo,
        cotas_vendidas: Number(b.qtd_vendida || 0),
        valor_cota: Number(b.valor_cota || 0),
        subtotal: Number(b.subtotal || 0),
      };
    });
  },

  async buscarDividas(fechamentoId) {
    const { data, error } = await _supabase
      .from('fechamento_dividas')
      .select('id, cliente_nome, valor')
      .eq('fechamento_id', fechamentoId)
      .order('valor', { ascending: false });

    if (error) throw error;

    return (data || []).map(d => ({
      id: d.id,
      cliente: d.cliente_nome || '—',
      valor: Number(d.valor || 0),
      obs: '',
    }));
  }
};
/* ════════════════════════════════════════════════════════════
   4. VIEWER — MÓDULO PRINCIPAL DE UI
════════════════════════════════════════════════════════════ */

const VIEWER = {

  /* ──────────────────────────────────────────────────────────
     4a. INICIALIZAÇÃO
  ─────────────────────────────────────────────────────────── */

  async init() {
    this._initRelogio();
    this._initPeriodo();
    this._initEventos();

    try {
      await this._carregarLojas();
      await this._carregarFuncionarios();
      await this.recarregar();
    } catch (err) {
      console.error('[VIEWER.init]', err);
      this.toast('Erro ao inicializar a página.', 'erro');
    }
  },

  /* ──────────────────────────────────────────────────────────
     4b. RELÓGIO E PERÍODO
  ─────────────────────────────────────────────────────────── */

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
      op.value = i + 1;
      op.textContent = nome;
      if (i + 1 === ESTADO.mes) op.selected = true;
      selMes.appendChild(op);
    });

    const selAno  = document.getElementById('sel-ano');
    const anoAtual = new Date().getFullYear();
    for (let a = anoAtual - 3; a <= anoAtual + 1; a++) {
      const op = document.createElement('option');
      op.value = a;
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

  /* ──────────────────────────────────────────────────────────
     4c. FILTROS E EVENTOS
  ─────────────────────────────────────────────────────────── */

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
      ESTADO.diaAtivo = null;
      // Ao mudar loja, recarrega funcionários filtrados por ela
      await this._carregarFuncionarios();
      this.recarregar();
    });

    document.getElementById('sel-func').addEventListener('change', e => {
      ESTADO.funcFiltro = e.target.value;
      this.recarregar();
    });

    document.getElementById('btn-inicio').addEventListener('click', () => {
      this.abrirModal('modal-inicio');
    });
    document.getElementById('btn-sair').addEventListener('click', () => {
      this.abrirModal('modal-sair');
    });

    // Fecha modais clicando no overlay
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.addEventListener('click', e => {
        if (e.target === m) this.fecharModal(m.id);
      });
    });
  },

  /* ──────────────────────────────────────────────────────────
     Popula select de lojas com as lojas permitidas ao usuário
  ─────────────────────────────────────────────────────────── */
  async _carregarLojas() {
    let lojas;
    try {
      lojas = await API.buscarLojasDoUsuario();
    } catch (err) {
      console.error('[_carregarLojas]', err);
      this.toast('Erro ao carregar lojas.', 'erro');
      return;
    }

    const sel = document.getElementById('sel-loja');
    // Mantém opção "Todas" e remove o restante
    while (sel.options.length > 1) sel.remove(1);

    lojas.forEach(l => {
      const op = document.createElement('option');
      op.value = l.id;
      op.textContent = l.nome;
      sel.appendChild(op);
    });

    // Se o usuário só tem acesso a uma loja, pré-seleciona ela
    if (lojas.length === 1) {
      sel.value = lojas[0].id;
      ESTADO.lojaFiltro = String(lojas[0].id);
    }
  },

  /* ──────────────────────────────────────────────────────────
     Popula select de funcionários considerando filtro de loja
  ─────────────────────────────────────────────────────────── */
  async _carregarFuncionarios() {
    // Determina quais IDs de lojas considerar para filtrar funcionários
    const lojaIds = ESTADO.lojaFiltro
      ? [ESTADO.lojaFiltro]
      : (_ctx.lojasPermitidas || []).map(l => String(l.loteria_id));

    let funcionarios;
    try {
      funcionarios = await API.buscarFuncionarios(lojaIds);
    } catch (err) {
      console.error('[_carregarFuncionarios]', err);
      this.toast('Erro ao carregar funcionários.', 'erro');
      return;
    }

    const sel = document.getElementById('sel-func');
    while (sel.options.length > 1) sel.remove(1);

    funcionarios.forEach(f => {
      const op = document.createElement('option');
      op.value = f.id;
      op.textContent = f.nome;
      sel.appendChild(op);
    });

    // Se o funcionário selecionado não existe mais na nova lista, reseta
    const ids = funcionarios.map(f => String(f.id));
    if (ESTADO.funcFiltro && !ids.includes(ESTADO.funcFiltro)) {
      ESTADO.funcFiltro = '';
      sel.value = '';
    }
  },

  /* ──────────────────────────────────────────────────────────
     4d. CARREGAMENTO DE DADOS
  ─────────────────────────────────────────────────────────── */

  async recarregar() {
    const btn = document.getElementById('btn-atualizar');
    if (btn) btn.classList.add('girando');

    try {
      ESTADO.fechamentosDoMes = await API.buscarFechamentosDoMes(
        ESTADO.mes,
        ESTADO.ano,
        ESTADO.lojaFiltro  || null,
        ESTADO.funcFiltro  || null,
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

  /* ──────────────────────────────────────────────────────────
     4e. ABAS DE DIAS
  ─────────────────────────────────────────────────────────── */

  _gerarAbasDias() {
    const container   = document.getElementById('dias-scroll');
    const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    const DIAS_FULL   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    const totalDias  = new Date(ESTADO.ano, ESTADO.mes, 0).getDate();
    const hoje       = new Date();
    const ehMesAtual = hoje.getMonth() + 1 === ESTADO.mes && hoje.getFullYear() === ESTADO.ano;

    // Mapa de dias que têm fechamentos
    const diasComDados = {};
    ESTADO.fechamentosDoMes.forEach(f => {
      const dia = parseInt(f.data.split('-')[2]);
      if (!diasComDados[dia]) diasComDados[dia] = [];
      diasComDados[dia].push(f);
    });

    container.innerHTML = '';

    for (let d = 1; d <= totalDias; d++) {
      const data   = new Date(ESTADO.ano, ESTADO.mes - 1, d);
      const dow    = data.getDay();
      const ehFds  = dow === 0 || dow === 6;
      const ehHoje = ehMesAtual && d === hoje.getDate();

      const temDados  = !!diasComDados[d];
      // Quebra: usa o campo já calculado pelo banco
      const temQuebra = temDados && diasComDados[d].some(f => Math.abs(f.quebra) > 0.01);
      const ehAtivo   = d === ESTADO.diaAtivo;

      const tab = document.createElement('button');
      tab.className = [
        'dia-tab',
        temDados  ? 'tem-dados'  : 'sem-dados',
        temQuebra ? 'tem-quebra' : '',
        ehFds     ? 'fds'        : '',
        ehHoje    ? 'hoje'       : '',
        ehAtivo   ? 'ativo'      : '',
      ].filter(Boolean).join(' ');

      tab.dataset.dia = d;
      tab.title = `${String(d).padStart(2,'0')} — ${DIAS_FULL[dow]}${temDados ? ' (tem fechamento)' : ''}`;

      tab.innerHTML = `
        <div class="dia-num-wrap">
          <span class="dia-num">${d}</span>
        </div>
        <span class="dia-dow-label">${DIAS_SEMANA[dow]}</span>
        <span class="dia-dot"></span>
      `;

      tab.addEventListener('click', () => this._selecionarDia(d));
      container.appendChild(tab);
    }

    // Rola até o dia ativo ou hoje
    setTimeout(() => {
      const alvo = ESTADO.diaAtivo || (ehMesAtual ? hoje.getDate() : 1);
      this._scrollParaDia(alvo);
    }, 50);
  },

  _scrollParaDia(dia) {
    const tab = document.querySelector(`.dia-tab[data-dia="${dia}"]`);
    if (tab) tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  },

  scrollDias(direcao) {
    const container = document.getElementById('dias-scroll');
    container.scrollBy({ left: direcao * 160, behavior: 'smooth' });
  },

  /* ──────────────────────────────────────────────────────────
     4f. SELEÇÃO DE DIA E CARREGAMENTO
  ─────────────────────────────────────────────────────────── */

  async _selecionarDia(dia, silencioso = false) {
    ESTADO.diaAtivo      = dia;
    ESTADO.fechamentoIdx = 0;

    // Atualiza destaque das abas
    document.querySelectorAll('.dia-tab').forEach(t => {
      t.classList.toggle('ativo', parseInt(t.dataset.dia) === dia);
    });

    const diaStr  = String(dia).padStart(2, '0');
    const mesStr  = String(ESTADO.mes).padStart(2, '0');
    const dataRef = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const lista   = ESTADO.fechamentosDoMes.filter(f => f.data === dataRef);

    if (lista.length === 0) {
      this._mostrarSemDados(dia);
      return;
    }

    this._mostrarLoading();

    try {
      await this._carregarFechamento(lista, ESTADO.fechamentoIdx);
    } catch (err) {
      console.error('[_selecionarDia]', err);
      this.toast('Erro ao carregar fechamento.', 'erro');
      this._mostrarSemDados(dia);
    }
  },

  async _carregarFechamento(lista, idx) {
    const fech = lista[idx];
    ESTADO.fechamentoAtual = fech;

    // Busca dados das tabelas filhas em paralelo
    const [produtos, boloes, dividas] = await Promise.all([
      API.buscarProdutos(fech.id),
      API.buscarBoloes(fech.id),
      API.buscarDividas(fech.id),
    ]);

    ESTADO.produtosAtuais = produtos;
    ESTADO.boloesAtuais   = boloes;
    ESTADO.dividasAtuais  = dividas;

    this._renderizarPainelEsq(fech, lista);
    this._renderizarPainelDir(fech, produtos, boloes, dividas);
  },

  _trocarFechamento(idx) {
    const diaStr  = String(ESTADO.diaAtivo).padStart(2, '0');
    const mesStr  = String(ESTADO.mes).padStart(2, '0');
    const dataRef = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const lista   = ESTADO.fechamentosDoMes.filter(f => f.data === dataRef);

    ESTADO.fechamentoIdx = idx;
    this._carregarFechamento(lista, idx);
  },

  /* ──────────────────────────────────────────────────────────
     4g. RENDERIZAÇÃO — PAINEL ESQUERDO
  ─────────────────────────────────────────────────────────── */

  _renderizarPainelEsq(fech, lista) {
    const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const DIAS_EXT    = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    this._setPainelEsqEstado('dados');

    // ── Status ──
    const statusMap = { fechado: 'Fechado', pendente: 'Pendente', revisao: 'Em Revisão' };
    const led = document.getElementById('fech-status-led');
    led.className = 'status-led ' + (fech.status !== 'fechado' ? fech.status : '');
    document.getElementById('fech-status-txt').textContent = statusMap[fech.status] || fech.status;

    // ── Hora ──
    const hora = fech.criado_em
      ? new Date(fech.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '—';
    document.getElementById('fech-hora').textContent = hora;

    // ── Múltiplos fechamentos no mesmo dia ──
    const multiFech = document.getElementById('multi-fech');
    if (lista.length > 1) {
      multiFech.style.display = 'block';
      const tabs = document.getElementById('mf-tabs');
      tabs.innerHTML = lista.map((f, i) => {
        const nome = f.funcionario_nome.split(' ')[0];
        return `<button class="mf-tab ${i === ESTADO.fechamentoIdx ? 'ativo' : ''}"
                  onclick="VIEWER._trocarFechamento(${i})">${this._esc(nome)}</button>`;
      }).join('');
    } else {
      multiFech.style.display = 'none';
    }

    // ── Identificação ──
    const inicial = fech.funcionario_nome ? fech.funcionario_nome.charAt(0).toUpperCase() : '?';
    document.getElementById('func-avatar').textContent    = inicial;
    document.getElementById('func-nome').textContent      = fech.funcionario_nome;
    document.getElementById('func-loja-txt').textContent  = fech.loja_nome;

    // ── Data ──
    const dataObj = new Date(fech.data + 'T12:00:00');
    document.getElementById('data-dia').textContent = String(dataObj.getDate()).padStart(2, '0');
    document.getElementById('data-mes').textContent = MESES_ABREV[dataObj.getMonth()];
    document.getElementById('data-dow').textContent = DIAS_EXT[dataObj.getDay()];

    // ── Totais — usa valores pré-calculados do banco ──
    document.getElementById('rc-relatorio').textContent = this._moeda(fech.relatorio);
    document.getElementById('rc-deposito').textContent  = this._moeda(fech.deposito);
    document.getElementById('rc-pix').textContent       = this._moeda(fech.pix_cnpj + fech.pix_dif);
    document.getElementById('rc-produtos').textContent  = this._moeda(fech.total_produtos + fech.total_federais);
    document.getElementById('rc-boloes').textContent    = this._moeda(fech.total_boloes);
    document.getElementById('rc-dividas').textContent   = this._moeda(fech.total_fiado);

    // ── Balanço — usa colunas já calculadas pelo banco ──
    document.getElementById('bl-deb').textContent  = this._moeda(fech.total_debitos);
    document.getElementById('bl-cred').textContent = this._moeda(fech.total_creditos);

    // ── Quebra — vem direto do banco ──
    const quebra   = fech.quebra;
    const quebraEl = document.getElementById('quebra-card');
    const valorEl  = document.getElementById('qc-valor');
    const descEl   = document.getElementById('qc-desc');

    valorEl.textContent = this._moeda(Math.abs(quebra));
    quebraEl.className  = 'quebra-card';

    if (Math.abs(quebra) < 0.01) {
      descEl.textContent = 'Caixa equilibrado';
    } else if (quebra < 0) {
      descEl.textContent = 'Caixa negativo';
      quebraEl.classList.add('negativa');
    } else {
      descEl.textContent = 'Caixa positivo';
      quebraEl.classList.add('positiva');
    }

    // ── Justificativa ──
    const justBox = document.getElementById('justificativa-box');
    if (fech.justificativa && fech.justificativa.trim()) {
      justBox.style.display = 'block';
      document.getElementById('just-content').textContent = fech.justificativa;
    } else {
      justBox.style.display = 'none';
    }

    // ── Campos adicionais ──
    document.getElementById('ca-troco-ini').textContent    = this._moeda(fech.troco_ini);
    document.getElementById('ca-troco-sob').textContent    = this._moeda(fech.troco_sob);
    document.getElementById('ca-pix-dif').textContent      = this._moeda(fech.pix_dif);
    document.getElementById('ca-premio-rasp').textContent  = this._moeda(fech.premio_rasp);
    document.getElementById('ca-resgate-tele').textContent = this._moeda(fech.resgate_tele);
  },

  /* ──────────────────────────────────────────────────────────
     4h. RENDERIZAÇÃO — PAINEL DIREITO (TABELAS)
  ─────────────────────────────────────────────────────────── */

  _renderizarPainelDir(fech, produtos, boloes, dividas) {
    const area = document.getElementById('detalhe-area');
    area.style.display = 'flex';
    area.classList.add('fade-in');

    document.getElementById('dir-grid-bg').classList.add('oculto');
    document.getElementById('dir-vazio-center').classList.add('oculto');

    // ── Barra de contexto ──
    const dataObj = new Date(fech.data + 'T12:00:00');
    document.getElementById('ctx-data').textContent =
      dataObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    document.getElementById('ctx-func').textContent = fech.funcionario_nome;
    document.getElementById('ctx-loja').textContent = fech.loja_nome;

    // Total geral: produtos + federais + bolões + depósito + pix
    const totGeral = fech.total_produtos + fech.total_federais + fech.total_boloes
                   + fech.deposito + fech.pix_cnpj;
    document.getElementById('ctx-total-geral').textContent = this._moeda(totGeral);

    this._renderizarTabelaProdutos(produtos);
    this._renderizarTabelaBoloes(boloes);
    this._renderizarTabelaDividas(dividas);
    this._renderizarDadosGerais(fech);
  },

  _renderizarTabelaProdutos(produtos) {
    const tbody  = document.getElementById('tbody-produtos');
    const count  = document.getElementById('count-produtos');
    const stotal = document.getElementById('stotal-produtos');
    const tf     = document.getElementById('tf-produtos');

    const total = this._somarProdutos(produtos);
    count.textContent  = produtos.length + (produtos.length === 1 ? ' item' : ' itens');
    stotal.textContent = this._moeda(total);
    tf.textContent     = this._moeda(total);

    if (produtos.length === 0) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="5"><i class="fas fa-inbox"></i> Nenhum produto registrado</td></tr>';
      return;
    }

    tbody.innerHTML = produtos.map(p => {
      const subtotal = p.total || (p.quantidade * p.valor_unit);
      return `
        <tr>
          <td>${this._esc(p.nome)}</td>
          <td><span class="chip-tipo ${this._chipTipo(p.tipo)}">${p.tipo}</span></td>
          <td class="col-r">${p.quantidade}</td>
          <td class="col-r">${this._moeda(p.valor_unit)}</td>
          <td class="col-r-accent">${this._moeda(subtotal)}</td>
        </tr>
      `;
    }).join('');
  },

  _renderizarTabelaBoloes(boloes) {
    const tbody     = document.getElementById('tbody-boloes');
    const count     = document.getElementById('count-boloes');
    const stotal    = document.getElementById('stotal-boloes');
    const tf        = document.getElementById('tf-boloes');
    const tfIntInfo = document.getElementById('tf-bol-int-info');

    const total    = this._somarBoloes(boloes);
    const cotasInt = boloes
      .filter(b => b.tipo === 'INTERNO')
      .reduce((s, b) => s + (b.cotas_vendidas || 0), 0);

    count.textContent    = boloes.length + (boloes.length === 1 ? ' item' : ' itens');
    stotal.textContent   = this._moeda(total);
    tf.textContent       = this._moeda(total);
    tfIntInfo.textContent = `${cotasInt} cotas int.`;

    if (boloes.length === 0) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="5"><i class="fas fa-inbox"></i> Nenhum bolão registrado</td></tr>';
      return;
    }

    tbody.innerHTML = boloes.map(b => {
      const sub     = b.subtotal || (b.cotas_vendidas * b.valor_cota);
      const chipCls = b.tipo === 'INTERNO' ? 'chip-int' : 'chip-ext';
      return `
        <tr>
          <td>${this._esc(b.descricao)}</td>
          <td><span class="chip-tipo ${chipCls}">${b.tipo}</span></td>
          <td class="col-r">${b.cotas_vendidas}</td>
          <td class="col-r">${this._moeda(b.valor_cota)}</td>
          <td class="col-r-accent">${this._moeda(sub)}</td>
        </tr>
      `;
    }).join('');
  },

  _renderizarTabelaDividas(dividas) {
    const tbody  = document.getElementById('tbody-dividas');
    const count  = document.getElementById('count-dividas');
    const stotal = document.getElementById('stotal-dividas');
    const tf     = document.getElementById('tf-dividas');

    const total = this._somarDividas(dividas);
    count.textContent  = dividas.length + (dividas.length === 1 ? ' cliente' : ' clientes');
    stotal.textContent = this._moeda(total);
    tf.textContent     = this._moeda(total);

    if (dividas.length === 0) {
      tbody.innerHTML = '<tr class="tr-empty"><td colspan="3"><i class="fas fa-inbox"></i> Nenhuma dívida registrada</td></tr>';
      return;
    }

    tbody.innerHTML = dividas.map(d => `
      <tr class="${d.valor > 100 ? 'row-destaque' : ''}">
        <td>${this._esc(d.cliente)}</td>
        <td class="col-r val-neg">${this._moeda(d.valor)}</td>
        <td style="color:var(--text-muted);font-size:11px">${this._esc(d.obs) || '—'}</td>
      </tr>
    `).join('');
  },

  _renderizarDadosGerais(fech) {
    const tbody = document.getElementById('tbody-geral');

    // Usa exclusivamente os valores calculados pelo banco
    const quebra = fech.quebra;

    const linhas = [
      ['Relatório do Dia',      this._moeda(fech.relatorio),    ''],
      ['Depósito Bancário',     this._moeda(fech.deposito),     ''],
      ['Troco Inicial (Fundo)', this._moeda(fech.troco_ini),    ''],
      ['Troco Sobra (Final)',   this._moeda(fech.troco_sob),    ''],
      ['PIX CNPJ Recebido',     this._moeda(fech.pix_cnpj),     'val-pos'],
      ['Diferença de PIX',      this._moeda(fech.pix_dif),      fech.pix_dif < 0 ? 'val-neg' : ''],
      ['Prêmio Raspadinha',     this._moeda(fech.premio_rasp),  'val-pos'],
      ['Resgate Telesena',      this._moeda(fech.resgate_tele), 'val-pos'],
      ['Total Produtos + Fed.', this._moeda(fech.total_produtos + fech.total_federais), 'val-pos'],
      ['Total Bolões',          this._moeda(fech.total_boloes), 'val-pos'],
      ['Total Fiado/Dívidas',   this._moeda(fech.total_fiado),  fech.total_fiado > 0 ? 'val-neg' : ''],
      ['— Total Débitos',       this._moeda(fech.total_debitos),  'val-neg'],
      ['— Total Créditos',      this._moeda(fech.total_creditos), 'val-pos'],
      ['— Quebra de Caixa',     this._moeda(quebra), quebra < 0 ? 'val-neg' : quebra > 0 ? 'val-pos' : 'val-zero'],
      ['Canal de Venda',        fech.canal_venda || '—',          ''],
      ['ID do Fechamento',      '#' + fech.id,                    ''],
      ['Status',                fech.status,                      ''],
      ['Registrado em',         fech.criado_em ? new Date(fech.criado_em).toLocaleString('pt-BR') : '—', ''],
      ['Sobrescrito por',       fech.sobrescrito_por || '—',      ''],
    ];

    tbody.innerHTML = linhas.map(([label, valor, cls]) => `
      <tr>
        <td>${label}</td>
        <td class="${cls}">${this._esc(String(valor))}</td>
      </tr>
    `).join('');
  },

  /* ──────────────────────────────────────────────────────────
     4i. ESTADOS DA UI
  ─────────────────────────────────────────────────────────── */

  _setPainelEsqEstado(estado) {
    const mapa = { vazio: 'esq-vazio', loading: 'esq-loading', sem: 'esq-sem-dados', dados: 'esq-dados' };
    ['esq-vazio', 'esq-loading', 'esq-sem-dados', 'esq-dados'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
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
    const diaStr = String(dia).padStart(2, '0');
    const mesStr = String(ESTADO.mes).padStart(2, '0');
    document.getElementById('esq-sem-dados-txt').textContent =
      `Nenhum fechamento registrado para ${diaStr}/${mesStr}/${ESTADO.ano}.`;
    document.getElementById('detalhe-area').style.display = 'none';
    document.getElementById('dir-grid-bg').classList.remove('oculto');
    document.getElementById('dir-vazio-center').classList.add('oculto');
  },

  /* ──────────────────────────────────────────────────────────
     4j. CONTROLES DAS SEÇÕES (ACCORDION)
  ─────────────────────────────────────────────────────────── */

  toggleSecao(headerEl) {
    const sec     = headerEl.closest('.sec');
    const secName = headerEl.dataset.sec;
    sec.classList.toggle('collapsed');
    ESTADO.secoesAbertas[secName] = !sec.classList.contains('collapsed');
  },

  /* ──────────────────────────────────────────────────────────
     4k. EDIÇÃO
  ─────────────────────────────────────────────────────────── */

  toggleEdicao() {
    ESTADO.modoEdicao = !ESTADO.modoEdicao;
    const btn = document.getElementById('btn-editar');
    if (btn) {
      btn.innerHTML = ESTADO.modoEdicao
        ? '<i class="fas fa-times"></i> Cancelar'
        : '<i class="fas fa-pen"></i> Editar';
    }
    this.toast(ESTADO.modoEdicao ? 'Modo de edição ativado' : 'Edição cancelada', 'info');
  },

  iniciarNovo() {
    // Redireciona para a tela de fechamento passando loja e data como parâmetros.
    // A tela de fechamento deve verificar override via verificar_override_fechamento().
    const diaStr = String(ESTADO.diaAtivo || new Date().getDate()).padStart(2, '0');
    const mesStr = String(ESTADO.mes).padStart(2, '0');
    const data   = `${ESTADO.ano}-${mesStr}-${diaStr}`;
    const loja   = ESTADO.lojaFiltro || '';

    window.location.href = `./fechamento-caixa.html?data=${data}${loja ? '&loja=' + loja : ''}`;
  },

  imprimir() {
    window.print();
  },

  /* ──────────────────────────────────────────────────────────
     4l. MODAIS
  ─────────────────────────────────────────────────────────── */

  abrirModal(id)  { document.getElementById(id).classList.add('aberto');    },
  fecharModal(id) { document.getElementById(id).classList.remove('aberto'); },

  irInicio() {
    this.fecharModal('modal-inicio');
    window.location.href = './index.html';
  },

  async sair() {
    this.fecharModal('modal-sair');
    try {
      await _supabase.auth.signOut();
    } catch (err) {
      console.warn('[sair] Erro no signOut:', err);
    }
    window.location.href = './login.html';
  },

  /* ──────────────────────────────────────────────────────────
     4m. TOAST DE NOTIFICAÇÃO
  ─────────────────────────────────────────────────────────── */

  _toastTimer: null,

  toast(msg, tipo = 'ok') {
    const el  = document.getElementById('toast');
    const ico = document.getElementById('toast-ico');
    const txt = document.getElementById('toast-msg');

    const icones = { ok: '✓', erro: '✕', info: 'ℹ', aviso: '⚠' };
    ico.textContent = icones[tipo] || '✓';
    txt.textContent = msg;

    el.style.borderColor = {
      ok:    'rgba(0,200,150,.3)',
      erro:  'rgba(255,79,79,.3)',
      info:  'rgba(77,166,255,.3)',
      aviso: 'rgba(240,167,50,.3)',
    }[tipo] || '';

    el.classList.add('visivel');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visivel'), 3000);
  },

  /* ──────────────────────────────────────────────────────────
     4n. CÁLCULOS LOCAIS (apenas para tabelas filhas)
     Os totais do fechamento em si vêm sempre do banco.
     Estas funções só somam as listas de produtos/bolões/dívidas
     buscadas para exibição nas tabelas detalhadas.
  ─────────────────────────────────────────────────────────── */

  _somarProdutos(lista) {
    return lista.reduce((s, p) => s + (p.total || (p.quantidade * p.valor_unit) || 0), 0);
  },

  _somarBoloes(lista) {
    return lista.reduce((s, b) => s + (b.subtotal || (b.cotas_vendidas * b.valor_cota) || 0), 0);
  },

  _somarDividas(lista) {
    return lista.reduce((s, d) => s + (d.valor || 0), 0);
  },

  /* ──────────────────────────────────────────────────────────
     4o. UTILITÁRIOS
  ─────────────────────────────────────────────────────────── */

  _moeda(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _chipTipo(tipo) {
    return {
      'RASPADINHA': 'chip-rasp',
      'TELESENA':   'chip-tele',
      'FEDERAL':    'chip-fed',
      'INTERNO':    'chip-int',
      'EXTERNO':    'chip-ext',
    }[tipo] || '';
  },

};
