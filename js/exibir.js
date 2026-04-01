const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

const $ = id => document.getElementById(id);

const VIEW_BOLAO = 'view_boloes_exibicao_operacional';
const VIEW_VENDAS = 'view_boloes_exibicao_operacional_vendas';
const VIEW_LOJAS = 'view_boloes_exibicao_operacional_lojas';

let usuario = null;
let usuarios = [];
let lojas = [];

const slugsLojas = ['boulevard', 'centro', 'lotobel', 'santa-tereza', 'via-brasil'];
const slugLabel = {
  'boulevard': 'BLD',
  'centro': 'CTR',
  'lotobel': 'LTB',
  'santa-tereza': 'STZ',
  'via-brasil': 'VIA'
};

let filtroTimer = null;

function agendarExibicao(){
  clearTimeout(filtroTimer);
  filtroTimer = setTimeout(() => {
    exibir();
  }, 250);
}

function fmtBRL(v){
  return v == null || v === '' ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtN(v){
  return v == null ? '—' : Number(v).toLocaleString('pt-BR');
}

function fmtDate(s){
  if(!s) return '—';
  const [y,m,d] = String(s).slice(0,10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtPair(a,b){
  const aa = a == null ? '—' : Number(a).toLocaleString('pt-BR');
  const bb = b == null ? '—' : Number(b).toLocaleString('pt-BR');
  return `${aa}/${bb}`;
}

function updateClock(){
  const n = new Date();
  $('relogio').textContent =
    n.toLocaleTimeString('pt-BR') + ' — ' +
    n.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
}
updateClock();
setInterval(updateClock, 1000);

async function init(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session){
    location.href = './login.html';
    return;
    $('fDataRef').value = hojeISO();

const filtrosChange = ['fDataRef', 'fDtConcDe', 'fDtConcAte', 'fModal', 'fLoja', 'fStatus'];
filtrosChange.forEach(id => {
  $(id).addEventListener('change', agendarExibicao);
});

$('fConc').addEventListener('input', agendarExibicao);

await exibir();
  }

  const { data: usr } = await sb.from('usuarios')
    .select('id,nome,perfil,ativo,pode_logar')
    .eq('auth_user_id', session.user.id)
    .eq('ativo', true)
    .eq('pode_logar', true)
    .maybeSingle();

  if(!usr){
    location.href = './login.html';
    return;
  }

  usuario = usr;
  $('btnLogout').onclick = async () => {
    await sb.auth.signOut();
    location.href = './login.html';
  };

  const [{ data: ls }, { data: us }] = await Promise.all([
    sb.from('loterias').select('id,nome,slug').eq('ativo', true).order('nome'),
    sb.from('usuarios').select('id,nome').eq('ativo', true).order('nome')
  ]);

  lojas = ls || [];
  usuarios = us || [];

  const sel = $('fLoja');
  lojas.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.nome;
    sel.appendChild(o);
  });
}

