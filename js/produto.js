/**
 * SISLOT — Produto
 * Cadastro · Movimentação · Estoque · Mestra
 */

const sb = window.supabase && window.SISLOT_CONFIG
  ? supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey)
  : null;

const utils = window.SISLOT_UTILS || {};
const $     = utils.$     || (id => document.getElementById(id));
const fmtBR = utils.fmtBR || (v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const fmtBRL= utils.fmtBRL|| (v => parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// ── Margens de custo por tipo ─────────────────────────
// Raspadinha: lucro 20% → custo = venda × 0.80
// Tele Sena:  lucro  8% → custo = venda × 0.92
const MARGEM_CUSTO = {
  RASPADINHA: 0.80,
  TELESENA:   0.92,
};

function calcularCusto(tipo, valorVenda) {
  const fator = MARGEM_CUSTO[tipo] ?? 0.80;
  return Number((Number(valorVenda || 0) * fator).toFixed(2));
}

// ── Lojas do sistema ─────────────────────────────────
const LOJAS = [
  { id: 1, nome: 'Centro',       slug: 'centro',       logo: './icons/loterpraca.png',   icon: 'fas fa-city'    },
  { id: 2, nome: 'Boulevard',    slug: 'boulevard',    logo: './icons/boulevard.png',    icon: 'fas fa-building'},
  { id: 3, nome: 'Lotobel',      slug: 'lotobel',      logo: './icons/lotobel.png',      icon: 'fas fa-landmark'},
  { id: 4, nome: 'Santa Tereza', slug: 'santa-tereza', logo: './icons/santa-tereza.png', icon: 'fas fa-church'  },
  { id: 5, nome: 'Via Brasil',   slug: 'via-brasil',   logo: './icons/via-brasil.png',   icon: 'fas fa-road'    },
];

const LOJA_CONFIG = {
  'centro':       { nome: 'Centro',       logo: './icons/loterpraca.png'   },
  'boulevard':    { nome: 'Boulevard',    logo: './icons/boulevard.png'    },
  'lotobel':      { nome: 'Lotobel',      logo: './icons/lotobel.png'      },
  'santa-tereza': { nome: 'Santa Tereza', logo: './icons/santa-tereza.png' },
  'via-brasil':   { nome: 'Via Brasil',   logo: './icons/via-brasil.png'   },
};

// ── Estado global ────────────────────────────────────
const state = {
  screen:       'cadastro',
  abaCadastro:  null,
  lojaAtiva:    LOJAS[0],
  tipoFiltro:   'todos',
  panelItem:    null,
  tipoMov:      'ENTRADA',
  usuario:      null,
  roleUsuario:  'ADMIN',
  movHistorico: [],
  carregando:   false,
  dashboard:    [],
};

// ══════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    if (window.SISLOT_SECURITY) {
      const ctx = await window.SISLOT_SECURITY.protegerPagina?.('produto');
      if (ctx) {
        state.usuario     = ctx.usuario;
        state.roleUsuario = ctx.usuario?.perfil || ctx.usuario?.role || 'OPERADOR';
        const principal   = ctx.lojaInicial || null;
        if (principal) {
          const loja = LOJAS.find(l => l.slug === principal.loteria_slug);
          if (loja) state.lojaAtiva = loja;
        }
      }
    }

    bind();
    aplicarTema(state.lojaAtiva.slug);
    renderScreenTabs();
    await carregarDashboard();
    renderCards();
    renderMovSelects();
    renderEstoque();
    renderMestra();
    preencherData();
  } catch (e) {
    console.error('[SISLOT] Erro ao iniciar:', e);
    alert('Erro ao iniciar: ' + (e.message || e));
  }
}

// ══════════════════════════════════════════════════════
// TEMA POR LOJA
// ══════════════════════════════════════════════════════
function aplicarTema(slug) {
  document.body.dataset.loja = slug;
  document.documentElement.dataset.loja = slug;

  const cfg = LOJA_CONFIG[slug] || LOJA_CONFIG['centro'];

  const logo = $('lojaLogo');
  if (logo) { logo.src = cfg.logo || ''; logo.alt = cfg.nome; }

  const nome = $('headerNome');
  if (nome) nome.textContent = cfg.nome;

  const estNome = $('estoqueLojaNome');
  if (estNome) estNome.textContent = cfg.nome;

  const movOrigem = $('movOrigem');
  if (movOrigem) movOrigem.value = state.lojaAtiva.id;

  // Dica de usabilidade na árvore
  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.title = `${cfg.nome} — clique para trocar de loja`;
}

// ══════════════════════════════════════════════════════
// TROCA DE LOJA — CICLO DIRETO SEM MODAL
// Cada clique na árvore avança para a próxima loja.
// Um toast leve confirma qual loja foi ativada.
// ══════════════════════════════════════════════════════
async function alternarLoja() {
  if (state.carregando) return;

  const idxAtual  = LOJAS.findIndex(l => l.id === state.lojaAtiva.id);
  state.lojaAtiva = LOJAS[(idxAtual + 1) % LOJAS.length];

  aplicarTema(state.lojaAtiva.slug);
  mostrarToastLoja(state.lojaAtiva.nome);

  await carregarDashboard();
  renderCards();
  renderMovSelects();
  renderEstoque();
  renderMestra();
}

