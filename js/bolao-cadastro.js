/**
 * SISLOT — Bolões (Cadastro + Movimentação)
 * Versão refatorada com utils
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils com fallbacks
const utils = window.SISLOT_UTILS || {};

const $ = utils.$ || (id => document.getElementById(id));
const parseCota = utils.parseCota || (v => { if (!v) return 0; const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; });
const fmtBR = utils.fmtBR || (v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtBRL = utils.fmtBRL || (v => parseFloat(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtData = utils.fmtData || (s => { if (!s) return '—'; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; } return s; });
const addDias = utils.addDias || ((inputId, delta) => { const el = $(inputId); if (!el) return; const v = el.value; let y, m, d; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { [y, m, d] = v.split('-').map(Number); } else { const n = new Date(); y = n.getFullYear(); m = n.getMonth() + 1; d = n.getDate(); } const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + delta); el.value = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); el.dispatchEvent(new Event('change', { bubbles: true })); });
const setStatus = utils.setStatus || ((elOrId, msg, tipo, icone) => { const el = typeof elOrId === 'string' ? $(elOrId) : elOrId; if (!el) return; el.className = 'status ' + (tipo || 'muted'); el.innerHTML = `<i class="fas fa-${icone || 'info-circle'}"></i><span>${msg}</span>`; });
const setBtnLoading = utils.setBtnLoading || ((btnOrId, on) => { const btn = typeof btnOrId === 'string' ? $(btnOrId) : btnOrId; if (!btn) return; if (on) { btn.classList.add('btn-loading'); btn.disabled = true; } else { btn.classList.remove('btn-loading'); btn.disabled = false; } });
const showModal = utils.showModal || (({ title, body, onConfirm, onCancel }) => { const result = confirm(`${title}\n\n${body}`); if (result && onConfirm) onConfirm(); if (!result && onCancel) onCancel(); });

// ── Configuração visual das lojas ──────────────────────────
const LOJA_CONFIG = {
    'boulevard':    { nome: 'Boulevard',    logo: './icons/boulevard.png',    theme: 'boulevard',    logoPos: '50% 50%' },
    'centro':       { nome: 'Centro',       logo: './icons/loterpraca.png',   theme: 'centro',       logoPos: '50% 42%' },
    'lotobel':      { nome: 'Lotobel',      logo: './icons/lotobel.png',      theme: 'lotobel',      logoPos: '50% 50%' },
    'santa-tereza': { nome: 'Santa Tereza', logo: './icons/santa-tereza.png', theme: 'santa-tereza', logoPos: '50% 50%' },
    'via-brasil':   { nome: 'Via Brasil',   logo: './icons/via-brasil.png',   theme: 'via-brasil',   logoPos: '50% 50%' },
};

const LOJAS_MOV = [
    { slug: 'boulevard',    id: 'deltaBoulevard',   icon: 'fas fa-building',  nome: 'Boulevard' },
    { slug: 'centro',       id: 'deltaCentro',      icon: 'fas fa-city',      nome: 'Centro' },
    { slug: 'lotobel',      id: 'deltaLotobel',     icon: 'fas fa-landmark',  nome: 'Lotobel' },
    { slug: 'santa-tereza', id: 'deltaSantaTereza', icon: 'fas fa-church',    nome: 'Santa Tereza' },
    { slug: 'via-brasil',   id: 'deltaViaBrasil',   icon: 'fas fa-road',      nome: 'Via Brasil' },
];

const MODS = [
    { key: 'Mega Sena',     icon: './icons/mega-sena.png'     },
    { key: 'Lotofácil',     icon: './icons/lotofacil.png'     },
    { key: 'Quina',         icon: './icons/quina.png'         },
    { key: 'Dia de Sorte',  icon: './icons/dia-de-sorte.png'  },
    { key: 'Timemania',     icon: './icons/timemania.png'     },
    { key: 'Dupla Sena',    icon: './icons/dupla.png'         },
    { key: 'Supersete',     icon: './icons/super-sete.png'    },
    { key: 'Milionária',    icon: './icons/milionaria.png'    },
    { key: 'Loteca',        icon: './icons/loteca.png'        },
    { key: 'Páscoa',        icon: './icons/pascoa.png'        },
    { key: 'Independência', icon: './icons/independencia.png' },
    { key: 'Virada',        icon: './icons/virada.png'        },
    { key: 'São João',      icon: './icons/saojoao.png'       },
];

// ── Estado da tela ─────────────────────────────────────────
let usuario = null;
let loteriaAtiva = null;
let todasLojas = [];
let lojaIdPorSlug = {};
let SHORTCUTS = {};

const CAMPOS_FORM = ['modalidade', 'concurso', 'dataInicial', 'dataConcurso', 'qtdJogos', 'qtdDezenas', 'valorCota', 'cotas'];
const CAMPOS_MOV  = ['deltaBoulevard', 'deltaCentro', 'deltaLotobel', 'deltaSantaTereza', 'deltaViaBrasil'];

// ── Relógio ────────────────────────────────────────────────
function updateClock() {
    const el = $('relogio');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
}
updateClock();
setInterval(updateClock, 1000);

/************************************************************
 * INICIALIZAÇÃO
 ************************************************************/
