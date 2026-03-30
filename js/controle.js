/**
 * SISLOT — Controle Financeiro (unificado)
 * Fontes:
 *   - view_card_acertos
 *   - view_controle_financeiro_detalhe
 * Quitação:
 *   - controle_financeiro
 */

const sb  = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);
const $   = id => document.getElementById(id);

const fmtMoney = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const fmtDate  = v => {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const fmtMes = mesIso => {
  if (!mesIso) return '—';
  const [y, m] = String(mesIso).slice(0, 7).split('-');
  const n = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${n[parseInt(m, 10) - 1]}/${y}`;
};
const mesDeData = iso => iso ? String(iso).slice(0, 7) + '-01' : '';

const LOJAS = [
  { slug:'boulevard',    nome:'Boulevard',    logo:'./icons/boulevard.png'    },
  { slug:'centro',       nome:'Centro',       logo:'./icons/loterpraca.png'   },
  { slug:'lotobel',      nome:'Lotobel',      logo:'./icons/lotobel.png'      },
  { slug:'santa-tereza', nome:'Santa Tereza', logo:'./icons/santa-tereza.png' },
  { slug:'via-brasil',   nome:'Via Brasil',   logo:'./icons/via-brasil.png'   },
];

const PRODUTO_COR = {
  FEDERAL: '#38bdf8',
  BOLAO:   '#a78bfa',
  PRODUTO: '#22c55e',
};

const state = {
  usuario: null,
  loterias: [],
  lojaFiltro: '',
  cards: [],
  detalhes: [],
};

// ══════════════════════════════════════════════════════════
// RELÓGIO
// ══════════════════════════════════════════════════════════
function setClock() {
  const el = $('relogio');
  if (el) {
    el.textContent =
      new Date().toLocaleTimeString('pt-BR') + ' — ' +
      new Date().toLocaleDateString('pt-BR');
  }
}
setClock();
setInterval(setClock, 1000);

// ══════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tab}`));
  if (tab === 'movimentacoes') renderMovimentacoes();
}
document.querySelectorAll('.tab-btn').forEach(btn =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ══════════════════════════════════════════════════════════
// LOJA-TREE
// ══════════════════════════════════════════════════════════
function atualizarHeaderLoja() {
  const logoImg    = $('logoImg');
  const svgAll     = $('lojaTreeAll');
  const headerNome = $('headerNome');
  const lojaId     = state.lojaFiltro;

  if (!lojaId) {
    if (svgAll) svgAll.style.display = '';
    if (logoImg) logoImg.style.display = 'none';
    if (headerNome) headerNome.textContent = 'Todas as Lojas';
    document.body.setAttribute('data-loja', 'todas');
    return;
  }

  const loteria  = state.loterias.find(x => String(x.id) === String(lojaId));
  const slug     = loteria?.slug || '';
  const lojaInfo = LOJAS.find(l => l.slug === slug);

  if (lojaInfo) {
    if (svgAll) svgAll.style.display = 'none';
    if (logoImg) {
      logoImg.src = lojaInfo.logo;
      logoImg.style.display = '';
    }
    if (headerNome) headerNome.textContent = lojaInfo.nome;
    document.body.setAttribute('data-loja', slug);
  }
}

function ciclarLojaTree() {
  const idsPresentes = new Set([
    ...state.cards.map(m => String(m.loja_a_id)),
    ...state.cards.map(m => String(m.loja_b_id)),
    ...state.detalhes.map(m => String(m.loja_devedora_id)),
    ...state.detalhes.map(m => String(m.loja_credora_id)),
  ].filter(Boolean));

  const lojasPres = state.loterias.filter(l => idsPresentes.has(String(l.id)));
  const ciclo = [null, ...lojasPres];
  const idxAtual = ciclo.findIndex(l =>
    l === null ? !state.lojaFiltro : String(l.id) === String(state.lojaFiltro)
  );
  const proximo = ciclo[(idxAtual + 1) % ciclo.length];
  state.lojaFiltro = proximo ? String(proximo.id) : '';

  atualizarHeaderLoja();
  renderSaldo();
  renderMovimentacoes();
}

// ══════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════
async function bootstrap() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = './login.html'; return; }

  const { data: user } = await sb
    .from('usuarios').select('id,nome,perfil,ativo')
    .eq('auth_user_id', session.user.id)
    .eq('ativo', true)
    .maybeSingle();

  if (!user || !['ADMIN','SOCIO'].includes(user.perfil)) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;
                  height:100vh;flex-direction:column;gap:12px;color:#8fa3c8">
        <div style="font-size:18px;font-weight:600">Acesso restrito</div>
        <div style="font-size:13px;opacity:.6">Disponível apenas para sócios e administradores.</div>
        <button onclick="location.href='./menu.html'"
          style="margin-top:8px;padding:8px 16px;border-radius:8px;
                 background:#132952;border:1px solid #1e3a6e;
                 color:#8fa3c8;cursor:pointer;font-size:12px">
          Voltar ao menu
        </button>
      </div>`;
    return;
  }
  state.usuario = user;

  const { data: lojas } = await sb
    .from('loterias')
    .select('id,nome,slug')
    .eq('ativo', true)
    .order('nome');

  state.loterias = lojas || [];

  const lojaTree = $('lojaTreeWrap');
  if (lojaTree) lojaTree.addEventListener('click', ciclarLojaTree);

  ['saldo-periodo','saldo-mes','saldo-produto','saldo-status'].forEach(id => {
    $(id)?.addEventListener('change', () => {
      if (id === 'saldo-periodo') {
        const wrap = $('wrap-saldo-mes');
        if (wrap) wrap.style.display = $(id).value === 'total' ? 'none' : '';
      }
      renderSaldo();
    });
  });

  $('btn-pagar-tudo')?.addEventListener('click', pagarTudo);

  ['mov-produto','mov-origem','mov-destino','mov-mes','mov-status'].forEach(id => {
    $(id)?.addEventListener('change', renderMovimentacoes);
  });

  $('btn-limpar-mov')?.addEventListener('click', () => {
    ['mov-produto','mov-origem','mov-destino','mov-mes','mov-status']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
    renderMovimentacoes();
  });

  await refreshAll();
}

// ══════════════════════════════════════════════════════════
// LOAD
// ══════════════════════════════════════════════════════════
async function refreshAll() {
  await Promise.all([loadCards(), loadDetalhes()]);
  preencherSelectsMes();
  preencherSelectsLojas();
  atualizarHeaderLoja();
  renderSaldo();
  renderMovimentacoes();
}

async function loadCards() {
  const { data, error } = await sb
    .from('view_card_acertos')
    .select('*')
    .order('origem_tipo')
    .order('devedor')
    .order('credor');

  if (error) {
    console.error('loadCards error:', error);
    state.cards = [];
    return;
  }

  state.cards = (data || []).map(r => ({
    ...r,
    mes_ref: null,
    status_acerto: 'PENDENTE',
  }));
}

async function loadDetalhes() {
  const { data, error } = await sb
    .from('view_controle_financeiro_detalhe')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    console.error('loadDetalhes error:', error);
    state.detalhes = [];
    return;
  }

  state.detalhes = (data || []).map(r => ({
    ...r,
    produto: r.origem_tipo,
    valor_acerto: Number(r.valor || 0),
    mes_ref: mesDeData(r.mes_ref || r.data_acerto || r.created_at),
    ref_label: r.referencia || `${r.origem_tipo} #${r.movimentacao_id}`,
    loteria_origem: r.loja_credora_id,
    loteria_destino: r.loja_devedora_id,
    data_ref_exibicao: r.data_acerto || r.mes_ref || r.created_at,
    qtd_label: '—',
    unit_label: '—',
  }));
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function lookupLoja(id) {
  return state.loterias.find(x => String(x.id) === String(id))?.nome || `Loja ${id}`;
}