function mostrarToastLoja(nome) {
  let toast = $('toastLoja');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastLoja';
    Object.assign(toast.style, {
      position:   'fixed',
      bottom:     '80px',
      left:       '50%',
      transform:  'translateX(-50%) translateY(12px)',
      background: 'var(--surface2,#1e2535)',
      color:      'var(--text1,#f1f5f9)',
      padding:    '10px 22px',
      borderRadius: '999px',
      fontSize:   '13px',
      fontWeight: '600',
      boxShadow:  '0 4px 24px rgba(0,0,0,.4)',
      zIndex:     '9999',
      opacity:    '0',
      transition: 'opacity .18s, transform .18s',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i class="fas fa-store" style="margin-right:8px;opacity:.7"></i>${nome}`;
  toast.style.opacity   = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(-50%) translateY(12px)';
  }, 1800);
}

// ══════════════════════════════════════════════════════
// DASHBOARD — SUPABASE
// ══════════════════════════════════════════════════════
async function carregarDashboard() {
  if (!sb) {
    console.warn('[SISLOT] Supabase não configurado.');
    mostrarEstadoVazio('Supabase não configurado.');
    return;
  }

  state.carregando = true;
  mostrarLoadingCards();

  try {
    const { data, error } = await sb
      .from('view_produtos_dashboard_loja')
      .select('*')
      .eq('loteria_id', state.lojaAtiva.id)
      .order('produto',   { ascending: true })
      .order('item_nome', { ascending: true });

    if (error) throw error;

    state.dashboard = (data || []).map(item => ({
      // id composto — chave única usada em dataset, findIndex e selects
      id: item.produto === 'RASPADINHA'
            ? `R:${item.raspadinha_id}`
            : `T:${item.telesena_item_id}`,

      produto:              item.produto,
      raspadinha_id:        item.raspadinha_id     ?? null,
      telesena_item_id:     item.telesena_item_id  ?? null,
      campanha_nome:        item.campanha_nome      ?? null,
      item_nome:            item.item_nome,
      saldo_atual:          Number(item.saldo_atual           || 0),
      vendidas_7d:          Number(item.vendidas_7d           || 0),
      media_dia_7d:         Number(item.media_dia_7d          || 0),
      duracao_estoque_dias: Number(item.duracao_estoque_dias  || 0),
      valor_venda:          Number(item.valor_venda           || 0),
      valor_custo:          Number(item.valor_custo           || 0),
    }));

  } catch (e) {
    console.error('[SISLOT] Erro ao carregar dashboard:', e);
    mostrarErroDashboard(e.message || String(e));
    state.dashboard = [];
  } finally {
    state.carregando = false;
  }
}

function mostrarLoadingCards() {
  const html = `
    <div class="empty-state" style="opacity:.5">
      <i class="fas fa-circle-notch fa-spin"></i>
      <span>Carregando produtos…</span>
    </div>`;
  ['cardsCadastro','cardsEstoque'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
}

function mostrarEstadoVazio(msg) {
  const html = `
    <div class="empty-state">
      <i class="fas fa-box-open"></i>
      <span>${msg || `Nenhum produto para ${state.lojaAtiva.nome}.`}</span>
    </div>`;
  ['cardsCadastro','cardsEstoque'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
}

function mostrarErroDashboard(msg) {
  const html = `
    <div class="empty-state" style="color:var(--error,#f87171)">
      <i class="fas fa-exclamation-triangle"></i>
      <span>Erro ao carregar: ${msg}</span>
    </div>`;
  ['cardsCadastro','cardsEstoque'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
}

// ══════════════════════════════════════════════════════
// NAVEGAÇÃO DE TELAS
// ══════════════════════════════════════════════════════
function renderScreenTabs() {
  const podeVerMestra = ['ADMIN','SOCIO'].includes(state.roleUsuario);
  const btnMestra = $('btnMestra');
  if (btnMestra && !podeVerMestra) btnMestra.style.display = 'none';
}

function mudarScreen(screen) {
  if (screen === 'mestra' && !['ADMIN','SOCIO'].includes(state.roleUsuario)) return;
  state.screen = screen;

  document.querySelectorAll('.qmod').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screen)
  );
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === `screen-${screen}`)
  );

  if (screen === 'estoque') renderEstoque();
  if (screen === 'mestra')  renderMestra();
}

// ══════════════════════════════════════════════════════
// ABA DE CADASTRO
// ══════════════════════════════════════════════════════
function mudarAba(aba) {
  if (state.abaCadastro === aba) {
    state.abaCadastro = null;
    document.querySelectorAll('.tipo-chip').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.cadastro-pane').forEach(p => p.classList.remove('active'));
    const hint = $('tipoHint');
    if (hint) hint.style.display = '';
    return;
  }

  state.abaCadastro = aba;
  document.querySelectorAll('.tipo-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.aba === aba)
  );
  document.querySelectorAll('.cadastro-pane').forEach(p => p.classList.remove('active'));
  const pane = $(`pane-${aba}`);
  if (pane) pane.classList.add('active');

  const hint = $('tipoHint');
  if (hint) hint.style.display = 'none';

  setTimeout(() => pane?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

// ══════════════════════════════════════════════════════
// CARDS DE ESTOQUE
// ══════════════════════════════════════════════════════
function getFiltrados(filtro) {
  if (!filtro || filtro === 'todos') return state.dashboard;
  if (filtro === 'baixo') return state.dashboard.filter(i => stockLevel(i) === 'critical');
  return state.dashboard.filter(i => i.produto === filtro);
}

function stockLevel(item) {
  const dias = Number(item.duracao_estoque_dias || 0);
  if (dias === 0) return 'critical';
  if (dias < 15)  return 'critical';
  if (dias < 30)  return 'warning';
  return 'ok';
}

function montarCard(item, clickable = false) {
  const nivel = stockLevel(item);
  const dias  = Number(item.duracao_estoque_dias || 0);
  const pct   = Math.min(100, Math.max(0, (dias / 60) * 100));

  const card = document.createElement('div');
  card.className     = 'prod-card';
  card.dataset.level = nivel;
  card.dataset.id    = item.id;

  const campanha  = item.campanha_nome ? `<div class="pcard-campanha">${item.campanha_nome}</div>` : '';
  const tipoLabel = item.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';
  const nivelSaldo = item.saldo_atual > 50 ? 'value-good'
                   : item.saldo_atual > 15 ? 'value-warn' : 'value-alert';

  card.innerHTML = `
    <div class="pcard-top">
      <div class="pcard-id">
        <div class="pcard-tipo">${tipoLabel}</div>
        <div class="pcard-nome">${item.item_nome}</div>
        ${campanha}
      </div>
      <div class="pcard-valor">R$ ${fmtBR(item.valor_venda)}</div>
    </div>
    <div class="pcard-stats">
      <div class="pstat">
        <div class="pstat-label">Saldo atual</div>
        <div class="pstat-value ${nivelSaldo}">${item.saldo_atual}</div>
      </div>
      <div class="pstat">
        <div class="pstat-label">Vendidas 7d</div>
        <div class="pstat-value">${item.vendidas_7d}</div>
      </div>
      <div class="pstat">
        <div class="pstat-label">Média / dia</div>
        <div class="pstat-value">${Number(item.media_dia_7d).toFixed(1)}</div>
      </div>
      <div class="pstat">
        <div class="pstat-label">Duração est.</div>
        <div class="pstat-value ${nivel === 'critical' ? 'value-alert' : nivel === 'warning' ? 'value-warn' : ''}">
          ${dias > 0 ? Math.round(dias) + 'd' : '—'}
        </div>
      </div>
    </div>
    <div class="pcard-duration">
      <div class="pcd-label">
        <span class="pcd-label-text">Nível de estoque</span>
        <span class="pcd-label-value">${dias > 0 ? `~${Math.round(dias)} dias` : 'sem dados'}</span>
      </div>
      <div class="pcd-bar-track">
        <div class="pcd-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>
    ${clickable ? `<div class="pcard-click-hint"><i class="fas fa-hand-pointer"></i> Clique para movimentar</div>` : ''}
  `;

  return card;
}

function renderCards() {
  const container = $('cardsCadastro');
  if (!container) return;
  container.innerHTML = '';

  const lista = getFiltrados(state.tipoFiltro);

  if (!lista.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <span>Nenhum produto para o filtro selecionado.</span>
      </div>`;
  } else {
    lista.forEach(item => {
      const card = montarCard(item, true);
      card.addEventListener('click', () => abrirPanel(item));
      container.appendChild(card);
    });
  }

  atualizarMetricas(lista);
  const badge = $('stockBadge');
  if (badge) badge.textContent = lista.length;
}

function atualizarMetricas(lista) {
  const totalSaldo  = lista.reduce((a, b) => a + Number(b.saldo_atual  || 0), 0);
  const totalVend   = lista.reduce((a, b) => a + Number(b.vendidas_7d  || 0), 0);
  const totalMedia  = lista.reduce((a, b) => a + Number(b.media_dia_7d || 0), 0);
  const duracao     = totalMedia > 0 ? totalSaldo / totalMedia : 0;

  if ($('mSaldoTotal')) $('mSaldoTotal').textContent = totalSaldo;
  if ($('mVendidas7d')) $('mVendidas7d').textContent = totalVend;
  if ($('mMediaDia'))   $('mMediaDia').textContent   = totalMedia.toFixed(1);
  if ($('mDuracao'))    $('mDuracao').textContent     = duracao > 0 ? `~${Math.round(duracao)}d` : '—';
}

// ══════════════════════════════════════════════════════
// PAINEL DESLIZANTE
// ══════════════════════════════════════════════════════
function abrirPanel(item) {
  state.panelItem = item;
  state.tipoMov   = 'ENTRADA';

  const tipoBadge = $('panelTipoBadge');
  if (tipoBadge) tipoBadge.textContent = item.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';

  const nome = $('panelNome');
  if (nome) nome.textContent = item.item_nome;

  const sub = $('panelSub');
  if (sub) {
    sub.textContent = item.campanha_nome
      ? `${item.campanha_nome} · R$ ${fmtBR(item.valor_venda)}`
      : `R$ ${fmtBR(item.valor_venda)}`;
  }

  atualizarSaldoPanel(item.saldo_atual, item.saldo_atual);
  setTipoToggle('ENTRADA');

  const inp = $('panelQtd');
  if (inp) { inp.value = ''; inp.focus?.(); }
  const obs = $('panelObs');
  if (obs) obs.value = '';

  esconderStatusPanel();

  document.querySelectorAll('.prod-card').forEach(c =>
    c.classList.toggle('active', c.dataset.id === item.id)
  );

  $('movPanel').classList.add('active');
  $('panelBackdrop').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function fecharPanel() {
  $('movPanel').classList.remove('active');
  $('panelBackdrop').classList.remove('active');
  document.body.style.overflow = '';
  document.querySelectorAll('.prod-card').forEach(c => c.classList.remove('active'));
  state.panelItem = null;
}

function atualizarSaldoPanel(saldoAtual, saldoPrev) {
  if ($('panelSaldoAtual')) $('panelSaldoAtual').textContent = saldoAtual;
  if ($('prevAtual'))       $('prevAtual').textContent       = saldoAtual;

  const prevEl = $('panelSaldoPrev');
  if (prevEl) {
    prevEl.textContent  = saldoPrev;
    prevEl.style.color  = saldoPrev > saldoAtual ? 'var(--t1)'
                        : saldoPrev < saldoAtual ? '#f87171' : '';
  }

  const max = Math.max(saldoAtual, 200);
  const bar = $('panelSaldoBar');
  if (bar) bar.style.width = Math.min(100, Math.max(0, (saldoAtual / max) * 100)) + '%';

  const arrow = $('prevArrowIcon');
  if (arrow) {
    arrow.className = saldoPrev > saldoAtual ? 'fas fa-arrow-up'
                    : saldoPrev < saldoAtual ? 'fas fa-arrow-down' : 'fas fa-arrow-right';
  }
}

function calcularPrevisto() {
  if (!state.panelItem) return;
  const qtd   = Number($('panelQtd')?.value || 0);
  const saldo = Number(state.panelItem.saldo_atual);
  atualizarSaldoPanel(saldo, state.tipoMov === 'ENTRADA' ? saldo + qtd : saldo - qtd);
}

function setTipoToggle(tipo) {
  state.tipoMov = tipo;
  document.querySelectorAll('.tipo-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tipo === tipo)
  );
}

async function aplicarMovimentacaoRapida() {
  const item = state.panelItem;
  if (!item) return;

  const qtdInput = Number($('panelQtd')?.value || 0);
  if (!qtdInput || qtdInput <= 0) {
    showStatusPanel('Informe uma quantidade válida.', 'err');
    return;
  }

  const saldoAtual = Number(item.saldo_atual || 0);

  if (state.tipoMov === 'REDUCAO' && qtdInput > saldoAtual) {
    showStatusPanel('Quantidade maior que o saldo disponível.', 'err');
    return;
  }

  if (!sb) {
    showStatusPanel('Supabase não disponível.', 'err');
    return;
  }

  const obs = $('panelObs')?.value?.trim() || null;

  // Entrada = positivo | Redução = negativo
  const qtdLancamento = state.tipoMov === 'ENTRADA' ? qtdInput : -qtdInput;
  const novoSaldo = saldoAtual + qtdLancamento;

  const payload = {
    loteria_id:       state.lojaAtiva.id,
    produto:          item.produto,
    raspadinha_id:    item.produto === 'RASPADINHA' ? item.raspadinha_id : null,
    telesena_item_id: item.produto === 'TELESENA' ? item.telesena_item_id : null,
    qtd:              qtdLancamento,
    data_referencia:  new Date().toISOString().slice(0, 10),
    observacao:       obs,
    usuario_id:       state.usuario?.id || null,
  };

  try {
    showStatusPanel('Salvando...', 'info');

    const { error } = await sb
      .from('produtos_entradas')
      .insert(payload);

    if (error) throw error;

    // Histórico local apenas visual
    state.movHistorico.unshift({
      tipo: state.tipoMov,
      nome: item.item_nome,
      qtd: qtdInput,
      novoSaldo,
      obs: obs || '',
      hora: new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      }),
    });

    renderMovHistorico();

    // Recarrega saldo real vindo do servidor/view
    await carregarDashboard();
    renderCards();
    renderEstoque();
    renderMestra();
    renderMovSelects?.();

    // Atualiza painel com o valor recarregado do servidor
    const itemAtualizado = state.dashboard.find(x => x.id === item.id);
    if (itemAtualizado) {
      state.panelItem = itemAtualizado;
      atualizarSaldoPanel(
        Number(itemAtualizado.saldo_atual || 0),
        Number(itemAtualizado.saldo_atual || 0)
      );
    }

    showStatusPanel(
      `✓ ${state.tipoMov === 'ENTRADA' ? 'Entrada' : 'Redução'} registrada com sucesso.`,
      'ok'
    );

    if ($('panelQtd')) $('panelQtd').value = '';
    if ($('panelObs')) $('panelObs').value = '';

    setTimeout(() => {
      fecharPanel();
      esconderStatusPanel();
    }, 1200);

  } catch (err) {
    console.error('[SISLOT] Erro ao registrar movimentação rápida:', err);
    showStatusPanel(
      err?.message || 'Erro ao salvar movimentação.',
      'err'
    );
  }
}