async function init() {
    const ctx = await window.SISLOT_SECURITY.protegerPagina('cadastro');
    if (!ctx) return;

    usuario = ctx.usuario;
    todasLojas = ctx.lojasPermitidas || [];
    loteriaAtiva = ctx.lojaInicial || null;

    todasLojas.forEach(l => {
        lojaIdPorSlug[l.loteria_slug] = l.loteria_id;
    });

    const todasAtivas = await window.SISLOT_SECURITY.carregarTodasLojas();
    todasAtivas.forEach(l => {
        lojaIdPorSlug[l.loteria_slug] = l.loteria_id;
    });

    if (!todasLojas.length || !loteriaAtiva) {
        alert('Nenhuma loja disponível para este usuário.');
        window.SISLOT_SECURITY.irParaInicio();
        return;
    }

    await carregarModelos();

    aplicarTema(loteriaAtiva.loteria_slug);
    atualizarOrigemUI();
    atualizarCamposMov();
    renderQuickbar();
    loadDraft();
    applyFederalUI();
    bind();

    if (!$('dataInicial').value) {
        $('dataInicial').value = new Date().toISOString().slice(0, 10);
    }
}

async function buscarUltimoConcurso(modalidade) {
    if (!modalidade || !loteriaAtiva?.loteria_id) return null;

    const { data, error } = await sb
        .from('boloes')
        .select('concurso')
        .eq('loteria_id', loteriaAtiva.loteria_id)
        .eq('modalidade', modalidade)
        .neq('status', 'CANCELADO');

    if (error) throw new Error(error.message);
    if (!data || !data.length) return null;

    const numeros = data
        .map(r => parseInt(r.concurso, 10))
        .filter(n => Number.isFinite(n));

    if (!numeros.length) return null;

    return Math.max(...numeros);
}

