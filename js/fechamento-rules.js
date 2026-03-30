(function () {
  const sb = supabase.createClient(
    window.SISLOT_CONFIG.url,
    window.SISLOT_CONFIG.anonKey
  );

  function perfilNorm(usuario) {
    return String(usuario?.perfil || '').trim().toUpperCase();
  }

  function isAdmin(usuario) {
    return perfilNorm(usuario) === 'ADMIN';
  }

  function isSocio(usuario) {
    return perfilNorm(usuario) === 'SOCIO';
  }

  function isGerente(usuario) {
    return perfilNorm(usuario) === 'GERENTE';
  }

  function isOperador(usuario) {
    return perfilNorm(usuario) === 'OPERADOR';
  }

  function podeSelecionarFuncionario(usuario) {
    return isAdmin(usuario) || isSocio(usuario) || isGerente(usuario);
  }

  function podeGravarFechamento({ usuarioLogado, funcionarioSelecionadoId }) {
    if (isAdmin(usuarioLogado) || isSocio(usuarioLogado) || isGerente(usuarioLogado)) {
      return true;
    }

    if (isOperador(usuarioLogado)) {
      return Number(usuarioLogado?.id) === Number(funcionarioSelecionadoId);
    }

    return false;
  }

  function exigeTokenParaSobrescrever({ usuarioLogado }) {
    if (isAdmin(usuarioLogado) || isSocio(usuarioLogado)) return false;
    if (isGerente(usuarioLogado) || isOperador(usuarioLogado)) return true;
    return true;
  }

  function avaliarPermissaoGravacao({
    usuarioLogado,
    funcionarioSelecionadoId,
    existeFechamento
  }) {
    const podeGravar = podeGravarFechamento({
      usuarioLogado,
      funcionarioSelecionadoId
    });

    if (!podeGravar) {
      return {
        permitido: false,
        exigeToken: false,
        sobrescrevendo: false,
        motivo: 'Usuário sem permissão para gravar este fechamento.'
      };
    }

    const sobrescrevendo = !!existeFechamento;
    const exigeToken = sobrescrevendo
      ? exigeTokenParaSobrescrever({ usuarioLogado })
      : false;

    return {
      permitido: true,
      exigeToken,
      sobrescrevendo,
      motivo: ''
    };
  }

  

async function gerarTokenSobrescrita({
  loteriaId,
  funcionarioId,
  dataRef,
  minutos = 3,
  observacao = ''
}) {
  const { data, error } = await sb.rpc('rpc_gerar_token_sobrescrita', {
    p_loteria_id: Number(loteriaId),
    p_alvo_usuario_id: Number(funcionarioId),
    p_alvo_data_ref: dataRef,
    p_minutos: 3,
    p_observacao: observacao || null
  });

  if (error) throw new Error(error.message);
  return data;
}
async function validarTokenSobrescrita({
  token,
  loteriaId,
  funcionarioId,
  dataRef
}) {
  const codigo = String(token || '').trim().replace(/\D/g, '').slice(0, 6);

  if (!codigo) {
    throw new Error('Informe o token.');
  }

  const { data, error } = await sb.rpc('rpc_validar_token_sobrescrita', {
    p_token: codigo,
    p_loteria_id: Number(loteriaId),
    p_alvo_usuario_id: Number(funcionarioId),
    p_alvo_data_ref: dataRef
  });

  if (error) throw new Error(error.message);
  return data;
}

async function consumirTokenSobrescrita({
  tokenId,
  fechamentoId = null
}) {
  const { data, error } = await sb.rpc('rpc_consumir_token_sobrescrita', {
    p_token_id: Number(tokenId),
    p_fechamento_id: fechamentoId ? Number(fechamentoId) : null
  });

  if (error) throw new Error(error.message);
  return data;
}
  async function abrirModalToken() {
    return new Promise(resolve => {
      const modal = document.getElementById('m-token');
      const input = document.getElementById('token-autorizacao');
      const erro = document.getElementById('token-err');

      if (!modal || !input || !erro) {
        resolve(null);
        return;
      }

      window.__fechamentoTokenResolver = resolve;

      input.value = '';
      erro.textContent = '';
      erro.style.display = 'none';
      modal.classList.add('show');

      setTimeout(() => input.focus(), 30);
    });
  }

  function fecharModalToken() {
    const modal = document.getElementById('m-token');
    if (modal) modal.classList.remove('show');
  }

 async function confirmarToken({ loteriaId, funcionarioId, dataRef }) {
  const input = document.getElementById('token-autorizacao');
  const erro = document.getElementById('token-err');

  if (!input || !erro) return;

  const codigo = input.value.replace(/\D/g, '').slice(0, 6);
  console.log('CONFIRMANDO TOKEN VIA ARQUIVO NOVO');
  if (!codigo) {
    erro.textContent = 'Informe o token.';
    erro.style.display = 'block';
    return;
  }

  try {
    const tokenValido = await validarTokenSobrescrita({
      token: codigo,
      loteriaId,
      funcionarioId,
      dataRef
    });

    fecharModalToken();
    console.log('VALIDANDO TOKEN VIA RPC');
    if (window.__fechamentoTokenResolver) {
      window.__fechamentoTokenResolver(tokenValido);
      window.__fechamentoTokenResolver = null;
    }
  } catch (e) {
    erro.textContent = e.message || 'Token inválido.';
    erro.style.display = 'block';
  }
}
  function cancelarToken() {
    fecharModalToken();

    if (window.__fechamentoTokenResolver) {
      window.__fechamentoTokenResolver(null);
      window.__fechamentoTokenResolver = null;
    }
  }

  window.FECHAMENTO_RULES = {
    perfilNorm,
    isAdmin,
    isSocio,
    isGerente,
    isOperador,
    podeSelecionarFuncionario,
    podeGravarFechamento,
    exigeTokenParaSobrescrever,
    avaliarPermissaoGravacao,
    gerarTokenSobrescrita,
    validarTokenSobrescrita,
    consumirTokenSobrescrita,
    abrirModalToken,
    confirmarToken,
    cancelarToken
  };
})();