function showStatusPanel(msg, tipo) {
  const st  = $('statusPanel');
  const mel = $('statusPanelMsg');
  if (!st || !mel) return;
  mel.textContent = msg;
  st.className    = `status ${tipo}`;
  st.style.display = 'flex';
}

function esconderStatusPanel() {
  const st = $('statusPanel');
  if (st) st.style.display = 'none';
}

// ══════════════════════════════════════════════════════
// MOVIMENTAÇÃO ENTRE LOJAS (Tela 2)
// ══════════════════════════════════════════════════════
function renderMovSelects() {
  const origem  = $('movOrigem');
  const destino = $('movDestino');
  const produto = $('movProduto');
  if (!origem || !destino || !produto) return;

  origem.innerHTML  = '';
  destino.innerHTML = '';
  produto.innerHTML = '<option value="">Selecione…</option>';

  LOJAS.forEach(l => {
    origem.add(new Option(l.nome, l.id));
    destino.add(new Option(l.nome, l.id));
  });

  origem.value  = String(state.lojaAtiva.id);
  destino.value = String(LOJAS.find(l => l.id !== state.lojaAtiva.id)?.id || '');

  state.dashboard.forEach(item => {
    const label = item.campanha_nome
      ? `${item.campanha_nome} — ${item.item_nome}`
      : item.item_nome;
    produto.add(new Option(label, item.id));
  });

  renderMovRouteVisual();
}

