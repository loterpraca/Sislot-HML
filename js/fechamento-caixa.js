/**
 * SISLOT - Fechamento de Caixa
 * Versão integrada com módulo Área do Cliente (CF)
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils com fallbacks
const utils = window.SISLOT_UTILS || {};

const $ = utils.$ || (id => document.getElementById(id));
const fmtBRL = utils.fmtBRL || (v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','));
const fmtData = utils.fmtData || (s => { if (!s) return '—'; const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; });
const isoDate = utils.isoDate || (date => date ? date.toISOString().slice(0, 10) : '');
const setStatus = utils.setStatus || ((id, msg, tipo) => { const el = $(id); if (el) { el.textContent = msg; el.className = `status-chip show ${tipo}`; } });
const hideStatus = utils.hideStatus || (id => { const el = $(id); if (el) el.className = 'status-chip'; });
const updateClock = utils.updateClock || (() => {
    const el = $('relogio');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('pt-BR') + ' — ' + now.toLocaleDateString('pt-BR');
});
const startClock = utils.startClock || (() => {
    updateClock();
    setInterval(updateClock, 1000);
});

startClock();

const LOJA_CONFIG = {
    'boulevard':    { nome: 'Boulevard',    logo: './icons/boulevard.png',    theme: 'boulevard',    logoPos: '50% 50%' },
    'centro':       { nome: 'Centro',       logo: './icons/loterpraca.png',   theme: 'centro',       logoPos: '50% 42%' },
    'lotobel':      { nome: 'Lotobel',      logo: './icons/lotobel.png',      theme: 'lotobel',      logoPos: '50% 50%' },
    'santa-tereza': { nome: 'Santa Tereza', logo: './icons/santa-tereza.png', theme: 'santa-tereza', logoPos: '50% 50%' },
    'via-brasil':   { nome: 'Via Brasil',   logo: './icons/via-brasil.png',   theme: 'via-brasil',   logoPos: '50% 50%' },
};

let usuario = null;
let loteriaAtiva = null;
let todasLojas = [];
let stepAtual = 1;
let modoAtual = 'novo';
let fechamentoOriginalId = null;

const ESTADO = {
    tela1: {},
    tela2: { produtos: [], federais: [] },
    tela3: { internos: [], externos: [] },
};

let lstInt = [];
let lstExt = [];
let allBoloes = [];
let federais = [];

let produtosLista = [];
let mostrarProdutosSemEstoque = false;

const n = id => parseFloat($(id)?.value) || 0;

function getCFOrThrow() {
    const cf = window.CF;
    if (!cf) {
        throw new Error('Módulo Área do Cliente não carregado. Verifique se cliente-fechamento.js está sendo carregado antes de fechamento-caixa.js.');
    }
    return cf;
}
function autoFill(el) {
    if (!el) return;
    el.classList.toggle('filled', String(el.value || '').trim() !== '');
}

function blurQ(id) {
    const i = $(id);
    if (i && i.value === '0') i.value = '';
}

function showStatusMsg(id, msg, tipo) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `status-chip show ${tipo}`;
}

function hideStatusMsg(id) {
    const el = $(id);
    if (!el) return;
    el.className = 'status-chip';
}

function aplicarTemaLoja(slug) {
    const cfg = LOJA_CONFIG[slug] || LOJA_CONFIG['centro'];
    document.body.setAttribute('data-loja', slug || 'centro');

    const img = $('logoImg');
    if (img) {
        img.src = cfg.logo;
        img.style.objectPosition = cfg.logoPos || '50% 50%';
    }

    const title = $('headerTitle');
    if (title) title.textContent = cfg.nome;

    const sub = $('headerSub');
    if (sub) sub.textContent = 'Fechamento de Caixa';
}

function bindHeaderActions() {
    $('lojaTreeWrap')?.addEventListener('click', async () => {
        await trocarLoteria();
    });
    $('btnInicio')?.addEventListener('click', () => confirmarInicio());
    $('btnSair')?.addEventListener('click', () => confirmarSair());
}

function bindStepClicks() {
    for (let i = 1; i <= 4; i++) {
        const el = $('s' + i);
        if (!el) continue;

        el.style.cursor = 'pointer';
        el.addEventListener('click', async () => {
            if (i === stepAtual) return;

            if (i < stepAtual) {
                if (i === 4) montarResumo();
                showStep(i);
                return;
            }

            await avancarStep(i);
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
    try {
        const ctx = await window.SISLOT_SECURITY.protegerPagina('fechamento');
        if (!ctx) return;

        usuario = ctx.usuario;

        todasLojas = (ctx.lojasPermitidas || []).map(l => ({
            id: l.loteria_id,
            nome: l.loteria_nome,
            slug: l.loteria_slug,
            codigo: l.loteria_codigo,
            cod_loterico: l.cod_loterico || '',
            principal: !!l.principal,
            papelNaLoja: l.papel_na_loja || ''
        }));

        if (!todasLojas.length) {
            alert('Nenhuma loteria vinculada a este usuário.');
            return;
        }

        const inicial = ctx.lojaInicial
            ? {
                id: ctx.lojaInicial.loteria_id,
                nome: ctx.lojaInicial.loteria_nome,
                slug: ctx.lojaInicial.loteria_slug,
                codigo: ctx.lojaInicial.loteria_codigo,
                cod_loterico: ctx.lojaInicial.cod_loterico || '',
                principal: !!ctx.lojaInicial.principal,
                papelNaLoja: ctx.lojaInicial.papel_na_loja || ''
            }
            : todasLojas[0];

        await definirLoteriaAtiva(inicial);

        $('data-ref').value = new Date().toISOString().slice(0, 10);

        await carregarProdutos();
        buildRaspadinha();

        $('prod-filtro-tipo')?.addEventListener('change', carregarProdutos);
        $('toggle-produtos-todos')?.addEventListener('change', (e) => {
            mostrarProdutosSemEstoque = !!e.target.checked;
            renderProdutos();
        });

        bindHeaderActions();
        bindStepClicks();

        // ── Inicializa o módulo Área do Cliente ────────────────────────────
  getCFOrThrow().init({
    sb,
    getLoteriaAtiva: () => loteriaAtiva,
    getUsuario:      () => usuario,
    getEstado:       () => ESTADO,
    getBoloes:       () => allBoloes,
    getFederais:     () => federais,
    getProdutos:     () => produtosLista,
    fmtBRL,
    fmtData
});

        setFS('fs-inicial');
        setB3('b3-inicial');
        showStep(1);
    } catch (e) {
        console.error(e);
        alert('Erro ao iniciar: ' + (e.message || e));
    }
}

async function definirLoteriaAtiva(loja) {
    loteriaAtiva = loja;
    window.loteriaAtiva = loteriaAtiva;
    aplicarTemaLoja(loja?.slug);
    await carregarFuncionarios();
}

async function trocarLoteria(slugOuId = null) {
    let loja = null;

    if (typeof slugOuId === 'string') {
        loja = todasLojas.find(l => l.slug === slugOuId) || null;
    } else if (typeof slugOuId === 'number') {
        loja = todasLojas.find(l => Number(l.id) === Number(slugOuId)) || null;
    }

    if (!loja) {
        const atual = todasLojas.findIndex(l => Number(l.id) === Number(loteriaAtiva?.id));
        if (atual < 0) return;
        let prox = atual + 1;
        if (prox >= todasLojas.length) prox = 0;
        loja = todasLojas[prox];
    }

    if (!loja) return;

    resetEstado();
    await definirLoteriaAtiva(loja);

    if (stepAtual > 1) showStep(1);
}

async function carregarFuncionarios() {
    const sel = $('funcionario');
    if (!sel) return;

    sel.innerHTML = '<option value="">Carregando...</option>';

    try {
        const { data, error } = await sb
            .from('usuarios_loterias')
            .select(`
                usuario_id,
                ativo,
                usuarios(id, nome, perfil, ativo, pode_logar)
            `)
            .eq('loteria_id', loteriaAtiva.id)
            .eq('ativo', true);

        if (error) throw error;

        const listaBruta = (data || []).flatMap(r => {
            if (!r.usuarios) return [];
            return Array.isArray(r.usuarios) ? r.usuarios : [r.usuarios];
        });

        const lista = listaBruta
            .filter(u => u && u.ativo && u.pode_logar)
            .filter((u, i, arr) => arr.findIndex(x => Number(x.id) === Number(u.id)) === i)
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

        sel.innerHTML = '<option value="">Selecione...</option>';

        if (FECHAMENTO_RULES.podeSelecionarFuncionario(usuario)) {
            lista.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.nome;
                sel.appendChild(opt);
            });

            sel.disabled = false;
            sel.value = '';
            sel.classList.remove('filled');

            if (!lista.length) {
                showStatusMsg('status-busca', 'Nenhum funcionário ativo encontrado para esta loteria.', 'err');
            } else {
                hideStatusMsg('status-busca');
            }
            return;
        }

        const opt = document.createElement('option');
        opt.value = usuario.id;
        opt.textContent = usuario.nome;
        sel.appendChild(opt);
        sel.value = String(usuario.id);
        sel.disabled = true;
        sel.classList.add('filled');
        hideStatusMsg('status-busca');
    } catch (e) {
        console.error('Erro ao carregar funcionários:', e);
        sel.innerHTML = '<option value="">Erro ao carregar</option>';
        showStatusMsg('status-busca', 'Erro ao carregar funcionários: ' + e.message, 'err');
    }
}

function onFuncChange() {
    const sel = $('funcionario');
    sel?.classList.toggle('filled', !!sel.value);
}

function showStep(n) {
    stepAtual = n;

    document.querySelectorAll('.step-content').forEach((el, i) => {
        el.classList.toggle('active', i + 1 === n);
    });

    for (let i = 1; i <= 4; i++) {
        const s = $('s' + i);
        const l = $('l' + i);
        if (!s) continue;

        if (i < n) {
            s.className = 'step done';
            s.querySelector('.step-circle').textContent = '✓';
        } else if (i === n) {
            s.className = 'step active';
            s.querySelector('.step-circle').textContent = i;
        } else {
            s.className = 'step wait';
            s.querySelector('.step-circle').textContent = i;
        }

        if (l) l.classList.toggle('done', i < n);
    }

    window.scrollTo(0, 0);
}

async function avancarStep(para) {
    try {
        if (para > stepAtual) {
            if (stepAtual === 1) {
                if (!validarStep1()) return;
                coletarTela1();
            }
            if (stepAtual === 2) coletarTela2();
            if (stepAtual === 3) coletarTela3();
        }

        showStep(para);

        if (para === 2) {
            const dataRef = $('data-ref').value;
            if (dataRef) await buscarFederaisSupabase(dataRef);
        }

        if (para === 3) {
            await carregarBoloes();
        }

        if (para === 4) {
            montarResumo();
        }
    } catch (e) {
        console.error('Erro ao avançar de tela:', e);
        alert('Erro ao avançar de tela:\n\n' + (e.message || e));
    }
}

function validarStep1() {
    const reqs = [
        'funcionario',
        'data-ref',
        'relatorio',
        'deposito',
        'troco-ini',
        'troco-sob',
        'pix-cnpj',
        'pix-dif',
        'premio-rasp',
        'resgate-tele'
    ];

    let ok = true;

    reqs.forEach(id => {
        const el = $(id);
        if (!String(el?.value || '').trim()) {
            ok = false;
            el?.classList.add('has-error');
        } else {
            el?.classList.remove('has-error');
        }
    });

    if (!ok) {
        document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUTOS
// ─────────────────────────────────────────────────────────────────────────────

function chaveProdutoItem(item) {
    const tipo = String(item.produto || '').toUpperCase();
    if (tipo === 'RASPADINHA') return `RASPADINHA|${item.raspadinha_id || ''}`;
    if (tipo === 'TELESENA') return `TELESENA|${item.telesena_item_id || ''}`;
    return `${tipo}|${item.raspadinha_id || ''}|${item.telesena_item_id || ''}`;
}

function aplicarContextoEdicaoProdutos(lista) {
    const produtosSalvos = ESTADO.tela2?.produtos || [];
    const mapa = {};
    produtosSalvos.forEach(p => { mapa[chaveProdutoItem(p)] = Number(p.qtd || 0); });

    return (lista || []).map(item => {
        const qtdSalva = Number(mapa[chaveProdutoItem(item)] || 0);
        const saldoAtual = Number(item.saldo_atual || 0);
        return { ...item, qtd_salva_edicao: qtdSalva, saldo_editavel: saldoAtual + qtdSalva, em_edicao: !!fechamentoOriginalId };
    });
}

async function carregarProdutos() {
    const tipo = $('prod-filtro-tipo')?.value || '';

    let query = sb
        .from('view_produtos_saldo_loja')
        .select(`loteria_id,produto,campanha_nome,item_nome,raspadinha_id,telesena_item_id,valor_venda,saldo_atual`)
        .eq('loteria_id', loteriaAtiva.id)
        .order('produto')
        .order('item_nome');

    if (tipo) query = query.eq('produto', tipo);

    const { data, error } = await query;

    if (error) {
        console.error('Erro ao carregar produtos:', error);
        produtosLista = [];
        renderProdutos();
        return;
    }

    produtosLista = aplicarContextoEdicaoProdutos(data || []);
    renderProdutos();

    if (ESTADO.tela2?.produtos?.length) restaurarProdutos();
}

function restaurarProdutos() {
    const produtosSalvos = ESTADO.tela2?.produtos || [];
    const mapa = {};

    produtosSalvos.forEach(p => {
        const tipo = String(p.produto || '').toUpperCase();
        let chave = '';
        if (tipo === 'RASPADINHA') chave = `RASPADINHA|${p.raspadinha_id || ''}`;
        else if (tipo === 'TELESENA') chave = `TELESENA|${p.telesena_item_id || ''}`;
        else chave = `${tipo}|${p.raspadinha_id || ''}|${p.telesena_item_id || ''}|${p.descricao || ''}|${Number(p.preco || 0)}`;
        mapa[chave] = Number(p.qtd || 0);
    });

    produtosLista.forEach(item => {
        const tipo = String(item.produto || '').toUpperCase();
        let chave = '';
        if (tipo === 'RASPADINHA') chave = `RASPADINHA|${item.raspadinha_id || ''}`;
        else if (tipo === 'TELESENA') chave = `TELESENA|${item.telesena_item_id || ''}`;
        else chave = `${tipo}|${item.raspadinha_id || ''}|${item.telesena_item_id || ''}|${item.item_nome || ''}|${Number(item.valor_venda || 0)}`;

        const idItem = item.raspadinha_id || item.telesena_item_id;
        const inp = $(`prod-qtd-${item.produto}-${idItem}`);
        if (!inp) return;
        const qtd = Number(mapa[chave] || 0);
        inp.value = qtd > 0 ? qtd : '';
    });

    recalcProdutos();
    updT2Geral();
}

function produtosVisiveis() {
    let lista = [...produtosLista];

    if (!mostrarProdutosSemEstoque) {
        lista = lista.filter(item =>
            Number(item.saldo_atual || 0) > 0 ||
            Number(item.qtd_salva_edicao || 0) > 0
        );
    }

    lista.sort((a, b) => {
        const sa = Number(a.saldo_editavel ?? a.saldo_atual ?? 0);
        const sb = Number(b.saldo_editavel ?? b.saldo_atual ?? 0);
        if ((sb > 0) !== (sa > 0)) return (sb > 0) - (sa > 0);
        if (String(a.produto || '') !== String(b.produto || '')) return String(a.produto || '').localeCompare(String(b.produto || ''));
        return String(a.item_nome || '').localeCompare(String(b.item_nome || ''));
    });

    return lista;
}

function buildProdutoCard(item) {
    const saldoBase = Number(item.saldo_atual || 0);
    const qtdSalva = Number(item.qtd_salva_edicao || 0);
    const saldo = Number(item.saldo_editavel ?? saldoBase);
    const semEstoque = saldo <= 0;
    const estoqueBaixo = saldo > 0 && saldo <= 5;
    const badge = semEstoque ? 'Sem estoque' : estoqueBaixo ? 'Baixo' : 'Disponível';
    const badgeClass = semEstoque ? 'badge-r' : estoqueBaixo ? 'badge-t' : 'badge';
    const idItem = item.raspadinha_id || item.telesena_item_id;
    const nome = item.item_nome || 'Sem nome';
    const tipo = item.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';

    return `
        <div class="prod-card ${semEstoque ? 'is-off' : ''}" data-produto="${item.produto}" data-item-id="${idItem}">
            <div class="prod-head">
                <div>
                    <div class="prod-nome">${nome}</div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px">${tipo}</div>
                </div>
                <span class="${badgeClass}">${badge}</span>
            </div>
            <div class="prod-body">
                <div>
                    <label style="font-size:10px;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;display:block;margin-bottom:5px">Valor</label>
                    <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;color:var(--accent)">${fmtBRL(item.valor_venda || 0)}</div>
                </div>
                <div>
                    <label style="font-size:10px;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;display:block;margin-bottom:5px">Estoque</label>
                    <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;color:${semEstoque ? 'var(--err)' : 'var(--text)'}">${saldo}</div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px">Atual: ${saldoBase}${qtdSalva > 0 ? ` • no fechamento: ${qtdSalva}` : ''}</div>
                </div>
            </div>
            <div class="qtd-wrap">
                <button type="button" class="btn-q" onclick="ajProduto('${item.produto}', '${idItem}', -1)" ${semEstoque ? 'disabled' : ''}>−</button>
                <input type="number" class="inp-qtd" id="prod-qtd-${item.produto}-${idItem}" placeholder="0" min="0" max="${Math.max(0, saldo)}" oninput="recalcProdutos()" onblur="blurQ('prod-qtd-${item.produto}-${idItem}')" ${semEstoque ? 'disabled' : ''}>
                <button type="button" class="btn-q" onclick="ajProduto('${item.produto}', '${idItem}', 1)" ${semEstoque ? 'disabled' : ''}>+</button>
            </div>
            <div class="prod-footer">
                <span class="prod-tot-lbl">Subtotal</span>
                <span class="prod-tot-val" id="prod-sub-${item.produto}-${idItem}">R$ 0,00</span>
            </div>
        </div>`;
}

function renderProdutos() {
    const wrap = $('produtos-grid');
    if (!wrap) return;

    const lista = produtosVisiveis();

    if (!lista.length) {
        wrap.innerHTML = `
            <div class="state-box" style="grid-column:1/-1">
                <div class="state-title">Nenhum produto disponível</div>
                <div class="state-sub">Altere o filtro ou marque "Mostrar sem estoque".</div>
            </div>`;
        const totalEl = $('produtos-tot');
        if (totalEl) totalEl.textContent = 'R$ 0,00';
        updT2Geral();
        return;
    }

    wrap.innerHTML = lista.map(buildProdutoCard).join('');

    if (ESTADO.tela2?.produtos?.length) restaurarProdutos();
    else recalcProdutos();
}

function ajProduto(produto, idItem, delta) {
    const el = $(`prod-qtd-${produto}-${idItem}`);
    if (!el || el.disabled) return;
    const atual = Number(el.value || 0);
    const max = Number(el.max || 999999);
    const novo = Math.max(0, Math.min(max, atual + delta));
    el.value = novo || '';
    recalcProdutos();
    el.focus();
}

function recalcProdutos() {
    let total = 0;

    produtosLista.forEach(item => {
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const elQtd = $(`prod-qtd-${item.produto}-${idItem}`);
        const elSub = $(`prod-sub-${item.produto}-${idItem}`);
        if (!elQtd || !elSub) return;

        const saldo = Number(item.saldo_editavel ?? item.saldo_atual ?? 0);
        let qtd = Number(elQtd.value || 0);
        if (qtd > saldo) { qtd = saldo; elQtd.value = saldo || ''; }

        const subtotal = qtd * Number(item.valor_venda || 0);
        elSub.textContent = fmtBRL(subtotal);
        elSub.classList.toggle('on', subtotal > 0);
        elQtd.classList.toggle('filled', qtd > 0);

        const card = elQtd.closest('.prod-card');
        if (card) card.classList.toggle('has-val', qtd > 0);

        total += subtotal;
    });

    const totalEl = $('produtos-tot');
    if (totalEl) totalEl.textContent = fmtBRL(total);
    const t2Rasp = $('t2-rasp');
    if (t2Rasp) t2Rasp.textContent = fmtBRL(total);
    updT2Geral();
}

function buildRaspadinha() { renderProdutos(); }

// Stubs de compatibilidade
function ajR() {}
function recalcR() {}
function updRaspTot() { recalcProdutos(); }
function ajTele() {}
function recalcTele() { recalcProdutos(); }

function getRaspTot() {
    let t = 0;
    produtosLista.forEach(item => {
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const qtd = Number($(`prod-qtd-${item.produto}-${idItem}`)?.value || 0);
        t += qtd * Number(item.valor_venda || 0);
    });
    return t;
}

function getTeleTot() { return 0; }

function getFedTot() {
    let t = 0;
    federais.forEach((f, i) => { t += (parseInt($(`fed-qtd-${i}`)?.value) || 0) * Number(f.valorUnit || 0); });
    return t;
}

function updT2Geral() {
    const g = getRaspTot() + getTeleTot() + getFedTot();
    const el = $('t2-geral');
    if (el) el.textContent = fmtBRL(g);
    const fed = $('t2-fed');
    if (fed) fed.textContent = fmtBRL(getFedTot());
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCA DE FECHAMENTO EXISTENTE
// ─────────────────────────────────────────────────────────────────────────────

function setSaveLoading(loading, text = '') {
    const btn = document.querySelector('[onclick="buscarFechamentoExistente()"]');
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.dataset.oldText = btn.textContent;
        btn.textContent = text || 'Carregando...';
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.oldText || 'Buscar Fechamento';
    }
}

function montarTela1DoFechamento(fech) {
    return {
        funcionario_id: fech.usuario_id || '',
        data_ref: fech.data_ref || '',
        relatorio: Number(fech.relatorio || 0),
        deposito: Number(fech.deposito || 0),
        troco_inicial: Number(fech.troco_inicial || 0),
        troco_sobra: Number(fech.troco_sobra || 0),
        pix_cnpj: Number(fech.pix_cnpj || 0),
        diferenca_pix: Number(fech.diferenca_pix || 0),
        premio_raspadinha: Number(fech.premio_raspadinha || 0),
        resgate_telesena: Number(fech.resgate_telesena || 0)
        // dividas removidas — substituídas pelo módulo CF
    };
}

function montarTela2DoFechamento(fech, federaisCarregados = []) {
    const produtos = (fech.fechamento_produtos || []).map(p => ({
        produto_id: p.produto_id || null,
        produto: String(p.tipo || '').toUpperCase(),
        descricao: p.descricao || '',
        preco: Number(p.valor_unitario || 0),
        qtd: Number(p.qtd_vendida || 0),
        sub: Number(p.total || 0),
        raspadinha_id: p.raspadinha_id || null,
        telesena_item_id: p.telesena_item_id || null
    }));
    return { produtos, federais: federaisCarregados };
}

function montarTela3DoFechamento(fech) {
    const internos = [];
    const externos = [];
    (fech.fechamento_boloes || []).forEach(b => {
        const item = {
            bolao_id: b.bolao_id,
            modalidade: b.modalidade,
            concurso: b.concurso,
            valorCota: b.valor_cota,
            qtdVendida: b.qtd_vendida,
            subtotal: b.subtotal || b.total || 0,
            origem: b.origem || null,
            tipo: b.tipo || null
        };
        if (b.tipo === 'EXTERNO' || b.origem) externos.push(item);
        else internos.push(item);
    });
    return { internos, externos };
}

function preencherTela1(fech) {
    const set = (id, v) => {
        const el = $(id);
        if (!el) return;
        el.value = v !== null && v !== undefined ? Number(v).toFixed(2) : '';
        el.classList.toggle('filled', !!el.value && el.value !== '0.00');
    };

    $('funcionario').value = fech.usuario_id || '';
    $('data-ref').value = fech.data_ref || '';
    autoFill($('funcionario'));
    autoFill($('data-ref'));

    set('relatorio', fech.relatorio);
    set('deposito', fech.deposito);
    set('troco-ini', fech.troco_inicial);
    set('troco-sob', fech.troco_sobra);
    set('pix-cnpj', fech.pix_cnpj);
    set('pix-dif', fech.diferenca_pix);
    set('premio-rasp', fech.premio_raspadinha);
    set('resgate-tele', fech.resgate_telesena);
    // Seção de dívidas removida — módulo CF carrega o histórico pelo próprio modal
}

async function buscarFechamentoExistente() {
    const funcionarioId = parseInt($('funcionario').value, 10);
    const dataRef = $('data-ref').value;

    if (!funcionarioId || !dataRef) {
        toast('Selecione funcionário e data.', false);
        return;
    }

    try {
        setSaveLoading(true, 'Buscando fechamento...');

        const { data: fech, error } = await sb
            .from('fechamentos')
            .select(`*, fechamento_produtos(*), fechamento_boloes(*)`)
            .eq('loteria_id', loteriaAtiva.id)
            .eq('usuario_id', funcionarioId)
            .eq('data_ref', dataRef)
            .maybeSingle();

        if (error) throw error;

        if (!fech) {
            toast('Nenhum fechamento encontrado para este funcionário/data.', false);
            return;
        }

        const federaisCarregados = await carregarFederaisDoFechamento(fech.id);

        fechamentoOriginalId = fech.id;
        ESTADO.tela1 = montarTela1DoFechamento(fech);
        ESTADO.tela2 = montarTela2DoFechamento(fech, federaisCarregados);
        ESTADO.tela3 = montarTela3DoFechamento(fech);

        preencherTela1(fech);
        await getCFOrThrow().carregarFechamentoExistente({ fechamentoId: fech.id });
        await carregarProdutos();
        await buscarFederaisSupabase(fech.data_ref);
        await carregarBoloes();

        toast('Fechamento carregado com sucesso.', true);
    } catch (e) {
        console.error('Erro ao buscar fechamento:', e);
        toast(e.message || 'Erro ao buscar fechamento.', false);
    } finally {
        setSaveLoading(false);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLETA DE DADOS
// ─────────────────────────────────────────────────────────────────────────────

function coletarTela1() {
    // Sem coleta de dívidas — substituído pelo módulo CF
    ESTADO.tela1 = {
        funcionario_id: $('funcionario').value,
        funcionario_nome: $('funcionario').options[$('funcionario').selectedIndex]?.text || '',
        data_ref: $('data-ref').value,
        relatorio: n('relatorio'),
        deposito: n('deposito'),
        troco_inicial: n('troco-ini'),
        troco_sobra: n('troco-sob'),
        pix_cnpj: n('pix-cnpj'),
        diferenca_pix: n('pix-dif'),
        premio_raspadinha: n('premio-rasp'),
        resgate_telesena: n('resgate-tele'),
        // clienteFechamento é mantido pelo módulo CF dentro de ESTADO.tela1
       clienteFechamento: ESTADO.tela1?.clienteFechamento || {
    clienteSelecionado: null,
    lancamentos: []
}
    };
}

function coletarTela2() {
    const produtos = produtosLista.map(item => {
        const idItem = item.raspadinha_id || item.telesena_item_id;
        const qtd = parseInt($(`prod-qtd-${item.produto}-${idItem}`)?.value) || 0;
        return {
            produto_id: item.produto_id || null,
            produto: item.produto,
            descricao: item.item_nome || '',
            preco: Number(item.valor_venda || 0),
            qtd,
            sub: qtd * Number(item.valor_venda || 0),
            raspadinha_id: item.raspadinha_id || null,
            telesena_item_id: item.telesena_item_id || null
        };
    });

    const feds = federais.map((f, i) => {
        const qtdVendida = parseInt($(`fed-qtd-${i}`)?.value) || 0;
        return {
            federal_id: f.federal_id,
            modalidade: f.modalidade,
            concurso: f.concurso,
            dtSorteio: f.dtSorteio,
            valorUnit: Number(f.valorUnit || 0),
            valorCusto: Number(f.valorCusto || 0),
            qtdVendida,
            subtotal: qtdVendida * Number(f.valorUnit || 0)
        };
    });

    ESTADO.tela2 = { produtos, federais: feds };
}

function coletarTela3() {
    const coleta = tipo => allBoloes
        .filter(b => b.tipo === tipo)
        .map(({ data, idx }) => ({
            bolao_id: data.bolao_id,
            modalidade: data.modalidade,
            concurso: data.concurso,
            valorCota: Number(data.valorCota || 0),
            qtdVendida: parseInt($(`qtd-${idx}`)?.value) || 0,
            subtotal: (parseInt($(`qtd-${idx}`)?.value) || 0) * Number(data.valorCota || 0)
        }));

    ESTADO.tela3 = { internos: coleta('INTERNO'), externos: coleta('EXTERNO') };
}

// ─────────────────────────────────────────────────────────────────────────────
// FEDERAIS
// ─────────────────────────────────────────────────────────────────────────────

function chaveFederalItem(item) { return `FEDERAL|${Number(item.federal_id || 0)}`; }

function aplicarContextoEdicaoFederais(lista) {
    const salvos = ESTADO.tela2?.federais || [];
    const mapa = {};
    salvos.forEach(f => { mapa[chaveFederalItem(f)] = Number(f.qtdVendida || 0); });

    return (lista || []).map(item => {
        const qtdSalva = Number(mapa[chaveFederalItem(item)] || 0);
        const saldoAtual = Number(item.saldo_atual || 0);
        return { ...item, qtd_salva_edicao: qtdSalva, saldo_editavel: saldoAtual + qtdSalva, em_edicao: !!fechamentoOriginalId };
    });
}

function federaisVisiveis() {
    return [...federais]
        .filter(item => Number(item.saldo_atual || 0) > 0 || Number(item.qtd_salva_edicao || 0) > 0)
        .sort((a, b) => {
            const sa = Number(a.saldo_editavel ?? a.saldo_atual ?? 0);
            const sb = Number(b.saldo_editavel ?? b.saldo_atual ?? 0);
            if ((sb > 0) !== (sa > 0)) return (sb > 0) - (sa > 0);
            const cmpData = String(a.dtSorteio || '').localeCompare(String(b.dtSorteio || ''));
            if (cmpData !== 0) return cmpData;
            const cmpMod = String(a.modalidade || '').localeCompare(String(b.modalidade || ''), 'pt-BR');
            if (cmpMod !== 0) return cmpMod;
            return String(a.concurso || '').localeCompare(String(b.concurso || ''), 'pt-BR');
        });
}

function getSaldoFederal(item) { return Number(item?.saldo_editavel ?? item?.saldo_atual ?? 0); }

async function buscarFederais() {
    const dataRef = $('data-ref').value;
    if (!dataRef) { alert('Defina a data do fechamento antes de buscar federais.'); return; }
    await buscarFederaisSupabase(dataRef);
}

async function buscarFederaisSupabase(dataRef) {
    try {
        setFS('fs-loading');
        $('fs-load-sub').textContent = 'Consultando federais disponíveis para esta loja...';

        const { data, error } = await sb
            .from('view_resumo_federal')
            .select(`federal_id,loteria_id,loja_origem,modalidade,concurso,dt_sorteio,valor_fracao,valor_custo,qtd_inicial,qtd_vendida_funcionarios,qtd_vendida_whatsapp,qtd_vendida_caixa,qtd_vendida_cambista_interno,qtd_venda_interna_total,estoque_atual,resultado`)
            .eq('loteria_id', loteriaAtiva.id)
            .gte('dt_sorteio', dataRef)
            .order('dt_sorteio', { ascending: true })
            .order('concurso', { ascending: true });

        if (error) throw error;

        const base = (data || []).map(f => ({
            federal_id: f.federal_id,
            loteriaId: Number(f.loteria_id),
            lojaOrigem: f.loja_origem,
            modalidade: f.modalidade,
            concurso: f.concurso,
            dtSorteio: f.dt_sorteio,
            valorUnit: Number(f.valor_fracao || 0),
            valorCusto: Number(f.valor_custo || 0),
            qtdInicial: Number(f.qtd_inicial || 0),
            qtdVendidaFuncionarios: Number(f.qtd_vendida_funcionarios || 0),
            qtdVendidaWhatsapp: Number(f.qtd_vendida_whatsapp || 0),
            qtdVendidaCaixa: Number(f.qtd_vendida_caixa || 0),
            qtdVendidaCambista: Number(f.qtd_vendida_cambista_interno || 0),
            qtdVendaInternaTotal: Number(f.qtd_venda_interna_total || 0),
            saldo_atual: Number(f.estoque_atual || 0),
            resultado: Number(f.resultado || 0)
        }));

        federais = aplicarContextoEdicaoFederais(base);
        federais = federaisVisiveis();

        renderFed();

        if (!federais.length) { setFS('fs-vazio'); return; }

        setFS('fs-lista');

        if (ESTADO.tela2?.federais?.length) restaurarFederais();
    } catch (e) {
        console.error('Erro ao buscar federais:', e);
        federais = [];
        setFS('fs-erro');
        $('fs-err-msg').textContent = e.message || 'Erro ao buscar federais.';
    }
}

function renderFed() {
    const tb = $('fed-tbody');
    tb.innerHTML = '';
    $('fed-count').textContent = federais.length;

    federais.forEach((f, i) => {
        const saldoBase = Number(f.saldo_atual || 0);
        const qtdSalva = Number(f.qtd_salva_edicao || 0);
        const saldo = getSaldoFederal(f);
        const semSaldo = saldo <= 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="mono">${f.modalidade}</td>
            <td class="mono" style="color:var(--purple);font-weight:600">${f.concurso}</td>
            <td class="mono" style="color:var(--amber)">${fmtData(f.dtSorteio)}</td>
            <td class="mono" style="color:var(--accent)">R$ ${Number(f.valorUnit || 0).toFixed(2).replace('.', ',')}</td>
            <td class="mono" style="text-align:center;color:var(--sky)">
                ${saldo}
                <div style="font-size:10px;color:var(--muted);margin-top:2px">Atual: ${saldoBase}${qtdSalva > 0 ? ` • no fechamento: ${qtdSalva}` : ''}</div>
            </td>
            <td>
                <div class="qtd-wrap" style="justify-content:center">
                    <button type="button" class="btn-q" style="border-color:rgba(167,139,250,.3)" onclick="ajFed(${i},-1)" ${semSaldo ? 'disabled' : ''}>−</button>
                    <input type="number" class="inp-fed" id="fed-qtd-${i}" min="0" max="${Math.max(0, saldo)}" placeholder="0" oninput="onFed(${i})" onblur="blurQ('fed-qtd-${i}')" ${semSaldo ? 'disabled' : ''}>
                    <button type="button" class="btn-q" style="border-color:rgba(167,139,250,.3)" onclick="ajFed(${i},+1)" ${semSaldo ? 'disabled' : ''}>+</button>
                </div>
                <div class="fed-sub" id="fed-sub-${i}">—</div>
            </td>`;
        tb.appendChild(tr);
    });

    const headers = document.querySelectorAll('.fed-table thead th');
    if (headers[4]) headers[4].textContent = 'Saldo';

    $('fed-tot-lbl').textContent = fmtBRL(getFedTot());
    updT2Geral();
}

function ajFed(i, delta) {
    const inp = $(`fed-qtd-${i}`);
    if (!inp || inp.disabled) return;
    const max = getSaldoFederal(federais[i]);
    const atual = parseInt(inp.value, 10) || 0;
    const novo = Math.min(max, Math.max(0, atual + delta));
    inp.value = novo || '';
    onFed(i);
    inp.focus();
}

function onFed(i) {
    const inp = $(`fed-qtd-${i}`);
    const sub = $(`fed-sub-${i}`);
    if (!inp || !sub) return;
    const f = federais[i];
    const max = getSaldoFederal(f);
    let qtd = parseInt(inp.value, 10) || 0;
    if (qtd > max) { qtd = max; inp.value = max || ''; }

    if (qtd > 0) {
        sub.textContent = fmtBRL(qtd * Number(f.valorUnit || 0));
        sub.classList.add('on');
        inp.classList.add('filled');
        inp.closest('tr')?.classList.add('hv');
    } else {
        sub.textContent = '—';
        sub.classList.remove('on');
        inp.classList.remove('filled');
        inp.closest('tr')?.classList.remove('hv');
    }

    $('fed-tot-lbl').textContent = fmtBRL(getFedTot());
    updT2Geral();
}

function restaurarFederais() {
    const mapa = {};
    (ESTADO.tela2?.federais || []).forEach(f => {
        if (Number(f.qtdVendida || 0) > 0) mapa[chaveFederalItem(f)] = Number(f.qtdVendida || 0);
    });
    federais.forEach((f, i) => {
        const qtd = Number(mapa[chaveFederalItem(f)] || 0);
        if (!qtd) return;
        const inp = $(`fed-qtd-${i}`);
        if (!inp) return;
        const max = getSaldoFederal(f);
        inp.value = Math.min(qtd, max) || '';
        onFed(i);
    });
}

async function carregarFederaisDoFechamento(fechId) {
    const { data, error } = await sb
        .from('federal_vendas')
        .select(`federal_id,qtd_vendida,valor_unitario,desconto,valor_liquido`)
        .eq('fechamento_id', fechId)
        .eq('canal', 'FECHAMENTO');
    if (error) throw error;
    return (data || []).map(f => ({
        federal_id: f.federal_id,
        valorUnit: Number(f.valor_unitario || 0),
        qtdVendida: Number(f.qtd_vendida || 0),
        subtotal: Number(f.valor_liquido || 0),
        desconto: Number(f.desconto || 0)
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO FS / B3
// ─────────────────────────────────────────────────────────────────────────────

function setFS(s) {
    ['fs-inicial', 'fs-loading', 'fs-erro', 'fs-vazio', 'fs-lista'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
    });
    const alvo = $(s);
    if (alvo) alvo.style.display = s === 'fs-lista' ? 'block' : 'flex';
}

function setB3(s) {
    ['b3-inicial', 'b3-loading', 'b3-erro', 'b3-vazio', 'b3-lista'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = 'none';
    });
    const alvo = $(s);
    if (alvo) alvo.style.display = s === 'b3-lista' ? 'block' : 'flex';
}

// ─────────────────────────────────────────────────────────────────────────────
// BOLÕES
// ─────────────────────────────────────────────────────────────────────────────

function chaveBolaoItem(item) { return `${String(item.tipo || '').toUpperCase()}|${Number(item.bolao_id || 0)}`; }

function aplicarContextoEdicaoBoloes(lista) {
    const salvos = [
        ...(ESTADO.tela3?.internos || []).map(b => ({ ...b, tipo: 'INTERNO' })),
        ...(ESTADO.tela3?.externos || []).map(b => ({ ...b, tipo: 'EXTERNO' }))
    ];
    const mapa = {};
    salvos.forEach(b => { mapa[chaveBolaoItem(b)] = Number(b.qtdVendida || 0); });

    return (lista || []).map(item => {
        const qtdSalva = Number(mapa[chaveBolaoItem(item)] || 0);
        const saldoAtual = Number(item.saldo_atual || 0);
        return { ...item, qtd_salva_edicao: qtdSalva, saldo_editavel: saldoAtual + qtdSalva, em_edicao: !!fechamentoOriginalId };
    });
}

function boloesVisiveis() {
    const todos = [
        ...lstInt.map(b => ({ ...b, tipo: 'INTERNO' })),
        ...lstExt.map(b => ({ ...b, tipo: 'EXTERNO' }))
    ];

    return todos
        .filter(item => Number(item.saldo_atual || 0) > 0 || Number(item.qtd_salva_edicao || 0) > 0)
        .sort((a, b) => {
            const sa = Number(a.saldo_editavel ?? a.saldo_atual ?? 0);
            const sb = Number(b.saldo_editavel ?? b.saldo_atual ?? 0);
            if ((sb > 0) !== (sa > 0)) return (sb > 0) - (sa > 0);
            const espA = isModalidadeEspecial(a.modalidade);
            const espB = isModalidadeEspecial(b.modalidade);
            if (espA !== espB) return Number(espA) - Number(espB);
            const cmpMod = String(a.modalidade || '').localeCompare(String(b.modalidade || ''), 'pt-BR');
            if (cmpMod !== 0) return cmpMod;
            const valA = Number(a.valorCota || 0);
            const valB = Number(b.valorCota || 0);
            if (valA !== valB) return valA - valB;
            return Number(a.concurso || 0) - Number(b.concurso || 0);
        });
}

function getSaldoBolao(item) { return Number(item?.saldo_editavel ?? item?.saldo_atual ?? 0); }

async function carregarBoloes() {
    const dataRef = $('data-ref').value;
    if (!dataRef) return;
    setB3('b3-loading');

    try {
        const [
            { data: boloesInt, error: errInt },
            { data: movsExt, error: errExt },
            { data: vendasBolao, error: errVend }
        ] = await Promise.all([
            sb.from('boloes').select(`id,modalidade,concurso,valor_cota,qtd_cotas_total,qtd_jogos,qtd_dezenas,dt_inicial,dt_concurso,status,loteria_id`).eq('loteria_id', loteriaAtiva.id).eq('status', 'ATIVO').lte('dt_inicial', dataRef).gte('dt_concurso', dataRef),
            sb.from('movimentacoes_cotas').select(`bolao_id,qtd_cotas,status,loteria_destino,boloes(id,loteria_id,modalidade,concurso,valor_cota,qtd_jogos,qtd_dezenas,dt_inicial,dt_concurso,status,loterias(nome,cod_loterico))`).eq('loteria_destino', loteriaAtiva.id).eq('status', 'ATIVO'),
            sb.from('boloes_vendas').select(`bolao_id,qtd_vendida`).eq('loteria_vendedora_id', loteriaAtiva.id)
        ]);

        if (errInt) throw errInt;
        if (errExt) throw errExt;
        if (errVend) throw errVend;

        const mapaVendido = {};
        (vendasBolao || []).forEach(v => {
            const bolaoId = Number(v.bolao_id || 0);
            if (!bolaoId) return;
            mapaVendido[bolaoId] = (mapaVendido[bolaoId] || 0) + Number(v.qtd_vendida || 0);
        });

        const mapaExt = {};
        (movsExt || []).forEach(m => {
            const b = Array.isArray(m.boloes) ? m.boloes[0] : m.boloes;
            if (!b || b.status !== 'ATIVO') return;
            if (b.dt_inicial > dataRef || b.dt_concurso < dataRef) return;
            if (!mapaExt[m.bolao_id]) mapaExt[m.bolao_id] = { bolao: b, qtdCotas: 0 };
            mapaExt[m.bolao_id].qtdCotas += Number(m.qtd_cotas || 0);
        });

        lstInt = aplicarContextoEdicaoBoloes(
            (boloesInt || []).map(b => {
                const saldoBase = Number(b.qtd_cotas_total || 0);
                const qtdVendidaTotal = Number(mapaVendido[b.id] || 0);
                return {
                    bolao_id: b.id, modalidade: b.modalidade, concurso: b.concurso,
                    qtdJogos: b.qtd_jogos, qtdDezenas: b.qtd_dezenas,
                    valorCota: Number(b.valor_cota || 0), dtInicial: b.dt_inicial, dtConcurso: b.dt_concurso,
                    saldo_base: saldoBase, qtd_vendida_total: qtdVendidaTotal,
                    saldo_atual: Math.max(0, saldoBase - qtdVendidaTotal),
                    saldoEnviado: null, origem: loteriaAtiva.nome, tipo: 'INTERNO'
                };
            })
        );

        lstExt = aplicarContextoEdicaoBoloes(
            Object.values(mapaExt).map(({ bolao: b, qtdCotas }) => {
                const saldoBase = Number(qtdCotas || 0);
                const qtdVendidaTotal = Number(mapaVendido[b.id] || 0);
                return {
                    bolao_id: b.id, modalidade: b.modalidade, concurso: b.concurso,
                    qtdJogos: b.qtd_jogos, qtdDezenas: b.qtd_dezenas,
                    valorCota: Number(b.valor_cota || 0), dtInicial: b.dt_inicial, dtConcurso: b.dt_concurso,
                    saldo_base: saldoBase, qtd_vendida_total: qtdVendidaTotal,
                    saldo_atual: Math.max(0, saldoBase - qtdVendidaTotal),
                    saldoEnviado: saldoBase, origem: b.loterias?.nome || '',
                    origemCodLoterico: b.loterias?.cod_loterico || '', tipo: 'EXTERNO'
                };
            })
        );

        const total = lstInt.length + lstExt.length;
        if (!total) { allBoloes = []; renderBoloes(); setB3('b3-vazio'); return; }

        renderBoloes();
        setB3('b3-lista');

        if (ESTADO.tela3.internos?.length || ESTADO.tela3.externos?.length) restaurarBoloes();
    } catch (e) {
        console.error(e);
        $('b3-err-msg').textContent = e.message || 'Erro ao carregar bolões.';
        setB3('b3-erro');
    }
}

function renderBoloes() {
    const wrap = $('boloes-wrap');
    wrap.innerHTML = '';
    allBoloes = [];

    const todos = boloesVisiveis();

    if (!todos.length) {
        wrap.innerHTML = `
            <div class="state-box" style="grid-column:1/-1">
                <div class="state-title">Nenhum bolão disponível</div>
                <div class="state-sub">Sem saldo disponível para esta loja nesta data.</div>
            </div>`;
        updBolTotais();
        return;
    }

    const especiais = ordenarBoloesFechamento(todos.filter(b => isModalidadeEspecial(b.modalidade)));
    const regulares = ordenarBoloesFechamento(todos.filter(b => !isModalidadeEspecial(b.modalidade)));

    const agruparPorModalidade = lista => {
        const mapa = {};
        lista.forEach(b => {
            const mod = b.modalidade || 'SEM MODALIDADE';
            if (!mapa[mod]) mapa[mod] = [];
            mapa[mod].push(b);
        });
        return mapa;
    };

    const renderGrupoModalidade = (tituloBloco, lista, blocoEspecial = false) => {
        if (!lista.length) return;

        const bloco = document.createElement('div');
        bloco.style.marginBottom = '26px';
        bloco.innerHTML = `
            <div class="bloco-sep ${blocoEspecial ? 'b-ext' : 'b-int'}">
                <div class="bloco-label">${tituloBloco}</div>
                <div class="bloco-line"></div>
                <div class="bloco-tot" id="bloco-tot-${tituloBloco.replace(/\s+/g, '-').toLowerCase()}">R$ 0,00</div>
            </div>`;
        wrap.appendChild(bloco);

        const grupos = agruparPorModalidade(lista);

        Object.entries(grupos).forEach(([mod, boloes]) => {
            const grp = document.createElement('div');
            grp.className = 'mod-group';
            const modKey = `${tituloBloco}-${mod}`.replace(/\s/g, '_');

            grp.innerHTML = `
                <div class="mod-header ${blocoEspecial ? 'ec' : 'ic'}">
                    <div class="mod-dot"></div>
                    <div class="mod-nome">${mod}</div>
                    <div class="mod-count">${boloes.length}</div>
                    <div class="mod-subtot" id="mod-tot-${modKey}">R$ 0,00</div>
                </div>`;

            boloes.forEach((b, i) => {
                const gi = allBoloes.length;
                const saldoBase = Number(b.saldo_base || 0);
                const qtdVendidaTotal = Number(b.qtd_vendida_total || 0);
                const qtdSalva = Number(b.qtd_salva_edicao || 0);
                const saldo = getSaldoBolao(b);
                const semSaldo = saldo <= 0;

                allBoloes.push({ tipo: b.tipo, data: b, idx: gi, grupo: tituloBloco, modalidade: mod });

                const metas = [];
                if (b.qtdJogos) metas.push(`<span class="meta-tag">${b.qtdJogos} jogo(s)</span>`);
                if (b.qtdDezenas) metas.push(`<span class="meta-tag">${b.qtdDezenas} dez.</span>`);
                metas.push(`<span class="meta-tag" style="color:var(--accent);border-color:rgba(0,200,150,.2)">R$ ${Number(b.valorCota).toFixed(2).replace('.', ',')} / cota</span>`);
                metas.push(`<span class="meta-tag meta-saldo">saldo ${saldo}</span>`);
                if (b.tipo === 'EXTERNO') {
                    const origemTxt = [b.origem, b.origemCodLoterico].filter(Boolean).join(' · ');
                    metas.push(`<span class="meta-tag meta-dest">externo${origemTxt ? ' · ' + origemTxt : ''}</span>`);
                } else {
                    metas.push(`<span class="meta-tag">interno</span>`);
                }

                const infoSaldo = `<div style="font-size:10px;color:var(--muted);margin-top:6px">Base: ${saldoBase} · Vendido: ${qtdVendidaTotal}${qtdSalva > 0 ? ` · no fechamento: ${qtdSalva}` : ''}</div>`;

                const card = document.createElement('div');
                card.className = `bolao-card is-${b.tipo === 'INTERNO' ? 'int' : 'ext'} ${semSaldo ? 'is-off' : ''}`;
                card.dataset.idx = gi;
                card.style.animationDelay = (i * .03) + 's';
                card.innerHTML = `
                    <div>
                        <div class="bolao-key">#${b.bolao_id || ''} · ${b.concurso}</div>
                        <div class="bolao-nome">${b.modalidade} — Concurso ${b.concurso}</div>
                        <div class="bolao-metas">${metas.join('')}</div>
                        ${infoSaldo}
                    </div>
                    <div class="qtd-block">
                        <div class="qtd-lbl">Cotas Vendidas</div>
                        <div class="qtd-wrap">
                            <button type="button" class="btn-q" onclick="ajQ(${gi},-1)" ${semSaldo ? 'disabled' : ''}>−</button>
                            <input type="number" class="inp-qtd" id="qtd-${gi}" min="0" max="${Math.max(0, saldo)}" placeholder="0" oninput="onQtd(${gi})" onblur="blurQ('qtd-${gi}')" ${semSaldo ? 'disabled' : ''}>
                            <button type="button" class="btn-q" onclick="ajQ(${gi},+1)" ${semSaldo ? 'disabled' : ''}>+</button>
                        </div>
                        <div class="qtd-sub" id="sub-${gi}">—</div>
                    </div>`;
                grp.appendChild(card);
            });

            wrap.appendChild(grp);
        });
    };

    renderGrupoModalidade('Tradicionais', regulares, false);
    renderGrupoModalidade('Especiais', especiais, true);
    updBolTotais();
}

function ajQ(idx, d) {
    const inp = $(`qtd-${idx}`);
    if (!inp || inp.disabled) return;
    const max = getSaldoBolao(allBoloes[idx]?.data);
    const atual = Number(inp.value || 0);
    const novo = Math.max(0, Math.min(max, atual + d));
    inp.value = novo || '';
    onQtd(idx);
    inp.focus();
}

function onQtd(idx) {
    const inp = $(`qtd-${idx}`);
    if (!inp) return;
    const sub = $(`sub-${idx}`);
    const card = inp.closest('.bolao-card');
    const b = allBoloes[idx].data;
    const max = getSaldoBolao(b);
    let qtd = parseInt(inp.value, 10) || 0;
    if (qtd > max) { qtd = max; inp.value = max || ''; }

    if (qtd > 0) {
        sub.textContent = fmtBRL(qtd * Number(b.valorCota || 0));
        sub.classList.add('on');
        inp.classList.add('filled');
        card?.classList.add('has-val');
    } else {
        sub.textContent = '—';
        sub.classList.remove('on');
        inp.classList.remove('filled');
        card?.classList.remove('has-val');
    }

    updBolTotais();
    atualizarListaVendas();
}

function normalizarTexto(txt) {
    return String(txt || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isModalidadeEspecial(modalidade) {
    const m = normalizarTexto(modalidade);
    return m.includes('PASCOA') || m.includes('VIRADA') || m.includes('INDEPENDENCIA') || m.includes('SAO JOAO');
}

function ordenarBoloesFechamento(lista) {
    return [...lista].sort((a, b) => {
        const cmpMod = String(a.modalidade || '').localeCompare(String(b.modalidade || ''), 'pt-BR');
        if (cmpMod !== 0) return cmpMod;
        const valA = Number(a.valorCota || 0);
        const valB = Number(b.valorCota || 0);
        if (valA !== valB) return valA - valB;
        return Number(a.concurso || 0) - Number(b.concurso || 0);
    });
}

function updBolTotais() {
    let tInt = 0, tExt = 0, totalCotas = 0;

    allBoloes.forEach(({ tipo, data, idx }) => {
        const qtd = parseInt($(`qtd-${idx}`)?.value) || 0;
        const subtotal = qtd * Number(data.valorCota || 0);
        if (tipo === 'INTERNO') tInt += subtotal;
        else tExt += subtotal;
        totalCotas += qtd;
    });

    const tot = tInt + tExt;
    $('tot-int').textContent = fmtBRL(tInt);
    $('tot-ext').textContent = fmtBRL(tExt);
    $('tot-bol').textContent = fmtBRL(tot);
    $('tot-bol-geral').textContent = fmtBRL(tot);
    $('tot-cotas').textContent = totalCotas;

    document.querySelectorAll('[id^="mod-tot-"]').forEach(el => { el.textContent = 'R$ 0,00'; });

    const blocoTrad = $('bloco-tot-tradicionais');
    if (blocoTrad) blocoTrad.textContent = 'R$ 0,00';
    const blocoEsp = $('bloco-tot-especiais');
    if (blocoEsp) blocoEsp.textContent = 'R$ 0,00';

    let totTrad = 0, totEsp = 0;
    const modTots = {};

    allBoloes.forEach(({ data, idx, grupo, modalidade }) => {
        const qtd = parseInt($(`qtd-${idx}`)?.value) || 0;
        const subtotal = qtd * Number(data.valorCota || 0);
        const modKey = `${grupo}-${modalidade}`.replace(/\s/g, '_');
        modTots[modKey] = (modTots[modKey] || 0) + subtotal;
        if (grupo === 'Especiais') totEsp += subtotal;
        else totTrad += subtotal;
    });

    Object.entries(modTots).forEach(([k, v]) => {
        const el = $(`mod-tot-${k}`);
        if (el) el.textContent = fmtBRL(v);
    });

    if (blocoTrad) blocoTrad.textContent = fmtBRL(totTrad);
    if (blocoEsp) blocoEsp.textContent = fmtBRL(totEsp);
}

function atualizarListaVendas() {
    const vendidos = allBoloes.filter(({ idx }) => (parseInt($(`qtd-${idx}`)?.value) || 0) > 0);
    const list = $('vendas-registradas');
    const items = $('vendas-items');
    list.classList.toggle('show', vendidos.length > 0);
    items.innerHTML = '';

    vendidos.forEach(({ tipo, data, idx }) => {
        const qtd = parseInt($(`qtd-${idx}`)?.value) || 0;
        const item = document.createElement('div');
        item.className = 'venda-item';
        item.innerHTML = `
            <span class="vi-nome">${data.modalidade} — Conc. ${data.concurso} <span style="font-size:9px;color:var(--dim)">${tipo}</span></span>
            <span class="vi-qtd">${qtd}x</span>
            <span class="vi-val">${fmtBRL(qtd * Number(data.valorCota || 0))}</span>`;
        items.appendChild(item);
    });
}

function restaurarBoloes() {
    const mapa = {};
    [...(ESTADO.tela3.internos || []), ...(ESTADO.tela3.externos || [])].forEach(b => {
        if (Number(b.qtdVendida || 0) > 0) mapa[Number(b.bolao_id)] = Number(b.qtdVendida || 0);
    });
    allBoloes.forEach(({ data, idx }) => {
        const qtd = Number(mapa[Number(data.bolao_id)] || 0);
        if (!qtd) return;
        const inp = $(`qtd-${idx}`);
        if (!inp) return;
        const max = getSaldoBolao(data);
        inp.value = Math.min(qtd, max) || '';
        onQtd(idx);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMO — integrado com módulo CF
// ─────────────────────────────────────────────────────────────────────────────

function montarResumo() {
    coletarTela1();
    coletarTela2();
    coletarTela3();

    const t1 = ESTADO.tela1;
    const t2 = ESTADO.tela2;
    const t3 = ESTADO.tela3;

    $('r-func').textContent = t1.funcionario_nome || '—';
    $('r-data').textContent = fmtData(t1.data_ref);
    $('r-loteria').textContent = loteriaAtiva?.nome || '—';

    const totalProd = (t2.produtos || []).reduce((a, p) => a + Number(p.sub || 0), 0);
    const totalFed  = (t2.federais || []).reduce((a, f) => a + Number(f.subtotal || 0), 0);
    const totalBol  = [...(t3.internos || []), ...(t3.externos || [])]
        .reduce((a, b) => a + Number(b.subtotal || 0), 0);

    const s = (id, v) => {
        const el = $(id);
        if (!el) return;
        el.textContent = fmtBRL(v);
        el.classList.toggle('zero', v === 0);
    };

    s('r-troco-ini', t1.troco_inicial);
    s('r-produtos', totalProd);
    s('r-federais', totalFed);
    s('r-boloes', totalBol);
    s('r-relatorio', t1.relatorio);

    const totCFCredito = getCFOrThrow().getTotalCredito();

    const s_cf = (id, v) => {
        const el = $(id);
        if (!el) return;
        el.textContent = fmtBRL(v);
        el.classList.toggle('zero', v === 0);
    };

    s_cf('cf-r-credito-val', totCFCredito);

    const lans = ESTADO.tela1?.clienteFechamento?.lancamentos || [];
    const badge = $('cf-r-credito-badge');
    if (badge) {
        badge.textContent = lans.filter(l => l.tipo_movimento === 'DEBITO').length;
    }

    const totDeb = Number(t1.troco_inicial || 0)
        + totalProd
        + totalFed
        + totalBol
        + Number(t1.relatorio || 0);

    const totCred = Number(t1.troco_sobra || 0)
        + Number(t1.deposito || 0)
        + Number(t1.pix_cnpj || 0)
        + Number(t1.diferenca_pix || 0)
        + Number(t1.premio_raspadinha || 0)
        + Number(t1.resgate_telesena || 0)
        + totCFCredito;

    s('r-tot-deb', totDeb);
    s('r-troco-sob', t1.troco_sobra);
    s('r-deposito', t1.deposito);
    s('r-pix', t1.pix_cnpj);
    s('r-pix-dif', t1.diferenca_pix);
    s('r-rasp', t1.premio_raspadinha);
    s('r-tele', t1.resgate_telesena);
    s('r-tot-cred', totCred);

    const quebra = totCred - totDeb;

    detectarModo();
    renderQuebra(quebra, totCred, totDeb);
}

function renderQuebra(quebra, cred, deb) {
    const card      = $('quebra-card');
    const icon      = $('q-icon');
    const titulo    = $('q-titulo');
    const desc      = $('q-desc');
    const val       = $('q-valor');
    const det       = $('q-detalhe');
    const justWrap  = $('just-wrap');
    const btn       = $('btn-final');

    card.className = 'quebra-card';
    det.textContent = `Créditos (R$ ${Number(cred).toFixed(2).replace('.', ',')}) − Débitos (R$ ${Number(deb).toFixed(2).replace('.', ',')})`;

    const abs = Math.abs(quebra);
    const fmtA = 'R$ ' + abs.toFixed(2).replace('.', ',');

    if (abs < 0.005) {
        card.classList.add('q-eq');
        icon.textContent = '✓';
        titulo.textContent = 'Caixa Equilibrado';
        desc.textContent = 'Créditos e débitos estão balanceados.';
        val.textContent = 'R$ 0,00';
        justWrap.classList.remove('show');
        if (modoAtual !== 'visualizacao') btn.disabled = false;
    } else if (quebra > 0) {
        card.classList.add('q-pos');
        icon.textContent = '↑';
        titulo.textContent = 'Sobra de Caixa';
        desc.textContent = `O caixa apresenta sobra de ${fmtA}.`;
        val.textContent = '+' + fmtA;
        justWrap.classList.add('show');
        btn.disabled = true;
    } else {
        card.classList.add('q-neg');
        icon.textContent = '↓';
        titulo.textContent = 'Falta de Caixa';
        desc.textContent = `O caixa apresenta falta de ${fmtA}.`;
        val.textContent = '−' + fmtA;
        justWrap.classList.add('show');
        btn.disabled = true;
    }

    const ta  = $('justificativa');
    const cnt = $('just-cnt');

    if (ta && cnt) {
        cnt.textContent = ta.value.length;
        ta.oninput = () => {
            cnt.textContent = ta.value.length;
            if (Math.abs(quebra) >= 0.005 && modoAtual !== 'visualizacao') {
                btn.disabled = ta.value.trim().length < 10;
            }
        };
    }
}

function detectarModo() {
    const banner = $('modo-banner');
    banner.className = 'modo-banner';

    const btnFinal    = $('btn-final');
    const btnFinalTxt = $('btn-final-txt');

    if (!fechamentoOriginalId) {
        modoAtual = 'novo';
        banner.innerHTML = '<span>Novo fechamento — será gravado ao finalizar.</span>';
        banner.classList.add('show', 'novo');
        if (btnFinal) btnFinal.className = 'btn-finalizar salvar';
        if (btnFinalTxt) btnFinalTxt.textContent = 'Finalizar Fechamento';
        return;
    }

    modoAtual = 'edicao';
    banner.innerHTML = '<span>Modo <strong>edição</strong> — ao finalizar o registro existente será sobrescrito.</span>';
    banner.classList.add('show', 'edicao');
    if (btnFinal) btnFinal.className = 'btn-finalizar salvar';
    if (btnFinalTxt) btnFinalTxt.textContent = 'Salvar Alterações';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE SNAPSHOT / VENDAS
// ─────────────────────────────────────────────────────────────────────────────

function getProdutosVendidosTela2(t2 = ESTADO.tela2) {
    return (t2?.produtos || []).filter(p => Number(p.qtd || 0) > 0);
}

async function estornarProdutosDoFechamento(fechId) {
    if (!fechId) return 0;
    const { data, error } = await sb.rpc('estornar_vendas_produto_fechamento', { p_fechamento_id: fechId });
    if (error) throw error;
    return Number(data || 0);
}

async function apagarSnapshotProdutosDoFechamento(fechId) {
    if (!fechId) return;
    const { error } = await sb.from('fechamento_produtos').delete().eq('fechamento_id', fechId);
    if (error) throw error;
}

async function salvarSnapshotProdutosDoFechamento(fechId, produtosVendidos) {
    if (!produtosVendidos.length) return;
    const prodRows = produtosVendidos.map(p => ({
        fechamento_id: fechId, produto_id: p.produto_id || null,
        tipo: p.produto, descricao: p.descricao || '',
        valor_unitario: Number(p.preco || 0), qtd_vendida: Number(p.qtd || 0),
        total: Number(p.sub || 0), raspadinha_id: p.raspadinha_id || null,
        telesena_item_id: p.telesena_item_id || null
    }));
    const { error } = await sb.from('fechamento_produtos').insert(prodRows);
    if (error) throw error;
}

async function registrarVendasProdutosDoFechamento(fechId, t1, produtosVendidos) {
    if (!produtosVendidos.length) return;
    try {
        for (const p of produtosVendidos) {
            const { error } = await sb.rpc('registrar_venda_produto', {
                p_loteria_vendedora_id: Number(loteriaAtiva.id),
                p_usuario_id: Number(t1.funcionario_id),
                p_canal: 'FECHAMENTO', p_produto: String(p.produto || '').toUpperCase(),
                p_raspadinha_id: p.raspadinha_id || null,
                p_telesena_item_id: p.telesena_item_id || null,
                p_qtd_vendida: Number(p.qtd || 0), p_data_referencia: t1.data_ref,
                p_desconto: 0, p_observacao: 'Lançado no fechamento', p_fechamento_id: fechId
            });
            if (error) throw error;
        }
    } catch (e) {
        await estornarProdutosDoFechamento(fechId);
        await apagarSnapshotProdutosDoFechamento(fechId);
        throw e;
    }
}

function getBoloesVendidosTela3(t3 = ESTADO.tela3) {
    return [
        ...((t3?.internos || []).filter(b => Number(b.qtdVendida || 0) > 0).map(b => ({ ...b, tipo: 'INTERNO' }))),
        ...((t3?.externos || []).filter(b => Number(b.qtdVendida || 0) > 0).map(b => ({ ...b, tipo: 'EXTERNO' })))
    ];
}

async function estornarBoloesDoFechamento(fechId) {
    if (!fechId) return 0;
    const { data, error } = await sb.rpc('estornar_vendas_bolao_fechamento', { p_fechamento_id: fechId });
    if (error) throw error;
    return Number(data || 0);
}

async function apagarSnapshotBoloesDoFechamento(fechId) {
    if (!fechId) return;
    const { error } = await sb.from('fechamento_boloes').delete().eq('fechamento_id', fechId);
    if (error) throw error;
}

async function salvarSnapshotBoloesDoFechamento(fechId, boloesVendidos) {
    if (!boloesVendidos.length) return;
    const bolRows = boloesVendidos.map(b => ({
        fechamento_id: fechId, bolao_id: b.bolao_id, tipo: b.tipo,
        modalidade: b.modalidade, concurso: b.concurso || null,
        qtd_vendida: Number(b.qtdVendida || 0), valor_cota: Number(b.valorCota || 0),
        subtotal: Number(b.subtotal || 0)
    }));
    const { error } = await sb.from('fechamento_boloes').insert(bolRows);
    if (error) throw error;
}

async function registrarVendasBoloesDoFechamento(fechId, t1, boloesVendidos) {
    if (!boloesVendidos.length) return;
    try {
        for (const b of boloesVendidos) {
            const { error } = await sb.rpc('registrar_venda_bolao', {
                p_bolao_id: Number(b.bolao_id),
                p_loteria_vendedora_id: Number(loteriaAtiva.id),
                p_usuario_id: Number(t1.funcionario_id),
                p_canal: 'FECHAMENTO', p_origem_lancamento: 'FECHAMENTO_CAIXA',
                p_qtd_vendida: Number(b.qtdVendida || 0), p_data_referencia: t1.data_ref,
                p_observacao: 'Lançado no fechamento', p_fechamento_id: fechId, p_fechamento_keyid: null
            });
            if (error) throw error;
        }
    } catch (e) {
        await estornarBoloesDoFechamento(fechId);
        await apagarSnapshotBoloesDoFechamento(fechId);
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZAR / GRAVAR — integrado com módulo CF
// ─────────────────────────────────────────────────────────────────────────────

async function finalizar() {
    if (modoAtual === 'visualizacao') {
        resetEstado();
        showStep(1);
        return;
    }

    coletarTela1();
    coletarTela2();
    coletarTela3();

    const t1 = ESTADO.tela1;
    const t2 = ESTADO.tela2;
    const t3 = ESTADO.tela3;

    const btn = $('btn-final');
    btn.disabled = true;
    let salvouComSucesso = false;

    try {
        let existeId = fechamentoOriginalId;

        if (!existeId) {
            const { data: existe, error: errExiste } = await sb
                .from('fechamentos').select('id')
                .eq('loteria_id', loteriaAtiva.id)
                .eq('usuario_id', t1.funcionario_id)
                .eq('data_ref', t1.data_ref)
                .maybeSingle();
            if (errExiste) throw errExiste;
            if (existe?.id) existeId = existe.id;
        }

        const permissao = FECHAMENTO_RULES.avaliarPermissaoGravacao({
            usuarioLogado: usuario,
            funcionarioSelecionadoId: t1.funcionario_id,
            existeFechamento: !!existeId
        });

        if (!permissao.permitido) {
            btn.disabled = false;
            alert(permissao.motivo || 'Sem permissão para gravar.');
            return;
        }

        let tokenAutorizado = null;
        if (permissao.exigeToken) {
            tokenAutorizado = await FECHAMENTO_RULES.abrirModalToken();
            if (!tokenAutorizado) { btn.disabled = false; return; }
        }

        const sobrescrever = !!permissao.sobrescrevendo;

        showGravando('Gravando fechamento de ' + t1.funcionario_nome + '...');
        setProgress(10);

        // Totais base
        const totalProd = (t2.produtos || []).reduce((a, p) => a + Number(p.sub || 0), 0);
        const totalFed  = (t2.federais || []).reduce((a, f) => a + Number(f.subtotal || 0), 0);
        const totalBol  = [...(t3.internos || []), ...(t3.externos || [])].reduce((a, b) => a + Number(b.subtotal || 0), 0);

        const totCFCredito = getCFOrThrow().getTotalCredito();

        const totDeb = Number(t1.troco_inicial || 0)
            + totalProd
            + totalFed
            + totalBol
            + Number(t1.relatorio || 0);

        const totCred = Number(t1.troco_sobra || 0)
            + Number(t1.deposito || 0)
            + Number(t1.pix_cnpj || 0)
            + Number(t1.diferenca_pix || 0)
            + Number(t1.premio_raspadinha || 0)
            + Number(t1.resgate_telesena || 0)
            + totCFCredito;
            

        const quebra = totCred - totDeb;
        const justif = $('justificativa')?.value || '';

        const payload = {
            loteria_id:         Number(loteriaAtiva.id),
            usuario_id:         Number(t1.funcionario_id),
            funcionario_nome:   t1.funcionario_nome || '',
            data_ref:           t1.data_ref,
            troco_inicial:      Number(t1.troco_inicial || 0),
            troco_sobra:        Number(t1.troco_sobra || 0),
            relatorio:          Number(t1.relatorio || 0),
            deposito:           Number(t1.deposito || 0),
            pix_cnpj:           Number(t1.pix_cnpj || 0),
            diferenca_pix:      Number(t1.diferenca_pix || 0),
            premio_raspadinha:  Number(t1.premio_raspadinha || 0),
            resgate_telesena:   Number(t1.resgate_telesena || 0),
            total_produtos:     Number(totalProd || 0),
            total_federais:     Number(totalFed || 0),
            total_boloes:       Number(totalBol || 0),
            // total_fiado mantém compatibilidade com a coluna existente
            total_fiado:        Number(totCFCredito || 0),
            total_debitos:      Number(totDeb || 0),
            total_creditos:     Number(totCred || 0),
            quebra:             Number(quebra || 0),
            justificativa:      justif || null,
            criado_por:         Number(usuario?.id || 0),
            sobrescrito_por:    tokenAutorizado?.gerado_por ? Number(tokenAutorizado.gerado_por) : null,
            updated_at:         new Date().toISOString()
        };

        let fechId = existeId;

        if (sobrescrever && existeId) {
            setProgress(20);

            const { error: errUpd } = await sb.from('fechamentos').update(payload).eq('id', existeId);
            if (errUpd) throw errUpd;

            // Estorna CF anterior do fechamento
            await getCFOrThrow().estornarDoFechamento(existeId);

            await estornarProdutosDoFechamento(existeId);
            await apagarSnapshotProdutosDoFechamento(existeId);

            await estornarBoloesDoFechamento(existeId);
            await apagarSnapshotBoloesDoFechamento(existeId);

            const { error: errDelFed } = await sb
                .from('federal_vendas').delete()
                .eq('fechamento_id', existeId).eq('canal', 'FECHAMENTO');
            if (errDelFed) throw errDelFed;
        } else {
            setProgress(30);
            const { data: authData, error: authErr } = await sb.auth.getUser();

console.log('AUTH USER', authData?.user || null);
console.log('AUTH ERROR', authErr || null);
console.log('USUARIO FRONT', usuario);
console.log('LOTERIA ATIVA', loteriaAtiva?.id);
console.log('FUNCIONARIO SELECIONADO', t1.funcionario_id);
console.log('PAYLOAD FECHAMENTO', payload);
            
            const { data: ins, error: errIns } = await sb
                .from('fechamentos').insert(payload).select('id').single();
            if (errIns) throw errIns;
            fechId = ins.id;
        }

        setProgress(55);

        const produtosVendidos = getProdutosVendidosTela2(t2);
        await salvarSnapshotProdutosDoFechamento(fechId, produtosVendidos);
        await registrarVendasProdutosDoFechamento(fechId, t1, produtosVendidos);

        setProgress(70);

        const federaisVendidas = (t2.federais || []).filter(f => Number(f.qtdVendida || 0) > 0);
        for (const f of federaisVendidas) {
            const { error } = await sb.rpc('registrar_venda_federal', {
                p_federal_id: f.federal_id, p_loteria_vendedora_id: loteriaAtiva.id,
                p_usuario_id: Number(t1.funcionario_id), p_canal: 'FECHAMENTO',
                p_qtd_vendida: Number(f.qtdVendida), p_data_referencia: t1.data_ref,
                p_desconto: 0, p_observacao: 'Lançado no fechamento', p_fechamento_id: fechId
            });
            if (error) throw error;
        }

        setProgress(82);

        const boloesVendidos = getBoloesVendidosTela3(t3);
        await salvarSnapshotBoloesDoFechamento(fechId, boloesVendidos);
        await registrarVendasBoloesDoFechamento(fechId, t1, boloesVendidos);

        setProgress(93);

        // ── Grava módulo CF (extrato clientes) ────────────────────────────
        await getCFOrThrow().gravarNoSupabase(fechId, t1);
        if (sobrescrever && tokenAutorizado?.id) {
        await FECHAMENTO_RULES.consumirTokenSobrescrita({
        tokenId: tokenAutorizado.id,
        fechamentoId: fechId
          });
        }

        
        setProgress(100);

        fechamentoOriginalId = fechId;
        modoAtual = 'edicao';
        salvouComSucesso = true;

        await Promise.allSettled([
            carregarProdutos(),
            buscarFederaisSupabase(t1.data_ref),
            carregarBoloes()
        ]);

    } catch (e) {
        console.error('Erro ao gravar fechamento:', e);
        toast('Erro ao gravar: ' + (e.message || e), false);
    } finally {
        hideGravando();
        btn.disabled = false;
        if (salvouComSucesso) abrirModalSucessoFechamento('Fechamento salvo com sucesso.');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAIS / UI
// ─────────────────────────────────────────────────────────────────────────────

function fecharModal(id) { $(id).classList.remove('show'); }
function confirmarInicio() { $('m-inicio').classList.add('show'); }
function confirmarSair()   { $('m-sair').classList.add('show'); }
function executarInicio()  { fecharModal('m-inicio'); window.SISLOT_SECURITY.irParaInicio(); }
async function executarSair() { await window.SISLOT_SECURITY.sair(); }

function showGravando(titulo) {
    $('m-grav-titulo').textContent = titulo;
    $('m-grav-sub').textContent = 'Aguarde';
    $('m-prog').style.width = '0%';
    $('m-gravando').classList.add('show');
}

function hideGravando() { $('m-gravando').classList.remove('show'); }
function setProgress(pct) { $('m-prog').style.width = pct + '%'; $('m-grav-sub').textContent = pct + '%'; }
function toast(msg, ok = true) { console.log((ok ? '[OK] ' : '[ERRO] ') + msg); }

function abrirModalSucessoFechamento(msg = 'O fechamento foi salvo com sucesso.') {
    const msgEl = $('m-sucesso-fechamento-msg');
    if (msgEl) msgEl.textContent = msg;
    $('m-sucesso-fechamento')?.classList.add('show');
}

function confirmarSucessoFechamento() {
    fecharModal('m-sucesso-fechamento');
    resetEstado();
    window.SISLOT_SECURITY.irParaInicio();
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET DE ESTADO — integrado com módulo CF
// ─────────────────────────────────────────────────────────────────────────────

function resetEstado() {
    ESTADO.tela1 = {};
    ESTADO.tela2 = { produtos: [], federais: [] };
    ESTADO.tela3 = { internos: [], externos: [] };

    lstInt = [];
    lstExt = [];
    allBoloes = [];
    federais = [];
    produtosLista = [];
    mostrarProdutosSemEstoque = false;
    fechamentoOriginalId = null;
    modoAtual = 'novo';

    [
        'relatorio', 'deposito', 'troco-ini', 'troco-sob',
        'pix-cnpj', 'pix-dif', 'premio-rasp', 'resgate-tele'
    ].forEach(id => {
        const el = $(id);
        if (el) { el.value = ''; el.classList.remove('filled', 'has-error'); }
    });

    const just = $('justificativa');
    if (just) just.value = '';
    const justCnt = $('just-cnt');
    if (justCnt) justCnt.textContent = '0';

    if (FECHAMENTO_RULES.podeSelecionarFuncionario(usuario)) {
        $('funcionario').value = '';
        $('funcionario').classList.remove('filled');
    }

    const dataRef = $('data-ref');
    if (dataRef) {
        dataRef.value = new Date().toISOString().slice(0, 10);
        dataRef.classList.add('filled');
    }

    // ── Reset do módulo CF (substitui o bloco antigo de dívidas) ──────────
    if (window.CF) {
    window.CF.reset();
}

    const filtroTipo = $('prod-filtro-tipo');
    if (filtroTipo) filtroTipo.value = '';
    const toggleTodos = $('toggle-produtos-todos');
    if (toggleTodos) toggleTodos.checked = false;

    const prodGrid = $('produtos-grid');
    if (prodGrid) prodGrid.innerHTML = '';
    const fedBody = $('fed-tbody');
    if (fedBody) fedBody.innerHTML = '';
    const boloesWrap = $('boloes-wrap');
    if (boloesWrap) boloesWrap.innerHTML = '';
    const vendasItems = $('vendas-items');
    if (vendasItems) vendasItems.innerHTML = '';
    const vendasReg = $('vendas-registradas');
    if (vendasReg) vendasReg.classList.remove('show');

    const banner = $('modo-banner');
    if (banner) { banner.className = 'modo-banner'; banner.innerHTML = ''; }

    const btnFinal = $('btn-final');
    if (btnFinal) btnFinal.disabled = false;
    const btnFinalTxt = $('btn-final-txt');
    if (btnFinalTxt) btnFinalTxt.textContent = 'Finalizar Fechamento';

    renderProdutos();
    renderFed();
    updBolTotais();
    updT2Geral();

    setFS('fs-inicial');
    setB3('b3-inicial');
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
