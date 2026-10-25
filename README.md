# SELVA Studio

Sistema de gestão da floricultura **SELVA** (por Kiara Gracie): catálogo com ficha técnica e preço sugerido, clientes, pedidos com orçamento via WhatsApp e financeiro com importação de extrato.

- **Front**: site estático (HTML, CSS e JavaScript puro, sem build) na pasta `web/`.
- **Banco e login**: [Supabase](https://supabase.com) (Postgres + Auth), com dados sincronizados em tempo real entre aparelhos.
- **Sem servidor próprio**: hospede o `web/` em qualquer host estático (Cloudflare Pages, Netlify, Vercel, nginx no Hetzner…).

Enquanto `web/config.js` estiver vazio, o app roda em **modo local** (dados só no navegador) — útil para testar antes de configurar o Supabase.

## 1. Criar o projeto no Supabase (10 min)

1. Em [supabase.com](https://supabase.com) crie um projeto (região `South America (São Paulo)`), anote a senha do banco.
2. **SQL Editor → New query**: cole o conteúdo de `supabase/schema.sql` e rode. Isso cria as tabelas, as regras de segurança (RLS) e liga o tempo real.
3. **Authentication → Providers → Email**: desligue *Allow new users to sign up* (ninguém se cadastra sozinho).
4. **Authentication → Users → Add user → Create new user**: e-mail e senha da Kiara, com *Auto Confirm User* marcado.
5. **Authentication → URL Configuration**: em *Site URL* coloque o endereço onde o app vai ficar (ex.: `https://selva.pages.dev`). É para onde o link de “esqueci minha senha” volta.
6. **Project Settings → API**: copie *Project URL* e a chave *anon public*.

## 2. Configurar o app

Edite `web/config.js`:

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

A chave *anon* é pública por desenho (vai para o navegador de qualquer forma); quem protege os dados é o login e as políticas de RLS do `schema.sql`.

Para testar na sua máquina (módulos ES precisam de http, não de `file://`):

```bash
python3 -m http.server 8080 --directory web
# abra http://localhost:8080
```

## 3. Publicar (Cloudflare Pages)

1. Suba esta pasta para um repositório no GitHub.
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → escolha o repositório.
3. *Build command*: deixe em branco. *Build output directory*: `web`.
4. Deploy. Depois, em *Custom domains*, aponte um domínio (ex.: `studio.selvaporkiara.com`) e atualize a *Site URL* no Supabase.

Qualquer outro host estático funciona igual: basta servir a pasta `web/`.

No celular, abra o endereço e use “Adicionar à tela de início” — o app foi desenhado para telas pequenas (barra de abas inferior).

## Como funciona por dentro

- `web/app.js` carrega todas as tabelas do usuário logado para a memória, renderiza as telas e, a cada alteração, grava só o que mudou (upsert/delete) com um pequeno atraso para agrupar edições. O ponto na barra lateral mostra *Sincronizado / Salvando… / Sem conexão*.
- Uma assinatura de tempo real (`postgres_changes`) recarrega os dados quando outro aparelho altera algo — sem interromper uma edição em andamento.
- **Precificação**: custo = Σ insumo × qtd + custo direto + minutos/60 × R$/h + embalagem + extras; preço sugerido = custo × markup ÷ (1 − taxa do cartão), arredondado para o múltiplo de R$ 5 seguinte.
- Pedido confirmado gera um lançamento de receita vinculado; marcar como recebido no financeiro atualiza o pedido (e vice-versa). Cancelar ou voltar para orçamento remove o lançamento.
- **Extrato**: cole as linhas do internet banking ou escolha o CSV. Cada linha vira um lançamento pago; se existir conta pendente com o mesmo valor em até 7 dias, ela é conciliada em vez de duplicada.
- Cópia de segurança: em Configurações, “Copiar cópia de segurança” gera um JSON com tudo; “Importar cópia” restaura.

## Estrutura

```
web/
  index.html        casca da aplicação (sidebar, telas, gaveta de formulários, login)
  styles.css        identidade SELVA (tokens de cor, tipografia, componentes)
  app.js            dados, regras de negócio, telas e eventos
  config.js         URL e chave anon do Supabase (vazio = modo local)
  assets/           logotipo SVG oficial
supabase/
  schema.sql        tabelas, RLS, triggers e tempo real
```

## Próximas fases

- Eventos (proposta por evento, cronograma, equipe) · Assinaturas florais (planos, rota de entrega, recorrência) · WhatsApp integrado (API oficial).
- Identidade: embutir a fonte Overused Grotesk (hoje substituída pela Hanken Grotesk) e o símbolo da serpente como favicon/avatar.
- Vários logins na mesma loja (Kiara + equipe): basta trocar `user_id` por `loja_id` nas políticas quando chegar a hora.
