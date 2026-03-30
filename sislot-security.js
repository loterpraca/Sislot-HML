/**
 * SISLOT - Segurança e Permissões
 * Versão: 1.0
 */

(function () {
    const sb = supabase.createClient(
        window.SISLOT_CONFIG.url,
        window.SISLOT_CONFIG.anonKey
    );

    // Usa utils se disponível
    const utils = window.SISLOT_UTILS || {};

    function rotaInicioPorPerfil(perfil) {
        if (['ADMIN', 'SOCIO', 'GERENTE', 'OPERADOR'].includes(perfil)) {
            return './menu.html';
        }
        return './login.html';
    }

    async function buscarUsuarioPorAuthId(authUserId) {
        const { data: usr, error } = await sb
            .from('usuarios')
            .select('id, auth_user_id, nome, email, perfil, ativo, pode_logar')
            .eq('auth_user_id', authUserId)
            .maybeSingle();

        if (error) throw new Error(error.message);
        return usr || null;
    }

    async function validarUsuarioLogavel(authUserId) {
        const usr = await buscarUsuarioPorAuthId(authUserId);

        if (!usr || !usr.ativo || !usr.pode_logar) {
            await sb.auth.signOut();
            throw new Error('Usuário sem permissão de acesso.');
        }

        return usr;
    }

    async function redirecionarAposLogin(authUserId) {
        const usr = await validarUsuarioLogavel(authUserId);
        const destino = rotaInicioPorPerfil(usr.perfil);
        window.location.href = destino;
    }

    async function redirecionarSeJaLogado() {
        const { data: { session }, error } = await sb.auth.getSession();

        if (error) throw new Error(error.message);
        if (!session?.user?.id) return;

        try {
            await redirecionarAposLogin(session.user.id);
        } catch (err) {
            await sb.auth.signOut();
            throw err;
        }
    }

    async function carregarVinculos(usuarioId) {
        const { data, error } = await sb
            .from('usuarios_loterias')
            .select('loteria_id, principal, papel_na_loja, loterias(id, nome, slug, codigo, cod_loterico, ativo)')
            .eq('usuario_id', usuarioId);

        if (error || !data) return [];

        return data
            .filter(v => v.loterias && v.loterias.ativo !== false)
            .map(v => ({
                loteria_id: v.loterias.id,
                loteria_nome: v.loterias.nome,
                loteria_slug: v.loterias.slug,
                loteria_codigo: v.loterias.codigo,
                cod_loterico: v.loterias.cod_loterico,
                principal: !!v.principal,
                papel_na_loja: v.papel_na_loja || null,
            }));
    }

    async function carregarTodasLojas() {
        const { data, error } = await sb
            .from('loterias')
            .select('id, nome, slug, codigo, cod_loterico, ativo')
            .eq('ativo', true)
            .order('nome');

        if (error || !data) return [];

        return data.map(l => ({
            loteria_id: l.id,
            loteria_nome: l.nome,
            loteria_slug: l.slug,
            loteria_codigo: l.codigo,
            cod_loterico: l.cod_loterico,
            principal: false,
        }));
    }

    async function protegerPagina(modulo) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.user?.id) {
            location.href = './login.html';
            return null;
        }

        const usuario = await validarUsuarioLogavel(session.user.id);
        const mod = String(modulo || '').toLowerCase();

        let permitido = false;
        let lojasPermitidas = [];

        if (usuario.perfil === 'ADMIN') {
            permitido = true;
            const todas = await carregarTodasLojas();
            const vinc = await carregarVinculos(usuario.id);

            lojasPermitidas = todas.map(l => {
                const match = vinc.find(v => v.loteria_id === l.loteria_id);
                return { ...l, principal: !!match?.principal };
            });
        }
        else if (usuario.perfil === 'SOCIO') {
            if (mod === 'cadastro' || mod === 'movimentacao') {
                permitido = true;
                const todas = await carregarTodasLojas();
                const vinc = await carregarVinculos(usuario.id);

                lojasPermitidas = todas.map(l => {
                    const match = vinc.find(v => v.loteria_id === l.loteria_id);
                    return { ...l, principal: !!match?.principal };
                });
            }
            else if (mod === 'fechamento') {
                permitido = true;
                lojasPermitidas = await carregarVinculos(usuario.id);
            }
        }
        else if (usuario.perfil === 'GERENTE') {
            if (mod === 'fechamento') {
                permitido = true;
                lojasPermitidas = await carregarVinculos(usuario.id);
            }
        }
        else if (usuario.perfil === 'OPERADOR') {
            if (mod === 'fechamento') {
                permitido = true;
                lojasPermitidas = await carregarVinculos(usuario.id);
            }
        }

        if (!permitido) {
            location.href = rotaInicioPorPerfil(usuario.perfil);
            return null;
        }

        const lojaInicial =
            lojasPermitidas.find(l => l.principal) ||
            lojasPermitidas[0] ||
            null;

        return {
            usuario,
            lojasPermitidas,
            lojaInicial,
            rotaInicio: rotaInicioPorPerfil(usuario.perfil),
        };
    }

    async function sair() {
        await sb.auth.signOut();
        window.location.href = './login.html';
    }

    function irParaInicio() {
        const path = window.location.pathname || '';
        const currentFile = path.split('/').pop() || '';

        sb.auth.getSession().then(async ({ data: { session } }) => {
            if (!session?.user?.id) {
                window.location.href = './login.html';
                return;
            }

            try {
                const usr = await validarUsuarioLogavel(session.user.id);
                const destino = rotaInicioPorPerfil(usr.perfil);

                if (currentFile === destino.replace('./', '')) return;
                window.location.href = destino;
            } catch (_) {
                window.location.href = './login.html';
            }
        });
    }

    window.SISLOT_SECURITY = {
        rotaInicioPorPerfil,
        buscarUsuarioPorAuthId,
        validarUsuarioLogavel,
        redirecionarAposLogin,
        redirecionarSeJaLogado,
        carregarVinculos,
        carregarTodasLojas,
        protegerPagina,
        sair,
        irParaInicio
    };
})();