function limpar(){
  $('fDataRef').value = hojeISO();
  ['fDtConcDe','fDtConcAte','fConc'].forEach(id => $(id).value = '');
  ['fModal','fLoja','fStatus'].forEach(id => $(id).selectedIndex = 0);
  exibir();
}
function hojeISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function exibir(){
  const dataRef = $('fDataRef').value || hojeISO();
  $('statsRow').style.display = 'none';
  $('tableArea').innerHTML = '<div class="state-box"><div class="spinner"></div><div class="state-title">Carregando…</div></div>';
  
  let q = sb.from(VIEW_BOLAO)
  .select('*')
  .lte('dt_inicial', dataRef)
  .gte('dt_concurso', dataRef)
  .order('modalidade')
  .order('dt_concurso')
  .order('valor_cota');

if ($('fDtConcDe').value) q = q.gte('dt_concurso', $('fDtConcDe').value);
if ($('fDtConcAte').value) q = q.lte('dt_concurso', $('fDtConcAte').value);
if ($('fModal').value) q = q.eq('modalidade', $('fModal').value);
if ($('fConc').value) q = q.ilike('concurso', '%' + $('fConc').value + '%');
if ($('fLoja').value) q = q.eq('origem_loteria_id', parseInt($('fLoja').value));
if ($('fStatus').value) q = q.eq('status', $('fStatus').value);

  const { data: boloes, error } = await q;

  if (error || !boloes?.length) {
    $('tableArea').innerHTML = '<div class="state-box"><div class="state-title">Nenhum resultado</div><div class="state-sub">Tente ajustar os filtros.</div></div>';
    return;
  }

  const ids = boloes.map(b => b.bolao_id);

  const [{ data: vendas }, { data: lojasBolao }] = await Promise.all([
    sb.from(VIEW_VENDAS).select('*').in('bolao_id', ids),
    sb.from(VIEW_LOJAS).select('*').in('bolao_id', ids)
  ]);

  const canalMap = {};
  const funcMap = {};
  (boloes || []).forEach(b => {
    canalMap[b.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
    funcMap[b.bolao_id] = {};
  });

  (vendas || []).forEach(v => {
    if (!canalMap[v.bolao_id]) canalMap[v.bolao_id] = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
    canalMap[v.bolao_id][v.canal] = (canalMap[v.bolao_id][v.canal] || 0) + (v.qtd_vendida || 0);

    if (v.usuario_id) {
      if (!funcMap[v.bolao_id]) funcMap[v.bolao_id] = {};
      funcMap[v.bolao_id][v.usuario_id] = (funcMap[v.bolao_id][v.usuario_id] || 0) + (v.qtd_vendida || 0);
    }
  });

  const lojaMap = {};
  (lojasBolao || []).forEach(r => {
    if (!lojaMap[r.bolao_id]) lojaMap[r.bolao_id] = {};
    lojaMap[r.bolao_id][r.loja_slug] = {
      bruto: r.estoque_bruto_loja,
      vend: r.qtd_vendida_loja,
      bruto_venda: r.bruto_venda
    };
  });

  const funcIds = [...new Set((vendas || []).map(v => v.usuario_id).filter(Boolean))];
  const funcNomes = {};
  usuarios.forEach(u => {
    if (funcIds.includes(u.id)) funcNomes[u.id] = u.nome.split(' ')[0];
  });

  const totVendaReal = boloes.reduce((s,b) => s + Number(b.venda_real_total || 0), 0);
  const totEncalhe = boloes.reduce((s,b) => s + Number(b.encalhe_total || 0), 0);
  const totLiquido = boloes.reduce((s,b) => s + Number(b.estoque_liquido_total || 0), 0);
  const totVCont = boloes.reduce((s,b) => s + Number(b.venda_contabil_total || 0), 0);

  $('statsRow').style.display = 'grid';
  $('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-label">Bolões</div><div class="stat-value">${boloes.length}</div></div>
    <div class="stat-card"><div class="stat-label">Venda Real Total</div><div class="stat-value green">${fmtN(totVendaReal)}</div></div>
    <div class="stat-card"><div class="stat-label">Encalhe Total</div><div class="stat-value amber">${fmtN(totEncalhe)}</div></div>
    <div class="stat-card"><div class="stat-label">Estoque Líquido</div><div class="stat-value blue">${fmtN(totLiquido)}</div></div>
    <div class="stat-card"><div class="stat-label">Venda Contábil</div><div class="stat-value green">${fmtN(totVCont)}</div></div>
  `;

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap fade-in';

  const nFunc = funcIds.length;
  const nSlug = slugsLojas.length;

  const grpRow = `<tr class="grp-row">
    <th colspan="9" class="grp-bolao sep-col">Bolão</th>
    <th colspan="3" class="grp-canal sep-col">Canal de Venda</th>
    ${nFunc > 0 ? `<th colspan="${nFunc}" class="grp-func sep-col">Venda por Funcionário</th>` : ''}
    <th colspan="${nSlug}" class="grp-loja sep-col">Venda por Loja</th>
    <th colspan="2" class="grp-enc sep-col">Encalhe na Origem</th>
    <th colspan="4" class="grp-sint">Síntese Geral</th>
  </tr>`;

  const funcCols = funcIds.map(id => `<th>${funcNomes[id] || 'Func.'}</th>`).join('');
  const lojaCols = slugsLojas.map(s => `<th>${slugLabel[s]}</th>`).join('');

  const colRow = `<tr class="col-row">
    <th class="left">Origem</th>
    <th>Dt Ini</th>
    <th>Dt Conc</th>
    <th class="left">Modalidade</th>
    <th>Conc.</th>
    <th>Jogos</th>
    <th>Dez.</th>
    <th>V.Cota</th>
    <th class="sep-col">Qtd Cotas</th>

    <th>Balcão</th>
    <th>WPP</th>
    <th class="sep-col">MKP</th>

    ${nFunc > 0 ? funcCols : ''}

    ${lojaCols}

    <th>Enc.Físico</th>
    <th class="sep-col">Enc.Virtual</th>

    <th>Total Cotas/V.Real</th>
    <th>Encalhe Total</th>
    <th>Est. Líquido</th>
    <th>V.Contábil</th>
  </tr>`;

  const rows = boloes.map(b => {
    const cm = canalMap[b.bolao_id] || {};
    const lm = lojaMap[b.bolao_id] || {};
    const fm = funcMap[b.bolao_id] || {};

    const funcTds = funcIds.map(id => `<td class="purple">${fmtN(fm[id] || 0)}</td>`).join('');
    const lojaTds = slugsLojas.map(s => {
      const cell = lm[s];
      return `<td class="cyan">${cell?.bruto_venda || fmtPair(null, null)}</td>`;
    }).join('');

    return `<tr>
      <td class="left">${b.origem_nome || '—'}</td>
      <td class="mono dim">${fmtDate(b.dt_inicial)}</td>
      <td class="mono dim">${fmtDate(b.dt_concurso)}</td>
      <td class="left bold">${b.modalidade}</td>
      <td class="mono">#${b.concurso}</td>
      <td class="mono">${fmtN(b.qtd_jogos)}</td>
      <td class="mono">${fmtN(b.qtd_dezenas)}</td>
      <td class="amber">${fmtBRL(b.valor_cota)}</td>
      <td class="mono sep-col">${fmtN(b.qtd_cotas_total)}</td>

      <td class="blue">${fmtN(cm.BALCAO || 0)}</td>
      <td class="blue">${fmtN(cm.WHATSAPP || 0)}</td>
      <td class="blue sep-col">${fmtN(cm.MARKETPLACE || 0)}</td>

      ${nFunc > 0 ? funcTds : ''}

      ${lojaTds}

      <td class="amber">${fmtN(b.enc_fisico)}</td>
      <td class="amber sep-col">${fmtN(b.enc_virtual)}</td>

      <td class="green">${b.total_cotas_venda_real || fmtPair(b.qtd_cotas_total, b.venda_real_total)}</td>
      <td class="amber">${fmtN(b.encalhe_total)}</td>
      <td class="blue">${fmtN(b.estoque_liquido_total)}</td>
      <td class="green">${fmtN(b.venda_contabil_total)}</td>
    </tr>`;
  }).join('');

  const totCanal = { BALCAO: 0, WHATSAPP: 0, MARKETPLACE: 0 };
  Object.values(canalMap).forEach(cm => {
    ['BALCAO','WHATSAPP','MARKETPLACE'].forEach(c => {
      totCanal[c] += (cm[c] || 0);
    });
  });

  const totFuncTds = funcIds.map(id => {
    const t = Object.values(funcMap).reduce((s, fm) => s + (fm[id] || 0), 0);
    return `<td class="purple bold">${fmtN(t)}</td>`;
  }).join('');

  const totLojaTds = slugsLojas.map(s => {
    const bruto = (lojasBolao || [])
      .filter(r => r.loja_slug === s)
      .reduce((sum, r) => sum + Number(r.estoque_bruto_loja || 0), 0);
    const venda = (lojasBolao || [])
      .filter(r => r.loja_slug === s)
      .reduce((sum, r) => sum + Number(r.qtd_vendida_loja || 0), 0);
    return `<td class="cyan bold">${fmtPair(bruto, venda)}</td>`;
  }).join('');

  const totEncFis = boloes.reduce((s,b) => s + Number(b.enc_fisico || 0), 0);
  const totEncVirt = boloes.reduce((s,b) => s + Number(b.enc_virtual || 0), 0);
  const totCotas = boloes.reduce((s,b) => s + Number(b.qtd_cotas_total || 0), 0);

  const totalRow = `<tr style="background:rgba(0,200,150,0.04);border-top:1px solid var(--border2)">
    <td class="left bold" style="color:var(--accent);font-family:var(--mono);font-size:10px;letter-spacing:.1em">TOTAL</td>
    <td colspan="8" class="sep-col"></td>

    <td class="blue bold">${fmtN(totCanal.BALCAO)}</td>
    <td class="blue bold">${fmtN(totCanal.WHATSAPP)}</td>
    <td class="blue bold sep-col">${fmtN(totCanal.MARKETPLACE)}</td>

    ${nFunc > 0 ? totFuncTds : ''}

    ${totLojaTds}

    <td class="amber bold">${fmtN(totEncFis)}</td>
    <td class="amber bold sep-col">${fmtN(totEncVirt)}</td>

    <td class="green bold">${fmtPair(totCotas, totVendaReal)}</td>
    <td class="amber bold">${fmtN(totEncalhe)}</td>
    <td class="blue bold">${fmtN(totLiquido)}</td>
    <td class="green bold">${fmtN(totVCont)}</td>
  </tr>`;

  wrap.innerHTML = `<table class="data-table">
    <thead>${grpRow}${colRow}</thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>`;

  $('tableArea').innerHTML = '';
  $('tableArea').appendChild(wrap);
}

document.addEventListener('DOMContentLoaded', init);
