-- SELVA Studio — esquema do banco (Supabase / Postgres)
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase (ou via `supabase db push`).
-- Cada tabela guarda o dono da linha em user_id; as políticas de RLS garantem que cada login
-- só enxerga e altera os próprios dados.

create extension if not exists pgcrypto;

-- ---------- Configurações do studio (uma linha por usuário) ----------
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Insumos: flores, folhagens, vasos, embalagens ----------
create table if not exists public.insumos (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  nome text not null,
  categoria text not null default '',
  unidade text not null default 'un',
  custo numeric(12,2) not null default 0,
  fornecedor text not null default '',
  obs text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Produtos: arranjos (com ficha técnica) e peças de revenda ----------
create table if not exists public.produtos (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  nome text not null,
  tipo text not null default 'arranjo' check (tipo in ('arranjo','peca')),
  categoria text not null default '',
  descricao text not null default '',
  ficha jsonb not null default '[]'::jsonb,          -- [{insumoId, qtd}]
  custo_direto numeric(12,2) not null default 0,
  minutos numeric(8,1) not null default 0,
  embalagem numeric(12,2) not null default 0,
  extras numeric(12,2) not null default 0,
  markup numeric(6,2),                                -- nulo = usa o padrão das configurações
  preco numeric(12,2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Clientes ----------
create table if not exists public.clientes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  nome text not null,
  telefone text not null default '',
  email text not null default '',
  endereco text not null default '',
  aniversario date,
  tags text[] not null default '{}',
  obs text not null default '',
  criado_em date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Pedidos e orçamentos ----------
create table if not exists public.pedidos (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  numero text not null,
  cliente_id text references public.clientes(id) on delete set null,
  itens jsonb not null default '[]'::jsonb,          -- [{produtoId, nome, qtd, preco}]
  entrega jsonb not null default '{}'::jsonb,        -- {data, hora, endereco}
  status text not null default 'orcamento' check (status in ('orcamento','confirmado','producao','entregue','cancelado')),
  pagamento jsonb not null default '{}'::jsonb,      -- {metodo, status, pagoEm}
  desconto numeric(12,2) not null default 0,
  taxa_entrega numeric(12,2) not null default 0,
  mensagem text not null default '',
  obs text not null default '',
  criado_em date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Lançamentos financeiros ----------
create table if not exists public.lancamentos (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  tipo text not null check (tipo in ('receita','despesa')),
  descricao text not null,
  categoria text not null default '',
  valor numeric(12,2) not null default 0,
  vencimento date not null,
  pago_em date,
  pedido_id text references public.pedidos(id) on delete cascade,
  origem text not null default 'manual',             -- manual | pedido | extrato
  conta text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pedidos_user_entrega on public.pedidos (user_id, ((entrega->>'data')));
create index if not exists lancamentos_user_venc on public.lancamentos (user_id, vencimento);
create index if not exists clientes_user_nome on public.clientes (user_id, nome);

-- ---------- updated_at automático ----------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['settings','insumos','produtos','clientes','pedidos','lancamentos'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- Segurança: cada login vê só o que é seu ----------
do $$ declare t text; begin
  foreach t in array array['settings','insumos','produtos','clientes','pedidos','lancamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "dono le" on public.%I', t);
    execute format('drop policy if exists "dono insere" on public.%I', t);
    execute format('drop policy if exists "dono altera" on public.%I', t);
    execute format('drop policy if exists "dono apaga" on public.%I', t);
    execute format('create policy "dono le" on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "dono insere" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "dono altera" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "dono apaga" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- Tempo real: o app recebe as alterações feitas em outro aparelho ----------
do $$ declare t text; begin
  foreach t in array array['settings','insumos','produtos','clientes','pedidos','lancamentos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