function detalhesFiltradosBase() {
  const produto  = $('mov-produto')?.value  || '';
  const origemId = $('mov-origem')?.value   || '';
  const destId   = $('mov-destino')?.value  || '';
  const mesRef   = $('mov-mes')?.value      || '';
  const status   = $('mov-status')?.value   || '';

  return state.detalhes.filter(m => {
    if (produto && m.origem_tipo !== produto) return false;
    if (origemId && String(m.loja_credora_id) !== String(origemId)) return false;
    if (destId && String(m.loja_devedora_id) !== String(destId)) return false;
    if (mesRef && String(m.mes_ref || '').slice(0, 10) !== String(mesRef)) return false;
    if (status && m.acerto_status !== status) return false;
    if (state.lojaFiltro) {
      const id = String(state.lojaFiltro);
      if (String(m.loja_credora_id) !== id && String(m.loja_devedora_id) !== id) return false;
    }
    return true;
  });
}

function preencherSelectsMes() {
  const meses = [...new Set(
    state.detalhes.map(m => String(m.mes_ref || '').slice(0, 10)).filter(Boolean)
  )].sort().reverse();

  ['saldo-mes','mov-mes'].forEach(id => {
    const sel = $(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${id === 'saldo-mes' ? 'Todos os meses' : 'Todos'}</option>`;
    meses.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = fmtMes(m);
      if (m === cur || (!cur && m === meses[0] && id === 'saldo-mes')) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function preencherSelectsLojas() {
  const ids = new Set(state.detalhes.flatMap(m =>
    [String(m.loja_credora_id), String(m.loja_devedora_id)].filter(Boolean)
  ));

  const lojas = state.loterias.filter(l => ids.has(String(l.id)));

  ['mov-origem','mov-destino'].forEach(id => {
    const sel = $(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">Todas</option>`;
    lojas.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.nome;
      if (String(l.id) === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

// ══════════════════════════════════════════════════════════
// RENDER — ABA SALDO
// ══════════════════════════════════════════════════════════
function renderSaldo() {
  const periodo = $('saldo-periodo')?.value || 'mes';
  const mesRef  = $('saldo-mes')?.value     || '';
  const produto = $('saldo-produto')?.value || '';
  const status  = $('saldo-status')?.value  || 'PENDENTE';

  let cards = [...state.cards];

  if (produto) cards = cards.filter(c => c.origem_tipo === produto);

  if (state.lojaFiltro) {
    const id = String(state.lojaFiltro);
    cards = cards.filter(c =>
      String(c.loja_a_id) === id || String(c.loja_b_id) === id
    );
  }

  if (status && status !== 'PENDENTE') {
    cards = [];
  }

  if (periodo !== 'total' && mesRef) {
    const detalhesMes = detalhesFiltradosBase().filter(m =>
      String(m.mes_ref || '').slice(0, 10) === String(mesRef)
    );

    const permitidos = new Set(
      detalhesMes.map(m => `${m.origem_tipo}|${Math.min(Number(m.loja_credora_id), Number(m.loja_devedora_id))}|${Math.max(Number(m.loja_credora_id), Number(m.loja_devedora_id))}`)
    );

    cards = cards.filter(c =>
      permitidos.has(`${c.origem_tipo}|${Math.min(Number(c.loja_a_id), Number(c.loja_b_id))}|${Math.max(Number(c.loja_a_id), Number(c.loja_b_id))}`)
    );
  }

  const detalhesParaKpi = detalhesFiltradosBase().filter(m => {
    if (produto && m.origem_tipo !== produto) return false;
    if (periodo !== 'total' && mesRef && String(m.mes_ref || '').slice(0,10) !== String(mesRef)) return false;
    if (status && m.acerto_status !== status) return false;
    if (state.lojaFiltro) {
      const id = String(state.lojaFiltro);
      if (String(m.loja_credora_id) !== id && String(m.loja_devedora_id) !== id) return false;
    }
    return true;
  });

  const totalPendente = detalhesParaKpi
    .filter(m => m.acerto_status === 'PENDENTE')
    .reduce((a, m) => a + Number(m.valor || 0), 0);

  const totalPago = detalhesParaKpi
    .filter(m => m.acerto_status === 'PAGO')
    .reduce((a, m) => a + Number(m.valor || 0), 0);

  const qtdPendente = cards.length;
  const qtdQuitado  = 0;

  const kpis = $('kpis-saldo');
  if (kpis) {
    kpis.innerHTML = [
      { l:'Total pendente', v:fmtMoney(totalPendente), s:`${qtdPendente} relação(ões)`, cor:'var(--amber)'  },
      { l:'Total quitado',  v:fmtMoney(totalPago),     s:`${qtdQuitado} relação(ões)`, cor:'var(--accent)' },
      { l:'Pares',          v:cards.length,            s:'com pendência',               cor:'var(--sky)'    },
      { l:'Referência',     v:mesRef ? fmtMes(mesRef) : periodo === 'total' ? 'Acumulado' : 'Todos', s:'período', cor:'var(--purple)' },
    ].map(({ l, v, s, cor }) => `
      <div class="kpi" style="--kpi-color:${cor}">
        <div class="kpi-label">${l}</div>
        <div class="kpi-value">${v}</div>
        <div class="kpi-sub">${s}</div>
      </div>`).join('');
  }

  const sepLabel = $('sep-label-saldo');
  if (sepLabel) {
    sepLabel.textContent = periodo === 'total'
      ? 'Saldo total acumulado por par de lojas'
      : mesRef
        ? `Saldo de ${fmtMes(mesRef)} por par de lojas`
        : 'Saldo por par de lojas — todos os meses';
  }

  const sepCount = $('saldo-count');
  if (sepCount) sepCount.textContent = cards.length;

  const wrap = $('cards-saldo');
  if (!wrap) return;

  wrap.innerHTML = cards.length
    ? cards.map(buildCardNovo).join('')
    : `<div class="empty">
         <div class="empty-title">Nenhum registro encontrado</div>
         <div class="empty-sub">Ajuste os filtros ou aguarde novas movimentações.</div>
       </div>`;
}

function buildCardNovo(p) {
  const corProduto = PRODUTO_COR[p.origem_tipo] || 'var(--muted)';
  const qtdPend = Number(p.qtd_pendencias || 0);

  return `
    <div class="rel-card" style="--card-color:var(--amber)">
      <div class="rel-card-head">
        <div>
          <div class="rel-card-lojas">
            ${p.devedor}
            <span class="rel-card-seta">→</span>
            ${p.credor}
          </div>
          <div class="rel-card-meta">${qtdPend} pendência(s)</div>
          <div class="rel-card-produto"
               style="background:${corProduto}18;color:${corProduto};border:1px solid ${corProduto}40">
            ${p.origem_tipo}
          </div>
        </div>
        <span class="badge b-warn">PENDENTE</span>
      </div>
      <div class="rel-card-valor">
        <div>
          <div class="rel-card-valor-label">${p.devedor} paga ${p.credor}</div>
          <div class="rel-card-valor-num" style="color:var(--amber)">
            ${fmtMoney(p.valor_liquido)}
          </div>
        </div>
        <div class="rel-card-foot">
          <button class="btn-primary"
            onclick="pagarParLiquido('${p.origem_tipo}', ${p.loja_a_id}, ${p.loja_b_id}, '${String(p.devedor).replace(/'/g, "\\'")}', '${String(p.credor).replace(/'/g, "\\'")}')">
            Marcar como pago
          </button>
        </div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════
// RENDER — ABA MOVIMENTAÇÕES
// ══════════════════════════════════════════════════════════
function renderMovimentacoes() {
  const movs = detalhesFiltradosBase();
  const totalPendente = movs.filter(m => m.acerto_status === 'PENDENTE')
    .reduce((a, m) => a + Number(m.valor || 0), 0);
  const totalPago = movs.filter(m => m.acerto_status === 'PAGO')
    .reduce((a, m) => a + Number(m.valor || 0), 0);

  const tbody = $('tbody-movimentacoes');
  if (!tbody) return;

  tbody.innerHTML = movs.length ? movs.map(m => {
    const statusClass = m.acerto_status === 'PAGO' ? 'b-ok'
      : m.acerto_status === 'CANCELADO' ? 'b-info'
      : 'b-warn';
    const corProd = PRODUTO_COR[m.origem_tipo] || 'var(--muted)';

    return `<tr>
      <td class="mono">${fmtDate(m.mes_ref || m.data_ref_exibicao)}</td>
      <td>
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
                     background:${corProd}18;color:${corProd};border:1px solid ${corProd}40">
          ${m.origem_tipo}
        </span>
      </td>
      <td class="mono" style="font-size:11px">${m.ref_label}</td>
      <td>${lookupLoja(m.loja_credora_id)}</td>
      <td>${lookupLoja(m.loja_devedora_id)}</td>
      <td class="mono">${m.qtd_label || '—'}</td>
      <td class="money">${m.unit_label || '—'}</td>
      <td class="money">${fmtMoney(m.valor)}</td>
      <td><span class="badge ${statusClass}">${m.acerto_status || 'PENDENTE'}</span></td>
      <td class="mono">${fmtDate(m.data_acerto)}</td>
    </tr>`;
  }).join('')
  : `<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--dim)">
      Nenhum registro para os filtros selecionados.
     </td></tr>`;

  const totais = $('mov-totais');
  if (totais) {
    totais.innerHTML = `
      <span>${movs.length} movimentação(ões)</span>
      <span>Pendente: <strong style="color:var(--amber)">${fmtMoney(totalPendente)}</strong></span>
      <span>Pago: <strong style="color:var(--accent)">${fmtMoney(totalPago)}</strong></span>
      <span>Total: <strong>${fmtMoney(totalPendente + totalPago)}</strong></span>`;
  }
}

// ══════════════════════════════════════════════════════════
// AÇÕES — Quitação
// ══════════════════════════════════════════════════════════
window.pagarParLiquido = async function(origemTipo, lojaAId, lojaBId, devedor, credor) {
  if (!confirm(
    `Confirma pagamento?\n\n` +
    `${devedor} paga ${credor}\n` +
    `Módulo: ${origemTipo}\n\n` +
    `Todas as pendências do par nesse módulo serão marcadas como PAGAS.`
  )) return;

  try {
    const hoje = new Date().toISOString().slice(0, 10);

    const { error } = await sb
      .from('controle_financeiro')
      .update({
        acerto_status: 'PAGO',
        data_acerto: hoje,
        quitado_por: state.usuario?.id || null,
      })
      .eq('origem_tipo', origemTipo)
      .eq('acerto_status', 'PENDENTE')
      .or(
        `and(loja_devedora_id.eq.${lojaAId},loja_credora_id.eq.${lojaBId}),` +
        `and(loja_devedora_id.eq.${lojaBId},loja_credora_id.eq.${lojaAId})`
      );

    if (error) throw error;

    mostrarStatus('st-saldo', `Acerto quitado com sucesso.`, 'ok');
    await refreshAll();
  } catch (e) {
    mostrarStatus('st-saldo', e.message || String(e), 'err');
  }
};

async function pagarTudo() {
  const mesRef  = $('saldo-mes')?.value     || '';
  const produto = $('saldo-produto')?.value || '';

  const pendentes = state.detalhes.filter(m => {
    if (m.acerto_status !== 'PENDENTE') return false;
    if (produto && m.origem_tipo !== produto) return false;
    if (mesRef && String(m.mes_ref || '').slice(0,10) !== String(mesRef)) return false;
    if (state.lojaFiltro) {
      const id = String(state.lojaFiltro);
      if (String(m.loja_credora_id) !== id && String(m.loja_devedora_id) !== id) return false;
    }
    return true;
  });

  if (!pendentes.length) {
    mostrarStatus('st-saldo', 'Não há pendências para os filtros selecionados.', 'ok');
    return;
  }

  const totalPendente = pendentes.reduce((a, m) => a + Number(m.valor || 0), 0);

  if (!confirm(
    `Confirma quitação de TODAS as pendências?\n\n` +
    `${mesRef ? 'Mês: ' + fmtMes(mesRef) + '\n' : ''}` +
    `${produto ? 'Módulo: ' + produto + '\n' : ''}` +
    `${pendentes.length} movimentação(ões) · ${fmtMoney(totalPendente)}\n\n` +
    `Esta ação não pode ser desfeita.`
  )) return;

  try {
    const ids = pendentes.map(m => m.id);
    const hoje = new Date().toISOString().slice(0, 10);

    const { error } = await sb
      .from('controle_financeiro')
      .update({
        acerto_status: 'PAGO',
        data_acerto: hoje,
        quitado_por: state.usuario?.id || null,
      })
      .in('id', ids);

    if (error) throw error;

    mostrarStatus('st-saldo', `${ids.length} movimentação(ões) quitadas.`, 'ok');
    await refreshAll();
  } catch (e) {
    mostrarStatus('st-saldo', e.message || String(e), 'err');
  }
}

// ══════════════════════════════════════════════════════════
// HELPER STATUS
// ══════════════════════════════════════════════════════════
function mostrarStatus(id, msg, tipo = 'ok') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-bar show ${tipo}`;
  setTimeout(() => { el.className = 'status-bar'; }, 4000);
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
bootstrap();