async function ajustarConcurso(delta) {
    const modalidade = $('modalidade')?.value?.trim();
    const concursoEl = $('concurso');

    if (!concursoEl) return;
    if (!modalidade) {
        setStatus('status', 'Selecione a modalidade antes de ajustar o concurso.', 'err', 'exclamation-circle');
        return;
    }

    const atual = parseInt(concursoEl.value, 10);

    if (Number.isFinite(atual)) {
        const novo = atual + delta;
        concursoEl.value = String(novo > 0 ? novo : 1);
        concursoEl.dispatchEvent(new Event('input', { bubbles: true }));
        concursoEl.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    try {
        setStatus('status', 'Buscando último concurso...', 'muted', 'spinner fa-spin');

        const ultimo = await buscarUltimoConcurso(modalidade);

        if (!Number.isFinite(ultimo)) {
            setStatus('status', 'Nenhum concurso anterior encontrado para essa modalidade.', 'err', 'exclamation-circle');
            return;
        }

        const novo = ultimo + delta;
        concursoEl.value = String(novo > 0 ? novo : 1);
        concursoEl.dispatchEvent(new Event('input', { bubbles: true }));
        concursoEl.dispatchEvent(new Event('change', { bubbles: true }));

        setStatus('status', `Concurso ajustado para ${concursoEl.value}.`, 'ok', 'check-circle');
    } catch (e) {
        setStatus('status', e.message || 'Erro ao buscar concurso.', 'err', 'exclamation-circle');
    }
}

async function carregarModelos() {
    const { data } = await sb
        .from('modelos_boloes')
        .select('loteria_id, modalidade, nome, qtd_jogos, qtd_dezenas, valor_cota, qtd_cotas, ordem')
        .eq('ativo', true)
        .order('ordem');

    SHORTCUTS = {};
    if (!data) return;

    const idParaSlug = {};
    Object.entries(lojaIdPorSlug).forEach(([slug, id]) => {
        idParaSlug[id] = slug;
    });

    data.forEach(m => {
        const slug = idParaSlug[m.loteria_id];
        if (!slug) return;
        if (!SHORTCUTS[slug]) SHORTCUTS[slug] = {};
        if (!SHORTCUTS[slug][m.modalidade]) SHORTCUTS[slug][m.modalidade] = [];
        SHORTCUTS[slug][m.modalidade].push(m);
    });
}

/************************************************************
 * TEMA / VISUAL
 ************************************************************/
function aplicarTema(slug) {
    const cfg = LOJA_CONFIG[slug] || LOJA_CONFIG['centro'];

    document.body.setAttribute('data-theme', cfg.theme);
    document.body.setAttribute('data-loja', slug);

    const img = $('logoImg');
    if (img) {
        img.src = cfg.logo;
        img.style.objectPosition = cfg.logoPos;
    }

    const title = $('headerTitle');
    if (title) title.textContent = cfg.nome;

    const sub = $('headerSub');
    if (sub) sub.textContent = 'Cadastro e movimentação';
}

function atualizarOrigemUI() {
    const nome = loteriaAtiva?.loteria_nome || '—';
    const origemNome = $('origemNome');
    const movOrigemNome = $('movOrigemNome');
    if (origemNome) origemNome.textContent = nome;
    if (movOrigemNome) movOrigemNome.textContent = nome;
}

function atualizarCamposMov() {
    const mapaSlug = {
        boulevard: 'deltaBoulevard',
        centro: 'deltaCentro',
        lotobel: 'deltaLotobel',
        'santa-tereza': 'deltaSantaTereza',
        'via-brasil': 'deltaViaBrasil',
    };

    Object.entries(mapaSlug).forEach(([slug, inputId]) => {
        const el = $(inputId);
        if (!el) return;

        const field = el.closest('.mov-item');
        const ehOrigem = slug === loteriaAtiva?.loteria_slug;

        el.disabled = ehOrigem;
        if (ehOrigem) el.value = '';

        if (field) {
            field.classList.toggle('mov-origem', ehOrigem);
        }
    });
}

/************************************************************
 * TROCA DE LOJA
 ************************************************************/
function trocarLoja(slug) {
    const loja = todasLojas.find(l => l.loteria_slug === slug);
    if (!loja) return;

    loteriaAtiva = loja;
    aplicarTema(slug);
    atualizarOrigemUI();
    atualizarCamposMov();
    renderChips(localStorage.getItem('sl_active_mod') || '');
    saveDraft();
}

function getIndiceLojaAtual() {
    return todasLojas.findIndex(l => l.loteria_slug === loteriaAtiva?.loteria_slug);
}

function trocarLojaPorOffset(offset) {
    if (!todasLojas.length || !loteriaAtiva) return;

    const atual = getIndiceLojaAtual();
    if (atual < 0) return;

    let prox = atual + offset;

    if (prox < 0) prox = todasLojas.length - 1;
    if (prox >= todasLojas.length) prox = 0;

    trocarLoja(todasLojas[prox].loteria_slug);
}

/************************************************************
 * QUICKBAR
 ************************************************************/
function renderQuickbar() {
    const grid = $('modGrid');
    if (!grid) return;
    grid.innerHTML = '';

    MODS.forEach(mod => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qmod';
        btn.dataset.mod = mod.key;
        btn.title = mod.key;

        const img = document.createElement('img');
        img.src = mod.icon;
        img.alt = mod.key;
        img.loading = 'lazy';

        btn.appendChild(img);
        btn.onclick = () => selecionarMod(mod.key);
        grid.appendChild(btn);
    });

    const ativo = localStorage.getItem('sl_active_mod') || '';
    if (ativo) {
        setActiveModBtn(ativo);
        renderChips(ativo);
        const modalidadeEl = $('modalidade');
        if (modalidadeEl) modalidadeEl.value = ativo;
        applyFederalUI();
    }
}

function selecionarMod(modKey) {
    const prev = localStorage.getItem('sl_active_mod') || '';
    if (prev !== modKey) limparFormSemLoja();

    const modalidadeEl = $('modalidade');
    if (modalidadeEl) modalidadeEl.value = modKey;
    localStorage.setItem('sl_active_mod', modKey);
    setActiveModBtn(modKey);
    renderChips(modKey);
    applyFederalUI();
    saveDraft();
}

function setActiveModBtn(modKey) {
    document.querySelectorAll('.qmod').forEach(b =>
        b.classList.toggle('active', b.dataset.mod === modKey)
    );
}

function renderChips(modKey) {
    const slug = loteriaAtiva?.loteria_slug || '';
    const chips = (SHORTCUTS[slug] || {})[modKey] || [];
    const wrap = $('chipsWrap');
    const row = $('chipsRow');

    if (!wrap || !row) return;

    row.innerHTML = '';
    if (!chips.length) {
        wrap.classList.remove('active');
        return;
    }

    const modObj = MODS.find(m => m.key === modKey);
    const icon = modObj ? modObj.icon : '';

    chips.forEach(sc => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-tile';
        b.title = `${modKey} ${sc.nome}`;

        if (icon) {
            const img = document.createElement('img');
            img.src = icon;
            img.alt = modKey;
            b.appendChild(img);
        }

        const badge = document.createElement('span');
        badge.className = 'chip-badge';
        badge.textContent = sc.nome;
        b.appendChild(badge);

        b.onclick = () => aplicarShortcut(modKey, sc);
        row.appendChild(b);
    });

    wrap.classList.add('active');
}

