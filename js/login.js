/**
 * SISLOT - Login
 * Versão refatorada com utils
 */

const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
);

// Importa funções do utils
const utils = window.SISLOT_UTILS || {};
const $ = utils.$ || (id => document.getElementById(id));
const setBtnLoading = utils.setBtnLoading || ((btn, on) => {
    if (on) {
        btn.disabled = true;
        btn.classList.add('btn-loading');
    } else {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
    }
});
const showToast = utils.showToast || ((msg, type) => alert(msg));

const formLogin = document.getElementById('formLogin');
const emailEl = document.getElementById('email');
const senhaEl = document.getElementById('senha');
const errEmailEl = document.getElementById('errEmail');
const errSenhaEl = document.getElementById('errSenha');
const alertErroEl = document.getElementById('alertErro');
const btnLogin = document.getElementById('btnLogin');
const btnTexto = document.getElementById('btnTexto');
const spinner = document.getElementById('spinner');

init();

async function init() {
    registrarEventosCampos();
    formLogin.addEventListener('submit', onSubmitLogin);
}

function registrarEventosCampos() {
    [emailEl, senhaEl].forEach((campo) => {
        campo.addEventListener('input', limparErrosVisuais);
    });
}

function limparErrosVisuais() {
    emailEl.classList.remove('error');
    senhaEl.classList.remove('error');
    errEmailEl.classList.remove('visible');
    errSenhaEl.classList.remove('visible');
    alertErroEl.classList.remove('visible');
    alertErroEl.textContent = '';
}

function validarFormulario() {
    limparErrosVisuais();

    const email = emailEl.value.trim();
    const senha = senhaEl.value.trim();

    let valido = true;

    if (!email || !email.includes('@')) {
        emailEl.classList.add('error');
        errEmailEl.classList.add('visible');
        valido = false;
    }

    if (!senha) {
        senhaEl.classList.add('error');
        errSenhaEl.classList.add('visible');
        valido = false;
    }

    return { valido, email, senha };
}

function setLoading(loading) {
    setBtnLoading(btnLogin, loading);
    btnTexto.style.display = loading ? 'none' : 'block';
    if (spinner) spinner.style.display = loading ? 'block' : 'none';
}

function setBotaoSucesso() {
    if (btnTexto) btnTexto.textContent = '✓ Entrando…';
    btnTexto.style.display = 'block';
    if (spinner) spinner.style.display = 'none';
    if (btnLogin) btnLogin.style.background = '#00e8ad';
}

function resetBotao() {
    setBtnLoading(btnLogin, false);
    btnTexto.style.display = 'block';
    btnTexto.textContent = 'Entrar';
    if (spinner) spinner.style.display = 'none';
    if (btnLogin) btnLogin.style.background = '';
}

function mostrarErro(msg) {
    if (alertErroEl) {
        alertErroEl.textContent = msg;
        alertErroEl.classList.add('visible');
    }
}

function traduzirErro(msg) {
    if (!msg) return 'Erro desconhecido.';

    const m = String(msg).toLowerCase();

    if (m.includes('invalid login') || m.includes('invalid credentials')) {
        return 'E-mail ou senha incorretos.';
    }

    if (m.includes('email not confirmed')) {
        return 'E-mail não confirmado. Verifique sua caixa de entrada.';
    }

    if (m.includes('too many requests')) {
        return 'Muitas tentativas. Aguarde alguns minutos.';
    }

    if (m.includes('network')) {
        return 'Sem conexão com o servidor.';
    }

    return msg;
}

async function onSubmitLogin(e) {
    e.preventDefault();

    const { valido, email, senha } = validarFormulario();
    if (!valido) return;

    setLoading(true);

    try {
        const { data, error } = await sb.auth.signInWithPassword({
            email,
            password: senha
        });

        if (error) {
            throw new Error(traduzirErro(error.message));
        }

        setBotaoSucesso();

        if (
            window.SISLOT_SECURITY &&
            typeof window.SISLOT_SECURITY.redirecionarAposLogin === 'function'
        ) {
            await window.SISLOT_SECURITY.redirecionarAposLogin(data.user.id);
            return;
        }

        await redirecionarPorPerfilFallback(data.user.id);
    } catch (err) {
        mostrarErro(err.message || 'Erro ao fazer login. Tente novamente.');
        resetBotao();
    }
}

async function redirecionarPorPerfilFallback(authUserId) {
    const { data: usr, error } = await sb
        .from('usuarios')
        .select('perfil, pode_logar, ativo')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

    if (error) {
        throw new Error(error.message);
    }

    if (!usr || !usr.ativo || !usr.pode_logar) {
        mostrarErro('Usuário sem permissão de acesso.');
        await sb.auth.signOut();
        return;
    }

    window.location.href = './menu.html';
}
