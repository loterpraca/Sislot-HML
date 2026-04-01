(() => {
  const sb = supabase.createClient(window.SISLOT_CONFIG.url, window.SISLOT_CONFIG.anonKey);

  let usuarios = [];
  let loterias = [];
  let vinculos = [];
  let editandoUsrId = null;
  let editandoLotId = null;
  let modalCallback = null;
  let toastTimer = null;

  const PERFIL_LABEL = { ADMIN: 'Admin', SOCIO: 'Sócio', GERENTE: 'Gerente', OPERADOR: 'Operador' };
  const PERFIL_BADGE = { ADMIN: 'badge-purple', SOCIO: 'badge-blue', GERENTE: 'badge-amber', OPERADOR: 'badge-teal' };
  const PERM_PREFIX = 'sislot_perm_';
  const MODULOS = [
    { key: 'cadastrar', label: 'Cadastrar', desc: 'Criar e gerenciar bolões' },
    { key: 'movimentar', label: 'Movimentar', desc: 'Distribuir cotas' },
    { key: 'buscar', label: 'Buscar', desc: 'Consultar saldo' },
    { key: 'fechamento', label: 'Fechamento', desc: 'Fechar caixa do dia' },
    { key: 'federal', label: 'Federal', desc: 'Bilhetes federais' },
    { key: 'produtos', label: 'Produtos', desc: 'Controle de estoque' },
    { key: 'whatsapp', label: 'WhatsApp', desc: 'Vendas por WhatsApp' },
    { key: 'marketplace', label: 'Marketplace', desc: 'Lançamentos / apuração' },
    { key: 'financeiro', label: 'Controle Financeiro', desc: 'Acertos entre lojas' },
    { key: 'caixa', label: 'Caixa', desc: 'Vendas presenciais' },
    { key: 'controle_fechamento', label: 'Controle Fechamento', desc: 'Conferir fechamentos' },
    { key: 'pendencias', label: 'Pendências', desc: 'Pendências operacionais' },
    { key: 'configuracoes', label: 'Configurações', desc: 'Usuários, loterias e permissões' }
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const toBool = (v) => v === true || v === 'true';

  function toast(msg, tipo = 'green') {
    $('#toastMsg').textContent = msg;
    $('#toastDot').className = `toast-dot ${tipo}`;
    const el = $('#toast');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function confirmar(titulo, corpo, cb) {
    $('#modalTitle').textContent = titulo;
    $('#modalBody').textContent = corpo;
    modalCallback = cb;
    $('#modalOverlay').classList.add('open');
  }

  function fecharModal() {
    $('#modalOverlay').classList.remove('open');
    modalCallback = null;
  }

  function showTab(tab) {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  }

  function resetFormUsr() {
    editandoUsrId = null;
    $('#usr-nome').value = '';
    $('#usr-email').value = '';
    $('#usr-auth-user-id').value = '';
    $('#usr-perfil').value = 'OPERADOR';
    $('#usr-pode-logar').value = 'true';
    $('#usr-ativo-form').value = 'true';
    $('#btnUsrLabel').textContent = 'Salvar Usuário';
    $('#btnCancelarUsr').style.display = 'none';
  }

  function resetFormLot() {
    editandoLotId = null;
    ['#lot-nome', '#lot-slug', '#lot-codigo', '#lot-cod-loterico', '#lot-aba', '#lot-cor'].forEach((id) => { $(id).value = ''; });
    $('#btnLotLabel').textContent = 'Salvar Loteria';
    $('#btnCancelarLot').style.display = 'none';
  }

  function authBadge(u) {
    if (u.auth_user_id) return '<span class="badge badge-green">Vinculado</span>';
    if (u.pode_logar) return '<span class="badge badge-red">Falta auth</span>';
    return '<span class="badge badge-amber">Sem login</span>';
  }

  async function carregarUsuarios() {
    const { data, error } = await sb
      .from('usuarios')
      .select('id,nome,email,perfil,ativo,pode_logar,auth_user_id')
      .order('nome');

    if (error) {
      toast(`Erro ao carregar usuários: ${error.message}`, 'red');
      return;
    }

    usuarios = data || [];
    renderUsuarios(usuarios);
    preencherSelectUsuarios();
    preencherSelectSenhas();
    renderTabelaSenhas();
  }

  function renderUsuarios(lista) {
    $('#countUsr').textContent = `${lista.length} registros`;
    const tbody = $('#tbodyUsr');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Nenhum usuário encontrado</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((u) => `
      <tr>
        <td class="bright">${esc(u.nome)}</td>
        <td>${esc(u.email || '—')}</td>
        <td><span class="badge ${PERFIL_BADGE[u.perfil] || 'badge-teal'}">${PERFIL_LABEL[u.perfil] || u.perfil}</span></td>
        <td><div class="stack auth-status">${authBadge(u)}${u.auth_user_id ? `<span class="mono muted">${esc(u.auth_user_id)}</span>` : ''}</div></td>
        <td><span class="badge ${u.pode_logar ? 'badge-green' : 'badge-red'}">${u.pode_logar ? 'Sim' : 'Não'}</span></td>
        <td><span class="badge ${u.ativo ? 'badge-green' : 'badge-red'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><div class="tbl-actions">
          <button class="tbl-btn tbl-edit" data-edit-usr="${u.id}">Editar</button>
          <button class="tbl-btn tbl-toggle" data-toggle-login="${u.id}">${u.pode_logar ? 'Bloquear' : 'Liberar'}</button>
          <button class="tbl-btn tbl-toggle" data-toggle-ativo-usr="${u.id}">${u.ativo ? 'Desativar' : 'Ativar'}</button>
        </div></td>
      </tr>
    `).join('');
  }

  function filtrarUsuarios() {
    const q = $('#searchUsr').value.trim().toLowerCase();
    if (!q) return renderUsuarios(usuarios);
    renderUsuarios(usuarios.filter((u) =>
      (u.nome || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.auth_user_id || '').toLowerCase().includes(q)
    ));
  }

  function preencherSelectUsuarios() {
    const valorVinc = $('#vinc-usr').value;
    const sel = $('#vinc-usr');
    sel.innerHTML = '<option value="">Selecione…</option>';
    usuarios.filter((u) => u.ativo).forEach((u) => {
      const op = document.createElement('option');
      op.value = String(u.id);
      op.textContent = `${u.nome} (${PERFIL_LABEL[u.perfil] || u.perfil})`;
      sel.appendChild(op);
    });
    sel.value = valorVinc;
  }

  function preencherSelectSenhas() {
    const valor = $('#pwd-usuario').value;
    const sel = $('#pwd-usuario');
    sel.innerHTML = '<option value="">Selecione…</option>';
    usuarios.filter((u) => u.ativo && u.auth_user_id).forEach((u) => {
      const op = document.createElement('option');
      op.value = String(u.id);
      op.textContent = `${u.nome}${u.email ? ` — ${u.email}` : ''}`;
      sel.appendChild(op);
    });
    sel.value = valor;
  }

  async function salvarUsuario() {
    const nome = $('#usr-nome').value.trim();
    const email = $('#usr-email').value.trim() || null;
    const auth_user_id = $('#usr-auth-user-id').value.trim() || null;
    const perfil = $('#usr-perfil').value;
    const pode_logar = toBool($('#usr-pode-logar').value);
    const ativo = toBool($('#usr-ativo-form').value);

    if (!nome) {
      toast('Nome é obrigatório.', 'red');
      return;
    }

    if (pode_logar && (!email || !auth_user_id)) {
      toast('Para usuário com login, preencha e-mail e auth_user_id.', 'red');
      return;
    }

    const payload = { nome, email, perfil, pode_logar, ativo, auth_user_id };

    let error;
    if (editandoUsrId) {
      ({ error } = await sb.from('usuarios').update(payload).eq('id', editandoUsrId));
    } else {
      ({ error } = await sb.from('usuarios').insert(payload));
    }

    if (error) {
      toast(`Erro ao salvar usuário: ${error.message}`, 'red');
      return;
    }

    toast(editandoUsrId ? 'Usuário atualizado.' : 'Usuário cadastrado.');
    resetFormUsr();
    await carregarUsuarios();
  }

  function editarUsuario(id) {
    const u = usuarios.find((x) => x.id === id);
    if (!u) return;
    editandoUsrId = id;
    $('#usr-nome').value = u.nome || '';
    $('#usr-email').value = u.email || '';
    $('#usr-auth-user-id').value = u.auth_user_id || '';
    $('#usr-perfil').value = u.perfil || 'OPERADOR';
    $('#usr-pode-logar').value = String(!!u.pode_logar);
    $('#usr-ativo-form').value = String(!!u.ativo);
    $('#btnUsrLabel').textContent = 'Atualizar Usuário';
    $('#btnCancelarUsr').style.display = '';
    showTab('usuarios');
    $('#usr-nome').focus();
  }

  async function togglePodeLogar(id) {
    const u = usuarios.find((x) => x.id === id);
    if (!u) return;
    confirmar(
      u.pode_logar ? 'Bloquear login' : 'Liberar login',
      u.pode_logar ? 'O usuário continuará existindo, mas ficará impedido de entrar no sistema.' : 'O usuário poderá entrar novamente, desde que tenha login válido no Auth.',
      async () => {
        const { error } = await sb.from('usuarios').update({ pode_logar: !u.pode_logar }).eq('id', id);
        if (error) return toast(`Erro: ${error.message}`, 'red');
        toast(u.pode_logar ? 'Login bloqueado.' : 'Login liberado.');
        await carregarUsuarios();
      }
    );
  }

  async function toggleAtivoUsr(id) {
    const u = usuarios.find((x) => x.id === id);
    if (!u) return;
    confirmar(
      u.ativo ? 'Desativar usuário' : 'Ativar usuário',
      u.ativo ? 'O usuário ficará inativo nas listagens e permissões.' : 'O usuário voltará a aparecer normalmente.',
      async () => {
        const { error } = await sb.from('usuarios').update({ ativo: !u.ativo }).eq('id', id);
        if (error) return toast(`Erro: ${error.message}`, 'red');
        toast(u.ativo ? 'Usuário desativado.' : 'Usuário ativado.');
        await carregarUsuarios();
      }
    );
  }

  async function carregarLoterias() {
    const { data, error } = await sb
      .from('loterias')
      .select('id,nome,slug,codigo,cod_loterico,aba_externos,cor_primaria,ativo')
      .order('nome');

    if (error) {
      toast(`Erro ao carregar loterias: ${error.message}`, 'red');
      return;
    }

    loterias = data || [];
    renderLoterias();
    preencherSelectLoterias();
  }

  function preencherSelectLoterias() {
    const valor = $('#vinc-lot').value;
    const sel = $('#vinc-lot');
    sel.innerHTML = '<option value="">Selecione…</option>';
    loterias.filter((l) => l.ativo).forEach((l) => {
      const op = document.createElement('option');
      op.value = String(l.id);
      op.textContent = l.nome;
      sel.appendChild(op);
    });
    sel.value = valor;
  }

  function renderLoterias() {
    const tbody = $('#tbodyLot');
    if (!loterias.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma loteria cadastrada</td></tr>';
      return;
    }
    tbody.innerHTML = loterias.map((l) => `
      <tr>
        <td class="bright">${esc(l.nome)}</td>
        <td><span class="mono muted">${esc(l.slug || '—')}</span></td>
        <td>${esc(l.codigo || '—')}</td>
        <td>${esc(l.cod_loterico || '—')}</td>
        <td><span class="badge ${l.ativo ? 'badge-green' : 'badge-red'}">${l.ativo ? 'Ativa' : 'Inativa'}</span></td>
        <td><div class="tbl-actions">
          <button class="tbl-btn tbl-edit" data-edit-lot="${l.id}">Editar</button>
          <button class="tbl-btn tbl-toggle" data-toggle-lot="${l.id}">${l.ativo ? 'Desativar' : 'Ativar'}</button>
        </div></td>
      </tr>
    `).join('');
  }

  async function salvarLoteria() {
    const nome = $('#lot-nome').value.trim();
    const slug = $('#lot-slug').value.trim().toLowerCase();
    const codigo = $('#lot-codigo').value.trim().toUpperCase();
    const cod_loterico = $('#lot-cod-loterico').value.trim() || null;
    const aba_externos = $('#lot-aba').value.trim() || null;
    const cor_primaria = $('#lot-cor').value.trim() || null;

    if (!nome || !slug || !codigo) {
      toast('Nome, slug e código são obrigatórios.', 'red');
      return;
    }

    const payload = { nome, slug, codigo, cod_loterico, aba_externos, cor_primaria };
    let error;
    if (editandoLotId) {
      ({ error } = await sb.from('loterias').update(payload).eq('id', editandoLotId));
    } else {
      ({ error } = await sb.from('loterias').insert({ ...payload, ativo: true }));
    }
    if (error) return toast(`Erro ao salvar loteria: ${error.message}`, 'red');

    toast(editandoLotId ? 'Loteria atualizada.' : 'Loteria cadastrada.');
    resetFormLot();
    await carregarLoterias();
  }

  function editarLoteria(id) {
    const l = loterias.find((x) => x.id === id);
    if (!l) return;
    editandoLotId = id;
    $('#lot-nome').value = l.nome || '';
    $('#lot-slug').value = l.slug || '';
    $('#lot-codigo').value = l.codigo || '';
    $('#lot-cod-loterico').value = l.cod_loterico || '';
    $('#lot-aba').value = l.aba_externos || '';
    $('#lot-cor').value = l.cor_primaria || '';
    $('#btnLotLabel').textContent = 'Atualizar Loteria';
    $('#btnCancelarLot').style.display = '';
    showTab('loterias');
    $('#lot-nome').focus();
  }

  async function toggleLoteria(id) {
    const l = loterias.find((x) => x.id === id);
    if (!l) return;
    confirmar(
      l.ativo ? 'Desativar loteria' : 'Ativar loteria',
      l.ativo ? 'A loteria ficará inativa nas escolhas e relatórios.' : 'A loteria voltará a aparecer normalmente.',
      async () => {
        const { error } = await sb.from('loterias').update({ ativo: !l.ativo }).eq('id', id);
        if (error) return toast(`Erro: ${error.message}`, 'red');
        toast(l.ativo ? 'Loteria desativada.' : 'Loteria ativada.');
        await carregarLoterias();
      }
    );
  }

  async function carregarVinculos() {
    const { data, error } = await sb
      .from('usuarios_loterias')
      .select('id,usuario_id,loteria_id,papel_na_loja,principal,ativo,usuarios(nome),loterias(nome)')
      .eq('ativo', true)
      .order('id');

    if (error) {
      toast(`Erro ao carregar vínculos: ${error.message}`, 'red');
      return;
    }

    vinculos = data || [];
    renderVinculos(vinculos);
  }

  function renderVinculos(lista) {
    $('#countVinc').textContent = `${lista.length} registros`;
    const tbody = $('#tbodyVinc');
    if (!lista.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhum vínculo ativo encontrado</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map((v) => `
      <tr>
        <td class="bright">${esc(v.usuarios?.nome || '—')}</td>
        <td>${esc(v.loterias?.nome || '—')}</td>
        <td>${esc(v.papel_na_loja || '—')}</td>
        <td><span class="badge ${v.principal ? 'badge-green' : 'badge-amber'}">${v.principal ? 'Sim' : 'Não'}</span></td>
        <td><span class="badge ${v.ativo ? 'badge-green' : 'badge-red'}">${v.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><button class="tbl-btn tbl-del" data-remover-vinc="${v.id}">Remover</button></td>
      </tr>
    `).join('');
  }

  function filtrarVinculos() {
    const q = $('#searchVinc').value.trim().toLowerCase();
    if (!q) return renderVinculos(vinculos);
    renderVinculos(vinculos.filter((v) =>
      (v.usuarios?.nome || '').toLowerCase().includes(q)
      || (v.loterias?.nome || '').toLowerCase().includes(q)
      || (v.papel_na_loja || '').toLowerCase().includes(q)
    ));
  }

  async function salvarVinculo() {
    const usuario_id = Number($('#vinc-usr').value);
    const loteria_id = Number($('#vinc-lot').value);
    const principal = toBool($('#vinc-principal').value);
    const papel_na_loja = $('#vinc-papel').value.trim() || null;

    if (!usuario_id || !loteria_id) {
      toast('Selecione usuário e loteria.', 'red');
      return;
    }

    const existente = vinculos.find((v) => Number(v.usuario_id) === usuario_id && Number(v.loteria_id) === loteria_id);
    if (existente) {
      toast('Este vínculo já existe.', 'red');
      return;
    }

    if (principal) {
      const { error: unmarkError } = await sb
        .from('usuarios_loterias')
        .update({ principal: false })
        .eq('usuario_id', usuario_id)
        .eq('ativo', true);
      if (unmarkError) {
        toast(`Erro ao ajustar vínculo principal: ${unmarkError.message}`, 'red');
        return;
      }
    }

    const { error } = await sb.from('usuarios_loterias').insert({
      usuario_id,
      loteria_id,
      principal,
      papel_na_loja,
      ativo: true
    });
    if (error) return toast(`Erro ao criar vínculo: ${error.message}`, 'red');

    $('#vinc-usr').value = '';
    $('#vinc-lot').value = '';
    $('#vinc-principal').value = 'false';
    $('#vinc-papel').value = '';
    toast('Vínculo criado.');
    await carregarVinculos();
  }

  async function removerVinculo(id) {
    confirmar('Remover vínculo', 'O usuário perderá acesso a essa loteria. O vínculo será marcado como inativo.', async () => {
      const { error } = await sb.from('usuarios_loterias').update({ ativo: false, principal: false }).eq('id', id);
      if (error) return toast(`Erro: ${error.message}`, 'red');
      toast('Vínculo removido.');
      await carregarVinculos();
    });
  }

  function renderPermissoes() {
    const perfil = $('#perm-perfil').value;
    $('#permGrid').innerHTML = MODULOS.map((m) => {
      const salvo = localStorage.getItem(`${PERM_PREFIX}${perfil}_${m.key}`);
      const ativo = salvo === null ? true : salvo === 'true';
      return `
        <div class="perm-card">
          <div><div class="perm-name">${m.label}</div><div class="perm-desc">${m.desc}</div></div>
          <label class="toggle-wrap">
            <input type="checkbox" class="toggle-input" data-key="${m.key}" ${ativo ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
        </div>
      `;
    }).join('');
  }

  function salvarPermissoes() {
    const perfil = $('#perm-perfil').value;
    $$('#permGrid .toggle-input').forEach((inp) => {
      localStorage.setItem(`${PERM_PREFIX}${perfil}_${inp.dataset.key}`, String(inp.checked));
    });
    toast('Permissões salvas.');
  }

  function renderTabelaSenhas() {
    const tbody = $('#tbodyPwd');
    const aptos = usuarios.filter((u) => u.ativo && u.auth_user_id);
    if (!aptos.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhum usuário com auth_user_id disponível</td></tr>';
      return;
    }
    tbody.innerHTML = aptos.map((u) => `
      <tr>
        <td class="bright">${esc(u.nome)}</td>
        <td>${esc(u.email || '—')}</td>
        <td><span class="mono muted">${esc(u.auth_user_id || '—')}</span></td>
        <td><button class="tbl-btn tbl-edit" data-selecionar-reset="${u.id}">Selecionar</button></td>
      </tr>
    `).join('');
  }

  async function trocarSenha() {
    const usuario_id = Number($('#pwd-usuario').value);
    const nova_senha = $('#pwd-senha').value.trim();
    const confirmar_senha = $('#pwd-senha2').value.trim();

    if (!usuario_id) return toast('Selecione um usuário.', 'red');
    if (nova_senha.length < 8) return toast('A nova senha deve ter pelo menos 8 caracteres.', 'red');
    if (nova_senha !== confirmar_senha) return toast('A confirmação da senha não confere.', 'red');

    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    if (sessionError) return toast(`Sessão inválida: ${sessionError.message}`, 'red');
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) return toast('Sessão não encontrada. Faça login novamente.', 'red');

    const btn = $('#btnTrocarSenha');
    btn.disabled = true;
    try {
      const response = await fetch(`${window.SISLOT_CONFIG.url}/functions/v1/reset-user-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ usuario_id, nova_senha })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || 'Falha ao trocar a senha.');

      toast(result?.message || 'Senha alterada.', 'green');
      $('#pwd-senha').value = '';
      $('#pwd-senha2').value = '';
    } catch (err) {
      toast(err.message || 'Erro ao trocar a senha.', 'red');
    } finally {
      btn.disabled = false;
    }
  }

  async function init() {
    const { data: { session }, error: sessionError } = await sb.auth.getSession();
    if (sessionError || !session) {
      location.href = './login.html';
      return;
    }

    const { data: usr, error } = await sb
      .from('usuarios')
      .select('id,nome,perfil,ativo,pode_logar,auth_user_id')
      .eq('auth_user_id', session.user.id)
      .eq('ativo', true)
      .maybeSingle();

    if (error || !usr || usr.perfil !== 'ADMIN') {
      alert('Acesso restrito a administradores.');
      location.href = './menu.html';
      return;
    }

    const iniciais = (usr.nome || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
    $('#userAvatar').textContent = iniciais || '?';
    $('#userName').textContent = usr.nome || 'Administrador';
    $('#userRole').textContent = PERFIL_LABEL[usr.perfil] || usr.perfil;

    $('#btnLogout').addEventListener('click', async () => {
      await sb.auth.signOut();
      location.href = './login.html';
    });

    $$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
    $('#modalCancel').addEventListener('click', fecharModal);
    $('#modalConfirm').addEventListener('click', () => { if (modalCallback) modalCallback(); fecharModal(); });
    $('#searchUsr').addEventListener('input', filtrarUsuarios);
    $('#searchVinc').addEventListener('input', filtrarVinculos);
    $('#btnSalvarUsr').addEventListener('click', salvarUsuario);
    $('#btnCancelarUsr').addEventListener('click', resetFormUsr);
    $('#btnSalvarLot').addEventListener('click', salvarLoteria);
    $('#btnCancelarLot').addEventListener('click', resetFormLot);
    $('#btnSalvarVinc').addEventListener('click', salvarVinculo);
    $('#btnSalvarPerm').addEventListener('click', salvarPermissoes);
    $('#perm-perfil').addEventListener('change', renderPermissoes);
    $('#btnTrocarSenha').addEventListener('click', trocarSenha);

    $('#lot-nome').addEventListener('input', function onNomeInput() {
      if (editandoLotId) return;
      $('#lot-slug').value = this.value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    });

    document.addEventListener('click', (e) => {
      const editUsr = e.target.closest('[data-edit-usr]');
      if (editUsr) return editarUsuario(Number(editUsr.dataset.editUsr));

      const toggleLogin = e.target.closest('[data-toggle-login]');
      if (toggleLogin) return togglePodeLogar(Number(toggleLogin.dataset.toggleLogin));

      const toggleAtivoUsrBtn = e.target.closest('[data-toggle-ativo-usr]');
      if (toggleAtivoUsrBtn) return toggleAtivoUsr(Number(toggleAtivoUsrBtn.dataset.toggleAtivoUsr));

      const editLot = e.target.closest('[data-edit-lot]');
      if (editLot) return editarLoteria(Number(editLot.dataset.editLot));

      const toggleLotBtn = e.target.closest('[data-toggle-lot]');
      if (toggleLotBtn) return toggleLoteria(Number(toggleLotBtn.dataset.toggleLot));

      const removerVincBtn = e.target.closest('[data-remover-vinc]');
      if (removerVincBtn) return removerVinculo(Number(removerVincBtn.dataset.removerVinc));

      const selecionarReset = e.target.closest('[data-selecionar-reset]');
      if (selecionarReset) {
        const id = Number(selecionarReset.dataset.selecionarReset);
        $('#pwd-usuario').value = String(id);
        showTab('senhas');
      }
    });

    await Promise.all([carregarUsuarios(), carregarLoterias()]);
    await carregarVinculos();
    renderPermissoes();
  }

  init();
})();
