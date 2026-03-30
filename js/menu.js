/**
 * SISLOT - Menu Principal
 * Token por loja na seção "Lojas do Grupo"
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

const utils = window.SISLOT_UTILS || {};
const $ = utils.$ || (id => document.getElementById(id));
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

const PERFIL_LABEL = {
    ADMIN: 'Administrador',
    SOCIO: 'Sócio',
    GERENTE: 'Gerente',
    OPERADOR: 'Operador',
};

const LOJAS_FIXAS = [
    { id: 2, nome: 'Boulevard', icon: './icons/boulevard.png' },
    { id: 1, nome: 'Centro', icon: './icons/loterpraca.png' },
    { id: 3, nome: 'Lotobel', icon: './icons/lotobel.png' },
    { id: 4, nome: 'Santa Tereza', icon: './icons/santa-tereza.png' },
    { id: 5, nome: 'Via Brasil', icon: './icons/via-brasil.png' },
];

let usuarioAtual = null;
let lojaTokenAtual = null;

init();

function preencherUsuario(usuario) {
    const nome = String(usuario?.nome || 'Usuário').trim();
    const primeiroNome = nome.split(' ')[0] || 'Usuário';
    const iniciais = nome
        .split(' ')
        .filter(Boolean)
        .map((parte) => parte[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';

    const heroNome = $('heroNome');
    const userName = $('userName');
    const userRole = $('userRole');
    const userAvatar = $('userAvatar');

    if (heroNome) heroNome.textContent = primeiroNome;
    if (userName) userName.textContent = nome || 'Usuário';
    if (userRole) userRole.textContent = PERFIL_LABEL[usuario?.perfil] || usuario?.perfil || '—';
    if (userAvatar) userAvatar.textContent = iniciais;
}

function esconder(seletor) {
    document.querySelectorAll(seletor).forEach((el) => {
        el.style.display = 'none';
    });
}

function aplicarPermissoesMenu(perfil) {
    if (perfil === 'GERENTE' || perfil === 'OPERADOR') {
        esconder('.card-cadastro');
        esconder('.card-movimentacao');
        esconder('.card-exibir');
        esconder('.card-federal');
        esconder('.card-produtos');
        esconder('.card-whatsapp');
        esconder('.card-marketplace');
        esconder('.card-caixa');
        esconder('.card-config');
        esconder('.card-controle-fechamento');
        esconder('.card-pendencias');
        const adminWrap = $('adminWrap');
        if (adminWrap) adminWrap.style.display = 'none';
        return;
    }

    if (perfil === 'SOCIO') {
        esconder('.card-config');
        const adminWrap = $('adminWrap');
        if (adminWrap) adminWrap.style.display = 'none';
        return;
    }

    if (perfil === 'ADMIN') {
        const adminWrap = $('adminWrap');
        if (adminWrap) adminWrap.style.display = '';
    }
}

function hojeIso() {
    return new Date().toISOString().slice(0, 10);
}

function isAdmin(usuario) {
    return String(usuario?.perfil || '').trim().toUpperCase() === 'ADMIN';
}

function isSocio(usuario) {
    return String(usuario?.perfil || '').trim().toUpperCase() === 'SOCIO';
}

function podeGerarToken(usuario) {
    return isAdmin(usuario) || isSocio(usuario);
}

async function carregarIndicadores() {
    const hoje = hojeIso();

    const [
        movsResp,
        wppResp,
        mktResp,
    ] = await Promise.all([
        sb
            .from('movimentacoes_cotas')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', hoje),

        sb
            .from('boloes_vendas')
            .select('*', { count: 'exact', head: true })
            .eq('canal', 'WHATSAPP')
            .gte('created_at', hoje),

        sb
            .from('boloes_vendas')
            .select('*', { count: 'exact', head: true })
            .in('canal', ['MARKETPLACE', 'BALCAO'])
            .gte('created_at', hoje),
    ]);

    const statVendasWpp = $('statVendasWpp');
    const statMarketplace = $('statMarketplace');
    const statMovs = $('statMovs');

    if (statVendasWpp) statVendasWpp.textContent = wppResp.count ?? '—';
    if (statMarketplace) statMarketplace.textContent = mktResp.count ?? '—';
    if (statMovs) statMovs.textContent = movsResp.count ?? '—';
}

function configurarLogout() {
    const btnLogout = $('btnLogout');
    if (btnLogout) {
        btnLogout.onclick = async () => {
            await window.SISLOT_SECURITY.sair();
        };
    }
}

async function carregarUsuarioLogado() {
    const { data: { session }, error } = await sb.auth.getSession();

    if (error) {
        throw new Error(error.message);
    }

    if (!session?.user?.id) {
        location.href = './login.html';
        return null;
    }

    return await window.SISLOT_SECURITY.validarUsuarioLogavel(session.user.id);
}

async function carregarTodasLoterias() {
    const { data, error } = await sb
        .from('loterias')
        .select('id, nome')
        .order('nome', { ascending: true });

    if (error) throw new Error(error.message);

    return (data || []).map((l) => ({
        id: Number(l.id),
        nome: l.nome
    }));
}

async function carregarLoteriasDoSocio(usuarioId) {
    const { data, error } = await sb
        .from('usuarios_loterias')
        .select(`
            loteria_id,
            principal,
            ativo,
            loterias(id, nome)
        `)
        .eq('usuario_id', Number(usuarioId))
        .eq('ativo', true);

    if (error) throw new Error(error.message);

    return (data || [])
        .map((row) => {
            const lot = Array.isArray(row.loterias) ? row.loterias[0] : row.loterias;
            return {
                id: Number(row.loteria_id),
                nome: lot?.nome || `Loteria ${row.loteria_id}`,
                principal: !!row.principal
            };
        })
        .sort((a, b) => {
            if (a.principal !== b.principal) return a.principal ? -1 : 1;
            return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
        });
}

function iconeLoja(nome) {
    const n = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (n.includes('boulevard')) return './icons/boulevard.png';
    if (n.includes('centro')) return './icons/loterpraca.png';
    if (n.includes('lotobel')) return './icons/lotobel.png';
    if (n.includes('santa tereza')) return './icons/santa-tereza.png';
    if (n.includes('via brasil')) return './icons/via-brasil.png';

    return './icons/loterpraca.png';
}

function renderLojasRow(lojas, comToken) {
    const row = $('lojasRow');
    if (!row) return;

    row.innerHTML = '';

    lojas.forEach((loja) => {
        const el = document.createElement(comToken ? 'button' : 'div');
        el.className = `loja-chip ${comToken ? 'token-enabled' : ''}`;
        if (comToken) {
            el.type = 'button';
            el.addEventListener('click', () => abrirModalTokenLoja(loja));
        }

        el.innerHTML = `
            <div class="loja-logo">
              <img src="${iconeLoja(loja.nome)}" alt="${loja.nome}">
            </div>
            <span>${loja.nome}</span>
        `;

        row.appendChild(el);
    });
}

async function montarLojasDoGrupo(usuario) {
    const helper = $('lojasHelper');

    if (podeGerarToken(usuario)) {
        const lojas = isAdmin(usuario)
            ? await carregarTodasLoterias()
            : await carregarLoteriasDoSocio(usuario.id);

        if (helper) helper.style.display = 'block';
        renderLojasRow(lojas, true);
        return;
    }

    if (helper) helper.style.display = 'none';
    renderLojasRow(LOJAS_FIXAS, false);
}

async function carregarFuncionariosDaLoteria(loteriaId) {
    const { data, error } = await sb
        .from('usuarios_loterias')
        .select(`
            usuario_id,
            ativo,
            usuarios (
                id,
                nome,
                perfil,
                ativo,
                pode_logar
            )
        `)
        .eq('loteria_id', Number(loteriaId))
        .eq('ativo', true);

    if (error) {
        console.error('Erro ao buscar funcionarios da loteria:', error);
        throw new Error(error.message || 'Erro ao buscar funcionários.');
    }

    const lista = (data || [])
        .flatMap((row) => {
            if (!row.usuarios) return [];
            return Array.isArray(row.usuarios) ? row.usuarios : [row.usuarios];
        })
        .filter((u) => u && u.ativo && u.pode_logar)
        .filter((u, i, arr) => arr.findIndex((x) => Number(x.id) === Number(u.id)) === i)
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    return lista;
}
function limparResultadoToken() {
    const box = $('gtResultado');
    const erro = $('gtErro');

    if (box) box.style.display = 'none';
    if (erro) {
        erro.style.display = 'none';
        erro.textContent = '';
    }

    if ($('gtCodigoToken')) $('gtCodigoToken').textContent = '000000';
    if ($('gtExpiraToken')) $('gtExpiraToken').textContent = '';
}

async function abrirModalTokenLoja(loja) {
    lojaTokenAtual = loja;
    limparResultadoToken();

    const nomeLoja = $('gtLojaNome');
    const data = $('gtData');
    const func = $('gtFuncionario');
    const erro = $('gtErro');

    if (nomeLoja) nomeLoja.value = loja.nome;
    if (data) data.value = hojeIso();

    if (erro) {
        erro.style.display = 'none';
        erro.textContent = '';
    }

    if (func) {
        func.innerHTML = '<option value="">Carregando...</option>';
    }

    $('mGerarTokenLoja')?.classList.add('show');

    try {
        const funcionarios = await carregarFuncionariosDaLoteria(loja.id);

        if (func) {
            func.innerHTML = '<option value="">Selecione...</option>';

            if (!funcionarios.length) {
                func.innerHTML = '<option value="">Nenhum funcionário encontrado</option>';
                if (erro) {
                    erro.textContent = 'Nenhum funcionário ativo encontrado para esta loja.';
                    erro.style.display = 'block';
                }
                return;
            }

            funcionarios.forEach((u) => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.nome;
                func.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Erro ao abrir modal de token:', e);

        if (func) {
            func.innerHTML = '<option value="">Erro ao carregar</option>';
        }

        if (erro) {
            erro.textContent = e.message || 'Erro ao carregar funcionários da loja.';
            erro.style.display = 'block';
        }
    }
}
async function gerarTokenDaLojaSelecionada() {
    const erro = $('gtErro');
    const funcionarioId = $('gtFuncionario')?.value;
    const dataRef = $('gtData')?.value;
    const minutos = 3;

    limparResultadoToken();

    if (!lojaTokenAtual?.id || !funcionarioId || !dataRef) {
        if (erro) {
            erro.textContent = 'Preencha funcionário e data.';
            erro.style.display = 'block';
        }
        return;
    }

    try {
        const tk = await FECHAMENTO_RULES.gerarTokenSobrescrita({
            loteriaId: Number(lojaTokenAtual.id),
            funcionarioId: Number(funcionarioId),
            dataRef,
            minutos: 3,
            observacao: `Token gerado pelo menu - ${lojaTokenAtual.nome}`
        });

        const box = $('gtResultado');
        const codigo = $('gtCodigoToken');
        const expira = $('gtExpiraToken');

        if (box) box.style.display = 'block';
        if (codigo) codigo.textContent = String(tk.token || '').replace(/\D/g, '').slice(0, 6);
        if (expira) expira.textContent = `Expira em ${new Date(tk.expira_em).toLocaleString('pt-BR')}`;
    } catch (e) {
        if (erro) {
            erro.textContent = e.message || 'Erro ao gerar token.';
            erro.style.display = 'block';
        }
    }
}
async function bindLojasDoGrupo(usuario) {
    const chips = Array.from(document.querySelectorAll('.lojas-wrap .loja-chip[data-loteria-id]'));
    if (!chips.length) return;

    if (!podeGerarToken(usuario)) return;

    let permitidas = [];

    if (isAdmin(usuario)) {
        const lojas = await carregarTodasLoterias();
        permitidas = lojas.map((l) => Number(l.id));
    } else if (isSocio(usuario)) {
        const lojas = await carregarLoteriasDoSocio(usuario.id);
        permitidas = lojas.map((l) => Number(l.id));
    }

    chips.forEach((chip) => {
        const loteriaId = Number(chip.dataset.loteriaId);
        const loteriaNome = chip.dataset.loteriaNome || chip.textContent.trim();

        if (!permitidas.includes(loteriaId)) return;

        chip.style.cursor = 'pointer';

        chip.addEventListener('click', async () => {
            await abrirModalTokenLoja({
                id: loteriaId,
                nome: loteriaNome
            });
        });
    });
}
function fecharModalTokenLoja() {
    $('mGerarTokenLoja')?.classList.remove('show');
}

function bindModalTokenLoja() {
    $('btnFecharTokenLoja')?.addEventListener('click', fecharModalTokenLoja);
    $('btnCancelarTokenLoja')?.addEventListener('click', fecharModalTokenLoja);
    $('btnConfirmarGerarTokenLoja')?.addEventListener('click', gerarTokenDaLojaSelecionada);

    $('mGerarTokenLoja')?.addEventListener('click', (e) => {
        if (e.target?.id === 'mGerarTokenLoja') fecharModalTokenLoja();
    });
}

async function init() {
    try {
        startClock();

        const usuario = await carregarUsuarioLogado();
        if (!usuario) return;

        preencherUsuario(usuario);
        aplicarPermissoesMenu(usuario.perfil);
        configurarLogout();
        bindModalTokenLoja();

        await carregarIndicadores();
        await bindLojasDoGrupo(usuario);
    } catch (err) {
        console.error('Erro ao iniciar menu:', err);
        alert(err.message || 'Erro ao iniciar menu');
    }
}
