'use strict';

/**
 * SISLOT — Módulo Área do Cliente (CF)
 * Integrado ao fechamento-caixa.js
 *
 * Fluxo de dados:
 *  • Bolões   → getBoloes()   → allBoloes
 *  • Federais → getFederais() → federais
 *  • Produtos → getProdutos() → produtosLista
 *  • Conta    → lançamento 100% manual
 *
 * Tabelas Supabase:
 *  • cliente_fechamento_cadastro
 *  • cliente_fechamento_extrato
 *  • cliente_fechamento_itens
 */
const TB_CLIENTES = 'cliente_fechamento_cadastro';
const TB_EXTRATO  = 'cliente_fechamento_extrato';
const TB_ITENS    = 'cliente_fechamento_itens';

window.CF = (() => {
    // ─────────────────────────────────────────────────────────────────────
    // DEPENDÊNCIAS INJETADAS
    // ─────────────────────────────────────────────────────────────────────
    let _sb, _getLoteriaAtiva, _getUsuario, _getEstado;
    let _getBoloes   = () => window.allBoloes     || [];
    let _getFederais = () => window.federais      || [];
    let _getProdutos = () => window.produtosLista || [];
    let _fmtBRL  = v  => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
    let _fmtData = s  => { if (!s) return '—'; const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };

    // ─────────────────────────────────────────────────────────────────────
    // ESTADO PRIVADO
    // ─────────────────────────────────────────────────────────────────────
    let _clientes            = [];      // lista completa carregada do banco
    let _clienteAtual        = null;    // cliente selecionado na sessão
    let _carrinho            = [];      // itens a confirmar como débito
    let _pickerTipo          = null;    // tipo sendo escolhido no picker
    let _pickerMap           = {};      // mapa id→item para onclicks seguros
    let _boloesDisponiveisCF = [];      // mapa dos boloes disponiveis
    const $ = id => document.getElementById(id);

    // ─────────────────────────────────────────────────────────────────────
    // HELPER ESTADO (usa ESTADO.tela1.clienteFechamento)
    // ─────────────────────────────────────────────────────────────────────
    function _getCF() {
        const e = _getEstado();
        if (!e.tela1) e.tela1 = {};
        if (!e.tela1.clienteFechamento) {
            e.tela1.clienteFechamento = { clienteSelecionado: null, lancamentos: [] };
        }
        return e.tela1.clienteFechamento;
    }
    function _getLancamentos()  { return _getCF().lancamentos || []; }
    function _uid()             { return '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    // ─────────────────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────────────────
    function init(opts) {
        _sb              = opts.sb;
        _getLoteriaAtiva = opts.getLoteriaAtiva;
        _getUsuario      = opts.getUsuario;
        _getEstado       = opts.getEstado;
        if (opts.fmtBRL)      _fmtBRL      = opts.fmtBRL;
        if (opts.fmtData)     _fmtData     = opts.fmtData;
        if (opts.getBoloes)   _getBoloes   = opts.getBoloes;
        if (opts.getFederais) _getFederais = opts.getFederais;
        if (opts.getProdutos) _getProdutos = opts.getProdutos;

        $('btn-abrir-area-cliente')?.addEventListener('click', openModal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ABRIR / FECHAR MODAL
    // ─────────────────────────────────────────────────────────────────────
    async function openModal() {
        $('m-area-cliente')?.classList.add('show');
        _switchView('lista');
        _syncNav('lista');
        await _carregarClientes();
        _renderResumoSessao();
        _renderLancamentosSessao();
    }

    function closeModal() {
        $('m-area-cliente')?.classList.remove('show');
    }

    // ─────────────────────────────────────────────────────────────────────
    // VIEWS
    // ─────────────────────────────────────────────────────────────────────
    const _VIEWS = ['lista', 'cliente', 'carrinho', 'picker', 'novo-cliente'];

    function _switchView(nome) {
        _VIEWS.forEach(v => {
            const el = $(`cf-view-${v}`);
            if (el) el.classList.remove('cf-ativo');
        });
        $(`cf-view-${nome}`)?.classList.add('cf-ativo');
    }

    function _syncNav(view) {
        ['lista', 'extrato', 'debito'].forEach(k => $(`cf-nav-${k}`)?.classList.remove('ativo'));
        const map = { lista: 'lista', cliente: 'extrato', carrinho: 'debito', picker: 'debito' };
        const key = map[view];
        if (key) $(`cf-nav-${key}`)?.classList.add('ativo');
    }

    // ─────────────────────────────────────────────────────────────────────
    // CARREGAR CLIENTES DO BANCO
    // ─────────────────────────────────────────────────────────────────────
   async function _carregarClientes() {
    const wrap = $('cf-clientes-lista');
    if (!wrap) return;

    wrap.innerHTML = `<div class="cf-empty"><div class="spinner" style="margin-bottom:8px"></div><div>Carregando clientes...</div></div>`;

    try {
        const { data, error } = await _sb
            .from(TB_CLIENTES)
            .select('id, nome, telefone, documento, observacao, ativo')
            .eq('loteria_id', Number(_getLoteriaAtiva().id))
            .eq('ativo', true)
            .order('nome', { ascending: true });

        if (error) throw error;

        _clientes = data || [];
        _renderClientes(_clientes);

        const totalEl = $('cf-total-clientes');
        if (totalEl) totalEl.textContent = _clientes.length;
    } catch (e) {
        console.error('CF: erro ao carregar clientes:', e);
        wrap.innerHTML = `
            <div class="cf-empty">
                <div class="cf-empty-icon">⚠</div>
                <div>Erro ao carregar clientes</div>
                <small>${e.message || e}</small>
            </div>`;
    }
}
    function _iniciais(nome) {
        return (nome || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    }

    function _renderClientes(lista) {
    const wrap = $('cf-clientes-lista');
    if (!wrap) return;

    if (!lista.length) {
        wrap.innerHTML = `
            <div class="cf-empty">
                <div class="cf-empty-icon">👥</div>
                <div>Nenhum cliente encontrado</div>
                <small>Clique em "+ Novo" para cadastrar o primeiro</small>
            </div>`;
        return;
    }

    wrap.innerHTML = lista.map((c, i) => `
        <div class="cf-cliente-card"
             style="animation-delay:${i * 0.03}s"
             onclick="CF._selecionarClienteById('${c.id}')">
            <div class="cf-mini-avatar">${_iniciais(c.nome)}</div>
            <div class="cf-cli-info">
                <div class="cf-cli-nome">${c.nome}</div>
                <div class="cf-cli-tel">${c.telefone || c.documento || '—'}</div>
            </div>
            <div class="cf-cli-saldo">
                <span class="cf-badge-ok">cliente</span>
            </div>
            <svg class="cf-card-arrow" width="13" height="13" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
        </div>
    `).join('');
}

    function filtrarClientes() {
        const q = ($('cf-busca-cliente')?.value || '').toLowerCase().trim();
        if (!q) { _renderClientes(_clientes); return; }
        _renderClientes(_clientes.filter(c =>
            (c.nome     || '').toLowerCase().includes(q) ||
            (c.telefone || '').includes(q)               ||
            (c.documento|| '').includes(q)
        ));
    }

    // ─────────────────────────────────────────────────────────────────────
    // SELECIONAR CLIENTE
    // ─────────────────────────────────────────────────────────────────────
    function _selecionarClienteById(id) {
    const cli = _clientes.find(c => String(c.id) === String(id));
    if (!cli) return;
    selecionarCliente(cli);
}

    function selecionarCliente(cli) {
        _clienteAtual       = cli;
        window._cfClienteAtual = cli;
     _getCF().clienteSelecionado = {
    id: cli.id,
    nome: cli.nome || '',
    telefone: cli.telefone || '',
    documento: cli.documento || '',
    observacao: cli.observacao || ''
};

        // ── Atualiza sidebar ───────────────────────────────────────────
        const ini = _iniciais(cli.nome);
        const av  = $('cf-avatar-iniciais');
        if (av) av.textContent = ini;

        const sbNome = $('cf-sb-nome');
        if (sbNome) sbNome.textContent = cli.nome;

        const sbTel = $('cf-sb-tel');
        if (sbTel) sbTel.textContent = cli.telefone || cli.documento || '—';

        const saldo    = _saldoClienteAtual();
        const sbStatus = $('cf-sb-status');
        if (sbStatus) {
            sbStatus.textContent = saldo > 0 ? 'devendo' : 'em dia';
            sbStatus.className   = 'cf-status-dot ' + (saldo > 0 ? 'devendo' : 'ativo');
        }
        _atualizarSaldoSidebar();

        // ── Preenche header da view cliente ────────────────────────────
        const ch = $('cf-cliente-header');
        if (ch) ch.innerHTML = `
            <div class="cf-cli-nome-lg">${cli.nome}</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);margin-top:2px">
                ${cli.telefone || cli.documento || '—'}
            </div>`;

        const sp = $('cf-saldo-pendente');
if (sp) {
    if (saldo > 0) {
        const qtdLan = _lancamentosDoCliente().length;
        sp.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <polyline points="19 12 12 19 5 12"/>
            </svg>
            Devendo ${_fmtBRL(saldo)}
            ${qtdLan > 0 ? `· ${qtdLan} lançamento${qtdLan > 1 ? 's' : ''} nesta sessão` : ''}
        `;
    } else {
        sp.innerHTML = `<span style="color:var(--accent)">✓ Sem pendências</span>`;
    }
}

        _renderExtrato();
        _switchView('cliente');
        _syncNav('cliente');
    }

    function _saldoClienteAtual() {
    if (!_clienteAtual) return 0;
    return _lancamentosDoCliente().reduce((a, l) => a + Number(l.valor || 0), 0);
}

    function _lancamentosDoCliente() {
    if (!_clienteAtual) return [];
    return _getLancamentos().filter(l => String(l.cliente_id) === String(_clienteAtual.id));
}


    function _atualizarSaldoSidebar() {
        const saldo  = _saldoClienteAtual();
        const val    = $('cf-saldo-sb-val');
        const sub    = $('cf-saldo-sb-sub');
        const box    = $('cf-saldo-sb');
        if (val) {
            val.textContent = _fmtBRL(saldo);
            val.className   = 'cf-saldo-sb-val' + (saldo === 0 ? ' zerado' : '');
        }
        if (sub) sub.textContent = saldo > 0
            ? `${_lancamentosDoCliente().length} lançamento(s) nesta sessão`
            : 'Sem pendências';
        if (box) {
            box.style.borderColor = saldo > 0
                ? 'rgba(245,166,35,0.2)'
                : 'rgba(0,200,150,0.15)';
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // EXTRATO DA SESSÃO
    // ─────────────────────────────────────────────────────────────────────
    function _renderExtrato() {
    const wrap = $('cf-extrato-sessao');
    if (!wrap) return;

    const lans = _lancamentosDoCliente();

    if (!lans.length) {
        wrap.innerHTML = `<div class="cf-extrato-vazio">Nenhum lançamento nesta sessão</div>`;
        return;
    }

    const esc = v => String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    function renderItemExtrato(it, idx, lancId) {
        const tipo = String(it.tipo || '').toUpperCase();
        const qtd = Number(it.qtd || 1);
        const valor = Number(it.valor || 0);
        const valorUnit = Number(it.valorUnit || (qtd ? valor / qtd : 0) || 0);

        if (tipo === 'BOLAO') {
            const codigoExibicao = it.codigoLoterico || it.origemCodigo || '';
            const origemLabel = (it.origemNome || it.loteriaNome)
                ? `${esc(it.origemNome || it.loteriaNome)}${codigoExibicao ? ' · ' + esc(codigoExibicao) : ''}`
                : '';

            return `
                <div class="cf-extrato-item-card cf-extrato-item-bolao">
                    <div class="cf-extrato-item-top">
                        <div class="cf-extrato-item-tags">
                            <span class="cf-tipo-badge bolao">Bolão</span>
                            ${origemLabel ? `<span class="cf-bolao-tag cf-bolao-tag-loja">${origemLabel}</span>` : ''}
                        </div>
                        <button type="button"
                                class="cf-btn-mini-rm"
                                title="Remover item"
                                onclick="CF._rmItemLancado('${lancId}', ${idx})">
                            ✕
                        </button>
                    </div>

                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <div class="cf-extrato-item-title">${esc(it.modalidade || 'Bolão')}</div>
                        <span class="cf-bolao-tag cf-bolao-tag-conc">#${esc(it.concurso || '—')}</span>
                    </div>

                    <div class="cf-bolao-card-tags" style="margin-top:8px">
                        <span class="cf-bolao-chip">${it.qtdJogos || 0} jogos</span>
                        <span class="cf-bolao-chip">${it.qtdDezenas || 0} dez.</span>
                        <span class="cf-bolao-chip">qtd ${qtd}</span>
                        <span class="cf-bolao-chip">${_fmtBRL(valorUnit)}/cota</span>
                    </div>

                    <div class="cf-extrato-item-total-row">
                        <span class="cf-extrato-item-total-label">Total</span>
                        <span class="cf-extrato-item-total-val">${_fmtBRL(valor)}</span>
                    </div>
                </div>
            `;
        }

        if (tipo === 'FEDERAL') {
            return `
                <div class="cf-extrato-item-card">
                    <div class="cf-extrato-item-top">
                        <div class="cf-extrato-item-tags">
                            <span class="cf-tipo-badge federal">Federal</span>
                            <span class="cf-bolao-chip">${esc(it.modalidade || 'Federal')}</span>
                            <span class="cf-bolao-chip">conc. ${esc(it.concurso || '—')}</span>
                            <span class="cf-bolao-chip">qtd ${qtd}</span>
                        </div>
                        <button type="button"
                                class="cf-btn-mini-rm"
                                title="Remover item"
                                onclick="CF._rmItemLancado('${lancId}', ${idx})">
                            ✕
                        </button>
                    </div>

                    <div class="cf-extrato-item-title">${esc(it.descricao || 'Federal')}</div>

                    <div class="cf-extrato-item-total-row">
                        <span class="cf-extrato-item-total-label">${_fmtBRL(valorUnit)} / unidade</span>
                        <span class="cf-extrato-item-total-val">${_fmtBRL(valor)}</span>
                    </div>
                </div>
            `;
        }

        if (tipo === 'PRODUTO' || tipo === 'RASPADINHA' || tipo === 'TELESENA') {
            const nomeTipo =
                tipo === 'RASPADINHA' ? 'Raspadinha' :
                tipo === 'TELESENA'   ? 'Tele Sena'  :
                'Produto';

            return `
                <div class="cf-extrato-item-card">
                    <div class="cf-extrato-item-top">
                        <div class="cf-extrato-item-tags">
                            <span class="cf-tipo-badge produto">${nomeTipo}</span>
                            <span class="cf-bolao-chip">qtd ${qtd}</span>
                        </div>
                        <button type="button"
                                class="cf-btn-mini-rm"
                                title="Remover item"
                                onclick="CF._rmItemLancado('${lancId}', ${idx})">
                            ✕
                        </button>
                    </div>

                    <div class="cf-extrato-item-title">${esc(it.descricao || 'Produto')}</div>

                    <div class="cf-extrato-item-total-row">
                        <span class="cf-extrato-item-total-label">${_fmtBRL(valorUnit)} / unidade</span>
                        <span class="cf-extrato-item-total-val">${_fmtBRL(valor)}</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="cf-extrato-item-card">
                <div class="cf-extrato-item-top">
                    <div class="cf-extrato-item-tags">
                        <span class="cf-tipo-badge conta">Conta</span>
                    </div>
                    <button type="button"
                            class="cf-btn-mini-rm"
                            title="Remover item"
                            onclick="CF._rmItemLancado('${lancId}', ${idx})">
                        ✕
                    </button>
                </div>

                <div class="cf-extrato-item-title">${esc(it.descricao || 'Lançamento')}</div>

                <div class="cf-extrato-item-total-row">
                    <span class="cf-extrato-item-total-label">Total</span>
                    <span class="cf-extrato-item-total-val">${_fmtBRL(valor)}</span>
                </div>
            </div>
        `;
    }

    wrap.innerHTML = lans.map((l, i) => {
        const itensHtml = (l.itens || []).map((it, idx) => renderItemExtrato(it, idx, l.id)).join('');

        return `
            <div class="cf-extrato-linha cf-extrato-deb" style="animation-delay:${i * 0.04}s">
                <div class="cf-extrato-top">
                    <div class="cf-extrato-tipo">Débito</div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div class="v-neg">−${_fmtBRL(l.valor)}</div>
                        <button type="button"
                                class="cf-btn-mini-rm"
                                title="Remover lançamento"
                                onclick="CF._rmLancamento('${l.id}')">
                            ✕
                        </button>
                    </div>
                </div>

                ${itensHtml ? `<div class="cf-extrato-itens-cards">${itensHtml}</div>` : ''}

                <div class="cf-extrato-bottom">
                    <span class="cf-forma">FIADO</span>
                    <span class="cf-obs">${l.observacao || 'sem observação'}</span>
                </div>
            </div>`;
    }).join('');
}

    // ── Nav extrato (botão sidebar) ────────────────────────────────────
    function _navExtrato() {
        if (_clienteAtual) {
            _renderExtrato();
            _switchView('cliente');
            _syncNav('cliente');
        } else {
            _switchView('lista');
            _syncNav('lista');
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // RESUMO SESSÃO (view lista)
    // ─────────────────────────────────────────────────────────────────────
    function _renderResumoSessao() {
        const box   = $('cf-resumo-sessao');
        const inner = $('cf-resumo-sessao-inner');
        if (!box || !inner) return;

        const total = getTotalCredito();
        const count = _getLancamentos().length;
        if (!count) { box.classList.remove('show'); return; }

        box.classList.add('show');
        inner.innerHTML = `
            <div class="cf-resumo-linha">
                <span>Total desta sessão</span>
                <strong style="color:var(--accent)">${_fmtBRL(total)}</strong>
            </div>
            <div class="cf-resumo-linha">
                <span>Lançamentos</span>
                <span style="color:var(--muted)">${count}</span>
            </div>`;
    }

    function _renderLancamentosSessao() {
    const wrap = $('cf-lista-lancamentos');
    if (!wrap) return;
    const lans = _getLancamentos();
    if (!lans.length) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = lans.map(l => {
        const cli = _clientes.find(c => String(c.id) === String(l.cliente_id));
        return `
            <div class="cf-lanc-row">
                <div class="cf-lanc-esq">
                    <span class="cf-lanc-cli">${cli?.nome || '—'}</span>
                    <span class="cf-lanc-forma">FIADO</span>
                </div>
                <span class="cf-val-neg">−${_fmtBRL(l.valor)}</span>
            </div>`;
    }).join('');
}

    function _atualizarBadge() {
        const badge = $('cf-badge-lancamentos');
        const count = _getLancamentos().length;
        if (badge) badge.textContent = count === 0
            ? '0 lançamentos'
            : `${count} lançamento${count > 1 ? 's' : ''}`;
    }
    function _escHtml(v) {
        return String(v ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    async function _buscarBoloesDisponiveisCF() {
        const dataRef = $('data-ref')?.value || '';
        if (!dataRef) {
            throw new Error('Preencha a data do fechamento antes de buscar bolões.');
        }

        const { data, error } = await _sb.rpc('fn_boloes_disponiveis_loja', {
            p_loteria_id: Number(_getLoteriaAtiva().id),
            p_data_ref: dataRef
        });

        if (error) throw error;

        _boloesDisponiveisCF = (data || []).map(row => ({
            tipo: 'BOLAO',

            descricao: `${row.modalidade} — Concurso ${row.concurso}`,
            sub: `${row.tipo_perspectiva || (row.eh_origem ? 'INTERNO' : 'EXTERNO')} · Saldo: ${Number(row.saldo_real || 0)} cota${Number(row.saldo_real || 0) !== 1 ? 's' : ''}`,

            valorUnit: Number(row.valor_cota || 0),
            saldo: Number(row.saldo_real || 0),

            bolao_id: row.bolao_id,
            modalidade: row.modalidade || null,
            concurso: row.concurso || null,
            qtdJogos: Number(row.qtd_jogos || 0) || null,
            qtdDezenas: Number(row.qtd_dezenas || 0) || null,

            qtdCotasPosicao: Number(row.qtd_cotas_posicao || 0),
            qtdVendidaLoja: Number(row.qtd_vendida_loja || 0),

            tipoPerspectiva: row.tipo_perspectiva || (row.eh_origem ? 'INTERNO' : 'EXTERNO'),

            loteria_id: row.loteria_id || null,
            loteriaNome: row.loteria_nome || '—',
            loteriaSlug: row.loteria_slug || '',

            origemNome: row.loteria_origem_nome || row.loteria_nome || '—',
            origemSlug: row.loteria_origem_slug || '',
            origemCodigo: row.loteria_origem_codigo || '',
            codigoLoterico: row.codigo_loterico || '',

            federal_id: null,
            raspadinha_id: null,
            telesena_item_id: null
        }));
    }

    function _renderCardBolaoCF(item, key) {
        const codigoExibicao = item.codigoLoterico || item.origemCodigo || '';

        return `
            <div class="cf-bolao-card" onclick="CF._escolherItem('${key}')">
                <div class="cf-bolao-card-main">
                    <div class="cf-bolao-card-head">
                        <span class="cf-bolao-mod">${_escHtml(item.modalidade)}</span>
                        <span class="cf-bolao-tag cf-bolao-tag-conc">#${_escHtml(item.concurso)}</span>
                        <span class="cf-bolao-tag cf-bolao-tag-loja">
                            ${_escHtml(item.origemNome)}${codigoExibicao ? ' · ' + _escHtml(codigoExibicao) : ''}
                        </span>
                        <span class="cf-bolao-tag cf-bolao-tag-tipo">${_escHtml(item.tipoPerspectiva)}</span>
                        <span class="cf-bolao-tag cf-bolao-tag-val">${_fmtBRL(item.valorUnit)}/cota</span>
                    </div>

                    <div class="cf-bolao-card-tags">
                        <span class="cf-bolao-chip">${item.qtdJogos || 0} jogos</span>
                        <span class="cf-bolao-chip">${item.qtdDezenas || 0} dez.</span>
                        <span class="cf-bolao-chip">posição ${item.qtdCotasPosicao}</span>
                        <span class="cf-bolao-chip">vendidas ${item.qtdVendidaLoja}</span>
                        <span class="cf-bolao-chip cf-bolao-chip-saldo">saldo ${item.saldo}</span>
                    </div>
                </div>

                <div class="cf-bolao-card-side">
                    <div class="cf-bolao-price">${_fmtBRL(item.valorUnit)}</div>
                    <div class="cf-bolao-price-sub">por cota</div>
                </div>
            </div>
        `;
    }

    function _renderPicker() {
        const titulo = $('cf-picker-titulo');
        const wrap   = $('cf-picker-lista');
        const busca  = $('cf-picker-busca');

        if (!wrap) return;
        if (busca) busca.value = '';

        _pickerMap = {};

        const labels = {
            BOLAO: 'Bolões disponíveis',
            FEDERAL: 'Federais disponíveis',
            PRODUTO: 'Produtos disponíveis'
        };

        if (titulo) titulo.textContent = labels[_pickerTipo] || _pickerTipo;

        let lista = [];

        if (_pickerTipo === 'BOLAO') {
            lista = (_boloesDisponiveisCF || []).filter(b => Number(b.saldo || 0) > 0);
        }

        if (_pickerTipo === 'FEDERAL') {
            lista = _getFederais()
                .filter(f => Number(f.saldo_editavel ?? f.saldo_atual ?? 0) > 0)
                .map(f => {
                    const saldo = Number(f.saldo_editavel ?? f.saldo_atual ?? 0);
                    return {
                        tipo: 'FEDERAL',
                        descricao: `${f.modalidade} — Concurso ${f.concurso}`,
                        sub: `Sorteio ${_fmtData(f.dtSorteio)} · Saldo: ${saldo} fração${saldo !== 1 ? 'ões' : ''}`,
                        valorUnit: Number(f.valorUnit || 0),
                        saldo,

                        bolao_id: null,
                        federal_id: f.federal_id,
                        raspadinha_id: null,
                        telesena_item_id: null,

                        modalidade: f.modalidade || null,
                        concurso: f.concurso || null,
                        qtdJogos: null,
                        qtdDezenas: null
                    };
                });
        }

        if (_pickerTipo === 'PRODUTO') {
            lista = _getProdutos()
                .filter(p => Number(p.saldo_editavel ?? p.saldo_atual ?? 0) > 0)
                .map(p => {
                    const saldo = Number(p.saldo_editavel ?? p.saldo_atual ?? 0);
                    const tipoProd = p.produto === 'RASPADINHA' ? 'Raspadinha' : 'Tele Sena';
                    return {
                        tipo: 'PRODUTO',
                        descricao: p.item_nome || 'Produto',
                        sub: `${tipoProd} · Saldo: ${saldo} unidade${saldo !== 1 ? 's' : ''}`,
                        valorUnit: Number(p.valor_venda || 0),
                        saldo,
                        bolao_id: null,
                        federal_id: null,
                        raspadinha_id: p.raspadinha_id || null,
                        telesena_item_id: p.telesena_item_id || null
                    };
                });
        }

        if (!lista.length) {
            wrap.innerHTML = `
                <div class="cf-empty">
                    <div class="cf-empty-icon">📭</div>
                    <div>Nenhum item com saldo disponível</div>
                    <small>Verifique o estoque ou a data selecionada</small>
                </div>`;
            return;
        }

        lista.forEach((item, i) => {
            const key = 'p' + i;
            _pickerMap[key] = item;
        });

        wrap.innerHTML = lista.map((item, i) => {
            const key = 'p' + i;

            if (item.tipo === 'BOLAO') {
                return _renderCardBolaoCF(item, key);
            }

            return `
                <div class="cf-picker-item" onclick="CF._escolherItem('${key}')">
                    <div style="flex:1;min-width:0">
                        <div style="font-size:13px;font-weight:600;color:var(--bright);margin-bottom:3px;
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                            ${item.descricao}
                        </div>
                        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)">
                            ${item.sub}
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;margin-left:12px">
                        <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;
                                    color:var(--accent)">${_fmtBRL(item.valorUnit)}</div>
                        <div style="font-size:9px;color:var(--dim);margin-top:2px;font-family:'IBM Plex Mono',monospace">
                            por unidade
                        </div>
                    </div>
                </div>`;
        }).join('');
    }

    function _filtrarPicker() {
        const q = ($('cf-picker-busca')?.value || '').toLowerCase();
        const items = document.querySelectorAll('.cf-picker-item, .cf-bolao-card');
        items.forEach(el => {
            el.style.display = (q && !el.textContent.toLowerCase().includes(q)) ? 'none' : '';
        });
    }

    function _escolherItem(key) {
        const item = _pickerMap[key];
        if (!item) return;

        _carrinho.push({ id: _uid(), qtd: 1, ...item });
        _renderCarrinho();
        _switchView('carrinho');
        _syncNav('carrinho');
    }

    // ─────────────────────────────────────────────────────────────────────
    // CARRINHO
    // ─────────────────────────────────────────────────────────────────────
    function abrirCarrinho() {
        _carrinho = [];
        if ($('cf-obs-debito')) $('cf-obs-debito').value = '';
        _renderCarrinho();
        _switchView('carrinho');
        _syncNav('carrinho');
    }

    async function adicionarItemCarrinho(tipo) {
        if (tipo === 'CONTA') {
            _carrinho.push({ id: _uid(), tipo: 'CONTA', descricao: '', valor: 0 });
            _renderCarrinho();
            return;
        }

        if (tipo === 'BOLAO') {
            try {
                await _buscarBoloesDisponiveisCF();
            } catch (e) {
                alert(e.message || e);
                return;
            }

            _pickerTipo = tipo;
            _renderPicker();
            _switchView('picker');
            _syncNav('carrinho');
            return;
        }

        if (tipo === 'FEDERAL' && !_getFederais().length) {
            if (typeof window.buscarFederais === 'function') {
                await window.buscarFederais();
            }
        }

        if (tipo === 'PRODUTO' && !_getProdutos().length) {
            if (typeof window.carregarProdutos === 'function') {
                await window.carregarProdutos();
            }
        }

        _pickerTipo = tipo;
        _renderPicker();
        _switchView('picker');
        _syncNav('carrinho');
    }

    function _renderCarrinho() {
        const wrap = $('cf-carrinho-itens');
        const btn  = $('cf-btn-confirmar-debito');
        if (!wrap) return;

        if (!_carrinho.length) {
            wrap.innerHTML = `
                <div class="cf-empty" style="padding:24px">
                    <div class="cf-empty-icon">🛒</div>
                    <div style="font-size:12px;color:var(--muted)">Carrinho vazio</div>
                    <small>Use os botões acima para adicionar itens</small>
                </div>`;
            _updTotalCarrinho();
            if (btn) btn.disabled = true;
            return;
        }

        wrap.innerHTML = _carrinho.map((item, i) => _buildItemHTML(item, i)).join('');
        _updTotalCarrinho();
        if (btn) btn.disabled = _calcTotal() <= 0;
    }

    function _buildItemHTML(item, idx) {
        const corMap = {
            BOLAO:   { label: 'Bolão',   cls: 'bolao'   },
            FEDERAL: { label: 'Federal', cls: 'federal' },
            PRODUTO: { label: 'Produto', cls: 'produto' },
            CONTA:   { label: 'Conta',   cls: 'conta'   },
        };
        const t = corMap[item.tipo] || { label: item.tipo, cls: 'conta' };

        if (item.tipo === 'CONTA') {
            return `
                <div class="cf-carrinho-item" style="animation-delay:${idx * 0.05}s">
                    <div class="cf-item-head">
                        <span class="cf-tipo-badge ${t.cls}">${t.label}</span>
                        <button class="cf-btn-rm-item" onclick="CF._rmItem('${item.id}')">✕</button>
                    </div>
                    <div class="cf-item-campos">
                        <div class="cf-campo" style="grid-column:1/-1">
                            <div class="cf-campo-label">Descrição do lançamento</div>
                            <input class="cf-inp" type="text"
                                   placeholder="Ex: Bolsa, Recarga, Empréstimo..."
                                   value="${item.descricao || ''}"
                                   oninput="CF._updConta('${item.id}', 'descricao', this.value)">
                        </div>
                        <div class="cf-campo">
                            <div class="cf-campo-label">Valor (R$)</div>
                            <input class="cf-inp" type="number" step="0.01" min="0" placeholder="0,00"
                                   value="${item.valor > 0 ? item.valor : ''}"
                                   oninput="CF._updConta('${item.id}', 'valor', parseFloat(this.value) || 0)">
                        </div>
                    </div>
                    <div class="cf-item-subtotal" id="cf-sub-${item.id}">
                        Subtotal: <strong>${_fmtBRL(item.valor || 0)}</strong>
                    </div>
                </div>`;
        }

        const valUnit = Number(item.valorUnit || 0);
        const qtd = Number(item.qtd || 1);
        const sub = qtd * valUnit;

        if (item.tipo === 'BOLAO') {
            const codigoExibicao = item.codigoLoterico || item.origemCodigo || '';

            return `
                <div class="cf-carrinho-item cf-carrinho-item-bolao" style="animation-delay:${idx * 0.05}s">
                    <div class="cf-item-head">
                        <span class="cf-tipo-badge ${t.cls}">${t.label}</span>
                        <button class="cf-btn-rm-item" onclick="CF._rmItem('${item.id}')">✕</button>
                    </div>

                    <div class="cf-bolao-cart-head">
                        <div class="cf-bolao-cart-main">
                            <div class="cf-bolao-cart-title-row">
                                <span class="cf-bolao-cart-title">${item.modalidade || item.descricao || 'Bolão'}</span>
                                <span class="cf-bolao-tag cf-bolao-tag-conc">#${item.concurso || '—'}</span>
                                <span class="cf-bolao-tag cf-bolao-tag-loja">
                                    ${(item.origemNome || item.loteriaNome || '—')}${codigoExibicao ? ' · ' + codigoExibicao : ''}
                                </span>
                                <span class="cf-bolao-tag cf-bolao-tag-tipo">${item.tipoPerspectiva || 'BOLÃO'}</span>
                            </div>

                            <div class="cf-bolao-card-tags" style="margin-top:8px">
                                <span class="cf-bolao-chip">${item.qtdJogos || 0} jogos</span>
                                <span class="cf-bolao-chip">${item.qtdDezenas || 0} dez.</span>
                                <span class="cf-bolao-chip">posição ${item.qtdCotasPosicao ?? '—'}</span>
                                <span class="cf-bolao-chip">vendidas ${item.qtdVendidaLoja ?? '—'}</span>
                                <span class="cf-bolao-chip cf-bolao-chip-saldo">saldo ${item.saldo ?? '—'}</span>
                            </div>
                        </div>

                        <div class="cf-bolao-cart-price">
                            <div class="cf-bolao-price">${_fmtBRL(valUnit)}</div>
                            <div class="cf-bolao-price-sub">por cota</div>
                        </div>
                    </div>

                    <div class="cf-item-campos" style="margin-top:12px">
                        <div class="cf-campo">
                            <div class="cf-campo-label">Valor unitário</div>
                            <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:var(--accent);padding:8px 0">
                                ${_fmtBRL(valUnit)}
                            </div>
                        </div>

                        <div class="cf-campo">
                            <div class="cf-campo-label">Quantidade</div>
                            <input class="cf-inp" type="number" min="1" step="1" placeholder="1"
                                   value="${qtd}"
                                   oninput="CF._updQtd('${item.id}', parseInt(this.value) || 1)">
                        </div>
                    </div>

                    <div class="cf-item-subtotal" id="cf-sub-${item.id}">
                        Subtotal: <strong>${_fmtBRL(sub)}</strong>
                    </div>
                </div>`;
        }

        if (item.tipo === 'FEDERAL') {
            return `
                <div class="cf-carrinho-item" style="animation-delay:${idx * 0.05}s">
                    <div class="cf-item-head">
                        <span class="cf-tipo-badge ${t.cls}">${t.label}</span>
                        <button class="cf-btn-rm-item" onclick="CF._rmItem('${item.id}')">✕</button>
                    </div>

                    <div class="cf-bolao-card-tags" style="margin-bottom:10px">
                        <span class="cf-bolao-chip">${item.modalidade || 'Federal'}</span>
                        <span class="cf-bolao-chip">concurso ${item.concurso || '—'}</span>
                        <span class="cf-bolao-chip cf-bolao-chip-saldo">saldo ${item.saldo ?? '—'}</span>
                    </div>

                    <div style="font-size:12px;font-weight:600;color:var(--bright);margin-bottom:10px;line-height:1.3">
                        ${item.descricao}
                    </div>

                    <div class="cf-item-campos">
                        <div class="cf-campo">
                            <div class="cf-campo-label">Valor unitário</div>
                            <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:var(--accent);padding:8px 0">
                                ${_fmtBRL(valUnit)}
                            </div>
                        </div>

                        <div class="cf-campo">
                            <div class="cf-campo-label">Quantidade</div>
                            <input class="cf-inp" type="number" min="1" step="1" placeholder="1"
                                   value="${qtd}"
                                   oninput="CF._updQtd('${item.id}', parseInt(this.value) || 1)">
                        </div>
                    </div>

                    <div class="cf-item-subtotal" id="cf-sub-${item.id}">
                        Subtotal: <strong>${_fmtBRL(sub)}</strong>
                    </div>
                </div>`;
        }

        if (item.tipo === 'PRODUTO') {
            return `
                <div class="cf-carrinho-item" style="animation-delay:${idx * 0.05}s">
                    <div class="cf-item-head">
                        <span class="cf-tipo-badge ${t.cls}">${t.label}</span>
                        <button class="cf-btn-rm-item" onclick="CF._rmItem('${item.id}')">✕</button>
                    </div>

                    <div class="cf-bolao-card-tags" style="margin-bottom:10px">
                        <span class="cf-bolao-chip">${item.raspadinha_id ? 'Raspadinha' : item.telesena_item_id ? 'Tele Sena' : 'Produto'}</span>
                        <span class="cf-bolao-chip cf-bolao-chip-saldo">saldo ${item.saldo ?? '—'}</span>
                    </div>

                    <div style="font-size:12px;font-weight:600;color:var(--bright);margin-bottom:10px;line-height:1.3">
                        ${item.descricao}
                    </div>

                    <div class="cf-item-campos">
                        <div class="cf-campo">
                            <div class="cf-campo-label">Valor unitário</div>
                            <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:var(--accent);padding:8px 0">
                                ${_fmtBRL(valUnit)}
                            </div>
                        </div>

                        <div class="cf-campo">
                            <div class="cf-campo-label">Quantidade</div>
                            <input class="cf-inp" type="number" min="1" step="1" placeholder="1"
                                   value="${qtd}"
                                   oninput="CF._updQtd('${item.id}', parseInt(this.value) || 1)">
                        </div>
                    </div>

                    <div class="cf-item-subtotal" id="cf-sub-${item.id}">
                        Subtotal: <strong>${_fmtBRL(sub)}</strong>
                    </div>
                </div>`;
        }

        return `
            <div class="cf-carrinho-item" style="animation-delay:${idx * 0.05}s">
                <div class="cf-item-head">
                    <span class="cf-tipo-badge ${t.cls}">${t.label}</span>
                    <button class="cf-btn-rm-item" onclick="CF._rmItem('${item.id}')">✕</button>
                </div>
                <div style="font-size:12px;font-weight:600;color:var(--bright);margin-bottom:10px;line-height:1.3">
                    ${item.descricao || 'Item'}
                </div>
                <div class="cf-item-campos">
                    <div class="cf-campo">
                        <div class="cf-campo-label">Valor unitário</div>
                        <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:600;color:var(--accent);padding:8px 0">
                            ${_fmtBRL(valUnit)}
                        </div>
                    </div>
                    <div class="cf-campo">
                        <div class="cf-campo-label">Quantidade</div>
                        <input class="cf-inp" type="number" min="1" step="1" placeholder="1"
                               value="${qtd}"
                               oninput="CF._updQtd('${item.id}', parseInt(this.value) || 1)">
                    </div>
                </div>
                <div class="cf-item-subtotal" id="cf-sub-${item.id}">
                    Subtotal: <strong>${_fmtBRL(sub)}</strong>
                </div>
            </div>`;
    }

    // ── Atualização de itens do carrinho ──────────────────────────────

    function _rmItem(id) {
        _carrinho = _carrinho.filter(i => i.id !== id);
        _renderCarrinho();
    }

    function _updConta(id, campo, valor) {
        const item = _carrinho.find(i => i.id === id);
        if (!item) return;
        item[campo] = valor;
        if (campo === 'valor') {
            const sub = $(`cf-sub-${id}`);
            if (sub) sub.innerHTML = `Subtotal: <strong>${_fmtBRL(Number(valor) || 0)}</strong>`;
        }
        _updTotalCarrinho();
        const btn = $('cf-btn-confirmar-debito');
        if (btn) btn.disabled = _calcTotal() <= 0;
    }

    function _updQtd(id, qtd) {
        const item = _carrinho.find(i => i.id === id);
        if (!item) return;
        item.qtd        = qtd;
        const valUnit   = Number(item.valorUnit || 0);
        const sub       = $(`cf-sub-${id}`);
        if (sub) sub.innerHTML = `Subtotal: <strong>${_fmtBRL(qtd * valUnit)}</strong>`;
        _updTotalCarrinho();
        const btn = $('cf-btn-confirmar-debito');
        if (btn) btn.disabled = _calcTotal() <= 0;
    }

    function _calcTotal() {
        return _carrinho.reduce((acc, item) => {
            if (item.tipo === 'CONTA') return acc + Number(item.valor || 0);
            return acc + (Number(item.qtd || 1) * Number(item.valorUnit || 0));
        }, 0);
    }

    function _updTotalCarrinho() {
        const total = _calcTotal();
        const el    = $('cf-total-carrinho');
        if (el) el.textContent = _fmtBRL(total);
        const qty = $('cf-carrinho-qtd-itens');
        if (qty) qty.textContent = `${_carrinho.length} ${_carrinho.length === 1 ? 'item' : 'itens'}`;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CONFIRMAR DÉBITO (salva apenas em ESTADO, grava no banco ao finalizar)
    // ─────────────────────────────────────────────────────────────────────
    async function confirmarDebito() {
        if (!_clienteAtual || !_carrinho.length) return;
        const total = _calcTotal();
        if (total <= 0) return;

        const btn = $('cf-btn-confirmar-debito');
        if (btn) btn.disabled = true;

        const itens = _carrinho.map(item => {
            if (item.tipo === 'CONTA') {
                return {
                    tipo:      'CONTA',
                    descricao: item.descricao || 'Conta',
                    qtd:       1,
                    valor:     Number(item.valor || 0),
                };
            }
            const valUnit = Number(item.valorUnit || 0);
            const qtd     = Number(item.qtd || 1);
           return {
    tipo:             item.tipo,
    descricao:        item.descricao,
    qtd,
    valor:            qtd * valUnit,
    valorUnit:        valUnit,

    bolao_id:         item.bolao_id || null,
    federal_id:       item.federal_id || null,
    raspadinha_id:    item.raspadinha_id || null,
    telesena_item_id: item.telesena_item_id || null,

    modalidade:       item.modalidade || null,
    concurso:         item.concurso || null,
    qtdJogos:         item.qtdJogos || null,
    qtdDezenas:       item.qtdDezenas || null,

    origemNome:       item.origemNome || null,
    origemCodigo:     item.origemCodigo || null,
    codigoLoterico:   item.codigoLoterico || null,
    tipoPerspectiva:  item.tipoPerspectiva || null,
    loteriaNome:      item.loteriaNome || null,
    qtdCotasPosicao:  item.qtdCotasPosicao ?? null,
    qtdVendidaLoja:   item.qtdVendidaLoja ?? null,
    saldo:            item.saldo ?? null
};
        });

        const obs = ($('cf-obs-debito')?.value || '').trim();

        const lancamento = {
            id:             _uid(),
            cliente_id:     _clienteAtual.id,
            tipo_movimento: 'DEBITO',
            valor:          total,
            observacao:     obs || null,
            itens,
        };

        _getCF().lancamentos.push(lancamento);

        // Limpa carrinho e obs
        _carrinho = [];
        if ($('cf-obs-debito')) $('cf-obs-debito').value = '';

        // Atualiza UI
        _atualizarBadge();
        _renderResumoSessao();
        _renderLancamentosSessao();

        // Volta para o extrato do cliente
        selecionarCliente(_clienteAtual);

        if (btn) btn.disabled = false;
    }

    // ─────────────────────────────────────────────────────────────────────
    // NOVO CADASTRO
    // ─────────────────────────────────────────────────────────────────────
    function iniciarNovoCadastro() {
        ['cf-novo-nome', 'cf-novo-tel', 'cf-novo-doc', 'cf-novo-obs'].forEach(id => {
            const el = $(id); if (el) el.value = '';
        });
        const err = $('cf-novo-err');
        if (err) { err.textContent = ''; err.style.display = 'none'; }
        _switchView('novo-cliente');
        _syncNav('lista');
    }

   async function salvarNovoCadastro() {
    const nome = ($('cf-novo-nome')?.value || '').trim();
    const err  = $('cf-novo-err');

    if (!nome) {
        if (err) {
            err.textContent = 'Nome é obrigatório.';
            err.style.display = 'block';
        }
        return;
    }

    if (err) err.style.display = 'none';

    const btn = $('cf-btn-salvar-novo');
    if (btn) btn.disabled = true;

    try {
        const payload = {
            loteria_id: Number(_getLoteriaAtiva().id),
            nome,
            telefone:   ($('cf-novo-tel')?.value || '').trim() || null,
            documento:  ($('cf-novo-doc')?.value || '').trim() || null,
            observacao: ($('cf-novo-obs')?.value || '').trim() || null,
            ativo: true
        };

        const { data, error } = await _sb
            .from(TB_CLIENTES)
            .insert(payload)
            .select('*')
            .single();

        if (error) throw error;

        _clientes.unshift(data);
        await openModal();
    } catch (e) {
        console.error('CF: erro ao salvar cliente:', e);
        if (err) {
            err.textContent = 'Erro: ' + (e.message || e);
            err.style.display = 'block';
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}
    // ─────────────────────────────────────────────────────────────────────
    // TOTAL CRÉDITO (chamado por fechamento-caixa.js)
    // ─────────────────────────────────────────────────────────────────────
    function getTotalCredito() {
        return _getLancamentos()
            .filter(l => l.tipo_movimento === 'DEBITO')
            .reduce((a, l) => a + Number(l.valor || 0), 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GRAVAR NO SUPABASE (chamado dentro de finalizar())
    // ─────────────────────────────────────────────────────────────────────
    function _mapTipoItem(item) {
    const tipo = String(item.tipo || '').toUpperCase();
    if (tipo === 'BOLAO') return 'BOLAO';
    if (tipo === 'FEDERAL') return 'FEDERAL';
    if (tipo === 'PRODUTO') {
        if (item.raspadinha_id) return 'RASPADINHA';
        if (item.telesena_item_id) return 'TELESENA';
        return 'CONTA';
    }
    return 'CONTA';
}

function _mapReferenciaId(item) {
    if (item.bolao_id) return String(item.bolao_id);
    if (item.federal_id) return String(item.federal_id);
    if (item.raspadinha_id) return String(item.raspadinha_id);
    if (item.telesena_item_id) return String(item.telesena_item_id);
    return null;
}

async function gravarNoSupabase(fechId, t1) {
  const lans = _getLancamentos();
  if (!lans.length) return;

  for (const l of lans) {
    const { data: extrato, error: errExtrato } = await _sb
      .from(TB_EXTRATO)
      .insert({
        loteria_id: Number(_getLoteriaAtiva().id),
        cliente_id: l.cliente_id,
        fechamento_id: fechId,
        usuario_id: Number(_getUsuario()?.id || null),
        tipo_movimento: l.tipo_movimento || 'DEBITO',
        forma_pagamento: 'NAO_APLICA',
        status: 'CONFIRMADO',
        valor_total: Number(l.valor || 0),
        gera_credito_fechamento: true,
        gera_abatimento_divida: false,
        gera_pix_quitacao: false,
        data_movimento: t1?.data_ref,
        observacao: l.observacao || null
      })
      .select('id')
      .single();

    if (errExtrato) throw errExtrato;

    const itensRows = cfMontarItensRows({
      extratoId: extrato.id,
      dataRef: t1?.data_ref,
      lancamentos: l.itens || []
    });

    console.log('CF ITENS INSERT', itensRows);

    if (itensRows.length) {
      const { error: errItens } = await _sb
        .from(TB_ITENS)
        .insert(itensRows);

      if (errItens) throw errItens;
    }
  }
}
    // ─────────────────────────────────────────────────────────────────────
    // ESTORNAR DO FECHAMENTO (chamado antes de sobrescrever)
    // ─────────────────────────────────────────────────────────────────────
    async function estornarDoFechamento(fechId) {
    const { data: extratos, error } = await _sb
        .from(TB_EXTRATO)
        .select('id')
        .eq('fechamento_id', fechId);

    if (error) throw error;

    const ids = (extratos || []).map(e => e.id);
    if (!ids.length) return;

    const { error: errItens } = await _sb
        .from(TB_ITENS)
        .delete()
        .in('extrato_id', ids);

    if (errItens) throw errItens;

    const { error: errExtrato } = await _sb
        .from(TB_EXTRATO)
        .delete()
        .eq('fechamento_id', fechId);

    if (errExtrato) throw errExtrato;
}
    // ─────────────────────────────────────────────────────────────────────
    // CARREGAR FECHAMENTO EXISTENTE (modo edição)
    // ─────────────────────────────────────────────────────────────────────
   async function carregarFechamentoExistente({ fechamentoId }) {
    try {
        const { data: extratos, error: errExtratos } = await _sb
            .from(TB_EXTRATO)
            .select('id, cliente_id, tipo_movimento, valor_total, observacao')
            .eq('fechamento_id', fechamentoId)
            .order('created_at', { ascending: true });

        if (errExtratos) throw errExtratos;

        const extratoIds = (extratos || []).map(e => e.id);

        let itens = [];
        if (extratoIds.length) {
            const { data: itensData, error: errItens } = await _sb
                .from(TB_ITENS)
                .select(`
                    id,
                    extrato_id,
                    tipo_origem,
                    bolao_id,
                    federal_id,
                    raspadinha_id,
                    telesena_item_id,
                    descricao,
                    valor_unitario,
                    qtd_vendida,
                    valor_total
                `)
                .in('extrato_id', extratoIds)
                .order('created_at', { ascending: true });

            if (errItens) throw errItens;
            itens = itensData || [];
        }

        const itensPorExtrato = {};
        itens.forEach(item => {
            if (!itensPorExtrato[item.extrato_id]) itensPorExtrato[item.extrato_id] = [];
            itensPorExtrato[item.extrato_id].push({
                tipo: item.tipo_origem,
                descricao: item.descricao,
                qtd: Number(item.qtd_vendida || 1),
                valorUnit: Number(item.valor_unitario || 0),
                valor: Number(item.valor_total || 0),
                bolao_id: item.bolao_id || null,
                federal_id: item.federal_id || null,
                raspadinha_id: item.raspadinha_id || null,
                telesena_item_id: item.telesena_item_id || null
            });
        });

        _getCF().lancamentos = (extratos || []).map(l => ({
            id: _uid(),
            extrato_id: l.id,
            cliente_id: l.cliente_id,
            tipo_movimento: l.tipo_movimento,
            valor: Number(l.valor_total || 0),
            observacao: l.observacao || '',
            itens: itensPorExtrato[l.id] || []
        }));

        _atualizarBadge();
    } catch (e) {
        console.warn('CF: erro ao carregar fechamento existente:', e);
    }
}
    // ─────────────────────────────────────────────────────────────────────
    // RESET (chamado quando volta ao início ou troca de loteria)
    // ─────────────────────────────────────────────────────────────────────
    function reset() {
        const cf = _getCF();
        cf.clienteSelecionado = null;
        cf.lancamentos        = [];

        _clienteAtual          = null;
        window._cfClienteAtual = null;
        _carrinho              = [];
        _clientes              = [];
        _pickerMap             = {};
        _boloesDisponiveisCF   = [];

        // Sidebar de volta ao padrão
        const av = $('cf-avatar-iniciais');
        if (av) av.textContent = '—';
        const sbNome = $('cf-sb-nome');
        if (sbNome) sbNome.textContent = 'Nenhum cliente';
        const sbTel = $('cf-sb-tel');
        if (sbTel) sbTel.textContent = '—';
        const sbStatus = $('cf-sb-status');
        if (sbStatus) { sbStatus.textContent = 'inativo'; sbStatus.className = 'cf-status-dot'; }
        const saldoVal = $('cf-saldo-sb-val');
        if (saldoVal) { saldoVal.textContent = 'R$ 0,00'; saldoVal.className = 'cf-saldo-sb-val zerado'; }
        const saldoSub = $('cf-saldo-sb-sub');
        if (saldoSub) saldoSub.textContent = 'Sem pendências';

        const box = $('cf-saldo-sb');
        if (box) box.style.borderColor = '';

        const resumo = $('cf-resumo-sessao');
        if (resumo) resumo.classList.remove('show');

        const lans = $('cf-lista-lancamentos');
        if (lans) lans.innerHTML = '';

        _atualizarBadge();
    }
    function _recalcLancamento(l) {
    const itens = Array.isArray(l.itens) ? l.itens : [];
    l.valor = itens.reduce((acc, it) => acc + Number(it.valor || 0), 0);
    return l.valor;
}
function cfResolverTipoOrigem(item) {
  const tipoBruto = String(item?.tipo_origem || item?.tipo || '')
    .trim()
    .toUpperCase();

  if (tipoBruto === 'BOLAO') return 'BOLAO';
  if (tipoBruto === 'FEDERAL') return 'FEDERAL';
  if (tipoBruto === 'CONTA') return 'CONTA';

  if (Number(item?.raspadinha_id || 0) > 0) return 'RASPADINHA';
  if (Number(item?.telesena_item_id || 0) > 0) return 'TELESENA';

  return tipoBruto;
}

function cfMontarItensRows({ extratoId, dataRef, lancamentos }) {
  const itensRows = (lancamentos || []).map((item) => {
    const tipoOrigem = cfResolverTipoOrigem(item);

    const row = {
      extrato_id: extratoId,
      tipo_origem: tipoOrigem,

      bolao_id: null,
      federal_id: null,
      raspadinha_id: null,
      telesena_item_id: null,

      data_venda: dataRef,
      descricao: item.descricao || '',
      modalidade: item.modalidade || null,
      concurso: item.concurso || null,
      produto: null,
      qtd_jogos: item.qtdJogos ? Number(item.qtdJogos) : null,
      qtd_dezenas: item.qtdDezenas ? Number(item.qtdDezenas) : null,
      valor_unitario: Number(item.valorUnit ?? item.valor ?? 0),
      qtd_vendida: Number(item.qtd || 1)
    };

    if (tipoOrigem === 'BOLAO') {
      row.bolao_id = item.bolao_id ?? null;
    } else if (tipoOrigem === 'FEDERAL') {
      row.federal_id = item.federal_id ?? null;
    } else if (tipoOrigem === 'RASPADINHA') {
      row.raspadinha_id = item.raspadinha_id ?? null;
      row.produto = 'RASPADINHA';
    } else if (tipoOrigem === 'TELESENA') {
      row.telesena_item_id = item.telesena_item_id ?? null;
      row.produto = 'TELESENA';
    } else if (tipoOrigem === 'CONTA') {
      row.modalidade = null;
      row.concurso = null;
      row.produto = null;
      row.qtd_jogos = null;
      row.qtd_dezenas = null;
    }

    console.log('CF ITEM BRUTO', item);
    console.log('CF ITEM ROW', row);

    return row;
  });

  for (const row of itensRows) {
    if (row.tipo_origem === 'BOLAO' && !row.bolao_id) {
      throw new Error(`Item BOLAO sem bolao_id: ${row.descricao || row.modalidade || 'sem descrição'}`);
    }

    if (row.tipo_origem === 'FEDERAL' && !row.federal_id) {
      throw new Error(`Item FEDERAL sem federal_id: ${row.descricao || row.modalidade || 'sem descrição'}`);
    }

    if (row.tipo_origem === 'RASPADINHA' && !row.raspadinha_id) {
      throw new Error(`Item RASPADINHA sem raspadinha_id: ${row.descricao || 'sem descrição'}`);
    }

    if (row.tipo_origem === 'TELESENA' && !row.telesena_item_id) {
      throw new Error(`Item TELESENA sem telesena_item_id: ${row.descricao || 'sem descrição'}`);
    }

    if (
      row.tipo_origem === 'CONTA' &&
      (row.bolao_id || row.federal_id || row.raspadinha_id || row.telesena_item_id)
    ) {
      throw new Error(`Item CONTA veio com ids preenchidos: ${row.descricao || 'sem descrição'}`);
    }
  }

  return itensRows;
}
function _refreshSessaoUI() {
    _atualizarBadge();
    _renderResumoSessao();
    _renderLancamentosSessao();

    if (_clienteAtual) {
        _renderExtrato();
        _atualizarSaldoSidebar();
    }
}

function _rmLancamento(lancId) {
    const cf = _getCF();
    cf.lancamentos = (cf.lancamentos || []).filter(l => l.id !== lancId);
    _refreshSessaoUI();
}

function _rmItemLancado(lancId, itemIdx) {
    const cf = _getCF();
    const lanc = (cf.lancamentos || []).find(l => l.id === lancId);
    if (!lanc) return;

    if (!Array.isArray(lanc.itens)) lanc.itens = [];
    lanc.itens.splice(itemIdx, 1);

    if (!lanc.itens.length) {
        cf.lancamentos = (cf.lancamentos || []).filter(l => l.id !== lancId);
    } else {
        _recalcLancamento(lanc);
    }

    _refreshSessaoUI();
}

    
    // ─────────────────────────────────────────────────────────────────────
    // API PÚBLICA
    // ─────────────────────────────────────────────────────────────────────
       return {
        // lifecycle
        init,
        reset,

        // modal
        openModal,
        closeModal,

        // lista
        filtrarClientes,
        selecionarCliente,
        _selecionarClienteById,

        // novo cadastro
        iniciarNovoCadastro,
        salvarNovoCadastro,

        // carrinho / picker
        abrirCarrinho,
        adicionarItemCarrinho,
        confirmarDebito,

        // handlers inline
        _rmItem,
        _updConta,
        _updQtd,
        _escolherItem,
        _filtrarPicker,
        _navExtrato,
        _rmLancamento,
        _rmItemLancado,

        // integração com fechamento-caixa.js
        getTotalCredito,
        gravarNoSupabase,
        estornarDoFechamento,
        carregarFechamentoExistente,
    };

})();