function aplicarShortcut(modKey, sc) {
    const modalidadeEl = $('modalidade');
    const qtdJogosEl = $('qtdJogos');
    const qtdDezenasEl = $('qtdDezenas');
    const valorCotaEl = $('valorCota');
    const cotasEl = $('cotas');

    if (modalidadeEl) modalidadeEl.value = modKey;
    if (qtdJogosEl) qtdJogosEl.value = sc.qtd_jogos ?? '';
    if (qtdDezenasEl) qtdDezenasEl.value = sc.qtd_dezenas ?? '';
    if (valorCotaEl) valorCotaEl.value = fmtBR(sc.valor_cota);
    if (cotasEl) cotasEl.value = sc.qtd_cotas ?? '';
    applyFederalUI();
    setStatus('status', 'Atalho aplicado: ' + sc.nome, 'ok', 'check-circle');
    saveDraft();
}

/************************************************************
 * FEDERAL
 ************************************************************/
function applyFederalUI() {
    const modal = $('modalidade')?.value;
    const isFed = modal === 'Federal';
    const j = $('qtdJogos');
    const d = $('qtdDezenas');

    if (j) j.disabled = isFed;
    if (d) d.disabled = isFed;

    if (isFed) {
        if (j) j.value = '0';
        if (d) d.value = '0';
    } else {
        if (j && j.value === '0') j.value = '';
        if (d && d.value === '0') d.value = '';
    }
}

/************************************************************
 * DRAFT
 ************************************************************/
function saveDraft() {
    const d = {};
    CAMPOS_FORM.forEach(id => d[id] = $(id)?.value ?? '');
    CAMPOS_MOV.forEach(id => d[id] = $(id)?.value ?? '');
    d._mod = localStorage.getItem('sl_active_mod') || '';
    d._slug = loteriaAtiva?.loteria_slug || '';
    try { localStorage.setItem('sl_draft', JSON.stringify(d)); } catch {}
}

function loadDraft() {
    try {
        const raw = localStorage.getItem('sl_draft');
        if (!raw) return;

        const d = JSON.parse(raw);

        CAMPOS_FORM.forEach(id => {
            const el = $(id);
            if (el && d[id] !== undefined) el.value = d[id];
        });

        if (d._mod) {
            localStorage.setItem('sl_active_mod', d._mod);
            const modalidadeEl = $('modalidade');
            if (modalidadeEl) modalidadeEl.value = d._mod;
            setActiveModBtn(d._mod);
            renderChips(d._mod);
        }

        atualizarCamposMov();

        CAMPOS_MOV.forEach(id => {
            const el = $(id);
            if (el && d[id] !== undefined) el.value = d[id];
        });
    } catch {}
}

function limparFormSemLoja() {
    CAMPOS_FORM.forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    saveDraft();
}

function limparMov() {
    CAMPOS_MOV.forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    saveDraft();
}

/************************************************************
 * VALIDAÇÃO
 ************************************************************/
function validarBase(exigirCotas = true) {
    const modalidade = $('modalidade')?.value?.trim() || '';
    const concurso = $('concurso')?.value?.trim() || '';
    const dataInicial = $('dataInicial')?.value || '';
    const dataConcurso = $('dataConcurso')?.value || '';
    const qtdJogos = parseInt($('qtdJogos')?.value) || 0;
    const qtdDezenas = parseInt($('qtdDezenas')?.value) || 0;
    const valorCota = parseCota($('valorCota')?.value);
    const cotas = parseInt($('cotas')?.value) || 0;

    if (!modalidade) throw new Error('Modalidade é obrigatória.');
    if (!concurso) throw new Error('Número do concurso é obrigatório.');
    if (!dataInicial) throw new Error('Data inicial é obrigatória.');
    if (!dataConcurso) throw new Error('Data do concurso é obrigatória.');
    if (!valorCota || valorCota <= 0) throw new Error('Valor da cota deve ser > 0.');
    if (exigirCotas && cotas === 0) throw new Error('Qtd de cotas é obrigatória.');

    return { modalidade, concurso, dataInicial, dataConcurso, qtdJogos, qtdDezenas, valorCota, cotas };
}

/************************************************************
 * CADASTRAR
 ************************************************************/
