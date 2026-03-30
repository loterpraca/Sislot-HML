-- ================================================================
-- SISLOT — Tabelas para Vendas via WhatsApp
-- Execute no SQL Editor do Supabase
-- ================================================================

-- ── 1. Clientes WhatsApp ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes_whatsapp (
  id            BIGSERIAL PRIMARY KEY,
  nome          TEXT        NOT NULL,
  telefone      TEXT        NOT NULL,          -- ex: 5531999990000 (com DDI)
  apelido       TEXT,                           -- como o vendedor conhece
  ativo         BOOLEAN     NOT NULL DEFAULT true,
  observacoes   TEXT,
  criado_por    UUID        REFERENCES usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(telefone)
);

-- ── 2. Vendas WhatsApp ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendas_whatsapp (
  id                  BIGSERIAL PRIMARY KEY,
  cliente_id          BIGINT      NOT NULL REFERENCES clientes_whatsapp(id),
  bolao_id            BIGINT      NOT NULL REFERENCES boloes(id),
  loteria_id          BIGINT      NOT NULL REFERENCES loterias(id),  -- loja que vendeu
  qtd_cotas           INT         NOT NULL DEFAULT 1 CHECK (qtd_cotas > 0),
  valor_unitario      NUMERIC(10,2) NOT NULL,
  valor_total         NUMERIC(10,2) GENERATED ALWAYS AS (qtd_cotas * valor_unitario) STORED,
  pago                BOOLEAN     NOT NULL DEFAULT false,
  dt_pagamento        DATE,
  conferencia_enviada BOOLEAN     NOT NULL DEFAULT false,
  dt_conferencia      TIMESTAMPTZ,             -- quando enviou a conferência
  obs_venda           TEXT,
  criado_por          UUID        REFERENCES usuarios(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Trigger updated_at automático ────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_whatsapp_updated ON clientes_whatsapp;
CREATE TRIGGER trg_clientes_whatsapp_updated
  BEFORE UPDATE ON clientes_whatsapp
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_vendas_whatsapp_updated ON vendas_whatsapp;
CREATE TRIGGER trg_vendas_whatsapp_updated
  BEFORE UPDATE ON vendas_whatsapp
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. Índices ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_vendas_wp_cliente  ON vendas_whatsapp(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vendas_wp_bolao    ON vendas_whatsapp(bolao_id);
CREATE INDEX IF NOT EXISTS idx_vendas_wp_loteria  ON vendas_whatsapp(loteria_id);
CREATE INDEX IF NOT EXISTS idx_vendas_wp_pago     ON vendas_whatsapp(pago);
CREATE INDEX IF NOT EXISTS idx_vendas_wp_conf     ON vendas_whatsapp(conferencia_enviada);
CREATE INDEX IF NOT EXISTS idx_vendas_wp_data     ON vendas_whatsapp(created_at);

-- ── 5. RLS ───────────────────────────────────────────────────────
ALTER TABLE clientes_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas_whatsapp   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_clientes_wp_all"
  ON clientes_whatsapp FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "auth_vendas_wp_all"
  ON vendas_whatsapp FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── 6. View consolidada para exibição ───────────────────────────
CREATE OR REPLACE VIEW view_vendas_whatsapp AS
SELECT
  v.id,
  v.created_at,
  v.updated_at,
  v.qtd_cotas,
  v.valor_unitario,
  v.valor_total,
  v.pago,
  v.dt_pagamento,
  v.conferencia_enviada,
  v.dt_conferencia,
  v.obs_venda,
  -- Cliente
  c.id          AS cliente_id,
  c.nome        AS cliente_nome,
  c.apelido     AS cliente_apelido,
  c.telefone    AS cliente_telefone,
  -- Bolão
  b.id          AS bolao_id,
  b.modalidade,
  b.concurso,
  b.valor_cota,
  b.qtd_jogos,
  b.qtd_dezenas,
  b.dt_concurso,
  b.status      AS bolao_status,
  -- Loja
  l.id          AS loteria_id,
  l.nome        AS loteria_nome,
  l.slug        AS loteria_slug
FROM vendas_whatsapp v
JOIN clientes_whatsapp c ON c.id = v.cliente_id
JOIN boloes            b ON b.id = v.bolao_id
JOIN loterias          l ON l.id = v.loteria_id;