function renderMovRouteVisual() {
  const origemId  = Number($('movOrigem')?.value);
  const destinoId = Number($('movDestino')?.value);

  if ($('movNomeOrigem'))  $('movNomeOrigem').textContent  = LOJAS.find(l => l.id === origemId)?.nome  || '—';
  if ($('movNomeDestino')) $('movNomeDestino').textContent = LOJAS.find(l => l.id === destinoId)?.nome || '—';

  const qty  = Number($('movQtd')?.value || 0);
  const rQty = $('movRouteQty');
  if (rQty) rQty.textContent = qty > 0 ? `${qty} un.` : '—';
}

function renderMovHistorico() {
  const list = $('movHistoryList');
  if (!list) return;
  list.innerHTML = '';

  if (!state.movHistorico.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exchange-alt"></i>
        <span>Nenhuma movimentação registrada ainda.</span>
      </div>`;
    return;
  }

  state.movHistorico.slice(0, 8).forEach(entry => {
    const el = document.createElement('div');
    el.className = 'mov-history-item';
    el.innerHTML = `
      <span class="mhi-badge ${entry.tipo === 'ENTRADA' ? 'entrada' : 'reducao'}">${entry.tipo}</span>
      <div class="mhi-info">
        <div class="mhi-nome">${entry.nome}</div>
        <div class="mhi-rota">${entry.hora}${entry.obs ? ' · ' + entry.obs : ''}</div>
      </div>
      <div class="mhi-qtd">${entry.tipo === 'ENTRADA' ? '+' : '-'}${entry.qtd}</div>
    `;
    list.appendChild(el);
  });
}

async function salvarMovimentacao() {
  try {
    const origemId      = Number($('movOrigem')?.value);
    const destinoId     = Number($('movDestino')?.value);
    const produtoKey    = $('movProduto')?.value || '';
    const qtd           = Number($('movQtd')?.value || 0);
    const custoInf      = Number($('movCusto')?.value || 0);
    const obs           = $('movObs')?.value?.trim() || '';

    if (!origemId || !destinoId || !produtoKey) {
      setStatus('statusMov', 'Preencha todos os campos obrigatórios.', 'err'); return;
    }
    if (origemId === destinoId) {
      setStatus('statusMov', 'Origem e destino não podem ser iguais.', 'err'); return;
    }
    if (qtd <= 0) {
      setStatus('statusMov', 'Informe uma quantidade válida.', 'err'); return;
    }

    const prod = state.dashboard.find(x => x.id === produtoKey);
    if (!prod) { setStatus('statusMov', 'Produto não encontrado.', 'err'); return; }

    const saldoAtual = Number(prod.saldo_atual || 0);
    if (qtd > saldoAtual) {
      setStatus('statusMov', `Saldo insuficiente. Disponível: ${saldoAtual}`, 'err'); return;
    }

    const valorUnit  = custoInf > 0 ? custoInf : Number(prod.valor_custo || 0);
    const valorTotal = Number((qtd * valorUnit).toFixed(2));

    // Atualiza local imediatamente
    const idx = state.dashboard.findIndex(x => x.id === produtoKey);
    if (idx >= 0) state.dashboard[idx].saldo_atual = Math.max(0, saldoAtual - qtd);

    if (!sb) {
      setStatus('statusMov', 'Supabase não disponível — movimentação aplicada localmente.', 'info');
      renderCards(); renderMovSelects(); renderEstoque(); renderMestra();
      return;
    }

    const payload = {
      loteria_origem_id:  origemId,
      loteria_destino_id: destinoId,
      produto:            prod.produto,
      raspadinha_id:      prod.produto === 'RASPADINHA' ? prod.raspadinha_id    : null,
      telesena_item_id:   prod.produto === 'TELESENA'   ? prod.telesena_item_id : null,
      qtd,
      valor_custo_unit:   valorUnit,
      valor_total:        valorTotal,
      data_referencia:    new Date().toISOString().slice(0, 10),
      observacao:         obs || null,
      usuario_id:         state.usuario?.id || null,
    };

    const { error } = await sb.from('produtos_movimentacoes').insert(payload);
    if (error) throw error;

    // Recarrega para refletir saldo real do servidor
    await carregarDashboard();

    setStatus('statusMov', '✓ Movimentação salva com sucesso.', 'ok');
    ['movQtd','movCusto','movObs'].forEach(id => { const el = $(id); if (el) el.value = ''; });

    renderCards(); renderMovSelects(); renderEstoque(); renderMestra();
  } catch (e) {
    console.error('[SISLOT] Erro ao salvar movimentação:', e);
    setStatus('statusMov', `Erro: ${e.message || e}`, 'err');
  }
}

function bindMovProdutoCusto() {
  const sel = $('movProduto');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const prod    = state.dashboard.find(x => x.id === sel.value);
    const inpCusto = $('movCusto');
    if (prod && inpCusto) inpCusto.value = Number(prod.valor_custo || 0).toFixed(2);
  });
}

function setStatusMov(msg, tipo) {
  const el = $('statusMov');
  if (!el) return;
  el.className = `status ${tipo}`;
  el.innerHTML = `<i class="fas fa-${tipo === 'ok' ? 'check-circle' : tipo === 'err' ? 'exclamation-circle' : 'info-circle'}"></i><span>${msg}</span>`;
}

// ══════════════════════════════════════════════════════
// TELA 3 — ESTOQUE
// ══════════════════════════════════════════════════════
function renderEstoque() {
  const container   = $('cardsEstoque');
  const searchVal   = $('estoqueSearch')?.value?.toLowerCase() || '';
  const filtroAtivo = document.querySelector('#screen-estoque .filter-chip.active')?.dataset.filter || 'todos';

  if (!container) return;
  container.innerHTML = '';

  let lista = getFiltrados(filtroAtivo);
  if (searchVal) {
    lista = lista.filter(i =>
      i.item_nome.toLowerCase().includes(searchVal) ||
      (i.campanha_nome || '').toLowerCase().includes(searchVal)
    );
  }

  if (!lista.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search"></i>
        <span>Nenhum produto encontrado.</span>
      </div>`;
  } else {
    lista.forEach(item => container.appendChild(montarCard(item, false)));
  }

  const criticos = lista.filter(i => stockLevel(i) === 'critical').length;

  if ($('esItens'))    $('esItens').textContent    = lista.length;
  if ($('esSaldo'))    $('esSaldo').textContent    = lista.reduce((a, b) => a + Number(b.saldo_atual || 0), 0);
  if ($('esVendas'))   $('esVendas').textContent   = lista.reduce((a, b) => a + Number(b.vendidas_7d || 0), 0);
  if ($('esCriticos')) $('esCriticos').textContent = criticos;

  const alertItem = $('esAlertItem');
  if (alertItem) alertItem.style.opacity = criticos > 0 ? '1' : '.4';
}

