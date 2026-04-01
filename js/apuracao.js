const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

let usuario = null;
let dataAtual = new Date();
let bolaoSel = null;
let todosBoloes = [];
let origemFiltro = '';
let pendenciaFiltro = 'TODOS';

const $ = id => document.getElementById(id);

function fmtData(dt) {
  return dt.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}
function isoDate(dt) { return dt.toISOString().slice(0, 10); }
function fmtBRL(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function intOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function setStatus(msg, tipo='info') {
  const el = $('statusBar');
  el.textContent = msg;
  el.className = 'status-bar show ' + tipo;
}
function clearStatus() {
  $('statusBar').className = 'status-bar';
}

function updateClock() {
  const now = new Date();
  $('relogio').textContent = now.toLocaleTimeString('pt-BR') + ' — ' +
    now.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = './login.html'; return; }

  const { data: usr } = await sb.from('usuarios')
    .select('id, nome, perfil, ativo, pode_logar')
    .eq('auth_user_id', session.user.id)
    .eq('ativo', true)
    .eq('pode_logar', true)
    .maybeSingle();

  if (!usr) { location.href = './login.html'; return; }
  usuario = usr;

  $('btnLogout').onclick = async () => { await sb.auth.signOut(); location.href = './login.html'; };
  $('selOrigem').addEventListener('change', async e => {
    origemFiltro = e.target.value || '';
    fecharPanel();
    await buscarBoloes();
  });
  $('selPendencia').addEventListener('change', async e => {
    pendenciaFiltro = e.target.value;
    fecharPanel();
    await buscarBoloes();
  });

  dataAtual = new Date();
  atualizarDateDisplay();
  await carregarOrigens();
  await buscarBoloes();
}

function atualizarDateDisplay() {
  $('dateDisplay').textContent = fmtData(dataAtual);
}

async function mudarData(delta) {
  dataAtual.setDate(dataAtual.getDate() + delta);
  atualizarDateDisplay();
  fecharPanel();
  await carregarOrigens();
  await buscarBoloes();
}

async function carregarOrigens() {
  const iso = isoDate(dataAtual);
  const { data, error } = await sb
    .from('view_boloes_apuracao_marketplace')
    .select('origem_loteria_id, origem_nome, origem_cod_loterico')
    .eq('status', 'ATIVO')
    .lte('dt_inicial', iso)
    .gte('dt_concurso', iso);

  if (error) return;

  const mapa = new Map();
  (data || []).forEach(r => {
    if (!mapa.has(String(r.origem_loteria_id))) mapa.set(String(r.origem_loteria_id), r);
  });

  const sel = $('selOrigem');
  const atual = origemFiltro;
  sel.innerHTML = '<option value="">Todas as origens</option>';
  [...mapa.values()]
    .sort((a,b) => String(a.origem_nome || '').localeCompare(String(b.origem_nome || ''), 'pt-BR'))
    .forEach(r => {
      const op = document.createElement('option');
      op.value = r.origem_loteria_id;
      op.textContent = `${r.origem_nome || '—'}${r.origem_cod_loterico ? ' · ' + r.origem_cod_loterico : ''}`;
      if (String(r.origem_loteria_id) === String(atual)) op.selected = true;
      sel.appendChild(op);
    });
}

async function buscarBoloes() {
  $('stLoading').style.display = 'flex';
  $('stVazio').style.display = 'none';
  $('stLista').style.display = 'none';
  $('boloesCount').innerHTML = '';

  const iso = isoDate(dataAtual);
  let q = sb.from('view_boloes_apuracao_marketplace')
    .select('*')
    .eq('status', 'ATIVO')
    .lte('dt_inicial', iso)
    .gte('dt_concurso', iso)
    .order('modalidade')
    .order('origem_nome')
    .order('concurso');

  if (origemFiltro) q = q.eq('origem_loteria_id', Number(origemFiltro));
  if (pendenciaFiltro === 'SIM') q = q.eq('pendencia_apuracao', true);
  if (pendenciaFiltro === 'NAO') q = q.eq('pendencia_apuracao', false);

  const { data: boloes, error } = await q;
  $('stLoading').style.display = 'none';

  if (error || !boloes?.length) {
    $('stVazioSub').textContent = `Nenhum bolão encontrado para ${fmtData(dataAtual)}.`;
    $('stVazio').style.display = 'flex';
    todosBoloes = [];
    return;
  }

  todosBoloes = boloes;
  renderBoloes(boloes);
}

