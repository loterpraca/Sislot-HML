/**
 * SISLOT — Theme Manager
 * Centraliza a lógica de tema por lotérica.
 * Substitui o código duplicado de tema espalhado em cada módulo.
 * Versão: 3.0
 */

(function () {
  'use strict';

  // ── Mapeamento canônico das lojas ──────────────────────────
  const LOJAS = {
    'boulevard':    { nome: 'Boulevard',    slug: 'boulevard',    cor: '#3b82f6' },
    'centro':       { nome: 'Centro',       slug: 'centro',       cor: '#00c896' },
    'lotobel':      { nome: 'Lotobel',      slug: 'lotobel',      cor: '#ef4444' },
    'santa-tereza': { nome: 'Santa Tereza', slug: 'santa-tereza', cor: '#a855f7' },
    'via-brasil':   { nome: 'Via Brasil',   slug: 'via-brasil',   cor: '#eab308' },
    'todas':        { nome: 'Todas',        slug: 'todas',        cor: '#94a3b8' },
  };

  // ── Storage key ───────────────────────────────────────────
  const STORAGE_KEY = 'sislot_loja_slug';

  /**
   * Aplica o tema de uma loja no body.
   * @param {string} slug - ex: 'boulevard'
   */
  function aplicarTema(slug) {
    const loja = LOJAS[slug] || LOJAS['todas'];
    document.body.dataset.loja = loja.slug;
    sessionStorage.setItem(STORAGE_KEY, loja.slug);
    _atualizarHeaderLogo(loja);
    _atualizarHeaderNome(loja);
    _dispatchTemaEvent(loja);
  }

  /**
   * Retorna a loja ativa atual.
   * @returns {{ nome, slug, cor }}
   */
  function lojaAtiva() {
    const slug = document.body.dataset.loja ||
                 sessionStorage.getItem(STORAGE_KEY) ||
                 'todas';
    return LOJAS[slug] || LOJAS['todas'];
  }

  /**
   * Retorna o slug da loja ativa.
   * @returns {string}
   */
  function lojaSlug() {
    return lojaAtiva().slug;
  }

  /**
   * Retorna lista de lojas disponíveis (sem 'todas').
   * @returns {Array<{ nome, slug, cor }>}
   */
  function listLojas() {
    return Object.values(LOJAS).filter(l => l.slug !== 'todas');
  }

  /**
   * Inicializa o tema ao carregar a página.
   * Lê o slug do sessionStorage ou usa 'todas'.
   * @param {string} [fallback] - slug padrão caso não haja nada salvo
   */
  function init(fallback = 'todas') {
    const slug = sessionStorage.getItem(STORAGE_KEY) || fallback;
    aplicarTema(slug);

    // Inicializa clock se existir elemento com id="relogio"
    const relogio = document.getElementById('relogio');
    if (relogio) _startClock('relogio');

    // Inicializa seletor de loja se existir #sl-loja-select
    const sel = document.getElementById('sl-loja-select');
    if (sel) {
      _preencherSeletorLoja(sel);
      sel.addEventListener('change', e => aplicarTema(e.target.value));
    }
  }

  // ── Privados ──────────────────────────────────────────────

  function _atualizarHeaderLogo(loja) {
    const img = document.querySelector('.sl-loja-logo img');
    if (img) {
      img.src = `./icons/${loja.slug}.png`;
      img.alt = loja.nome;
      img.onerror = () => { img.style.display = 'none'; };
    }
  }

  function _atualizarHeaderNome(loja) {
    const el = document.querySelector('.sl-header-nome');
    if (el) el.textContent = loja.nome;
  }

  function _dispatchTemaEvent(loja) {
    document.dispatchEvent(new CustomEvent('sislot:tema', { detail: loja }));
  }

  function _preencherSeletorLoja(sel) {
    const ativo = lojaSlug();
    sel.innerHTML = Object.values(LOJAS).map(l =>
      `<option value="${l.slug}" ${l.slug === ativo ? 'selected' : ''}>${l.nome}</option>`
    ).join('');
  }

  function _startClock(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const tick = () => {
      const now = new Date();
      el.textContent =
        now.toLocaleTimeString('pt-BR') + ' — ' +
        now.toLocaleDateString('pt-BR', {
          weekday: 'short', day: '2-digit',
          month: '2-digit', year: 'numeric'
        });
    };
    tick();
    setInterval(tick, 1000);
  }

  // ── Export ────────────────────────────────────────────────
  window.SISLOT_THEME = { init, aplicarTema, lojaAtiva, lojaSlug, listLojas, LOJAS };
  console.log('✓ SISLOT_THEME carregado');
})();
