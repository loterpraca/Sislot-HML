(() => {
  const cfg = window.SISLOT_CONFIG || {};
  const supabaseUrl = cfg.supabaseUrl || cfg.url;
  const supabaseAnonKey = cfg.supabaseAnonKey || cfg.anonKey || cfg.supabaseKey;

  if (!supabaseUrl || !supabaseAnonKey) {
    alert("Configuração do Supabase ausente no HTML.");
    return;
  }

  const { createClient } = window.supabase;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const form = document.getElementById("formTrocaSenha");
  const btn = document.getElementById("btnSalvar");
  const statusEl = document.getElementById("status");

  function setStatus(tipo, texto) {
    statusEl.className = `status ${tipo}`;
    statusEl.textContent = texto;
  }

  function limparStatus() {
    statusEl.className = "status";
    statusEl.textContent = "";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    limparStatus();

    const usuarioId = Number(document.getElementById("usuario_id").value);
    const novaSenha = document.getElementById("nova_senha").value.trim();
    const confirmarSenha = document.getElementById("confirmar_senha").value.trim();

    if (!usuarioId || usuarioId < 1) {
      setStatus("err", "Informe um ID de usuário válido.");
      return;
    }

    if (novaSenha.length < 8) {
      setStatus("err", "A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }

    if (novaSenha !== confirmarSenha) {
      setStatus("err", "A confirmação da senha não confere.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Trocando...";

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Sessão não encontrada. Faça login novamente.");
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/reset-user-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          usuario_id: usuarioId,
          nova_senha: novaSenha
        })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Falha ao trocar a senha.");
      }

      setStatus("ok", result?.message || "Senha alterada com sucesso.");
      form.reset();
    } catch (err) {
      console.error(err);
      setStatus("err", err.message || "Erro inesperado ao trocar a senha.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Trocar senha";
    }
  });
})();