function pendBadge(b) {
  return b.pendencia_apuracao
    ? '<span class="pend-badge pend">?</span>'
    : '<span class="pend-badge ok">✓</span>';
}

function valorInfo(v) {
  return v === null || v === undefined ? '—' : v;
}
function resumoBolaoHTML(b, expandido = false) {
  return `
    <div class="bolao-main ${expandido ? 'bolao-main-expandido' : ''}">
      <div class="bolao-header">
        ${expandido ? '' : pendBadge(b)}
        <span class="bolao-modal">${b.modalidade}</span>
        <span class="bolao-concurso">#${b.concurso}</span>
        <span class="bolao-origem">${b.origem_nome || '—'}</span>
      </div>

      <div class="bolao-tags">
        <span class="btag">${b.qtd_jogos} jogos</span>
        <span class="btag">${b.qtd_dezenas} dez.</span>
        <span class="btag">${b.qtd_cotas_total} cotas</span>
        <span class="btag">${fmtBRL(b.valor_cota)}/cota</span>
      </div>

      <div class="bolao-apu-linha">
        <span>Marketplace: ${valorInfo(b.qtd_marketplace)}</span>
        <span>Encalhe Físico: ${valorInfo(b.enc_fisico)}</span>
        <span>Encalhe Virtual: ${valorInfo(b.enc_virtual)}</span>
        <span>Prêmio_Cota: ${b.vlr_premio == null ? '' : fmtBRL(b.vlr_premio)}</span>
      </div>
    </div>
  `;
}
function renderBoloes(boloes) {
  const lista = $('stLista');
  lista.innerHTML = '';

  const grupos = {};
  boloes.forEach(b => {
    if (!grupos[b.modalidade]) grupos[b.modalidade] = [];
    grupos[b.modalidade].push(b);
  });

  const mods = Object.keys(grupos).sort((a,b) => a.localeCompare(b, 'pt-BR'));
  let total = 0;

  mods.forEach(mod => {
    const lst = grupos[mod].sort((a, b) => {
      const nA = a.origem_nome || '';
      const nB = b.origem_nome || '';
      if (nA !== nB) return nA.localeCompare(nB, 'pt-BR');
      return Number(a.valor_cota || 0) - Number(b.valor_cota || 0);
    });

    const sep = document.createElement('div');
    sep.className = 'section-sep';
    sep.style.marginTop = total > 0 ? '20px' : '0';
    sep.innerHTML = `<div class="section-sep-label">${mod}</div><div class="section-sep-line"></div><div class="section-sep-count">${lst.length}</div>`;
    lista.appendChild(sep);

    const grid = document.createElement('div');
    grid.className = 'boloes-grid';

    lst.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'bolao-card';
      card.dataset.id = b.bolao_id;
      card.style.animationDelay = (i * 0.04) + 's';
      card.innerHTML = `
      ${resumoBolaoHTML(b)}
          <div class="bolao-select-ind">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 5 9 10 3"/>
            </svg>
          </div>`;
          <div class="bolao-tags">
            <span class="btag">${b.qtd_jogos} jogos</span>
            <span class="btag">${b.qtd_dezenas} dez.</span>
            <span class="btag">${b.qtd_cotas_total} cotas</span>
            <span class="btag">${fmtBRL(b.valor_cota)}/cota</span>
          </div>
          <div class="bolao-apu-linha">
          <span>Marketplace: ${valorInfo(b.qtd_marketplace)}</span>
          <span>Encalhe Físico: ${valorInfo(b.enc_fisico)}</span>
          <span>Encalhe Virtual: ${valorInfo(b.enc_virtual)}</span>
          <span>Prêmio_Cota: ${b.vlr_premio == null ? '' : fmtBRL(b.vlr_premio)}</span>
        </div>
        </div>
        <div class="bolao-select-ind">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 6 5 9 10 3"/></svg>
        </div>`;
      card.addEventListener('click', () => selecionarBolao(b));
      grid.appendChild(card);
      total++;
    });

    lista.appendChild(grid);
  });

  $('stLista').style.display = 'block';
  $('boloesCount').innerHTML = `<span>${total}</span> bolões encontrados`;
}

async function selecionarBolao(b) {
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.bolao-card[data-id="${b.bolao_id}"]`)?.classList.add('selected');

  bolaoSel = b;
  clearStatus();

  $('panelNome').innerHTML = resumoBolaoHTML(b, true);
  $('panelTags').innerHTML = '';
  $('inputMarketplace').value = b.qtd_marketplace ?? '';
  $('inputEncFisico').value = b.enc_fisico ?? '';
  $('inputEncVirtual').value = b.enc_virtual ?? '';
  $('inputPremio').value = b.vlr_premio ?? '';

  renderResumoApuracao();

  $('vendaPanel').classList.add('open');
  document.body.classList.add('panel-open');
  $('inputMarketplace').focus();
}

function fecharPanel() {
  $('vendaPanel').classList.remove('open');
  document.body.classList.remove('panel-open');
  document.querySelectorAll('.bolao-card').forEach(c => c.classList.remove('selected'));
  bolaoSel = null;
  clearStatus();
}

function renderResumoApuracao() {
  if (!bolaoSel) return;

  const mp = intOrNull($('inputMarketplace').value);
  const ef = intOrNull($('inputEncFisico').value);
  const ev = intOrNull($('inputEncVirtual').value);
  const premio = numOrNull($('inputPremio').value);

  $('apuracaoResumo').innerHTML = `
    <strong>Marketplace:</strong> ${mp === null ? '' : mp} ·
    <strong>Encalhe Físico:</strong> ${ef === null ? '' : ef} ·
    <strong>Encalhe Virtual:</strong> ${ev === null ? '' : ev} ·
    <strong>Prêmio_Cota:</strong> ${premio === null ? '' : fmtBRL(premio)}
  `;

  if ($('apuBaseOrigem')) $('apuBaseOrigem').textContent = '';
  if ($('apuVendidoOperacional')) $('apuVendidoOperacional').textContent = '';
  if ($('apuSaldoFinal')) $('apuSaldoFinal').textContent = '';
  if ($('apuSituacao')) $('apuSituacao').textContent = '';
}
async function salvarApuracao() {
  if (!bolaoSel) return;

  const qtd_marketplace = intOrNull($('inputMarketplace').value);
  const enc_fisico = intOrNull($('inputEncFisico').value);
  const enc_virtual = intOrNull($('inputEncVirtual').value);
  const vlr_premio = numOrNull($('inputPremio').value);

  const negativos = [qtd_marketplace, enc_fisico, enc_virtual, vlr_premio].filter(v => v !== null && v < 0);
  if (negativos.length) {
    setStatus('Os valores não podem ser negativos.', 'err');
    return;
  }

  const btn = $('btnRegistrar');
  btn.disabled = true;
  setStatus('Salvando apuração…', 'info');

  const { error } = await sb.from('boloes')
    .update({
      qtd_marketplace,
      enc_fisico,
      enc_virtual,
      vlr_premio
    })
    .eq('id', bolaoSel.bolao_id);

  btn.disabled = false;

  if (error) {
    setStatus(error.message, 'err');
    return;
  }

  setStatus('Apuração salva com sucesso.', 'ok');

  const bolaoId = bolaoSel.bolao_id;
  await buscarBoloes();
  const atualizado = todosBoloes.find(x => Number(x.bolao_id) === Number(bolaoId));
  if (atualizado) await selecionarBolao(atualizado);
}

document.addEventListener('DOMContentLoaded', () => {
  $('btnDtPrev').addEventListener('click', () => mudarData(-1));
  $('btnDtNext').addEventListener('click', () => mudarData(+1));
  $('btnHoje').addEventListener('click', async () => {
    dataAtual = new Date();
    atualizarDateDisplay();
    fecharPanel();
    await carregarOrigens();
    await buscarBoloes();
  });
  $('btnFecharPanel').addEventListener('click', fecharPanel);
  init();
});
