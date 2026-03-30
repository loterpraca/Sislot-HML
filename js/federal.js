/**
 * SISLOT - Federal (Refatorado com utils)
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils
const {
    $,
    parseCota,
    fmtBR,
    fmtBRL,
    fmtData,
    addDias,
    setStatus,
    setBtnLoading,
    showModal
} = window.SISLOT_UTILS || {};

// Fallbacks caso utils não esteja disponível
const _fmtMoney = fmtBRL || function(v) { return 'R$ ' + (Number(v || 0).toFixed(2)).replace('.', ','); };
const _fmtDate = fmtData || function(v) { if(!v) return '—'; const [y,m,d] = String(v).split('-'); return `${d}/${m}/${y}`; };
const _showStatus = setStatus || function(id, msg, t) { const el = $(id); if(el) { el.textContent = msg; el.className = `status-bar show ${t}`; } };

const state = {
    usuario: null,
    loterias: [],
    usuarios: [],
    federais: [],
    resumo: [],
    movimentos: [],
    vendasFuncionario: [],
    editingCadastroConcurso: null,
    editingMovId: null,
    lancFederalId: null
};

const QTD_PADRAO = {
    qua: { centro: 80, boulevard: 80, lotobel: 60, santa: 0, via: 0 },
    sab: { centro: 80, boulevard: 70, lotobel: 120, santa: 0, via: 0 }
};

// Relógio usando utils
function setClock() { 
    const el = $('relogio');
    if (el) {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
    }
}
setClock();
setInterval(setClock, 1000);

function hideStatus(id) {
    const el = $(id);
    if (el) el.className = 'status-bar';
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
}

function fillSelect(selectId, items, placeholder = 'Selecione...', valueKey = 'id', labelFn = (x) => x.nome) {
    const sel = $(selectId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item[valueKey];
        opt.textContent = labelFn(item);
        sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

async function bootstrap() {
    await loadSession();
    await loadBaseData();
    bindEvents();
    await refreshAll();
}

async function loadSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = './login.html'; return; }
    const { data: user } = await sb.from('usuarios').select('id,nome,perfil,ativo').eq('auth_user_id', session.user.id).eq('ativo', true).maybeSingle();
    state.usuario = user;
}

async function loadBaseData() {
    const [lotRes, usuRes] = await Promise.all([
        sb.from('loterias').select('id,nome,slug,ativo').eq('ativo', true).order('id'),
        sb.from('usuarios').select('id,nome,ativo').eq('ativo', true).order('nome')
    ]);
    state.loterias = lotRes.data || [];
    state.usuarios = usuRes.data || [];
    fillStaticSelects();
}

function fillStaticSelects() {
    const lotLabel = x => `${x.id} • ${x.nome}`;
    ['filtro-loja', 'mov-loteria-origem', 'mov-loteria-destino', 'fec-loteria'].forEach(id => fillSelect(id, state.loterias, 'Todas / selecione...', 'id', lotLabel));
    fillSelect('fec-usuario', state.usuarios, 'Selecione...', 'id', x => x.nome);
}

async function refreshAll() {
    await Promise.all([
        loadFederais(),
        loadResumo(),
        loadMovs(),
        loadVendasFuncionario()
    ]);
    renderCadastro();
    renderVisao();
    renderMovimentacoes();
    renderFechamentoResumo();
    renderAuditoria();
    fillFederalSelectors();
}

async function loadFederais() {
    const { data } = await sb.from('federais').select('*').order('dt_sorteio', { ascending: false }).order('concurso', { ascending: false }).order('loteria_id');
    state.federais = data || [];
}

async function loadResumo() {
    const { data, error } = await sb.from('view_resumo_federal').select('*').order('dt_sorteio', { ascending: false }).order('concurso', { ascending: false });
    state.resumo = error ? [] : (data || []);
}

async function loadMovs() {
    const { data } = await sb.from('federal_movimentacoes').select('*, federais!inner(concurso,dt_sorteio,modalidade), usuarios(nome)').order('created_at', { ascending: false });
    state.movimentos = data || [];
}

async function loadVendasFuncionario() {
    const { data } = await sb.from('view_federal_vendas_funcionario').select('*').order('dt_sorteio', { ascending: false }).order('funcionario_nome');
    state.vendasFuncionario = data || [];
}

function fillFederalSelectors() {
    const fedLabel = x => `${x.concurso}`;
    ['mov-federal', 'fec-federal'].forEach(id => fillSelect(id, state.federais, 'Selecione...', 'id', fedLabel));
}

function lookupLoteriaName(id) { return state.loterias.find(x => String(x.id) === String(id))?.nome || '—'; }
function lookupFederal(id) { return state.federais.find(x => String(x.id) === String(id)); }

function applyFederalType(tipo) {
    if (tipo === 'ESPECIAL') {
        $('cad-valor-fracao').value = '10.00';
        $('cad-valor-custo').value = '8.04';
    } else {
        $('cad-valor-fracao').value = '4.00';
        $('cad-valor-custo').value = '3.21';
    }
}

function nextWedOrSat(base = new Date()) {
    const d = new Date(base);
    d.setHours(12, 0, 0, 0);
    while (![3, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function nextQuaSabFrom(baseIso, dir) {
    let d = new Date((baseIso || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
    d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    while (![3, 6].includes(d.getDay())) d.setDate(d.getDate() + (dir > 0 ? 1 : -1));
    return d.toISOString().slice(0, 10);
}

function suggestNextConcurso() {
    const nums = state.federais.map(f => parseInt(f.concurso, 10)).filter(n => !isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1) : '';
}

function suggestNextSorteio() {
    if (!state.federais.length) return nextWedOrSat();
    const dates = state.federais.map(f => f.dt_sorteio).filter(Boolean).sort().reverse();
    return nextQuaSabFrom(dates[0], 1);
}

function fillQtdPadraoCadastro() {
    const d = $('cad-dt-sorteio').value ? new Date($('cad-dt-sorteio').value + 'T12:00:00') : new Date();
    const pad = d.getDay() === 6 ? QTD_PADRAO.sab : QTD_PADRAO.qua;
    $('cad-qtd-centro').value = pad.centro;
    $('cad-qtd-boulevard').value = pad.boulevard;
    $('cad-qtd-lotobel').value = pad.lotobel;
    $('cad-qtd-santa').value = pad.santa;
    $('cad-qtd-via').value = pad.via;
}

function renderKPIs(rows) {
    const totalInicial = rows.reduce((a, x) => a + Number(x.qtd_inicial || 0), 0);
    const totalVendida = rows.reduce((a, x) => a + Number(x.qtd_vendida_total || 0), 0);
    const totalDev = rows.reduce((a, x) => a + Number(x.qtd_devolvida_origem || 0) + Number(x.qtd_devolvida_terceiros || 0), 0);
    const totalEnc = rows.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);
    const totalPrem = rows.reduce((a, x) => a + Number(x.premio_encalhe_total || 0), 0);
    const totalRes = rows.reduce((a, x) => a + Number(x.resultado || 0), 0);
    
    $('kpis-visao').innerHTML = [
        ['Qtd Inicial', totalInicial, 'Carga base'],
        ['Vendida', totalVendida, 'Funcionários + externa'],
        ['Devolvida', totalDev, 'Origem + terceiros'],
        ['Encalhe', totalEnc, 'Qtd restante sem venda'],
        ['Prêmio', _fmtMoney(totalPrem), 'Total de prêmio'],
        ['Resultado', _fmtMoney(totalRes), 'Apuração geral']
    ].map(([l, v, s]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${typeof v === 'number' && !String(v).includes('R$') ? v : v}</div><div class="kpi-sub">${s}</div></div>`).join('');
}

function renderVisao() {
    let rows = [...state.resumo];
    const c = $('filtro-concurso').value.trim();
    const loja = $('filtro-loja').value;
    const di = $('filtro-dt-ini').value;
    const df = $('filtro-dt-fim').value;
    if (c) rows = rows.filter(x => String(x.concurso).includes(c));
    if (loja) rows = rows.filter(x => String(x.loteria_id) === String(loja));
    if (di) rows = rows.filter(x => x.dt_sorteio >= di);
    if (df) rows = rows.filter(x => x.dt_sorteio <= df);
    renderKPIs(rows);
    $('tbody-visao').innerHTML = rows.length ? rows.map(r => {
        const res = Number(r.resultado || 0);
        return `<tr>
            <td>${r.modalidade || 'Federal'}</td>
            <td>${r.loja_origem}</td>
            <td class="mono">${r.concurso}</td>
            <td class="mono">${_fmtDate(r.dt_sorteio)}</td>
            <td class="mono">${r.qtd_inicial}</td>
            <td class="mono">${r.qtd_vendida_funcionarios}</td>
            <td class="mono">${r.qtd_vendida_externa}</td>
            <td class="mono">${r.qtd_devolvida_origem}</td>
            <td class="mono">${r.qtd_devolvida_terceiros}</td>
            <td class="mono">${r.qtd_encalhe}</td>
            <td class="money">${_fmtMoney(r.premio_encalhe_total)}</td>
            <td class="mono">${r.estoque_atual}</td>
            <td class="money ${res >= 0 ? 'pos' : 'neg'}">${_fmtMoney(res)}</td>
            <td><div class="flex" style="flex-wrap:nowrap;gap:6px"><button class="btn-amber" style="padding:6px 10px;font-size:11px" onclick="openFederalDetail('${r.federal_id}')">Detalhar</button><button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="openLancamento('${r.federal_id}')">Lançamento</button></div></td>
        </tr>`;
    }).join('') : `<tr><td colspan="14"><div class="empty"><div class="empty-title">Nada encontrado</div><div class="empty-sub">Ajuste os filtros ou cadastre o primeiro concurso.</div></div></td></tr>`;
}

function renderCadastro() {
    const grupos = Object.values(state.federais.reduce((acc, f) => {
        if (!acc[f.concurso]) acc[f.concurso] = { concurso: f.concurso, dt_sorteio: f.dt_sorteio, valor_fracao: f.valor_fracao, valor_custo: f.valor_custo, qt_fracoes_bilhete: f.qt_fracoes_bilhete, itens: [] };
        acc[f.concurso].itens.push(f);
        return acc;
    }, {})).sort((a, b) => String(b.concurso).localeCompare(String(a.concurso), undefined, { numeric: true }));
    $('cnt-cadastros').textContent = grupos.length;
    $('tbody-cadastro').innerHTML = grupos.length ? grupos.map(g => {
        const tipo = Number(g.valor_fracao) === 10 ? 'ESPECIAL' : 'COMUM';
        const totalIni = g.itens.reduce((a, x) => a + Number(x.qtd_recebidas || 0), 0);
        const totalDev = g.itens.reduce((a, x) => a + Number(x.qtd_devolvidas || 0), 0);
        const totalEnc = g.itens.reduce((a, x) => a + Number(x.qtd_encalhe || 0), 0);
        return `<tr>
            <td>Todos</td>
            <td class="mono">${g.concurso