// ══════════════════════════════════════════════════════
// TELA 4 — MESTRA
// ══════════════════════════════════════════════════════
function renderMestra() {
  if (!['ADMIN','SOCIO'].includes(state.roleUsuario)) return;

  const lista      = state.dashboard;
  const totalVend  = lista.reduce((a, b) => a + Number(b.vendidas_7d  || 0), 0);
  const totalFat   = lista.reduce((a, b) => a + Number(b.vendidas_7d  || 0) * Number(b.valor_venda || 0), 0);
  const totalCusto = lista.reduce((a, b) => a + Number(b.vendidas_7d  || 0) * Number(b.valor_custo || 0), 0);
  const totalLucro = totalFat - totalCusto;
  const margem     = totalFat > 0 ? (totalLucro / totalFat * 100) : 0;

  if ($('kpiVendas')) $('kpiVendas').textContent = totalVend;
  if ($('kpiFat'))    $('kpiFat').textContent    = fmtBRL(totalFat);
  if ($('kpiCusto'))  $('kpiCusto').textContent  = fmtBRL(totalCusto);
  if ($('kpiLucro'))  $('kpiLucro').textContent  = fmtBRL(totalLucro);
  if ($('kpiMargem')) $('kpiMargem').textContent = margem.toFixed(1) + '%';

  const tbody = $('mestraTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  lista.forEach(item => {
    const fat   = Number(item.vendidas_7d || 0) * Number(item.valor_venda || 0);
    const custo = Number(item.vendidas_7d || 0) * Number(item.valor_custo || 0);
    const lucro = fat - custo;
    const marg  = fat > 0 ? (lucro / fat * 100) : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="td-badge ${item.produto === 'RASPADINHA' ? 'rasp' : 'tele'}">
          ${item.produto === 'RASPADINHA' ? 'Rasp.' : 'Tele Sena'}
        </span>
      </td>
      <td class="td-produto">
        ${item.campanha_nome ? `<span style="color:var(--text2);font-size:11px">${item.campanha_nome} · </span>` : ''}
        ${item.item_nome}
      </td>
      <td class="num">${item.vendidas_7d}</td>
      <td class="num">${fmtBRL(fat)}</td>
      <td class="num">${fmtBRL(custo)}</td>
      <td class="num ${lucro >= 0 ? 'td-lucro-pos' : 'td-lucro-neg'}">${fmtBRL(lucro)}</td>
      <td class="num">${marg.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// ══════════════════════════════════════════════════════
// CADASTRO — RASPADINHA
// ══════════════════════════════════════════════════════
async function salvarRaspadinha() {
  try {
    const nome      = $('raspNome')?.value?.trim();
    const valorVend = Number($('raspValorVenda')?.value || 0);
    const ordem     = Number($('raspOrdem')?.value || 0);

    if (!nome)        { setStatus('statusRasp', 'Informe o nome.',           'err'); $('raspNome')?.focus();      return; }
    if (valorVend <= 0) { setStatus('statusRasp', 'Informe o valor de venda.', 'err'); $('raspValorVenda')?.focus(); return; }

    // Custo automático — Raspadinha lucro 20%
    const valorCusto = calcularCusto('RASPADINHA', valorVend);
    const inpCusto   = $('raspValorCusto');
    if (inpCusto) inpCusto.value = valorCusto.toFixed(2);

    if (!sb) { setStatus('statusRasp', 'Supabase não disponível.', 'err'); return; }

    const { data, error } = await sb
      .from('raspadinhas')
      .insert({ nome, valor_venda: valorVend, valor_custo: valorCusto, margem_percentual: 20, ordem, ativo: true })
      .select().single();

    if (error) throw error;

    setStatus('statusRasp', `✓ Raspadinha "${data.nome}" salva.`, 'ok');
    limparFormRasp();
    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusRasp', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao salvar raspadinha:', e);
  }
}

function limparFormRasp() {
  ['raspNome','raspValorVenda','raspValorCusto','raspOrdem'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
}

// ══════════════════════════════════════════════════════
// CADASTRO — TELE SENA
// ══════════════════════════════════════════════════════
async function salvarTeleSena() {
  try {
    const campanhaNome = $('teleCampanha')?.value?.trim();
    const itemNome     = $('teleItem')?.value?.trim();
    const dataInicio   = $('teleDataInicio')?.value || null;
    const dataFim      = $('teleDataFim')?.value    || null;
    const valorVenda   = Number($('teleValorVenda')?.value || 0);

    if (!campanhaNome) { setStatus('statusTele', 'Informe a campanha.', 'err'); $('teleCampanha')?.focus(); return; }
    if (!itemNome)     { setStatus('statusTele', 'Informe o item.',     'err'); $('teleItem')?.focus();     return; }
    if (!dataInicio || !dataFim) { setStatus('statusTele', 'Informe as datas.', 'err'); return; }
    if (valorVenda <= 0) { setStatus('statusTele', 'Informe o valor de venda.', 'err'); $('teleValorVenda')?.focus(); return; }

    // Custo automático — Tele Sena lucro 8%
    const valorCusto = calcularCusto('TELESENA', valorVenda);
    const inpCusto   = $('teleValorCusto');
    if (inpCusto) inpCusto.value = valorCusto.toFixed(2);

    if (!sb) { setStatus('statusTele', 'Supabase não disponível.', 'err'); return; }

    // Busca ou cria campanha
    let campanhaId = null;
    const { data: campExist, error: campBuscaErr } = await sb
      .from('telesena_campanhas').select('id').eq('nome', campanhaNome).maybeSingle();
    if (campBuscaErr) throw campBuscaErr;

    if (campExist?.id) {
      campanhaId = campExist.id;
    } else {
      const { data: campNova, error: campInsErr } = await sb
        .from('telesena_campanhas')
        .insert({ nome: campanhaNome, data_inicio: dataInicio, data_fim: dataFim, ativo: true, ordem: 0 })
        .select().single();
      if (campInsErr) throw campInsErr;
      campanhaId = campNova.id;
    }

    const { data: itemNovo, error: itemErr } = await sb
      .from('telesena_itens')
      .insert({ campanha_id: campanhaId, nome: itemNome, valor_venda: valorVenda, valor_custo: valorCusto, ativo: true, ordem: 0 })
      .select().single();
    if (itemErr) throw itemErr;

    setStatus('statusTele', `✓ Item "${itemNovo.nome}" salvo em "${campanhaNome}".`, 'ok');
    limparFormTele();
    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusTele', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao salvar Tele Sena:', e);
  }
}

function limparFormTele() {
  ['teleCampanha','teleItem','teleDataInicio','teleDataFim','teleValorVenda','teleValorCusto'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  preencherData();
}

// ══════════════════════════════════════════════════════
// INATIVAR
// ══════════════════════════════════════════════════════
async function inativarRaspadinhaSelecionada() {
  try {
    const nome = $('raspNome')?.value?.trim();
    if (!nome) { setStatus('statusRasp', 'Informe o nome para inativar.', 'err'); return; }
    if (!sb)   { setStatus('statusRasp', 'Supabase não disponível.', 'err');      return; }

    const { error } = await sb.from('raspadinhas').update({ ativo: false }).eq('nome', nome);
    if (error) throw error;

    setStatus('statusRasp', `✓ Raspadinha "${nome}" inativada.`, 'ok');
    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusRasp', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao inativar raspadinha:', e);
  }
}

async function inativarTeleSenaSelecionada() {
  try {
    const campanhaNome = $('teleCampanha')?.value?.trim();
    const itemNome     = $('teleItem')?.value?.trim();

    if (!campanhaNome) { setStatus('statusTele', 'Informe a campanha para inativar.', 'err'); return; }
    if (!sb)           { setStatus('statusTele', 'Supabase não disponível.', 'err');          return; }

    if (itemNome) {
      const { data: camp, error: campErr } = await sb
        .from('telesena_campanhas').select('id').eq('nome', campanhaNome).maybeSingle();
      if (campErr) throw campErr;
      if (!camp?.id) throw new Error('Campanha não encontrada.');

      const { data: itm, error: itmErr } = await sb
        .from('telesena_itens').select('id').eq('campanha_id', camp.id).eq('nome', itemNome).maybeSingle();
      if (itmErr) throw itmErr;
      if (!itm?.id) throw new Error('Item não encontrado.');

      const { error: updErr } = await sb.from('telesena_itens').update({ ativo: false }).eq('id', itm.id);
      if (updErr) throw updErr;
      setStatus('statusTele', `✓ Item "${itemNome}" inativado.`, 'ok');
    } else {
      const { error: updErr } = await sb.from('telesena_campanhas').update({ ativo: false }).eq('nome', campanhaNome);
      if (updErr) throw updErr;
      setStatus('statusTele', `✓ Campanha "${campanhaNome}" inativada.`, 'ok');
    }

    await carregarDashboard();
    renderCards(); renderEstoque(); renderMestra();
  } catch (e) {
    setStatus('statusTele', `Erro: ${e.message || e}`, 'err');
    console.error('[SISLOT] Erro ao inativar Tele Sena:', e);
  }
}

// ══════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════
function setStatus(elId, msg, tipo) {
  const el = $(elId);
  if (!el) return;
  el.className = `status ${tipo}`;
  const icon = tipo === 'ok' ? 'check-circle' : tipo === 'err' ? 'exclamation-circle' : 'info-circle';
  el.innerHTML = `<i class="fas fa-${icon}"></i><span>${msg}</span>`;
}

function preencherData() {
  const agora   = new Date();
  const dataBr  = agora.toLocaleDateString('pt-BR');
  const dataIso = agora.toISOString().slice(0, 10);

  const pill = $('pillData');
  if (pill) pill.textContent = dataBr;

  const ini = $('teleDataInicio');
  const fim = $('teleDataFim');
  if (ini && !ini.value) ini.value = dataIso;
  if (fim && !fim.value) fim.value = dataIso;
}

// ══════════════════════════════════════════════════════
// BIND DE EVENTOS
// ══════════════════════════════════════════════════════
function bind() {
  bindMovProdutoCusto();

  // Quickbar
  document.querySelectorAll('.qmod').forEach(btn =>
    btn.addEventListener('click', () => mudarScreen(btn.dataset.screen))
  );

  // Tipo chips cadastro
  document.querySelectorAll('.tipo-chip').forEach(btn =>
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba))
  );
  document.querySelectorAll('.pane-close').forEach(btn =>
    btn.addEventListener('click', () => mudarAba(btn.dataset.aba))
  );

  // ── Troca de loja por clique direto — SEM MODAL ──
  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.addEventListener('click', alternarLoja);

  // Panel movimentação rápida
  $('btnFecharPanel')?.addEventListener('click', fecharPanel);
  $('panelBackdrop')?.addEventListener('click', fecharPanel);
  $('btnAplicarPanel')?.addEventListener('click', aplicarMovimentacaoRapida);

  document.querySelectorAll('.tipo-toggle-btn').forEach(btn =>
    btn.addEventListener('click', () => { setTipoToggle(btn.dataset.tipo); calcularPrevisto(); })
  );

  $('panelQtdMinus')?.addEventListener('click', () => {
    const inp = $('panelQtd');
    if (inp) { inp.value = Math.max(0, Number(inp.value) - 1); calcularPrevisto(); }
  });
  $('panelQtdPlus')?.addEventListener('click', () => {
    const inp = $('panelQtd');
    if (inp) { inp.value = Number(inp.value) + 1; calcularPrevisto(); }
  });
  $('panelQtd')?.addEventListener('input', calcularPrevisto);

  // Movimentação entre lojas
  $('movQtdMinus')?.addEventListener('click', () => {
    const inp = $('movQtd');
    if (inp) { inp.value = Math.max(0, Number(inp.value) - 1); renderMovRouteVisual(); }
  });
  $('movQtdPlus')?.addEventListener('click', () => {
    const inp = $('movQtd');
    if (inp) { inp.value = Number(inp.value) + 1; renderMovRouteVisual(); }
  });
  $('movQtd')?.addEventListener('input',    renderMovRouteVisual);
  $('movOrigem')?.addEventListener('change', renderMovRouteVisual);
  $('movDestino')?.addEventListener('change', renderMovRouteVisual);

  $('btnSalvarMov')?.addEventListener('click', salvarMovimentacao);
  $('btnLimparMov')?.addEventListener('click', () => {
    ['movQtd','movCusto','movObs'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    renderMovRouteVisual();
    setStatusMov('Campos limpos.', 'muted');
  });

  // Custo automático — Raspadinha (20% lucro)
  $('raspValorVenda')?.addEventListener('input', () => {
    const v = Number($('raspValorVenda').value || 0);
    const c = $('raspValorCusto');
    if (c) c.value = v > 0 ? calcularCusto('RASPADINHA', v).toFixed(2) : '';
  });

  // Custo automático — Tele Sena (8% lucro)
  $('teleValorVenda')?.addEventListener('input', () => {
    const v = Number($('teleValorVenda').value || 0);
    const c = $('teleValorCusto');
    if (c) c.value = v > 0 ? calcularCusto('TELESENA', v).toFixed(2) : '';
  });

  $('btnSalvarRasp')?.addEventListener('click',   salvarRaspadinha);
  $('btnInativarRasp')?.addEventListener('click', inativarRaspadinhaSelecionada);
  $('btnSalvarTele')?.addEventListener('click',   salvarTeleSena);
  $('btnInativarTele')?.addEventListener('click', inativarTeleSenaSelecionada);

  // Filtros tela 1
  document.querySelectorAll('#stockFilterChips .filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#stockFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.tipoFiltro = btn.dataset.filter;
      renderCards();
    })
  );

  // Filtros tela 3
  document.querySelectorAll('#estoqueFilterChips .filter-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#estoqueFilterChips .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEstoque();
    })
  );

  $('estoqueSearch')?.addEventListener('input', renderEstoque);
  $('mestraPeriodo')?.addEventListener('change', renderMestra);
  $('mestraTipo')?.addEventListener('change',    renderMestra);

  $('btnInicio')?.addEventListener('click', () => window.SISLOT_SECURITY?.irParaInicio?.());
  $('btnSair')?.addEventListener('click', async () => await window.SISLOT_SECURITY?.sair?.());
}