async function onCadastrar() {
    const btn = $('btnCadastrar');
    if (!btn) return;

    try {
        const b = validarBase(true);
        if (!loteriaAtiva) throw new Error('Nenhuma loja selecionada.');

        const corpo = [
            '🧾 CONFIRMAÇÃO DE CADASTRO', '',
            `📍 Origem: ${loteriaAtiva.loteria_nome}`,
            `🎯 ${b.modalidade} | Concurso: ${b.concurso}`,
            `🗓️ ${fmtData(b.dataInicial)} → ${fmtData(b.dataConcurso)}`,
            `🎮 ${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
            `💰 Cota: ${fmtBRL(b.valorCota)} | ${b.cotas} cotas`,
            'Confirma o cadastro?'
        ].join('\n');

        showModal({
            title: 'Confirmar cadastro',
            body: corpo,
            onConfirm: async () => {
                setBtnLoading(btn, true);
                setStatus('status', 'Salvando bolão…', 'muted', 'spinner fa-spin');
                try {
                    await doCadastrar(b);
                } catch (e) {
                    setStatus('status', e.message, 'err', 'exclamation-circle');
                } finally {
                    setBtnLoading(btn, false);
                }
            }
        });
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    }
}

async function doCadastrar(b, somarCotas = false) {
    const loteriaId = loteriaAtiva.loteria_id;

    const { data: existe } = await sb
        .from('boloes')
        .select('id, qtd_cotas_total')
        .eq('loteria_id', loteriaId)
        .eq('modalidade', b.modalidade)
        .eq('concurso', b.concurso)
        .eq('valor_cota', b.valorCota)
        .eq('qtd_jogos', b.qtdJogos)
        .eq('qtd_dezenas', b.qtdDezenas)
        .neq('status', 'CANCELADO')
        .maybeSingle();

    if (existe && !somarCotas) {
        const corpo = [
            '⚠️ Este bolão já existe!', '',
            `${b.modalidade} — Concurso ${b.concurso}`,
            `${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
            `Cota: ${fmtBRL(b.valorCota)}`,
            `Cotas atuais: ${existe.qtd_cotas_total}`,
            `Adicionar mais ${b.cotas}? Novo total: ${existe.qtd_cotas_total + b.cotas}`
        ].join('\n');

        showModal({
            title: 'Bolão já existe',
            body: corpo,
            onConfirm: async () => {
                try {
                    await doCadastrar(b, true);
                } catch (e) {
                    setStatus('status', e.message, 'err', 'exclamation-circle');
                }
            }
        });

        setStatus('status', 'Aguardando confirmação…', 'muted', 'clock');
        return;
    }

    if (existe && somarCotas) {
        const novoTotal = existe.qtd_cotas_total + b.cotas;
        const { error } = await sb
            .from('boloes')
            .update({ qtd_cotas_total: novoTotal, updated_at: new Date().toISOString() })
            .eq('id', existe.id);

        if (error) throw new Error(error.message);

        setStatus('status', `✓ Cotas somadas! Novo total: ${novoTotal}`, 'ok', 'check-circle');
        return;
    }

    const { error } = await sb.from('boloes').insert({
        loteria_id:      loteriaId,
        criado_por:      usuario.id,
        modalidade:      b.modalidade,
        concurso:        b.concurso,
        codigo_loterico: loteriaAtiva.cod_loterico || loteriaAtiva.loteria_codigo || '',
        dt_inicial:      b.dataInicial,
        dt_concurso:     b.dataConcurso,
        qtd_jogos:       b.qtdJogos,
        qtd_dezenas:     b.qtdDezenas,
        valor_cota:      b.valorCota,
        qtd_cotas_total: b.cotas,
        status:          'ATIVO',
    });

    if (error) throw new Error(error.message);
    setStatus('status', '✓ Bolão cadastrado com sucesso!', 'ok', 'check-double');
}

/************************************************************
 * CANCELAR
 ************************************************************/
async function onDeletar() {
    const btn = $('btnDeletar');
    if (!btn) return;

    try {
        const b = validarBase(false);
        if (!loteriaAtiva) throw new Error('Nenhuma loja selecionada.');

        const { data: bolao } = await sb
            .from('boloes')
            .select('id, qtd_cotas_total')
            .eq('loteria_id', loteriaAtiva.loteria_id)
            .eq('modalidade', b.modalidade)
            .eq('concurso', b.concurso)
            .eq('valor_cota', b.valorCota)
            .eq('qtd_jogos', b.qtdJogos)
            .eq('qtd_dezenas', b.qtdDezenas)
            .neq('status', 'CANCELADO')
            .maybeSingle();

        if (!bolao) {
            setStatus('status', 'Bolão não encontrado.', 'err', 'exclamation-circle');
            return;
        }

        const corpo = [
            '🗑️ CONFIRMAÇÃO DE CANCELAMENTO', '',
            `📍 ${loteriaAtiva.loteria_nome}`,
            `🎯 ${b.modalidade} — Concurso ${b.concurso}`,
            `🎮 ${b.qtdJogos} jogos de ${b.qtdDezenas} dezenas`,
            `💰 Cota: ${fmtBRL(b.valorCota)} | ${bolao.qtd_cotas_total} cotas`, '',
            '⚠️ O bolão será marcado como CANCELADO. Confirma?'
        ].join('\n');

        showModal({
            title: 'Confirmar cancelamento',
            body: corpo,
            onConfirm: async () => {
                setBtnLoading(btn, true);
                try {
                    const { error } = await sb
                        .from('boloes')
                        .update({ status: 'CANCELADO', updated_at: new Date().toISOString() })
                        .eq('id', bolao.id);

                    if (error) throw new Error(error.message);
                    setStatus('status', '✓ Bolão cancelado.', 'ok', 'check-circle');
                } catch (e) {
                    setStatus('status', e.message, 'err', 'exclamation-circle');
                } finally {
                    setBtnLoading(btn, false);
                }
            }
        });
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    }
}

/************************************************************
 * BUSCAR POSIÇÃO ATUAL
 ************************************************************/
async function onBuscar() {
    const btn = $('btnBuscar');
    if (!btn) return;

    try {
        const modal = $('modalidade')?.value?.trim() || '';
        const concurso = $('concurso')?.value?.trim() || '';
        const cota = parseCota($('valorCota')?.value);
        const jogos = parseInt($('qtdJogos')?.value) || 0;
        const dezenas = parseInt($('qtdDezenas')?.value) || 0;

        if (!modal || !concurso || !cota) {
            setStatus('status', 'Preencha modalidade, concurso e valor da cota para buscar.', 'err', 'exclamation-circle');
            return;
        }

        setBtnLoading(btn, true);
        setStatus('status', 'Buscando saldos…', 'muted', 'spinner fa-spin');

        let query = sb
            .from('boloes')
            .select('id, valor_cota, qtd_cotas_total, enc_fisico, enc_virtual, custo_jogo, status')
            .eq('loteria_id', loteriaAtiva.loteria_id)
            .eq('modalidade', modal)
            .eq('concurso', concurso)
            .eq('valor_cota', cota)
            .neq('status', 'CANCELADO');

        if (jogos > 0) query = query.eq('qtd_jogos', jogos);
        if (dezenas > 0) query = query.eq('qtd_dezenas', dezenas);

        const { data: bolao } = await query.maybeSingle();

        if (!bolao) {
            showModal({
                title: 'Não encontrado',
                body: [
                    '❌ Bolão não encontrado', '',
                    `Modalidade: ${modal}`,
                    `Concurso: ${concurso}`,
                    `Cota: ${fmtBRL(cota)}`, '',
                    'Verifique os dados ou cadastre primeiro.'
                ].join('\n')
            });

            setStatus('status', 'Bolão não localizado.', 'muted', 'info-circle');
            return;
        }

        const { data: destinos } = await sb
            .from('view_posicao_destinos')
            .select('*')
            .eq('bolao_id', bolao.id);

        const linhas = [
            `📍 ${loteriaAtiva.loteria_nome}`,
            `🎯 ${modal} — Concurso ${concurso}`,
            `💰 Cota: ${fmtBRL(cota)}`,
            `📦 Total: ${bolao.qtd_cotas_total} cotas`,
            `🏷️ Custo do jogo: ${fmtBRL(bolao.custo_jogo)}`,
            `📭 Encalhe origem: ${(bolao.enc_fisico || 0) + (bolao.enc_virtual || 0)}`, '',
            '📊 Distribuição por loja:'
        ];

        if (destinos && destinos.length) {
            destinos.forEach(d => {
                linhas.push(`  ${d.loteria_nome}: ${d.qtd_cotas_liquidas} cotas | encalhe ${d.qtd_encalhe} | vendido ~${d.qtd_vendida_apurada}`);
            });
        } else {
            linhas.push('  (nenhuma distribuição registrada)');
        }

        showModal({
            title: '🔍 Posição atual',
            body: linhas.join('\n')
        });

        setStatus('status', 'Busca concluída.', 'ok', 'check');
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    } finally {
        setBtnLoading(btn, false);
    }
}

/************************************************************
 * MOVIMENTAR
 ************************************************************/
async function onMovimentar() {
    const btn = $('btnMovimentar');
    if (!btn) return;

    try {
        const modal = $('modalidade')?.value?.trim() || '';
        const concurso = $('concurso')?.value?.trim() || '';
        const cota = parseCota($('valorCota')?.value);

        if (!modal || !concurso || !cota) {
            throw new Error('Preencha modalidade, concurso e valor da cota.');
        }

        const mapaDeltas = {
            'boulevard':    parseInt($('deltaBoulevard')?.value)   || 0,
            'centro':       parseInt($('deltaCentro')?.value)      || 0,
            'lotobel':      parseInt($('deltaLotobel')?.value)     || 0,
            'santa-tereza': parseInt($('deltaSantaTereza')?.value) || 0,
            'via-brasil':   parseInt($('deltaViaBrasil')?.value)   || 0,
        };

        const temDelta = Object.values(mapaDeltas).some(v => v !== 0);
        if (!temDelta) throw new Error('Informe ao menos um valor de destino.');

        const { data: bolao } = await sb
            .from('boloes')
            .select('id, valor_cota, qtd_cotas_total')
            .eq('loteria_id', loteriaAtiva.loteria_id)
            .eq('modalidade', modal)
            .eq('concurso', concurso)
            .eq('valor_cota', cota)
            .neq('status', 'CANCELADO')
            .maybeSingle();

        if (!bolao) throw new Error('Bolão não encontrado. Cadastre antes de movimentar.');

        const { data: movs } = await sb
            .from('movimentacoes_cotas')
            .select('loteria_destino, loteria_origem, qtd_cotas')
            .eq('bolao_id', bolao.id)
            .eq('status', 'ATIVO');

        const saldoPorId = {};
        const historicoDetalhePorId = {};

        if (movs) {
            movs.forEach(m => {
                const destId = m.loteria_destino;
                const origemId = m.loteria_origem;

                if (origemId === loteriaAtiva.loteria_id) {
                    if (!saldoPorId[destId]) saldoPorId[destId] = 0;
                    if (!historicoDetalhePorId[destId]) historicoDetalhePorId[destId] = [];
                    saldoPorId[destId] += m.qtd_cotas;
                    historicoDetalhePorId[destId].push(m.qtd_cotas);
                }

                if (destId === loteriaAtiva.loteria_id) {
                    if (!saldoPorId[origemId]) saldoPorId[origemId] = 0;
                    if (!historicoDetalhePorId[origemId]) historicoDetalhePorId[origemId] = [];
                    saldoPorId[origemId] -= m.qtd_cotas;
                    historicoDetalhePorId[origemId].push(-m.qtd_cotas);
                }
            });
        }

        const linhas = [
            `📍 Origem: ${loteriaAtiva.loteria_nome}`,
            `🎯 ${modal} — Concurso ${concurso}`,
            `🎫 Cota: ${fmtBRL(cota)}`, '',
            '📊 CONFERÊNCIA DE MOVIMENTAÇÃO:',
            '(Histórico [Mov] → Final)',
        ];

        const slugsDestino = ['boulevard', 'centro', 'lotobel', 'santa-tereza', 'via-brasil'];
        const icones = {
            'boulevard': '🏢',
            'centro': '🏙️',
            'lotobel': '🏛️',
            'santa-tereza': '⛪',
            'via-brasil': '🛣️',
        };

        slugsDestino.forEach(slug => {
            const delta = mapaDeltas[slug] || 0;
            const destId = lojaIdPorSlug[slug];
            const nome = LOJA_CONFIG[slug]?.nome || slug;
            const icone = icones[slug] || '📍';
            const hist = historicoDetalhePorId[destId] || [];
            const saldo = saldoPorId[destId] || 0;
            const final = saldo + delta;

            if (delta === 0 && hist.length === 0) {
                linhas.push(`${icone} ${nome}: 0 (sem alteração)`);
                return;
            }

            if (delta === 0) {
                const histStr = hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ');
                linhas.push(`${icone} ${nome}: ${histStr} → ${saldo} (sem alteração)`);
                return;
            }

            const histStr = hist.length ? hist.map(v => v < 0 ? `[${v}]` : String(v)).join(' + ') : '0';
            const deltaStr = delta > 0 ? `[+${delta}]` : `[${delta}]`;
            linhas.push(`${icone} ${nome}: ${histStr} ${deltaStr} → ${final}`);
        });

        linhas.push('', '⚠️ Confirma a atualização desses valores?');

        showModal({
            title: 'Confirmar Movimentação',
            body: linhas.join('\n'),
            onConfirm: async () => {
                setBtnLoading(btn, true);
                setStatus('status', 'Registrando…', 'muted', 'spinner fa-spin');
                try {
                    await doMovimentar(bolao, mapaDeltas);
                    setStatus('status', '✓ Movimentação registrada!', 'ok', 'check-double');
                    limparMov();
                } catch (e) {
                    setStatus('status', e.message, 'err', 'exclamation-circle');
                } finally {
                    setBtnLoading(btn, false);
                }
            }
        });
    } catch (e) {
        setStatus('status', e.message, 'err', 'exclamation-circle');
    }
}

async function doMovimentar(bolao, mapaDeltas) {
    const inserts = [];

    for (const [slug, qtd] of Object.entries(mapaDeltas)) {
        if (qtd === 0 || slug === loteriaAtiva.loteria_slug) continue;

        const destId = lojaIdPorSlug[slug];
        if (!destId) throw new Error(`Loja destino não encontrada: ${slug}`);

        inserts.push({
            bolao_id: bolao.id,
            loteria_origem: loteriaAtiva.loteria_id,
            loteria_destino: destId,
            qtd_cotas: qtd,
            valor_unitario: bolao.valor_cota,
            status: 'ATIVO',
            criado_por: usuario.id,
        });
    }

    if (!inserts.length) throw new Error('Nenhuma movimentação válida.');

    const { error } = await sb.from('movimentacoes_cotas').insert(inserts);
    if (error) throw new Error(error.message);
}

/************************************************************
 * BINDINGS
 ************************************************************/
function bind() {
    const btnDiPrev = $('btnDiPrev');
    const btnDiNext = $('btnDiNext');
    const btnDcPrev = $('btnDcPrev');
    const btnDcNext = $('btnDcNext');
    const btnConcursoPrev = $('btnConcursoPrev');
    const btnConcursoNext = $('btnConcursoNext');
    const btnCadastrar = $('btnCadastrar');
    const btnDeletar = $('btnDeletar');
    const btnMovimentar = $('btnMovimentar');
    const btnBuscar = $('btnBuscar');
    const btnLimpar = $('btnLimpar');
    const btnZerarMov = $('btnZerarMov');
    const modalidade = $('modalidade');
    const lojaTreeWrap = $('lojaTreeWrap');
    const origemChip = $('origemChip');
    const movOrigemChip = $('movOrigemChip');
    const btnInicio = $('btnInicio');
    const btnSair = $('btnSair');

    if (btnDiPrev) btnDiPrev.onclick = () => addDias('dataInicial', -1);
    if (btnDiNext) btnDiNext.onclick = () => addDias('dataInicial', +1);
    if (btnDcPrev) btnDcPrev.onclick = () => addDias('dataConcurso', -1);
    if (btnDcNext) btnDcNext.onclick = () => addDias('dataConcurso', +1);

    if (btnConcursoPrev) btnConcursoPrev.addEventListener('click', async () => { await ajustarConcurso(-1); });
    if (btnConcursoNext) btnConcursoNext.addEventListener('click', async () => { await ajustarConcurso(1); });

    if (btnCadastrar) btnCadastrar.addEventListener('click', onCadastrar);
    if (btnDeletar) btnDeletar.addEventListener('click', onDeletar);
    if (btnMovimentar) btnMovimentar.addEventListener('click', onMovimentar);
    if (btnBuscar) btnBuscar.addEventListener('click', onBuscar);

    if (btnLimpar) btnLimpar.addEventListener('click', () => {
        limparFormSemLoja();
        setStatus('status', 'Campos limpos.', 'muted', 'broom');
    });

    if (btnZerarMov) btnZerarMov.addEventListener('click', () => {
        limparMov();
        setStatus('status', 'Movimentação limpa.', 'muted', 'broom');
    });

    if (modalidade) modalidade.addEventListener('change', () => {
        const m = modalidade.value;
        localStorage.setItem('sl_active_mod', m);
        setActiveModBtn(m);
        renderChips(m);
        applyFederalUI();
        saveDraft();
    });

    [...CAMPOS_FORM, ...CAMPOS_MOV].forEach(id => {
        const el = $(id);
        if (el) {
            el.addEventListener('input', saveDraft);
            el.addEventListener('change', saveDraft);
        }
    });

    if (lojaTreeWrap) {
        lojaTreeWrap.addEventListener('click', () => trocarLojaPorOffset(1));
        lojaTreeWrap.setAttribute('title', 'Trocar loja');
    }

    if (origemChip) origemChip.addEventListener('click', () => trocarLojaPorOffset(1));
    if (movOrigemChip) movOrigemChip.addEventListener('click', () => trocarLojaPorOffset(1));

    if (btnInicio) btnInicio.addEventListener('click', () => {
        window.SISLOT_SECURITY.irParaInicio();
    });

    if (btnSair) btnSair.addEventListener('click', async () => {
        await window.SISLOT_SECURITY.sair();
    });
}

// Inicialização
init();
