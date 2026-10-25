import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/* ===== Persistência: Supabase (com login e sincronização) ou modo local (navegador) ===== */
const LOCAL_KEY = 'selva.studio.v1';
const TABLES = ['insumos','produtos','clientes','pedidos','lancamentos'];
const n_ = v => { const n = parseFloat(String(v??'').replace(',','.')); return isNaN(n)?0:n; };
const toRow = {
  insumos: o=>({id:o.id, nome:o.nome, categoria:o.categoria||'', unidade:o.unidade||'', custo:n_(o.custo), fornecedor:o.fornecedor||'', obs:o.obs||''}),
  produtos: o=>({id:o.id, nome:o.nome, tipo:o.tipo||'arranjo', categoria:o.categoria||'', descricao:o.descricao||'', ficha:o.ficha||[], custo_direto:n_(o.custoDireto), minutos:n_(o.minutos), embalagem:n_(o.embalagem), extras:n_(o.extras), markup:o.markup?n_(o.markup):null, preco:n_(o.preco), ativo:o.ativo!==false}),
  clientes: o=>({id:o.id, nome:o.nome, telefone:o.telefone||'', email:o.email||'', endereco:o.endereco||'', aniversario:o.aniversario||null, tags:o.tags||[], obs:o.obs||'', criado_em:o.criadoEm||null}),
  pedidos: o=>({id:o.id, numero:o.numero, cliente_id:o.clienteId||null, itens:o.itens||[], entrega:o.entrega||{}, status:o.status, pagamento:o.pagamento||{}, desconto:n_(o.desconto), taxa_entrega:n_(o.taxaEntrega), mensagem:o.mensagem||'', obs:o.obs||'', criado_em:o.criadoEm||null}),
  lancamentos: o=>({id:o.id, tipo:o.tipo, descricao:o.descricao, categoria:o.categoria||'', valor:n_(o.valor), vencimento:o.vencimento, pago_em:o.pagoEm||null, pedido_id:o.pedidoId||null, origem:o.origem||'manual', conta:o.conta||''}),
};
const fromRow = {
  insumos: r=>({id:r.id, nome:r.nome, categoria:r.categoria||'', unidade:r.unidade||'', custo:+r.custo||0, fornecedor:r.fornecedor||'', obs:r.obs||''}),
  produtos: r=>({id:r.id, nome:r.nome, tipo:r.tipo||'arranjo', categoria:r.categoria||'', descricao:r.descricao||'', ficha:r.ficha||[], custoDireto:+r.custo_direto||0, minutos:+r.minutos||0, embalagem:+r.embalagem||0, extras:+r.extras||0, markup:r.markup==null?null:+r.markup, preco:+r.preco||0, ativo:r.ativo!==false}),
  clientes: r=>({id:r.id, nome:r.nome, telefone:r.telefone||'', email:r.email||'', endereco:r.endereco||'', aniversario:r.aniversario||'', tags:r.tags||[], obs:r.obs||'', criadoEm:r.criado_em||''}),
  pedidos: r=>({id:r.id, numero:r.numero, clienteId:r.cliente_id||'', itens:r.itens||[], entrega:r.entrega||{}, status:r.status, pagamento:r.pagamento||{}, desconto:+r.desconto||0, taxaEntrega:+r.taxa_entrega||0, mensagem:r.mensagem||'', obs:r.obs||'', criadoEm:r.criado_em||''}),
  lancamentos: r=>({id:r.id, tipo:r.tipo, descricao:r.descricao, categoria:r.categoria||'', valor:+r.valor||0, vencimento:r.vencimento, pagoEm:r.pago_em||null, pedidoId:r.pedido_id||null, origem:r.origem||'manual', conta:r.conta||''}),
};
let sb = null;
const store = {
  mode: (SUPABASE_URL && SUPABASE_ANON_KEY && /^https:\/\/[a-z0-9-]+\.supabase\.co/.test(SUPABASE_URL)) ? 'supabase' : 'local',
  user: null, snapshot: null, _t: null, flushing: false, dirty: false,
  async init(){ if(this.mode!=='supabase') return; const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm'); sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); },
  async getSession(){ if(this.mode!=='supabase') return {local:true}; const {data} = await sb.auth.getSession(); this.user = data.session?.user||null; return data.session; },
  onAuth(cb){ if(sb) sb.auth.onAuthStateChange((ev, session)=>{ this.user = session?.user||null; cb(ev, session); }); },
  async signIn(email, password){ const {error} = await sb.auth.signInWithPassword({email, password}); return error ? traduzErro(error) : null; },
  async resetPassword(email){ const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname}); return error ? traduzErro(error) : null; },
  async updatePassword(password){ const {error} = await sb.auth.updateUser({password}); return error ? traduzErro(error) : null; },
  async signOut(){ if(sb) await sb.auth.signOut(); location.reload(); },
  async load(){
    if(this.mode==='local'){ try{ const raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : null; }catch(e){ return null; } }
    const [st, ...rest] = await Promise.all([sb.from('settings').select('*').maybeSingle(), ...TABLES.map(t=>sb.from(t).select('*'))]);
    const err = [st, ...rest].find(r=>r.error); if(err) throw new Error(err.error.message);
    if(!st.data && rest.every(r=>!r.data.length)) return null;
    const s = { settings: st.data?.data?.settings || {}, seq: st.data?.data?.seq || {pedido:1} };
    TABLES.forEach((t,i)=>{ s[t] = (rest[i].data||[]).map(fromRow[t]); });
    this.snapshot = this.snap(s); return s;
  },
  snap(s){ const o = {settings: JSON.stringify({settings:s.settings, seq:s.seq})}; TABLES.forEach(t=>{ o[t] = new Map((s[t]||[]).map(x=>[x.id, JSON.stringify(toRow[t](x))])); }); return o; },
  persist(s){
    if(this.mode==='local'){ try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); }catch(e){} return; }
    this.dirty = true; setSync('saving'); clearTimeout(this._t); this._t = setTimeout(()=>this.flush(s), 350);
  },
  async flush(s){
    if(this.flushing){ this._t = setTimeout(()=>this.flush(s), 400); return; }
    this.flushing = true; this.dirty = false;
    try{
      const prev = this.snapshot || this.snap({settings:{},seq:{}}); const cur = this.snap(s);
      const ups = {}, dels = {};
      TABLES.forEach(t=>{ ups[t] = []; dels[t] = []; cur[t].forEach((json,id)=>{ if(prev[t].get(id)!==json) ups[t].push(JSON.parse(json)); }); prev[t].forEach((json,id)=>{ if(!cur[t].has(id)) dels[t].push(id); }); });
      for(const t of ['lancamentos','pedidos','clientes','produtos','insumos']){ if(dels[t].length){ const {error} = await sb.from(t).delete().in('id', dels[t]); if(error) throw error; } }
      for(const t of ['insumos','produtos','clientes','pedidos','lancamentos']){ if(ups[t].length){ const {error} = await sb.from(t).upsert(ups[t]); if(error) throw error; } }
      if(prev.settings!==cur.settings){ const {error} = await sb.from('settings').upsert({user_id:this.user.id, data:{settings:s.settings, seq:s.seq}}); if(error) throw error; }
      this.snapshot = cur; setSync(this.dirty ? 'saving' : 'ok');
    }catch(e){ console.error(e); setSync('error'); toast('Não consegui salvar no servidor. Vou tentar de novo.'); clearTimeout(this._t); this._t = setTimeout(()=>this.flush(s), 4000); }
    finally{ this.flushing = false; }
  },
  subscribe(cb){ if(this.mode!=='supabase') return; const ch = sb.channel('selva-sync'); [...TABLES,'settings'].forEach(t=>ch.on('postgres_changes', {event:'*', schema:'public', table:t}, ()=>cb())); ch.subscribe(); },
};
function traduzErro(error){ const m = (error.message||'').toLowerCase(); if(m.includes('invalid login')) return 'E-mail ou senha incorretos.'; if(m.includes('rate limit')) return 'Muitas tentativas. Espere um minuto e tente de novo.'; if(m.includes('email not confirmed')) return 'Confirme o e-mail antes de entrar.'; if(m.includes('password should be')) return 'A senha precisa ter pelo menos 6 caracteres.'; return error.message; }
function setSync(st){ const el = document.getElementById('sync'); if(!el) return; el.dataset.state = st; el.textContent = {ok:'Sincronizado', saving:'Salvando…', error:'Sem conexão — tentando de novo', local:'Salvo neste navegador', offline:'Sem conexão'}[st] || ''; }


/* ===== Store ===== */
const STATUS = {orcamento:'Orçamento', confirmado:'Confirmado', producao:'Em produção', entregue:'Entregue', cancelado:'Cancelado'};
const STATUS_FLOW = ['orcamento','confirmado','producao','entregue'];
const CATS_INSUMO = ['Flores','Folhagens','Vasos','Embalagens','Decoração','Outros'];
const UNIDADES = ['haste','maço','un','m','kg','pct'];
const PAGAMENTOS = ['Pix','Cartão','Dinheiro','Transferência','Link de pagamento'];
let state = null;
const ui = { route:'inicio', tab:{catalogo:'produtos', financeiro:'lancamentos'}, month: null, search:{}, draft:null, drawer:null, filtroPedidos:'ativos', filtroLanc:'todos' };

function uid(){ return Math.random().toString(36).slice(2,8) + Date.now().toString(36).slice(-3); }
function todayISO(){ const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function addDays(iso, n){ const d = new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function monthKey(iso){ return (iso||'').slice(0,7); }
function shiftMonth(key, n){ const [y,m] = key.split('-').map(Number); const d = new Date(y, m-1+n, 1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const MESES_LONGO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function fmtMonth(key){ const [y,m]=key.split('-'); return MESES_LONGO[+m-1]+' '+y; }
function fmtMonthShort(key){ const [y,m]=key.split('-'); return MESES[+m-1]+'/'+y.slice(2); }
const nf = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
function fmt(v){ return nf.format(+v||0); }
function fmtN(v, d=2){ return (+v||0).toLocaleString('pt-BR',{minimumFractionDigits:d, maximumFractionDigits:d}); }
function fmtDate(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return d+'/'+m+'/'+y.slice(2); }
function fmtDateLong(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return `${+d} de ${MESES_LONGO[+m-1].toLowerCase()}`; }
function pct(v){ return v==null ? '—' : (v*100).toFixed(0)+'%'; }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function byId(arr, id){ return arr.find(x=>x.id===id); }
function num(v){ const n = parseFloat(String(v??'').replace(',','.')); return isNaN(n)?0:n; }
function roundUp5(v){ return Math.ceil(v/5)*5; }
function onlyDigits(s){ return String(s||'').replace(/\D/g,''); }
function sortBy(arr, key, desc=false){ return [...arr].sort((a,b)=>{ const x=a[key]??'', y=b[key]??''; return (x<y?-1:x>y?1:0)*(desc?-1:1); }); }

function save(){ store.persist(state); }
function migrate(){ state.settings = Object.assign(defaultSettings(), state.settings||{}); ['insumos','produtos','clientes','pedidos','lancamentos'].forEach(k=>{ if(!Array.isArray(state[k])) state[k]=[]; }); state.seq = state.seq || {pedido: 1}; }
function defaultSettings(){ return { nome:'SELVA', responsavel:'Kiara', whatsapp:'', endereco:'Dr. Melo Alves 287, Jardins — São Paulo', instagram:'@selvaporkiara', horaTrabalho:60, markupArranjo:2.5, markupRevenda:2.2, taxaCartao:4, validadeOrcamento:7, categoriasDespesa:'Flores e folhagens, Vasos e materiais, Embalagens, Aluguel, Energia e água, Pessoal, Marketing, Transporte, Contador e taxas, Outros', demo:false }; }

/* ===== Pricing ===== */
function produtoCusto(p){
  const mat = (p.ficha||[]).reduce((s,r)=>{ const i = byId(state.insumos, r.insumoId); return s + (i ? num(i.custo)*num(r.qtd) : 0); }, 0) + num(p.custoDireto);
  const mo = num(p.minutos)/60 * num(state.settings.horaTrabalho);
  const emb = num(p.embalagem), extras = num(p.extras);
  return { mat, mo, emb, extras, total: mat+mo+emb+extras };
}
function markupDe(p){ return num(p.markup) || (p.tipo==='peca' ? num(state.settings.markupRevenda) : num(state.settings.markupArranjo)) || 1; }
function precoSugerido(p){ const c = produtoCusto(p).total; if(!c) return 0; const taxa = num(state.settings.taxaCartao)/100; const base = c*markupDe(p); return roundUp5(taxa>0 && taxa<1 ? base/(1-taxa) : base); }
function margemDe(p){ const c = produtoCusto(p).total, preco = num(p.preco); if(!preco) return null; const taxa = num(state.settings.taxaCartao)/100; return (preco*(1-taxa)-c)/preco; }
function pedidoTotais(pd){
  const sub = (pd.itens||[]).reduce((s,i)=>s+num(i.qtd)*num(i.preco),0);
  const custo = (pd.itens||[]).reduce((s,i)=>{ const p = byId(state.produtos, i.produtoId); return s + num(i.qtd)*(p ? produtoCusto(p).total : 0); },0);
  const total = Math.max(0, sub - num(pd.desconto) + num(pd.taxaEntrega));
  return { sub, custo, total, margem: total ? (total-custo-num(pd.taxaEntrega))/total : null };
}
function nextNumero(){ const n = state.seq.pedido++; return String(n).padStart(4,'0'); }
function syncPedidoFinanceiro(pd){
  const idx = state.lancamentos.findIndex(l=>l.pedidoId===pd.id);
  const ativo = ['confirmado','producao','entregue'].includes(pd.status);
  if(!ativo){ if(idx>=0) state.lancamentos.splice(idx,1); return; }
  const cli = byId(state.clientes, pd.clienteId); const t = pedidoTotais(pd);
  const base = { tipo:'receita', descricao:`Pedido #${pd.numero} — ${cli?cli.nome:'cliente'}`, categoria:'Vendas', valor:t.total, vencimento: pd.entrega?.data || pd.criadoEm, pagoEm: pd.pagamento?.status==='pago' ? (pd.pagamento.pagoEm||todayISO()) : null, pedidoId: pd.id, origem:'pedido', conta: pd.pagamento?.metodo||'' };
  if(idx>=0) Object.assign(state.lancamentos[idx], base); else state.lancamentos.push(Object.assign({id:uid()}, base));
}
function lancStatus(l){ if(l.pagoEm) return 'pago'; return l.vencimento < todayISO() ? 'atrasado' : 'pendente'; }

/* ===== Seed (example data, clearly marked) ===== */
function seed(){
  const s = { settings: Object.assign(defaultSettings(), {demo:true}), insumos:[], produtos:[], clientes:[], pedidos:[], lancamentos:[], seq:{pedido:12} };
  const I = (nome,categoria,unidade,custo,fornecedor)=>{ const o={id:uid(),nome,categoria,unidade,custo,fornecedor,obs:''}; s.insumos.push(o); return o; };
  const rosa=I('Rosa Avalanche','Flores','haste',6.5,'Veiling Holambra'), tulipa=I('Tulipa Rainha da Noite','Flores','haste',9,'Veiling Holambra'), ranun=I('Ranúnculo','Flores','haste',7.5,'Veiling Holambra'), anem=I('Anêmona','Flores','haste',8,'Veiling Holambra'), lisi=I('Lisianthus branco','Flores','haste',5,'Veiling Holambra'), peon=I('Peônia (sazonal)','Flores','haste',28,'Importadora'), euca=I('Eucalipto cinerea','Folhagens','maço',18,'Veiling Holambra'), ruscus=I('Ruscus','Folhagens','maço',12,'Veiling Holambra'), olivo=I('Olivo','Folhagens','maço',22,'Produtor local'), vasoc=I('Vaso cerâmica baixo','Vasos','un',48,'Ateliê Terra'), vasov=I('Vaso vidro cilíndrico','Vasos','un',32,'Atacado Vidro'), kraft=I('Papel kraft','Embalagens','m',1.8,'Papelaria'), seda=I('Papel de seda','Embalagens','un',0.9,'Papelaria'), fita=I('Fita de cetim bordô','Embalagens','m',2.2,'Armarinho'), caixa=I('Caixa SELVA','Embalagens','un',9.5,'Gráfica'), cartao=I('Cartão SELVA','Embalagens','un',2,'Gráfica'), espuma=I('Espuma floral','Outros','un',6,'Atacado'), cast=I('Castiçal de latão','Decoração','un',65,'Antiquário');
  const F = (...rows)=>rows.map(([i,q])=>({insumoId:i.id,qtd:q}));
  const P = (o)=>{ s.produtos.push(Object.assign({id:uid(),tipo:'arranjo',categoria:'Buquê',descricao:'',ficha:[],minutos:0,embalagem:0,extras:0,custoDireto:0,markup:null,preco:0,ativo:true},o)); return s.produtos[s.produtos.length-1]; };
  const bP=P({nome:'Buquê Selvagem P',categoria:'Buquê',descricao:'Rosas e ranúnculos com eucalipto, amarrado em kraft.',ficha:F([rosa,5],[ranun,2],[euca,0.5],[kraft,1.2],[seda,2],[fita,1],[cartao,1]),minutos:25,preco:240});
  const bM=P({nome:'Buquê Selvagem M',categoria:'Buquê',descricao:'Versão generosa do buquê da casa.',ficha:F([rosa,12],[ranun,5],[lisi,4],[euca,1],[kraft,1.5],[seda,3],[fita,1.5],[cartao,1]),minutos:35,preco:520});
  const rn=P({nome:'Arranjo Rainha da Noite',categoria:'Arranjo',descricao:'Tulipas pretas em vaso de vidro.',ficha:F([tulipa,15],[ruscus,1],[vasov,1],[cartao,1]),minutos:30,preco:550});
  const mesa=P({nome:'Composição de mesa Olivo',categoria:'Arranjo',descricao:'Anêmonas e lisianthus sobre olivo, em cerâmica.',ficha:F([anem,6],[lisi,4],[olivo,1],[vasoc,1],[espuma,1]),minutos:45,preco:490});
  const peoc=P({nome:'Peônias na caixa',categoria:'Arranjo',descricao:'Cinco peônias na caixa SELVA. Sazonal.',ficha:F([peon,5],[caixa,1],[seda,2],[cartao,1]),minutos:20,preco:450});
  const vp=P({nome:'Vaso cerâmica Ateliê Terra',tipo:'peca',categoria:'Vaso',descricao:'Peça de revenda.',custoDireto:48,preco:110});
  const cp=P({nome:'Castiçal de latão',tipo:'peca',categoria:'Decoração',descricao:'Peça de revenda.',custoDireto:65,preco:150});
  const C = (o)=>{ s.clientes.push(Object.assign({id:uid(),telefone:'',email:'',endereco:'',aniversario:'',tags:[],obs:'',criadoEm:'2026-08-01'},o)); return s.clientes[s.clientes.length-1]; };
  const marina=C({nome:'Marina Albuquerque',telefone:'11 99876-1020',email:'marina@exemplo.com',endereco:'Al. Lorena 1200, Jardins',aniversario:'1988-03-14',tags:['recorrente'],obs:'Prefere tons terrosos. Sem lírios (alergia do marido).'});
  const henrique=C({nome:'Henrique Sato',telefone:'11 98712-3344',email:'',endereco:'R. dos Pinheiros 880, Pinheiros',aniversario:'1979-11-02',tags:['presentes']});
  const vertice=C({nome:'Studio Vértice Arquitetura',telefone:'11 3061-7700',email:'contato@exemplo.com',endereco:'R. Oscar Freire 500, Jardins',aniversario:'',tags:['corporativo','eventos'],obs:'Pedidos mensais para a recepção.'});
  const carolina=C({nome:'Carolina Duprat',telefone:'11 97222-0101',email:'',endereco:'R. Pedroso Alvarenga 300, Itaim',aniversario:'1992-07-21',tags:[]});
  const beatriz=C({nome:'Beatriz Mello',telefone:'11 99100-5566',email:'',endereco:'R. Sabará 150, Higienópolis',aniversario:'1985-10-30',tags:['recorrente']});
  const O = (numero,cli,itens,entrega,status,pag,criadoEm,extra={})=>{ const pd=Object.assign({id:uid(),numero,clienteId:cli.id,itens:itens.map(([p,q,pr])=>({produtoId:p.id,nome:p.nome,qtd:q,preco:pr??p.preco})),entrega,status,pagamento:pag,desconto:0,taxaEntrega:entrega.taxa||0,mensagem:'',obs:'',criadoEm},extra); s.pedidos.push(pd); syncPedidoFinanceiro.call(null,pd); return pd; };
  // sync needs state; temporarily point state to s
  const prev = state; state = s;
  O('0003',marina,[[bM,1]],{data:'2026-08-16',hora:'10:00',endereco:marina.endereco,taxa:25},'entregue',{metodo:'Pix',status:'pago',pagoEm:'2026-08-15'},'2026-08-12');
  O('0004',vertice,[[mesa,2]],{data:'2026-09-02',hora:'08:30',endereco:vertice.endereco,taxa:0},'entregue',{metodo:'Transferência',status:'pago',pagoEm:'2026-09-10'},'2026-08-28');
  O('0005',henrique,[[rn,1],[cp,1]],{data:'2026-09-20',hora:'14:00',endereco:henrique.endereco,taxa:25},'entregue',{metodo:'Cartão',status:'pago',pagoEm:'2026-09-19'},'2026-09-17');
  O('0006',marina,[[vp,1],[bP,1]],{data:'2026-10-04',hora:'11:00',endereco:marina.endereco,taxa:25},'entregue',{metodo:'Pix',status:'pago',pagoEm:'2026-10-03'},'2026-10-01');
  O('0007',marina,[[bM,1]],{data:'2026-10-18',hora:'16:00',endereco:marina.endereco,taxa:25},'entregue',{metodo:'Pix',status:'pago',pagoEm:'2026-10-18'},'2026-10-15',{mensagem:'Para a Lu, com saudade.'});
  O('0008',vertice,[[mesa,3]],{data:'2026-10-28',hora:'08:30',endereco:vertice.endereco,taxa:0},'confirmado',{metodo:'Transferência',status:'pendente'},'2026-10-20');
  O('0009',henrique,[[rn,1]],{data:'2026-10-26',hora:'15:00',endereco:'R. Haddock Lobo 1300, Jardins',taxa:25},'producao',{metodo:'Cartão',status:'pago',pagoEm:'2026-10-24'},'2026-10-23',{mensagem:'Feliz aniversário, mãe.'});
  O('0010',carolina,[[bP,1],[cp,1]],{data:'2026-10-31',hora:'',endereco:carolina.endereco,taxa:25},'orcamento',{metodo:'',status:'pendente'},'2026-10-24');
  O('0011',beatriz,[[peoc,1]],{data:'2026-11-02',hora:'10:00',endereco:beatriz.endereco,taxa:25},'confirmado',{metodo:'Pix',status:'pendente'},'2026-10-25');
  const L = (tipo,descricao,categoria,valor,vencimento,pagoEm,conta='')=>s.lancamentos.push({id:uid(),tipo,descricao,categoria,valor,vencimento,pagoEm,origem:'manual',conta});
  ['2026-08','2026-09','2026-10'].forEach((m,k)=>{
    L('despesa','Aluguel do studio','Aluguel',6800,m+'-05',m+'-05','Transferência');
    L('despesa','Veiling Holambra — compra semanal','Flores e folhagens',1180+k*90,m+'-07',m+'-07','Pix');
    L('despesa','Veiling Holambra — compra semanal','Flores e folhagens',1260+k*40,m+'-21',m+'-21','Pix');
    L('despesa','Energia (Enel)','Energia e água',390+k*15,m+'-28',m+'-28','Débito');
    L('despesa','Entregas (motoboy)','Transporte',280+k*30,m+'-30',m+'-30','Pix');
    L('despesa','Contador','Contador e taxas',350,m+'-10',m+'-10','Transferência');
  });
  L('despesa','Gráfica — caixas e cartões','Embalagens',640,'2026-10-12','2026-10-12','Pix');
  L('despesa','Ensaio fotográfico (lançamento)','Marketing',800,'2026-10-15','2026-10-15','Pix');
  L('despesa','Veiling Holambra — compra semanal','Flores e folhagens',980,'2026-10-27',null,'Pix');
  L('despesa','Energia (Enel)','Energia e água',420,'2026-10-30',null,'Débito');
  L('despesa','Aluguel do studio','Aluguel',6800,'2026-11-05',null,'Transferência');
  L('despesa','Contador','Contador e taxas',350,'2026-11-10',null,'Transferência');
  L('receita','Venda balcão — vasos e peças','Vendas',760,'2026-10-11','2026-10-11','Cartão');
  L('receita','Venda balcão — buquês prontos','Vendas',540,'2026-10-19','2026-10-19','Pix');
  L('receita','Venda balcão — buquês prontos','Vendas',430,'2026-09-13','2026-09-13','Pix');
  L('receita','Venda balcão — vasos','Vendas',620,'2026-08-23','2026-08-23','Cartão');
  state = prev;
  return s;
}

/* ===== UI plumbing ===== */
const $ = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>[...root.querySelectorAll(sel)];
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2400); }
let dialogResolve=null;
function confirmDialog(title, text, okLabel='Confirmar', danger=false){
  $('#dialog-title').textContent=title; $('#dialog-text').textContent=text; const ok=$('#dialog-ok'); ok.textContent=okLabel; ok.className='btn '+(danger?'btn-danger btn-ghost':'btn-primary');
  $('#dialog-wrap').classList.add('open'); return new Promise(res=>{ dialogResolve=res; });
}
function closeDialog(v){ $('#dialog-wrap').classList.remove('open'); if(dialogResolve){ dialogResolve(v); dialogResolve=null; } }
function openDrawer(eyebrow, title, bodyHtml, footHtml){ ui.drawer={eyebrow,title}; $('#drawer-eyebrow').textContent=eyebrow; $('#drawer-title').textContent=title; $('#drawer-body').innerHTML=bodyHtml; $('#drawer-foot').innerHTML=footHtml||''; $('#drawer-wrap').classList.add('open'); const f=$('#drawer-body input,#drawer-body select,#drawer-body textarea'); if(f && window.innerWidth>860) setTimeout(()=>f.focus(),30); }
function closeDrawer(){ $('#drawer-wrap').classList.remove('open'); ui.draft=null; ui.drawer=null; }
function copyText(txt){ return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject()).then(()=>true).catch(()=>{ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); return ok; }); }
function waLink(phone, text){ const d = onlyDigits(phone); const full = d.length<=11 ? '55'+d : d; return 'https://wa.me/'+full+'?text='+encodeURIComponent(text); }

const ROUTES = ['inicio','catalogo','clientes','pedidos','financeiro','config','eventos','assinaturas','whatsapp'];
function go(route){ if(!ROUTES.includes(route)) route='inicio'; ui.route=route; if(location.hash.slice(1)!==route){ try{ history.replaceState(null,'','#'+route); }catch(e){} } render(); window.scrollTo({top:0}); }
function render(){
  $$('#nav a, #tabbar a, .topbar a').forEach(a=>a.classList.toggle('active', a.dataset.to===ui.route));
  const fn = VIEWS[ui.route] || VIEWS.inicio; $('#view').innerHTML = fn();
  if(ui.route==='financeiro') afterFinanceiro();
}
function field(label, inner){ return `<div class="field"><span class="lbl">${label}</span>${inner}</div>`; }
function inp(name, val, attrs=''){ return `<input name="${name}" id="f-${name}" value="${esc(val??'')}" ${attrs}>`; }
function sel(name, val, opts, attrs=''){ return `<select name="${name}" id="f-${name}" ${attrs}>${opts.map(o=>{ const [v,l]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(v)}" ${String(v)===String(val??'')?'selected':''}>${esc(l)}</option>`; }).join('')}</select>`; }
function fd(form){ const o={}; new FormData(form).forEach((v,k)=>o[k]=v); return o; }


const VIEWS = {};
function pageHead(eyebrow, title, lead, actions=''){ return `<div class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${lead?`<p class="lead">${lead}</p>`:''}</div><div class="actions">${actions}</div></div>`; }
function demoBanner(){ if(!state.settings.demo && !state.produtos.length && !state.clientes.length && !state.pedidos.length) return `<div class="banner"><span class="ms">spa</span><span>Bem-vinda ao seu sistema. Comece pelo <strong>Catálogo</strong> (insumos e produtos) ou, se preferir ver tudo funcionando primeiro, carregue os dados de exemplo em Configurações.</span></div>`; return state.settings.demo ? `<div class="banner"><span class="ms">info</span><span>Você está vendo <strong>dados de exemplo</strong> para conhecer o sistema. Quando quiser começar de verdade, vá em Configurações e escolha “Limpar tudo”.</span></div>` : ''; }
function chip(status, label){ return `<span class="chip ${status}">${label||STATUS[status]||status}</span>`; }

/* ===== Início ===== */
VIEWS.inicio = function(){
  const hoje = todayISO(), mk = monthKey(hoje);
  const pedidosMes = state.pedidos.filter(p=>!['orcamento','cancelado'].includes(p.status) && monthKey(p.entrega?.data||p.criadoEm)===mk);
  const vendasMes = pedidosMes.reduce((s,p)=>s+pedidoTotais(p).total,0);
  const receitasBalcao = state.lancamentos.filter(l=>l.tipo==='receita' && !l.pedidoId && monthKey(l.vencimento)===mk).reduce((s,l)=>s+num(l.valor),0);
  const aReceber = state.lancamentos.filter(l=>l.tipo==='receita' && !l.pagoEm).reduce((s,l)=>s+num(l.valor),0);
  const aPagar = state.lancamentos.filter(l=>l.tipo==='despesa' && !l.pagoEm && l.vencimento<=addDays(hoje,7));
  const aPagarV = aPagar.reduce((s,l)=>s+num(l.valor),0);
  const orcs = state.pedidos.filter(p=>p.status==='orcamento');
  const orcsV = orcs.reduce((s,p)=>s+pedidoTotais(p).total,0);
  const margens = state.produtos.filter(p=>p.ativo!==false && num(p.preco)>0).map(margemDe).filter(m=>m!=null);
  const margemMedia = margens.length ? margens.reduce((a,b)=>a+b,0)/margens.length : null;
  const entregas = sortBy(state.pedidos.filter(p=>['confirmado','producao'].includes(p.status) || (p.status==='orcamento' && p.entrega?.data>=hoje)).filter(p=>p.entrega?.data), 'entrega.data');
  entregas.sort((a,b)=>(a.entrega.data+a.entrega.hora).localeCompare(b.entrega.data+b.entrega.hora));
  const vencs = sortBy(state.lancamentos.filter(l=>!l.pagoEm && l.vencimento<=addDays(hoje,10)),'vencimento');
  const aniv = state.clientes.filter(c=>c.aniversario).map(c=>{ const md=c.aniversario.slice(5); const y=hoje.slice(0,4); let d=y+'-'+md; if(d<hoje) d=(+y+1)+'-'+md; return {c,d}; }).filter(x=>x.d<=addDays(hoje,30)).sort((a,b)=>a.d.localeCompare(b.d));
  const h = new Date().getHours(); const sauda = h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';
  return pageHead(fmtDateLong(hoje)+' · '+fmtMonth(mk).split(' ')[1], `${sauda}, ${esc(state.settings.responsavel||'')}`, 'Composição em estado selvagem.', `<button class="btn btn-primary" data-action="new-pedido"><span class="ms">add</span>Novo pedido</button>`)
  + demoBanner()
  + `<div class="kpis">
      <div class="kpi"><span class="eyebrow">Vendas do mês</span><span class="v">${fmt(vendasMes+receitasBalcao)}</span><span class="s">${pedidosMes.length} pedido${pedidosMes.length===1?'':'s'}${receitasBalcao?` · balcão ${fmt(receitasBalcao)}`:''}</span></div>
      <div class="kpi"><span class="eyebrow">A receber</span><span class="v">${fmt(aReceber)}</span><span class="s">pedidos confirmados sem pagamento</span></div>
      <div class="kpi"><span class="eyebrow">A pagar · 7 dias</span><span class="v ${aPagar.some(l=>lancStatus(l)==='atrasado')?'neg':''}">${fmt(aPagarV)}</span><span class="s">${aPagar.length} conta${aPagar.length===1?'':'s'}${aPagar.some(l=>lancStatus(l)==='atrasado')?' · há atrasadas':''}</span></div>
      <div class="kpi"><span class="eyebrow">Orçamentos abertos</span><span class="v">${orcs.length}</span><span class="s">${fmt(orcsV)} em negociação</span></div>
      <div class="kpi"><span class="eyebrow">Margem média</span><span class="v">${pct(margemMedia)}</span><span class="s">sobre o preço dos produtos</span></div>
    </div>
    <div class="two">
      <section class="section"><div class="section-head"><h2>Próximas entregas</h2><a href="#pedidos" class="btn btn-text btn-sm" data-action="nav" data-to="pedidos">Ver pedidos</a></div>
        ${entregas.length? `<div class="list">${entregas.slice(0,8).map(p=>{ const c=byId(state.clientes,p.clienteId); return `<div class="item" data-action="edit-pedido" data-id="${p.id}"><div><div class="t1">${esc(c?c.nome:'—')} <span class="muted">· #${p.numero}</span></div><div class="t2">${p.itens.map(i=>`${i.qtd}× ${esc(i.nome)}`).join(', ')}</div></div><div class="right"><div class="tnum">${fmtDate(p.entrega.data)}${p.entrega.hora?' · '+p.entrega.hora:''}</div>${chip(p.status)}</div></div>`; }).join('')}</div>` : `<div class="empty"><p>Nenhuma entrega agendada.</p><button class="btn btn-ghost btn-sm" data-action="new-pedido">Registrar pedido</button></div>`}
      </section>
      <section class="section"><div class="section-head"><h2>Vencimentos · 10 dias</h2><a href="#financeiro" class="btn btn-text btn-sm" data-action="nav" data-to="financeiro">Ver financeiro</a></div>
        ${vencs.length? `<div class="list">${vencs.slice(0,8).map(l=>`<div class="item" data-action="lanc-edit" data-id="${l.id}"><div><div class="t1">${esc(l.descricao)}</div><div class="t2">${esc(l.categoria)} · ${fmtDate(l.vencimento)}</div></div><div class="right"><div class="tnum ${l.tipo==='despesa'?'':'pos'}">${l.tipo==='despesa'?'− ':'+ '}${fmt(l.valor)}</div>${chip(lancStatus(l), lancStatus(l)==='atrasado'?'Atrasado':l.tipo==='despesa'?'A pagar':'A receber')}</div></div>`).join('')}</div>` : `<div class="empty"><p>Nada vencendo nos próximos dias.</p></div>`}
        ${aniv.length? `<div class="section-head" style="margin-top:28px"><h2>Aniversários · 30 dias</h2></div><div class="list">${aniv.slice(0,5).map(x=>`<div class="item" data-action="edit-cliente" data-id="${x.c.id}"><div><div class="t1">${esc(x.c.nome)}</div><div class="t2">${fmtDateLong(x.d)}</div></div><span class="ms muted">cake</span></div>`).join('')}</div>`:''}
      </section>
    </div>`;
};

/* ===== Catálogo ===== */
VIEWS.catalogo = function(){
  const tab = ui.tab.catalogo; const q=(ui.search.catalogo||'').toLowerCase();
  const head = pageHead('Catálogo', 'Produtos e insumos', 'Cada arranjo nasce de uma ficha técnica: o custo real sugere o preço.', `<div class="seg"><button class="${tab==='produtos'?'on':''}" data-action="tab" data-scope="catalogo" data-tab="produtos">Produtos</button><button class="${tab==='insumos'?'on':''}" data-action="tab" data-scope="catalogo" data-tab="insumos">Insumos</button></div>${tab==='produtos'?`<button class="btn btn-primary" data-action="new-produto"><span class="ms">add</span>Novo produto</button>`:`<button class="btn btn-primary" data-action="new-insumo"><span class="ms">add</span>Novo insumo</button>`}`);
  const search = `<div class="toolbar"><label class="search"><span class="ms">search</span><input id="search-catalogo" placeholder="${tab==='produtos'?'Buscar produto':'Buscar insumo ou fornecedor'}" value="${esc(ui.search.catalogo||'')}" data-search="catalogo"></label></div>`;
  if(tab==='insumos'){
    const rows = sortBy(state.insumos.filter(i=>!q || (i.nome+' '+i.fornecedor+' '+i.categoria).toLowerCase().includes(q)),'nome');
    const usos = {}; state.produtos.forEach(p=>(p.ficha||[]).forEach(r=>{ usos[r.insumoId]=(usos[r.insumoId]||0)+1; }));
    return head + search + (rows.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Insumo</th><th>Categoria</th><th>Fornecedor</th><th class="num">Custo</th><th class="num">Em produtos</th></tr></thead><tbody>${rows.map(i=>`<tr class="row" data-action="edit-insumo" data-id="${i.id}"><td class="primary">${esc(i.nome)}</td><td>${esc(i.categoria)}</td><td class="muted">${esc(i.fornecedor||'—')}</td><td class="num">${fmt(i.custo)} <span class="muted">/ ${esc(i.unidade)}</span></td><td class="num">${usos[i.id]||0}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><p>Nenhum insumo cadastrado ainda. Flores, folhagens, vasos e embalagens entram aqui com o custo por unidade.</p><button class="btn btn-ghost btn-sm" data-action="new-insumo">Cadastrar insumo</button></div>`);
  }
  const prods = sortBy(state.produtos.filter(p=>!q || (p.nome+' '+p.categoria).toLowerCase().includes(q)),'nome');
  return head + search + (prods.length ? `<div class="cards">${prods.map(p=>{ const c=produtoCusto(p).total, m=margemDe(p), sug=precoSugerido(p); const below = num(p.preco)>0 && num(p.preco)<sug; return `<div class="card" data-action="edit-produto" data-id="${p.id}"><div class="meta"><span>${esc(p.categoria||(p.tipo==='peca'?'Peça':'Arranjo'))}${p.ativo===false?' · inativo':''}</span><span>${p.tipo==='peca'?'revenda':`${(p.ficha||[]).length} insumos`}</span></div><div class="name">${esc(p.nome)}</div><div class="price">${num(p.preco)?fmt(p.preco):'<span class="muted">sem preço</span>'}</div><div class="bar"><i style="width:${Math.max(0,Math.min(100,(m||0)*100))}%"></i></div><div class="meta"><span>custo ${fmt(c)}</span><span class="${below?'neg':''}">${m==null?'defina o preço':'margem '+pct(m)}${below?' · abaixo da sugestão':''}</span></div></div>`; }).join('')}</div>` : `<div class="empty"><p>Nenhum produto ainda. Monte o primeiro arranjo com sua ficha técnica.</p><button class="btn btn-ghost btn-sm" data-action="new-produto">Criar produto</button></div>`);
};

function insumoForm(i){
  i = i || {nome:'',categoria:'Flores',unidade:'haste',custo:'',fornecedor:'',obs:''};
  const body = `<form class="form" id="form-insumo" data-form="insumo"><input type="hidden" name="id" value="${i.id||''}">
    ${field('Nome', inp('nome', i.nome, 'required placeholder="Ex.: Rosa Avalanche"'))}
    <div class="grid3">${field('Categoria', sel('categoria', i.categoria, CATS_INSUMO))}${field('Unidade', sel('unidade', i.unidade, UNIDADES))}${field('Custo por unidade (R$)', inp('custo', i.custo, 'type="number" step="0.01" min="0" required inputmode="decimal"'))}</div>
    ${field('Fornecedor', inp('fornecedor', i.fornecedor, 'placeholder="Ex.: Veiling Holambra"'))}
    ${field('Observações', `<textarea name="obs" id="f-obs" placeholder="Sazonalidade, cuidados, lote mínimo…">${esc(i.obs||'')}</textarea>`)}
  </form>`;
  const foot = `${i.id?`<button class="btn btn-danger btn-sm" data-action="delete-insumo" data-id="${i.id}">Excluir</button>`:'<span></span>'}<div class="actions"><button class="btn btn-ghost" data-action="close-drawer">Cancelar</button><button class="btn btn-primary" type="submit" form="form-insumo">Salvar insumo</button></div>`;
  openDrawer(i.id?'Insumo':'Novo insumo', i.id?i.nome:'Cadastrar insumo', body, foot);
}
function saveInsumo(d){ const o = { nome:d.nome.trim(), categoria:d.categoria, unidade:d.unidade, custo:num(d.custo), fornecedor:d.fornecedor.trim(), obs:d.obs.trim() }; if(d.id){ Object.assign(byId(state.insumos,d.id), o); } else state.insumos.push(Object.assign({id:uid()},o)); save(); closeDrawer(); render(); toast('Insumo salvo'); }

function produtoDraft(p){ return p ? JSON.parse(JSON.stringify(p)) : {nome:'',tipo:'arranjo',categoria:'Buquê',descricao:'',ficha:[],minutos:'',embalagem:'',extras:'',custoDireto:'',markup:'',preco:'',ativo:true}; }
function produtoForm(p){
  ui.draft = produtoDraft(p);
  const d = ui.draft;
  openDrawer(d.id?'Produto':'Novo produto', d.id?d.nome:'Criar produto', produtoBody(d), `${d.id?`<button class="btn btn-danger btn-sm" data-action="delete-produto" data-id="${d.id}">Excluir</button>`:'<span></span>'}<div class="actions"><button class="btn btn-ghost" data-action="close-drawer">Cancelar</button><button class="btn btn-primary" type="submit" form="form-produto">Salvar produto</button></div>`);
}
function produtoBody(d){
  const insumoOpts = [['','Escolher insumo…'], ...sortBy(state.insumos,'nome').map(i=>[i.id, `${i.nome} — ${fmt(i.custo)}/${i.unidade}`])];
  const ficha = (d.ficha||[]).map((r,k)=>{ const i=byId(state.insumos,r.insumoId); return `<div class="ficha-row"><select data-draft="ficha.${k}.insumoId" id="ficha-i-${k}">${insumoOpts.map(([v,l])=>`<option value="${esc(v)}" ${v===r.insumoId?'selected':''}>${esc(l)}</option>`).join('')}</select><input type="number" step="0.01" min="0" inputmode="decimal" data-draft="ficha.${k}.qtd" id="ficha-q-${k}" value="${esc(r.qtd)}" placeholder="qtd"><span class="num small tnum">${i?fmt(num(i.custo)*num(r.qtd)):'—'}</span><button type="button" class="icon-btn" data-action="ficha-del" data-idx="${k}" aria-label="Remover"><span class="ms">close</span></button></div>`; }).join('');
  return `<form class="form" id="form-produto" data-form="produto"><input type="hidden" name="id" value="${d.id||''}">
    <div class="grid2">${field('Tipo', sel('tipo', d.tipo, [['arranjo','Arranjo (com ficha técnica)'],['peca','Peça de revenda']], 'data-draft="tipo"'))}${field('Categoria', inp('categoria', d.categoria, 'placeholder="Buquê, Arranjo, Vaso…" list="cats"'))}<datalist id="cats"><option>Buquê</option><option>Arranjo</option><option>Vaso</option><option>Decoração</option><option>Caixa</option></datalist></div>
    ${field('Nome', inp('nome', d.nome, 'required placeholder="Ex.: Buquê Selvagem M" data-draft="nome"'))}
    ${field('Descrição curta', inp('descricao', d.descricao, 'placeholder="Como você descreveria no orçamento"'))}
    <div>
      <div class="section-head"><h2>Ficha técnica</h2><button type="button" class="btn btn-ghost btn-sm" data-action="ficha-add"><span class="ms">add</span>Insumo</button></div>
      ${ficha ? `<div class="ficha-row ficha-head"><span>Insumo</span><span>Qtd</span><span class="right">Custo</span><span></span></div><div class="form" style="gap:8px">${ficha}</div>` : `<p class="help">${d.tipo==='peca'?'Peças de revenda podem usar só o custo direto abaixo.':'Adicione flores, folhagens, vaso e embalagem com as quantidades usadas em uma unidade.'}</p>`}
    </div>
    <div class="grid2">${field('Custo direto (R$)', inp('custoDireto', d.custoDireto, 'type="number" step="0.01" min="0" inputmode="decimal" data-draft="custoDireto" placeholder="Compra da peça ou extras"'))}${field('Mão de obra (minutos)', inp('minutos', d.minutos, 'type="number" step="1" min="0" inputmode="numeric" data-draft="minutos" placeholder="0"'))}</div>
    <div class="grid2">${field('Embalagem extra (R$)', inp('embalagem', d.embalagem, 'type="number" step="0.01" min="0" inputmode="decimal" data-draft="embalagem"'))}${field('Outros custos (R$)', inp('extras', d.extras, 'type="number" step="0.01" min="0" inputmode="decimal" data-draft="extras"'))}</div>
    <div id="ficha-summary">${fichaSummary(d)}</div>
    <div class="grid2">${field('Markup (×)', inp('markup', d.markup, `type="number" step="0.1" min="1" inputmode="decimal" data-draft="markup" placeholder="padrão ${d.tipo==='peca'?state.settings.markupRevenda:state.settings.markupArranjo}"`))}${field('Preço de venda (R$)', inp('preco', d.preco, 'type="number" step="1" min="0" inputmode="decimal" data-draft="preco" required'))}</div>
    <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ativo" ${d.ativo!==false?'checked':''}> Produto ativo no catálogo</label>
  </form>`;
}
function fichaSummary(d){
  const c = produtoCusto(d), sug = precoSugerido(d), m = margemDe(d); const hora = num(state.settings.horaTrabalho);
  return `<div class="summary">
    <div class="row"><span>Materiais</span><span class="tnum">${fmt(c.mat)}</span></div>
    <div class="row"><span>Mão de obra <span class="muted">(${num(d.minutos)||0} min × ${fmt(hora)}/h)</span></span><span class="tnum">${fmt(c.mo)}</span></div>
    ${c.emb||c.extras?`<div class="row"><span>Embalagem e outros</span><span class="tnum">${fmt(c.emb+c.extras)}</span></div>`:''}
    <div class="row total"><span>Custo por unidade</span><span class="tnum">${fmt(c.total)}</span></div>
    <div class="row" style="align-items:center;margin-top:4px"><span>Preço sugerido <span class="muted">(markup ${fmtN(markupDe(d),1)}×${num(state.settings.taxaCartao)?`, taxa ${num(state.settings.taxaCartao)}%`:''})</span></span><span class="actions"><strong class="tnum">${fmt(sug)}</strong><button type="button" class="btn btn-ghost btn-sm" data-action="use-suggested" data-val="${sug}">Usar</button></span></div>
    <div class="row"><span>Margem com o preço atual</span><span class="tnum ${m!=null&&m<0.5?'neg':'pos'}">${pct(m)}${m!=null&&num(d.preco)?` · lucro ${fmt(num(d.preco)*(1-num(state.settings.taxaCartao)/100)-c.total)}`:''}</span></div>
  </div>`;
}
function setDraft(path, val){ const parts=path.split('.'); let o=ui.draft; for(let k=0;k<parts.length-1;k++){ o = o[parts[k]]; } o[parts[parts.length-1]] = val; }
function refreshFichaSummary(){ const el=$('#ficha-summary'); if(el && ui.draft) el.innerHTML = fichaSummary(ui.draft); $$('#drawer-body .ficha-row').forEach((row,k)=>{ const r=ui.draft.ficha[k-1]; if(!r) return; const i=byId(state.insumos,r.insumoId); const span=row.querySelector('span.num'); if(span) span.textContent = i?fmt(num(i.custo)*num(r.qtd)):'—'; }); }
function saveProduto(d){
  const o = { nome:d.nome.trim(), tipo:d.tipo, categoria:d.categoria.trim(), descricao:d.descricao.trim(), ficha:(ui.draft.ficha||[]).filter(r=>r.insumoId && num(r.qtd)>0).map(r=>({insumoId:r.insumoId, qtd:num(r.qtd)})), custoDireto:num(d.custoDireto), minutos:num(d.minutos), embalagem:num(d.embalagem), extras:num(d.extras), markup:num(d.markup)||null, preco:num(d.preco), ativo: d.ativo==='on' };
  if(d.id){ Object.assign(byId(state.produtos,d.id), o); } else state.produtos.push(Object.assign({id:uid()},o));
  save(); closeDrawer(); render(); toast('Produto salvo');
}


/* ===== Clientes ===== */
function clienteStats(c){ const ps = state.pedidos.filter(p=>p.clienteId===c.id && !['cancelado','orcamento'].includes(p.status)); const total = ps.reduce((s,p)=>s+pedidoTotais(p).total,0); const ultimo = ps.map(p=>p.entrega?.data||p.criadoEm).sort().pop(); return {n:ps.length,total,ultimo}; }
VIEWS.clientes = function(){
  const q=(ui.search.clientes||'').toLowerCase();
  const rows = sortBy(state.clientes.filter(c=>!q || (c.nome+' '+c.telefone+' '+(c.tags||[]).join(' ')+' '+c.endereco).toLowerCase().includes(q)),'nome');
  return pageHead('Clientes', 'Quem compra da SELVA', 'Histórico, datas importantes e preferências de cada pessoa.', `<button class="btn btn-primary" data-action="new-cliente"><span class="ms">person_add</span>Novo cliente</button>`)
  + `<div class="toolbar"><label class="search"><span class="ms">search</span><input id="search-clientes" placeholder="Buscar por nome, telefone, tag" value="${esc(ui.search.clientes||'')}" data-search="clientes"></label><span class="muted small">${rows.length} cliente${rows.length===1?'':'s'}</span></div>`
  + (rows.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Cliente</th><th>Contato</th><th>Tags</th><th class="num">Pedidos</th><th class="num">Total comprado</th><th>Último pedido</th></tr></thead><tbody>${rows.map(c=>{ const s=clienteStats(c); return `<tr class="row" data-action="edit-cliente" data-id="${c.id}"><td><span class="primary">${esc(c.nome)}</span><span class="sub">${esc(c.endereco||'')}</span></td><td class="tnum">${esc(c.telefone||'—')}${c.email?`<span class="sub">${esc(c.email)}</span>`:''}</td><td><div class="pills">${(c.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</div></td><td class="num">${s.n}</td><td class="num">${fmt(s.total)}</td><td class="tnum">${s.ultimo?fmtDate(s.ultimo):'—'}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty"><p>Nenhum cliente ainda.</p><button class="btn btn-ghost btn-sm" data-action="new-cliente">Cadastrar cliente</button></div>`);
};
function clienteForm(c){
  const novo = !c; c = c || {nome:'',telefone:'',email:'',endereco:'',aniversario:'',tags:[],obs:''};
  const hist = novo ? '' : (()=>{ const ps = sortBy(state.pedidos.filter(p=>p.clienteId===c.id),'criadoEm',true); const s=clienteStats(c); return `<div class="section" style="margin-top:28px"><div class="section-head"><h2>Histórico</h2><span class="muted small">${s.n} pedido${s.n===1?'':'s'} · ${fmt(s.total)}</span></div>${ps.length?`<div class="list">${ps.map(p=>`<div class="item" data-action="edit-pedido" data-id="${p.id}"><div><div class="t1">#${p.numero} · ${fmtDate(p.entrega?.data||p.criadoEm)}</div><div class="t2">${p.itens.map(i=>`${i.qtd}× ${esc(i.nome)}`).join(', ')}</div></div><div class="right"><div class="tnum">${fmt(pedidoTotais(p).total)}</div>${chip(p.status)}</div></div>`).join('')}</div>`:`<p class="help">Ainda sem pedidos.</p>`}</div>`; })();
  const body = `<form class="form" id="form-cliente" data-form="cliente"><input type="hidden" name="id" value="${c.id||''}">
    ${field('Nome', inp('nome', c.nome, 'required placeholder="Nome ou empresa"'))}
    <div class="grid2">${field('WhatsApp / telefone', inp('telefone', c.telefone, 'inputmode="tel" placeholder="11 9xxxx-xxxx"'))}${field('E-mail', inp('email', c.email, 'type="email"'))}</div>
    ${field('Endereço de entrega', inp('endereco', c.endereco, 'placeholder="Rua, número, bairro"'))}
    <div class="grid2">${field('Aniversário', inp('aniversario', c.aniversario, 'type="date"'))}${field('Tags', inp('tags', (c.tags||[]).join(', '), 'placeholder="recorrente, corporativo, eventos"'))}</div>
    ${field('Observações', `<textarea name="obs" id="f-obs" placeholder="Preferências, alergias, o que não pode faltar…">${esc(c.obs||'')}</textarea>`)}
  </form>${hist}`;
  const foot = `${novo?'<span></span>':`<div class="actions"><button class="btn btn-danger btn-sm" data-action="delete-cliente" data-id="${c.id}">Excluir</button></div>`}<div class="actions">${!novo&&c.telefone?`<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${waLink(c.telefone, `Olá, ${c.nome.split(' ')[0]}! `)}"><span class="ms">chat</span>WhatsApp</a>`:''}${novo?'':`<button class="btn btn-ghost btn-sm" data-action="new-pedido" data-cliente="${c.id}"><span class="ms">add</span>Pedido</button>`}<button class="btn btn-primary" type="submit" form="form-cliente">Salvar</button></div>`;
  openDrawer(novo?'Novo cliente':'Cliente', novo?'Cadastrar cliente':c.nome, body, foot);
}
function saveCliente(d){ const o={nome:d.nome.trim(),telefone:d.telefone.trim(),email:d.email.trim(),endereco:d.endereco.trim(),aniversario:d.aniversario,tags:d.tags.split(',').map(t=>t.trim()).filter(Boolean),obs:d.obs.trim()}; let id=d.id; if(id){ Object.assign(byId(state.clientes,id),o); } else { id=uid(); state.clientes.push(Object.assign({id,criadoEm:todayISO()},o)); } save(); closeDrawer(); render(); toast('Cliente salvo'); return id; }

/* ===== Pedidos ===== */
VIEWS.pedidos = function(){
  const f = ui.filtroPedidos; const hoje=todayISO();
  let rows = state.pedidos.filter(p => f==='ativos' ? ['orcamento','confirmado','producao'].includes(p.status) : f==='todos' ? true : p.status===f);
  rows.sort((a,b)=>((a.entrega?.data||a.criadoEm)+(a.entrega?.hora||'')).localeCompare((b.entrega?.data||b.criadoEm)+(b.entrega?.hora||'')) * (f==='entregue'||f==='todos'?-1:1));
  const counts = {}; state.pedidos.forEach(p=>counts[p.status]=(counts[p.status]||0)+1);
  const segs = [['ativos','Em aberto'],['orcamento','Orçamentos'],['producao','Em produção'],['entregue','Entregues'],['todos','Todos']];
  return pageHead('Pedidos', 'Pedidos e orçamentos', 'Do orçamento à entrega, com o pagamento acompanhando cada etapa.', `<button class="btn btn-primary" data-action="new-pedido"><span class="ms">add</span>Novo pedido</button>`)
  + `<div class="toolbar"><div class="seg">${segs.map(([v,l])=>`<button class="${f===v?'on':''}" data-action="filtro-pedidos" data-val="${v}">${l}${v==='orcamento'&&counts.orcamento?` (${counts.orcamento})`:''}</button>`).join('')}</div></div>`
  + (rows.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Nº</th><th>Cliente</th><th>Itens</th><th>Entrega</th><th class="num">Total</th><th>Pagamento</th><th>Status</th></tr></thead><tbody>${rows.map(p=>{ const c=byId(state.clientes,p.clienteId); const t=pedidoTotais(p); const atrasado = p.entrega?.data && p.entrega.data<hoje && ['confirmado','producao'].includes(p.status); return `<tr class="row" data-action="edit-pedido" data-id="${p.id}"><td class="tnum muted">#${p.numero}</td><td class="primary">${esc(c?c.nome:'—')}</td><td>${p.itens.map(i=>`${i.qtd}× ${esc(i.nome)}`).join('<br>')}</td><td class="tnum ${atrasado?'neg':''}">${fmtDate(p.entrega?.data)}${p.entrega?.hora?` · ${p.entrega.hora}`:''}</td><td class="num">${fmt(t.total)}</td><td>${p.status==='cancelado'?'—':chip(p.pagamento?.status==='pago'?'pago':'pendente', p.pagamento?.status==='pago'?(p.pagamento.metodo||'Pago'):'Pendente')}</td><td>${chip(p.status)}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty"><p>${f==='ativos'?'Nenhum pedido em aberto.':'Nada por aqui.'}</p><button class="btn btn-ghost btn-sm" data-action="new-pedido">Registrar pedido</button></div>`);
};
function pedidoDraft(p, clienteId){ if(p) return JSON.parse(JSON.stringify(p)); return {clienteId:clienteId||'', itens:[], entrega:{data:addDays(todayISO(),2),hora:'',endereco: clienteId ? (byId(state.clientes,clienteId)?.endereco||'') : ''}, status:'orcamento', pagamento:{metodo:'',status:'pendente'}, desconto:'', taxaEntrega:25, mensagem:'', obs:''}; }
function pedidoForm(p, clienteId){ ui.draft = pedidoDraft(p, clienteId); const d=ui.draft; openDrawer(d.id?`Pedido #${d.numero} · criado em ${fmtDate(d.criadoEm)}`:'Novo pedido', d.id?(byId(state.clientes,d.clienteId)?.nome||'Pedido'):'Registrar pedido', pedidoBody(d), pedidoFoot(d)); }
function pedidoFoot(d){
  const next = STATUS_FLOW[STATUS_FLOW.indexOf(d.status)+1];
  const nextLabel = {confirmado:'Confirmar pedido', producao:'Iniciar produção', entregue:'Marcar entregue'}[next];
  return `<div class="actions">${d.id?`<button class="btn btn-danger btn-sm" data-action="delete-pedido" data-id="${d.id}">Excluir</button>`:''}${d.id&&d.status!=='cancelado'?`<button class="btn btn-text btn-sm" data-action="pedido-status" data-status="cancelado">Cancelar pedido</button>`:''}</div>
  <div class="actions">${d.status==='orcamento'?`<button class="btn btn-ghost btn-sm" data-action="quote-preview"><span class="ms">request_quote</span>Orçamento</button>`:''}${next&&d.id?`<button class="btn btn-ghost btn-sm" data-action="pedido-status" data-status="${next}">${nextLabel}</button>`:''}<button class="btn btn-primary" type="submit" form="form-pedido">Salvar</button></div>`;
}
function pedidoBody(d){
  const cliOpts = [['','Escolher cliente…'], ...sortBy(state.clientes,'nome').map(c=>[c.id,c.nome])];
  const prodOpts = [['','Produto…'], ...sortBy(state.produtos.filter(p=>p.ativo!==false),'nome').map(p=>[p.id, `${p.nome} — ${fmt(p.preco)}`])];
  const t = pedidoTotais(d);
  const itens = (d.itens||[]).map((it,k)=>`<div class="item-row"><select data-draft="itens.${k}.produtoId" data-item="${k}" id="it-p-${k}">${prodOpts.map(([v,l])=>`<option value="${esc(v)}" ${v===it.produtoId?'selected':''}>${esc(l)}</option>`).join('')}</select><input type="number" min="1" step="1" inputmode="numeric" data-draft="itens.${k}.qtd" id="it-q-${k}" value="${esc(it.qtd)}" placeholder="qtd"><input type="number" min="0" step="1" inputmode="decimal" data-draft="itens.${k}.preco" id="it-pr-${k}" value="${esc(it.preco)}" placeholder="preço"><button type="button" class="icon-btn" data-action="pedido-item-del" data-idx="${k}" aria-label="Remover"><span class="ms">close</span></button></div>`).join('');
  return `<form class="form" id="form-pedido" data-form="pedido"><input type="hidden" name="id" value="${d.id||''}">
    <div class="grid2" style="align-items:end">${field('Cliente', sel('clienteId', d.clienteId, cliOpts, 'required data-draft="clienteId"'))}<button type="button" class="btn btn-ghost btn-sm" data-action="new-cliente-inline" style="justify-self:start"><span class="ms">person_add</span>Novo cliente</button></div>
    <div>
      <div class="section-head"><h2>Itens</h2><button type="button" class="btn btn-ghost btn-sm" data-action="pedido-item-add"><span class="ms">add</span>Item</button></div>
      ${itens?`<div class="item-row ficha-head"><span>Produto</span><span>Qtd</span><span>Preço un.</span><span></span></div><div class="form" style="gap:8px">${itens}</div>`:`<p class="help">Adicione arranjos ou peças do catálogo. O preço pode ser ajustado por pedido.</p>`}
    </div>
    <div class="grid3">${field('Desconto (R$)', inp('desconto', d.desconto, 'type="number" step="1" min="0" inputmode="decimal" data-draft="desconto"'))}${field('Taxa de entrega (R$)', inp('taxaEntrega', d.taxaEntrega, 'type="number" step="1" min="0" inputmode="decimal" data-draft="taxaEntrega"'))}<div class="field"><span class="lbl">Total</span><div id="pedido-total" style="padding:9px 0;font-size:18px;font-weight:500" class="tnum">${fmt(t.total)}</div></div></div>
    <div class="section-head"><h2>Entrega</h2></div>
    <div class="grid3">${field('Data', inp('entrega.data', d.entrega?.data, 'type="date" required'))}${field('Horário', inp('entrega.hora', d.entrega?.hora, 'type="time"'))}${field('Status', sel('status', d.status, Object.entries(STATUS), 'data-draft="status"'))}</div>
    ${field('Endereço de entrega', inp('entrega.endereco', d.entrega?.endereco, 'placeholder="Ou “retirada no studio”"'))}
    ${field('Mensagem do cartão', inp('mensagem', d.mensagem, 'placeholder="O que vai escrito no cartão SELVA"'))}
    <div class="section-head"><h2>Pagamento</h2></div>
    <div class="grid2">${field('Forma', sel('pagamento.metodo', d.pagamento?.metodo, [['','—'],...PAGAMENTOS]))}${field('Situação', sel('pagamento.status', d.pagamento?.status, [['pendente','Pendente'],['pago','Pago']]))}</div>
    ${field('Observações internas', `<textarea name="obs" id="f-obs" placeholder="Detalhes de produção, referências, pedidos especiais…">${esc(d.obs||'')}</textarea>`)}
    <div class="summary"><div class="row"><span>Custo estimado dos itens</span><span class="tnum" id="pedido-custo">${fmt(t.custo)}</span></div><div class="row"><span>Margem do pedido</span><span class="tnum ${t.margem!=null&&t.margem<0.5?'neg':'pos'}" id="pedido-margem">${pct(t.margem)}</span></div></div>
  </form>`;
}
function refreshPedidoTotals(){ const d=ui.draft; if(!d) return; const t=pedidoTotais(d); const set=(id,v)=>{ const e=$(id); if(e) e.textContent=v; }; set('#pedido-total',fmt(t.total)); set('#pedido-custo',fmt(t.custo)); set('#pedido-margem',pct(t.margem)); const m=$('#pedido-margem'); if(m) m.className='tnum '+(t.margem!=null&&t.margem<0.5?'neg':'pos'); }
function collectPedido(d){
  const o = { clienteId:d.clienteId, itens:(ui.draft.itens||[]).filter(i=>i.produtoId&&num(i.qtd)>0).map(i=>{ const p=byId(state.produtos,i.produtoId); return {produtoId:i.produtoId, nome:p?p.nome:i.nome, qtd:num(i.qtd), preco:num(i.preco)}; }), entrega:{data:d['entrega.data'],hora:d['entrega.hora'],endereco:d['entrega.endereco'].trim()}, status:d.status, pagamento:{metodo:d['pagamento.metodo'],status:d['pagamento.status'],pagoEm: d['pagamento.status']==='pago' ? (ui.draft.pagamento?.pagoEm||todayISO()) : null}, desconto:num(d.desconto), taxaEntrega:num(d.taxaEntrega), mensagem:d.mensagem.trim(), obs:d.obs.trim() };
  return o;
}
function savePedido(d, silent){
  if(!d.clienteId){ toast('Escolha o cliente'); return null; }
  const o = collectPedido(d); if(!o.itens.length){ toast('Adicione pelo menos um item'); return null; }
  let pd;
  if(d.id){ pd=byId(state.pedidos,d.id); Object.assign(pd,o); } else { pd=Object.assign({id:uid(),numero:nextNumero(),criadoEm:todayISO()},o); state.pedidos.push(pd); }
  syncPedidoFinanceiro(pd); save(); if(!silent){ closeDrawer(); render(); toast(d.id?'Pedido atualizado':`Pedido #${pd.numero} registrado`); }
  return pd;
}
function quoteText(d){
  const c = byId(state.clientes, d.clienteId); const t = pedidoTotais(d); const s = state.settings;
  const lines = [`*${s.nome}* — Orçamento${d.numero?` #${d.numero}`:''}`, `Olá${c?`, ${c.nome.split(' ')[0]}`:''}! Segue o que conversamos:`, ''];
  (d.itens||[]).forEach(i=>{ const p=byId(state.produtos,i.produtoId); lines.push(`• ${i.qtd}× ${p?p.nome:i.nome} — ${fmt(num(i.qtd)*num(i.preco))}${p&&p.descricao?`\n   ${p.descricao}`:''}`); });
  lines.push('');
  if(num(d.desconto)) lines.push(`Desconto: − ${fmt(d.desconto)}`);
  lines.push(`Entrega: ${fmtDateLong(d.entrega?.data)}${d.entrega?.hora?` às ${d.entrega.hora}`:''}${d.entrega?.endereco?` — ${d.entrega.endereco}`:''}${num(d.taxaEntrega)?` (${fmt(d.taxaEntrega)})`:''}`);
  lines.push(`*Total: ${fmt(t.total)}*`);
  if(d.mensagem) lines.push(`Cartão: “${d.mensagem}”`);
  lines.push('', `Orçamento válido por ${s.validadeOrcamento||7} dias. Para confirmar, é só responder esta mensagem.`, `${s.nome}${s.instagram?` · ${s.instagram}`:''}`);
  return lines.join('\n');
}
function quotePreview(){
  const d = ui.draft; const form=$('#form-pedido'); if(form){ const o=collectPedido(fd(form)); Object.assign(d, o, {itens: o.itens.length?o.itens:d.itens}); }
  const c = byId(state.clientes, d.clienteId); const txt = quoteText(d);
  const body = `<p class="help" style="margin:0 0 12px">Revise o texto. Ele abre no WhatsApp do cliente pronto para enviar; se preferir, copie e cole onde quiser.</p><pre class="quote-pre" id="quote-text">${esc(txt)}</pre>`;
  const foot = `<button class="btn btn-ghost btn-sm" data-action="quote-back">Voltar ao pedido</button><div class="actions"><button class="btn btn-ghost" data-action="copy-quote">Copiar texto</button>${c&&c.telefone?`<a class="btn btn-primary" target="_blank" rel="noopener" href="${waLink(c.telefone, txt)}" data-action="quote-sent"><span class="ms">send</span>Enviar no WhatsApp</a>`:`<button class="btn btn-primary" disabled title="Cadastre o WhatsApp do cliente">Sem WhatsApp</button>`}</div>`;
  $('#drawer-eyebrow').textContent='Orçamento'; $('#drawer-title').textContent=c?c.nome:'Orçamento'; $('#drawer-body').innerHTML=body; $('#drawer-foot').innerHTML=foot;
}


/* ===== Financeiro ===== */
function catsDespesa(){ return String(state.settings.categoriasDespesa||'').split(',').map(s=>s.trim()).filter(Boolean); }
VIEWS.financeiro = function(){
  const mk = ui.month || monthKey(todayISO()); ui.month = mk; const hoje = todayISO();
  const doMes = state.lancamentos.filter(l=>monthKey(l.vencimento)===mk);
  const rec = doMes.filter(l=>l.tipo==='receita').reduce((s,l)=>s+num(l.valor),0);
  const des = doMes.filter(l=>l.tipo==='despesa').reduce((s,l)=>s+num(l.valor),0);
  const recPago = doMes.filter(l=>l.tipo==='receita'&&l.pagoEm).reduce((s,l)=>s+num(l.valor),0);
  const desPago = doMes.filter(l=>l.tipo==='despesa'&&l.pagoEm).reduce((s,l)=>s+num(l.valor),0);
  const aPagar = state.lancamentos.filter(l=>l.tipo==='despesa'&&!l.pagoEm).reduce((s,l)=>s+num(l.valor),0);
  const aReceber = state.lancamentos.filter(l=>l.tipo==='receita'&&!l.pagoEm).reduce((s,l)=>s+num(l.valor),0);
  const porCat = {}; doMes.filter(l=>l.tipo==='despesa').forEach(l=>porCat[l.categoria||'Outros']=(porCat[l.categoria||'Outros']||0)+num(l.valor));
  const cats = Object.entries(porCat).sort((a,b)=>b[1]-a[1]);
  const tab = ui.tab.financeiro; const f = ui.filtroLanc;
  let rows = doMes.filter(l=> f==='todos' ? true : f==='pendentes' ? !l.pagoEm : l.tipo===f);
  rows = sortBy(rows,'vencimento');
  const tabs = `<div class="seg"><button class="${tab==='lancamentos'?'on':''}" data-action="tab" data-scope="financeiro" data-tab="lancamentos">Lançamentos</button><button class="${tab==='extrato'?'on':''}" data-action="tab" data-scope="financeiro" data-tab="extrato">Importar extrato</button></div>`;
  return pageHead('Financeiro', 'Caixa e contas', 'O custo do mês, o que entra e o que vence, lado a lado.', `${tabs}<button class="btn btn-primary" data-action="lanc-new"><span class="ms">add</span>Lançamento</button>`)
  + `<div class="toolbar"><div class="seg"><button data-action="month-prev" aria-label="Mês anterior"><span class="ms">chevron_left</span></button><button class="on" style="min-width:150px">${fmtMonth(mk)}</button><button data-action="month-next" aria-label="Próximo mês"><span class="ms">chevron_right</span></button></div>${mk!==monthKey(hoje)?`<button class="btn btn-text btn-sm" data-action="month-today">Mês atual</button>`:''}</div>
    <div class="kpis">
      <div class="kpi"><span class="eyebrow">Receitas do mês</span><span class="v">${fmt(rec)}</span><span class="s">${fmt(recPago)} já recebidos</span></div>
      <div class="kpi"><span class="eyebrow">Despesas do mês</span><span class="v">${fmt(des)}</span><span class="s">${fmt(desPago)} já pagos</span></div>
      <div class="kpi"><span class="eyebrow">Resultado</span><span class="v ${rec-des<0?'neg':'pos'}">${fmt(rec-des)}</span><span class="s">${rec?`${((rec-des)/rec*100).toFixed(0)}% da receita`:'—'}</span></div>
      <div class="kpi"><span class="eyebrow">Em aberto (geral)</span><span class="v">${fmt(aPagar)}</span><span class="s">a pagar · ${fmt(aReceber)} a receber</span></div>
    </div>
    <div class="two">
      <section class="section"><div class="section-head"><h2>Últimos 6 meses</h2></div><div style="position:relative" id="chart-wrap"></div><div class="legend"><span><i style="background:var(--chart-a)"></i>Receitas</span><span><i style="background:var(--chart-b)"></i>Despesas</span></div></section>
      <section class="section"><div class="section-head"><h2>Despesas por categoria</h2><span class="muted small">${fmtMonth(mk)}</span></div>${cats.length?`<div class="list">${cats.map(([c,v])=>`<div class="item" style="cursor:default"><div style="flex:1"><div class="t1">${esc(c)}</div><div class="bar" style="margin-top:6px"><i style="width:${(v/cats[0][1]*100).toFixed(0)}%;background:var(--chart-b)"></i></div></div><div class="tnum">${fmt(v)} <span class="muted small">${des?(v/des*100).toFixed(0)+'%':''}</span></div></div>`).join('')}</div>`:`<p class="help">Sem despesas lançadas neste mês.</p>`}</section>
    </div>`
  + (tab==='extrato' ? extratoView() : `<section class="section"><div class="section-head"><h2>Lançamentos de ${fmtMonth(mk).toLowerCase()}</h2><div class="seg">${[['todos','Todos'],['pendentes','Pendentes'],['receita','Receitas'],['despesa','Despesas']].map(([v,l])=>`<button class="${f===v?'on':''}" data-action="filtro-lanc" data-val="${v}">${l}</button>`).join('')}</div></div>
    ${rows.length?`<div class="tablewrap"><table class="t"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${rows.map(l=>{ const st=lancStatus(l); return `<tr class="row" data-action="lanc-edit" data-id="${l.id}"><td class="tnum">${fmtDate(l.vencimento)}</td><td><span class="primary">${esc(l.descricao)}</span>${l.pedidoId?'<span class="sub">vinculado a pedido</span>':l.origem==='extrato'?'<span class="sub">do extrato</span>':''}</td><td>${esc(l.categoria)}</td><td class="num ${l.tipo==='receita'?'pos':''}">${l.tipo==='despesa'?'− ':'+ '}${fmt(l.valor)}</td><td>${chip(st, st==='pago'?(l.tipo==='despesa'?'Pago':'Recebido'):st==='atrasado'?'Atrasado':(l.tipo==='despesa'?'A pagar':'A receber'))}</td><td class="right">${l.pagoEm?'':`<button class="btn btn-ghost btn-sm" data-action="lanc-pay" data-id="${l.id}">${l.tipo==='despesa'?'Pagar':'Receber'}</button>`}</td></tr>`; }).join('')}</tbody></table></div>`:`<div class="empty"><p>Nenhum lançamento neste mês.</p><button class="btn btn-ghost btn-sm" data-action="lanc-new">Lançar conta</button></div>`}</section>`);
};
function afterFinanceiro(){
  const wrap = $('#chart-wrap'); if(!wrap) return;
  const mk = ui.month; const months = []; for(let k=5;k>=0;k--) months.push(shiftMonth(mk,-k));
  const data = months.map(m=>{ const ls=state.lancamentos.filter(l=>monthKey(l.vencimento)===m); return {m, r:ls.filter(l=>l.tipo==='receita').reduce((s,l)=>s+num(l.valor),0), d:ls.filter(l=>l.tipo==='despesa').reduce((s,l)=>s+num(l.valor),0)}; });
  const W=560, H=220, padL=52, padR=8, padT=12, padB=28; const max = Math.max(1000, ...data.flatMap(x=>[x.r,x.d]));
  const nice = Math.ceil(max/5000)*5000 || 5000; const steps=4; const y=v=>padT+(H-padT-padB)*(1-v/nice);
  const gw=(W-padL-padR)/6, bw=Math.min(28,(gw-16)/2);
  let svg=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas dos últimos seis meses">`;
  for(let k=0;k<=steps;k++){ const v=nice/steps*k; svg+=`<line class="grid" x1="${padL}" x2="${W-padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${padL-6}" y="${(y(v)+4).toFixed(1)}" text-anchor="end">${v>=1000?(v/1000)+'k':v}</text>`; }
  data.forEach((x,i)=>{ const cx=padL+gw*i+gw/2; const yr=y(x.r), yd=y(x.d);
    svg+=`<rect x="${(cx-bw-1).toFixed(1)}" y="${yr.toFixed(1)}" width="${bw}" height="${(H-padB-yr).toFixed(1)}" fill="var(--chart-a)" data-tip="${fmtMonthShort(x.m)} · receitas ${fmt(x.r)}"/>`;
    svg+=`<rect x="${(cx+1).toFixed(1)}" y="${yd.toFixed(1)}" width="${bw}" height="${(H-padB-yd).toFixed(1)}" fill="var(--chart-b)" data-tip="${fmtMonthShort(x.m)} · despesas ${fmt(x.d)}"/>`;
    svg+=`<text x="${cx.toFixed(1)}" y="${H-10}" text-anchor="middle" ${x.m===mk?'font-weight="600" fill="var(--ink)"':''}>${fmtMonthShort(x.m)}</text>`; });
  svg+=`<line class="axis" x1="${padL}" x2="${W-padR}" y1="${H-padB}" y2="${H-padB}"/></svg><div class="chart-tip" id="chart-tip"></div>`;
  wrap.innerHTML=svg;
  wrap.addEventListener('mousemove', e=>{ const r=e.target.closest('rect[data-tip]'); const tip=$('#chart-tip'); if(!r){ tip.style.opacity=0; return; } const b=wrap.getBoundingClientRect(); const rb=r.getBoundingClientRect(); tip.textContent=r.dataset.tip; tip.style.left=(rb.left+rb.width/2-b.left)+'px'; tip.style.top=(rb.top-b.top)+'px'; tip.style.opacity=1; });
  wrap.addEventListener('mouseleave', ()=>{ $('#chart-tip').style.opacity=0; });
}
function lancForm(l){
  const novo=!l; l = l || {tipo:'despesa',descricao:'',categoria:catsDespesa()[0]||'Outros',valor:'',vencimento:todayISO(),pagoEm:null,conta:''};
  const cats = l.tipo==='receita' ? ['Vendas','Eventos','Assinaturas','Outras receitas'] : catsDespesa();
  if(l.categoria && !cats.includes(l.categoria)) cats.push(l.categoria);
  const body = `<form class="form" id="form-lanc" data-form="lanc"><input type="hidden" name="id" value="${l.id||''}">
    <div class="grid2">${field('Tipo', sel('tipo', l.tipo, [['despesa','Despesa'],['receita','Receita']], 'data-lanc-tipo'))}${field('Valor (R$)', inp('valor', l.valor, 'type="number" step="0.01" min="0" required inputmode="decimal"'))}</div>
    ${field('Descrição', inp('descricao', l.descricao, 'required placeholder="Ex.: Veiling Holambra — compra semanal"'))}
    <div class="grid2">${field('Categoria', sel('categoria', l.categoria, cats))}${field('Conta / forma', inp('conta', l.conta, 'placeholder="Pix, cartão, débito…"'))}</div>
    <div class="grid2">${field('Vencimento', inp('vencimento', l.vencimento, 'type="date" required'))}${field(l.tipo==='despesa'?'Pago em':'Recebido em', inp('pagoEm', l.pagoEm, 'type="date"'))}</div>
    ${l.pedidoId?`<p class="help">Este lançamento nasce do pedido vinculado; o valor segue o pedido.</p>`:''}
  </form>`;
  const foot = `${novo?'<span></span>':`<button class="btn btn-danger btn-sm" data-action="lanc-delete" data-id="${l.id}">Excluir</button>`}<div class="actions">${!novo&&!l.pagoEm?`<button class="btn btn-ghost" data-action="lanc-pay" data-id="${l.id}">${l.tipo==='despesa'?'Marcar pago':'Marcar recebido'}</button>`:''}<button class="btn btn-primary" type="submit" form="form-lanc">Salvar</button></div>`;
  openDrawer(novo?'Novo lançamento':'Lançamento', novo?'Lançar conta':l.descricao, body, foot);
}
function saveLanc(d){ const o={tipo:d.tipo,descricao:d.descricao.trim(),categoria:d.categoria,valor:num(d.valor),vencimento:d.vencimento,pagoEm:d.pagoEm||null,conta:d.conta.trim()}; if(d.id){ const l=byId(state.lancamentos,d.id); Object.assign(l,o); if(l.pedidoId){ const pd=byId(state.pedidos,l.pedidoId); if(pd){ pd.pagamento=pd.pagamento||{}; pd.pagamento.status=l.pagoEm?'pago':'pendente'; pd.pagamento.pagoEm=l.pagoEm; } } } else state.lancamentos.push(Object.assign({id:uid(),origem:'manual'},o)); save(); closeDrawer(); render(); toast('Lançamento salvo'); }
function payLanc(id){ const l=byId(state.lancamentos,id); if(!l) return; l.pagoEm=todayISO(); if(l.pedidoId){ const pd=byId(state.pedidos,l.pedidoId); if(pd){ pd.pagamento=pd.pagamento||{}; pd.pagamento.status='pago'; pd.pagamento.pagoEm=l.pagoEm; } } save(); closeDrawer(); render(); toast(l.tipo==='despesa'?'Conta marcada como paga':'Recebimento registrado'); }

/* Extrato */
function parseExtrato(text){
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const out=[];
  const sep = (lines[0]||'').includes(';') ? ';' : (lines[0]||'').includes('\t') ? '\t' : ',';
  for(const line of lines){
    const cells = line.split(sep).map(c=>c.replace(/^"|"$/g,'').trim()); if(cells.length<2) continue;
    let date=null, val=null, descParts=[];
    for(const c of cells){
      let m;
      if(!date && (m=c.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/))){ date=`${m[3]}-${m[2]}-${m[1]}`; continue; }
      if(!date && (m=c.match(/^(\d{4})-(\d{2})-(\d{2})$/))){ date=c; continue; }
      const cv = c.replace(/R\$\s?/,'').replace(/\s/g,'');
      if(val===null && /^[-+]?\(?\d{1,3}(\.\d{3})*(,\d{1,2})?\)?$|^[-+]?\d+(,\d{1,2})$|^[-+]?\d+(\.\d{1,2})?$/.test(cv) && cv!==''){
        let neg = cv.startsWith('-')||cv.startsWith('(') ; let n = cv.replace(/[()+\-]/g,'');
        if(/,\d{1,2}$/.test(n)) n = n.replace(/\./g,'').replace(',','.'); else if(/^\d{1,3}(\.\d{3})+$/.test(n)) n=n.replace(/\./g,'');
        const f=parseFloat(n); if(!isNaN(f)){ val=neg?-f:f; continue; }
      }
      descParts.push(c);
    }
    if(date && val!==null && val!==0) out.push({date, valor:val, descricao: descParts.filter(x=>!/^(D|C|DEBITO|CREDITO|DÉBITO|CRÉDITO)$/i.test(x)).join(' · ').slice(0,80) || 'Movimentação'});
  }
  return out;
}
function matchLanc(mov){ const alvo=Math.abs(mov.valor); const tipo=mov.valor<0?'despesa':'receita'; return state.lancamentos.find(l=>l.tipo===tipo && !l.pagoEm && Math.abs(num(l.valor)-alvo)<0.01 && Math.abs((new Date(l.vencimento)-new Date(mov.date))/864e5)<=7); }
function extratoView(){
  const rows = ui.extrato||[];
  return `<section class="section"><div class="section-head"><h2>Importar extrato</h2></div>
    <div class="two"><div class="form"><p class="help" style="margin:0">Cole as linhas do extrato (CSV ou copiado do internet banking) ou escolha o arquivo exportado pelo banco. Reconheço data, valor e descrição em cada linha; valores negativos viram despesas. Movimentos que batem com contas pendentes (mesmo valor, até 7 dias) são conciliados em vez de duplicados.</p>
      <textarea id="extrato-text" style="min-height:140px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px" placeholder="25/10/2026;PIX ENVIADO VEILING HOLAMBRA;-980,00&#10;24/10/2026;PIX RECEBIDO HENRIQUE S;320,00"></textarea>
      <div class="actions"><input type="file" id="extrato-file" accept=".csv,.txt,.ofx" style="max-width:260px"><button class="btn btn-ghost" data-action="extrato-parse">Ler linhas</button></div></div>
    <div>${rows.length?`<div class="tablewrap"><table class="t"><thead><tr><th><input type="checkbox" id="ext-all" checked data-action="extrato-all"></th><th>Data</th><th>Descrição</th><th class="num">Valor</th><th>Categoria</th><th>Ação</th></tr></thead><tbody>${rows.map((r,k)=>{ const m=matchLanc(r); return `<tr><td><input type="checkbox" class="ext-sel" data-k="${k}" ${r.skip?'':'checked'}></td><td class="tnum">${fmtDate(r.date)}</td><td>${esc(r.descricao)}</td><td class="num ${r.valor<0?'':'pos'}">${fmt(r.valor)}</td><td>${m?`<span class="muted small">—</span>`:`<select class="ext-cat" data-k="${k}" style="padding:5px 26px 5px 8px;font-size:12.5px">${(r.valor<0?['A classificar',...catsDespesa()]:['Vendas','Outras receitas']).map(c=>`<option ${c===(r.cat||'')?'selected':''}>${esc(c)}</option>`).join('')}</select>`}</td><td>${m?`<span class="chip pago">Concilia · ${esc(m.descricao.slice(0,22))}</span>`:'<span class="chip pendente">Novo lançamento</span>'}</td></tr>`; }).join('')}</tbody></table></div><div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-primary" data-action="extrato-import">Importar selecionados</button></div>`:`<div class="empty"><p>As linhas lidas aparecem aqui para você conferir antes de importar.</p></div>`}</div></div></section>`;
}
function importExtrato(){
  const rows=ui.extrato||[]; let novos=0, conc=0;
  $$('.ext-sel').forEach(cb=>{ const r=rows[+cb.dataset.k]; if(!r || !cb.checked) return; const m=matchLanc(r); if(m){ m.pagoEm=r.date; if(m.pedidoId){ const pd=byId(state.pedidos,m.pedidoId); if(pd){ pd.pagamento=pd.pagamento||{}; pd.pagamento.status='pago'; pd.pagamento.pagoEm=r.date; } } conc++; } else { const selc=$(`.ext-cat[data-k="${cb.dataset.k}"]`); state.lancamentos.push({id:uid(),tipo:r.valor<0?'despesa':'receita',descricao:r.descricao,categoria:selc?selc.value:(r.valor<0?'A classificar':'Vendas'),valor:Math.abs(r.valor),vencimento:r.date,pagoEm:r.date,origem:'extrato',conta:'Extrato'}); novos++; } });
  ui.extrato=[]; save(); ui.tab.financeiro='lancamentos'; render(); toast(`${novos} lançamento${novos===1?'':'s'} criado${novos===1?'':'s'} · ${conc} conciliado${conc===1?'':'s'}`);
}

/* ===== Configurações ===== */
VIEWS.config = function(){
  const s = state.settings;
  return pageHead('Configurações', 'Studio e precificação', 'Os parâmetros que alimentam a sugestão de preço e os orçamentos.')
  + `<form class="form" id="form-config" data-form="config" style="max-width:720px">
    <div class="section-head"><h2>Studio</h2></div>
    <div class="grid2">${field('Nome da marca', inp('nome', s.nome, 'required'))}${field('Quem usa o sistema', inp('responsavel', s.responsavel, 'placeholder="Kiara"'))}</div>
    <div class="grid2">${field('WhatsApp da loja', inp('whatsapp', s.whatsapp, 'inputmode="tel" placeholder="11 9xxxx-xxxx"'))}${field('Instagram', inp('instagram', s.instagram))}</div>
    ${field('Endereço', inp('endereco', s.endereco))}
    <div class="section-head" style="margin-top:12px"><h2>Precificação</h2></div>
    <div class="grid2">${field('Valor da hora de trabalho (R$/h)', inp('horaTrabalho', s.horaTrabalho, 'type="number" step="1" min="0" inputmode="decimal"'))}${field('Taxa de cartão / plataforma (%)', inp('taxaCartao', s.taxaCartao, 'type="number" step="0.1" min="0" max="50" inputmode="decimal"'))}</div>
    <div class="grid2">${field('Markup padrão · arranjos (×)', inp('markupArranjo', s.markupArranjo, 'type="number" step="0.1" min="1" inputmode="decimal"'))}${field('Markup padrão · peças de revenda (×)', inp('markupRevenda', s.markupRevenda, 'type="number" step="0.1" min="1" inputmode="decimal"'))}</div>
    <p class="help">Floriculturas costumam trabalhar entre 2,5× e 3,5× sobre o custo das flores; peças de revenda, entre 2× e 2,5×. A sugestão de preço arredonda para o múltiplo de R$ 5 seguinte.</p>
    <div class="grid2">${field('Validade do orçamento (dias)', inp('validadeOrcamento', s.validadeOrcamento, 'type="number" step="1" min="1" inputmode="numeric"'))}</div>
    <div class="section-head" style="margin-top:12px"><h2>Financeiro</h2></div>
    ${field('Categorias de despesa (separadas por vírgula)', `<textarea name="categoriasDespesa" id="f-categoriasDespesa">${esc(s.categoriasDespesa)}</textarea>`)}
    <div class="actions"><button class="btn btn-primary" type="submit">Salvar configurações</button></div>
  </form>
  ${store.mode==='supabase'?`<div class="section" style="margin-top:44px;max-width:720px"><div class="section-head"><h2>Conta</h2></div><p class="help">Você está conectada como <strong>${esc(store.user?.email||'')}</strong>. Os dados ficam no servidor e aparecem em todos os aparelhos em que você entrar.</p><div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-action="logout"><span class="ms">logout</span>Sair</button></div></div>`:''}
  <div class="section" style="margin-top:44px;max-width:720px"><div class="section-head"><h2>Dados</h2></div>
    <p class="help">${store.mode==='supabase'?'Os dados estão salvos no servidor. Ainda assim, vale copiar uma cópia de segurança de tempos em tempos.':'Os dados ficam salvos apenas neste navegador. Exporte uma cópia de segurança de tempos em tempos; para usar em outro aparelho, cole a cópia em “Importar”.'}</p>
    <div class="actions" style="margin:12px 0"><button class="btn btn-ghost" data-action="export-json"><span class="ms">content_copy</span>Copiar cópia de segurança</button><button class="btn btn-ghost" data-action="import-json"><span class="ms">upload</span>Importar cópia</button><button class="btn btn-ghost" data-action="reset-demo">${state.produtos.length||state.clientes.length?'Repor dados de exemplo':'Carregar dados de exemplo'}</button><button class="btn btn-danger btn-ghost" data-action="clear-all">Limpar tudo</button></div>
    <textarea id="json-area" placeholder="A cópia de segurança aparece aqui. Para importar, cole o conteúdo e clique em Importar cópia." style="min-height:120px;font-family:ui-monospace,Menlo,monospace;font-size:12px"></textarea>
  </div>`;
};
function saveConfig(d){ Object.assign(state.settings, {nome:d.nome.trim(),responsavel:d.responsavel.trim(),whatsapp:d.whatsapp.trim(),instagram:d.instagram.trim(),endereco:d.endereco.trim(),horaTrabalho:num(d.horaTrabalho),taxaCartao:num(d.taxaCartao),markupArranjo:num(d.markupArranjo),markupRevenda:num(d.markupRevenda),validadeOrcamento:num(d.validadeOrcamento)||7,categoriasDespesa:d.categoriasDespesa}); save(); render(); toast('Configurações salvas'); }

/* ===== Próximas fases ===== */
const SOON = {
  eventos: {t:'Eventos', lead:'Casamentos, jantares e ativações de marca pedem outro ritmo: cronograma, equipe e vários arranjos por projeto.', items:['Proposta por evento com lista de peças, quantidades e montagem no local','Cronograma de compra, produção e desmontagem','Custos de equipe e logística dentro da margem do projeto','Pagamento em parcelas (sinal, saldo) ligado ao financeiro']},
  assinaturas: {t:'Assinaturas florais', lead:'Flores que chegam toda semana ou quinzena, em casa ou na recepção da empresa.', items:['Planos por frequência e tamanho, com valor mensal','Rota de entregas da semana e produção em lote','Pausas, trocas de endereço e renovação automática','Receita recorrente no financeiro e previsão de insumos']},
  whatsapp: {t:'WhatsApp da loja', lead:'Orçamentos, confirmações e lembretes saindo do mesmo lugar onde o pedido vive.', items:['Conversas da loja dentro do sistema, ligadas ao cliente','Orçamento enviado e confirmado sem sair da tela','Lembrete automático de entrega e de pagamento','Mensagem de aniversário com sugestão de arranjo']}
};
['eventos','assinaturas','whatsapp'].forEach(k=>{ VIEWS[k]=function(){ const s=SOON[k]; return pageHead('Próxima fase', s.t, s.lead) + `<div class="soon-page"><div class="note" style="margin-bottom:22px"><strong>Em breve.</strong> Esta área está planejada; enquanto isso, ${k==='whatsapp'?'os orçamentos já abrem direto no WhatsApp do cliente a partir de cada pedido.':'você pode registrar esses pedidos normalmente em Pedidos.'}</div><span class="eyebrow">O que está previsto</span><ul>${s.items.map(i=>`<li>${i}</li>`).join('')}</ul></div>`; }; });

/* ===== Events ===== */
document.addEventListener('click', async e=>{
  const el = e.target.closest('[data-action]'); if(!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  if(a==='nav'){ e.preventDefault(); go(el.dataset.to); return; }
  if(el.tagName==='A' && el.getAttribute('href')?.startsWith('https://')){ if(a==='quote-sent'){ toast('Orçamento aberto no WhatsApp'); } return; }
  if(a!=='extrato-all') e.preventDefault();
  switch(a){
    case 'tab': ui.tab[el.dataset.scope]=el.dataset.tab; render(); break;
    case 'close-drawer': closeDrawer(); break;
    case 'dialog-ok': closeDialog(true); break;
    case 'dialog-cancel': closeDialog(false); break;
    case 'new-insumo': insumoForm(); break;
    case 'edit-insumo': insumoForm(byId(state.insumos,id)); break;
    case 'delete-insumo': { const used = state.produtos.filter(p=>(p.ficha||[]).some(r=>r.insumoId===id)); if(await confirmDialog('Excluir insumo?', used.length?`Ele está na ficha de ${used.length} produto${used.length===1?'':'s'} e será removido dessas fichas.`:'Esta ação não pode ser desfeita.', 'Excluir', true)){ state.insumos=state.insumos.filter(i=>i.id!==id); state.produtos.forEach(p=>p.ficha=(p.ficha||[]).filter(r=>r.insumoId!==id)); save(); closeDrawer(); render(); toast('Insumo excluído'); } break; }
    case 'new-produto': produtoForm(); break;
    case 'edit-produto': produtoForm(byId(state.produtos,id)); break;
    case 'delete-produto': if(await confirmDialog('Excluir produto?', 'Os pedidos já registrados mantêm o nome e o preço do item.', 'Excluir', true)){ state.produtos=state.produtos.filter(p=>p.id!==id); save(); closeDrawer(); render(); toast('Produto excluído'); } break;
    case 'ficha-add': syncDraftFromForm('#form-produto'); ui.draft.ficha.push({insumoId:'',qtd:1}); $('#drawer-body').innerHTML=produtoBody(ui.draft); $(`#ficha-i-${ui.draft.ficha.length-1}`)?.focus(); break;
    case 'ficha-del': syncDraftFromForm('#form-produto'); ui.draft.ficha.splice(+el.dataset.idx,1); $('#drawer-body').innerHTML=produtoBody(ui.draft); break;
    case 'use-suggested': { const i=$('#f-preco'); if(i){ i.value=el.dataset.val; ui.draft.preco=num(el.dataset.val); refreshFichaSummary(); } break; }
    case 'new-cliente': clienteForm(); break;
    case 'edit-cliente': clienteForm(byId(state.clientes,id)); break;
    case 'delete-cliente': { const n=state.pedidos.filter(p=>p.clienteId===id).length; if(await confirmDialog('Excluir cliente?', n?`Há ${n} pedido${n===1?'':'s'} ligados a este cliente; eles continuam existindo sem o cadastro.`:'Esta ação não pode ser desfeita.', 'Excluir', true)){ state.clientes=state.clientes.filter(c=>c.id!==id); save(); closeDrawer(); render(); toast('Cliente excluído'); } break; }
    case 'new-cliente-inline': { syncDraftFromForm('#form-pedido'); ui.pendingPedido = ui.draft; clienteForm(); ui.returnToPedido = true; break; }
    case 'new-pedido': pedidoForm(null, el.dataset.cliente); break;
    case 'edit-pedido': pedidoForm(byId(state.pedidos,id)); break;
    case 'delete-pedido': if(await confirmDialog('Excluir pedido?', 'O lançamento financeiro vinculado também será removido.', 'Excluir', true)){ state.pedidos=state.pedidos.filter(p=>p.id!==id); state.lancamentos=state.lancamentos.filter(l=>l.pedidoId!==id); save(); closeDrawer(); render(); toast('Pedido excluído'); } break;
    case 'pedido-item-add': syncDraftFromForm('#form-pedido'); ui.draft.itens.push({produtoId:'',qtd:1,preco:''}); $('#drawer-body').innerHTML=pedidoBody(ui.draft); $(`#it-p-${ui.draft.itens.length-1}`)?.focus(); break;
    case 'pedido-item-del': syncDraftFromForm('#form-pedido'); ui.draft.itens.splice(+el.dataset.idx,1); $('#drawer-body').innerHTML=pedidoBody(ui.draft); break;
    case 'pedido-status': { const form=$('#form-pedido'); const d=fd(form); d.status=el.dataset.status; if(el.dataset.status==='cancelado' && !(await confirmDialog('Cancelar pedido?', 'O pedido fica registrado como cancelado e sai do financeiro.', 'Cancelar pedido', true))) break; savePedido(d); break; }
    case 'quote-preview': quotePreview(); break;
    case 'quote-back': $('#drawer-eyebrow').textContent=ui.draft.id?`Pedido #${ui.draft.numero}`:'Novo pedido'; $('#drawer-title').textContent=byId(state.clientes,ui.draft.clienteId)?.nome||'Pedido'; $('#drawer-body').innerHTML=pedidoBody(ui.draft); $('#drawer-foot').innerHTML=pedidoFoot(ui.draft); break;
    case 'copy-quote': copyText($('#quote-text').textContent).then(ok=>toast(ok?'Texto copiado':'Selecione o texto e copie manualmente')); break;
    case 'filtro-pedidos': ui.filtroPedidos=el.dataset.val; render(); break;
    case 'filtro-lanc': ui.filtroLanc=el.dataset.val; render(); break;
    case 'month-prev': ui.month=shiftMonth(ui.month,-1); render(); break;
    case 'month-next': ui.month=shiftMonth(ui.month,1); render(); break;
    case 'month-today': ui.month=monthKey(todayISO()); render(); break;
    case 'lanc-new': lancForm(); break;
    case 'lanc-edit': lancForm(byId(state.lancamentos,id)); break;
    case 'lanc-pay': payLanc(id); break;
    case 'lanc-delete': if(await confirmDialog('Excluir lançamento?', 'Esta ação não pode ser desfeita.', 'Excluir', true)){ state.lancamentos=state.lancamentos.filter(l=>l.id!==id); save(); closeDrawer(); render(); toast('Lançamento excluído'); } break;
    case 'extrato-parse': { const txt=$('#extrato-text').value; const file=$('#extrato-file').files[0]; const run=t=>{ ui.extrato=parseExtrato(t); render(); toast(ui.extrato.length?`${ui.extrato.length} linha${ui.extrato.length===1?'':'s'} reconhecida${ui.extrato.length===1?'':'s'}`:'Não reconheci data e valor nas linhas'); }; if(file){ const rd=new FileReader(); rd.onload=()=>run(String(rd.result)); rd.readAsText(file,'utf-8'); } else run(txt); break; }
    case 'extrato-all': $$('.ext-sel').forEach(cb=>cb.checked=el.checked); break;
    case 'extrato-import': importExtrato(); break;
    case 'export-json': { const txt=JSON.stringify(state,null,1); const ta=$('#json-area'); if(ta) ta.value=txt; copyText(txt).then(ok=>toast(ok?'Cópia de segurança copiada':'A cópia está no campo abaixo; copie o texto')); break; }
    case 'import-json': { const ta=$('#json-area'); try{ const o=JSON.parse(ta.value); if(!o || !Array.isArray(o.produtos)) throw 0; if(await confirmDialog('Importar cópia?', 'Os dados atuais deste navegador serão substituídos pela cópia.', 'Importar')){ state=o; migrate(); state.settings.demo=false; save(); render(); toast('Cópia importada'); } }catch(e){ toast('Cole uma cópia de segurança válida no campo'); } break; }
    case 'logout': if(await confirmDialog('Sair da conta?', 'Você precisará entrar de novo com e-mail e senha.', 'Sair')) store.signOut(); break;
    case 'forgot': showLogin('forgot'); break;
    case 'login-back': showLogin('login'); break;
    case 'reset-demo': if(await confirmDialog('Repor dados de exemplo?', 'Tudo que está salvo aqui será substituído pelos exemplos.', 'Repor', true)){ state=seed(); save(); render(); toast('Dados de exemplo repostos'); } break;
    case 'clear-all': if(await confirmDialog('Limpar tudo?', 'Produtos, clientes, pedidos e lançamentos serão apagados. As configurações ficam.', 'Limpar tudo', true)){ const s=state.settings; state={settings:Object.assign({},s,{demo:false}),insumos:[],produtos:[],clientes:[],pedidos:[],lancamentos:[],seq:{pedido:1}}; save(); render(); toast('Tudo limpo. Boa sorte, SELVA.'); } break;
  }
});
function syncDraftFromForm(sel){ const form=$(sel); if(!form||!ui.draft) return; const d=fd(form); if(sel==='#form-produto'){ Object.assign(ui.draft,{tipo:d.tipo,categoria:d.categoria,nome:d.nome,descricao:d.descricao,custoDireto:d.custoDireto,minutos:d.minutos,embalagem:d.embalagem,extras:d.extras,markup:d.markup,preco:d.preco,ativo:d.ativo==='on'}); } else { Object.assign(ui.draft,{clienteId:d.clienteId,desconto:d.desconto,taxaEntrega:d.taxaEntrega,status:d.status,mensagem:d.mensagem,obs:d.obs,entrega:{data:d['entrega.data'],hora:d['entrega.hora'],endereco:d['entrega.endereco']},pagamento:Object.assign({},ui.draft.pagamento,{metodo:d['pagamento.metodo'],status:d['pagamento.status']})}); } }
document.addEventListener('submit', e=>{
  const form=e.target.closest('form[data-form]'); if(!form) return; e.preventDefault(); const d=fd(form);
  switch(form.dataset.form){
    case 'insumo': saveInsumo(d); break;
    case 'produto': saveProduto(d); break;
    case 'cliente': { const id=saveCliente(d); if(ui.returnToPedido && ui.pendingPedido){ const draft=ui.pendingPedido; ui.returnToPedido=false; ui.pendingPedido=null; draft.clienteId=id; if(!draft.entrega.endereco) draft.entrega.endereco=byId(state.clientes,id)?.endereco||''; ui.draft=draft; openDrawer(draft.id?`Pedido #${draft.numero}`:'Novo pedido', byId(state.clientes,id)?.nome||'Pedido', pedidoBody(draft), pedidoFoot(draft)); } break; }
    case 'pedido': savePedido(d); break;
    case 'lanc': saveLanc(d); break;
    case 'config': saveConfig(d); break;
  }
});
document.addEventListener('input', e=>{
  const t=e.target;
  if(t.dataset.search!==undefined){ ui.search[t.dataset.search]=t.value; const pos=t.selectionStart; render(); const n=$(`#search-${t.dataset.search}`); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos);}catch(x){} } return; }
  if(t.dataset.draft && ui.draft){
    const p=t.dataset.draft; const val = t.type==='number' ? t.value : t.value;
    setDraft(p, val);
    if(t.dataset.item!==undefined){ const k=+t.dataset.item; const prod=byId(state.produtos,t.value); if(prod){ ui.draft.itens[k].preco=prod.preco; ui.draft.itens[k].nome=prod.nome; const pr=$(`#it-pr-${k}`); if(pr) pr.value=prod.preco; } }
    if(p==='tipo'){ syncDraftFromForm('#form-produto'); ui.draft.tipo=val; $('#drawer-body').innerHTML=produtoBody(ui.draft); $('#f-tipo')?.focus(); return; }
    if($('#form-produto')) refreshFichaSummary(); else refreshPedidoTotals();
  }
});
document.addEventListener('change', e=>{ const t=e.target; if(t.hasAttribute('data-lanc-tipo')){ const form=$('#form-lanc'); const d=fd(form); lancForm(Object.assign({}, d.id?byId(state.lancamentos,d.id):{}, {id:d.id, tipo:d.tipo, descricao:d.descricao, valor:d.valor, vencimento:d.vencimento, pagoEm:d.pagoEm||null, conta:d.conta, categoria:''})); } });
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ if($('#dialog-wrap').classList.contains('open')) closeDialog(false); else if($('#drawer-wrap').classList.contains('open')) closeDrawer(); } });
window.addEventListener('hashchange', ()=>{ const r=location.hash.slice(1); if(r && r!==ui.route && ROUTES.includes(r)) go(r); });



/* ===== Login e inicialização ===== */
function showLogin(mode='login', msg=''){
  $('#login').hidden=false; $('.app').hidden=true; $('#tabbar').hidden=true;
  const body = mode==='recovery'
    ? `<form class="form" data-form="recovery"><p class="lead" style="margin:0 0 6px">Defina a nova senha.</p>${field('Nova senha', inp('password','', 'type="password" required minlength="6" autocomplete="new-password"'))}${msg?`<p class="err">${esc(msg)}</p>`:''}<button class="btn btn-primary" type="submit">Salvar senha e entrar</button></form>`
    : mode==='forgot'
    ? `<form class="form" data-form="forgot"><p class="lead" style="margin:0 0 6px">Enviamos um link de redefinição para o seu e-mail.</p>${field('E-mail', inp('email','', 'type="email" required autocomplete="email"'))}${msg?`<p class="err">${esc(msg)}</p>`:''}<button class="btn btn-primary" type="submit">Enviar link</button><button class="btn btn-text" type="button" data-action="login-back">Voltar</button></form>`
    : `<form class="form" data-form="login"><p class="lead" style="margin:0 0 6px">Composição em estado selvagem.</p>${field('E-mail', inp('email','', 'type="email" required autocomplete="email"'))}${field('Senha', inp('password','', 'type="password" required autocomplete="current-password"'))}${msg?`<p class="err">${esc(msg)}</p>`:''}<button class="btn btn-primary" type="submit">Entrar</button><button class="btn btn-text" type="button" data-action="forgot">Esqueci minha senha</button></form>`;
  $('#login-body').innerHTML = body; $('#login input')?.focus();
}
function emptyState(){ return { settings: Object.assign(defaultSettings(), {demo:false}), insumos:[], produtos:[], clientes:[], pedidos:[], lancamentos:[], seq:{pedido:1} }; }
async function boot(){
  $('#login').hidden=true; $('.app').hidden=false; $('#tabbar').hidden=false;
  try{ const data = await store.load(); state = data || emptyState(); }
  catch(e){ console.error(e); state = emptyState(); toast('Não consegui carregar os dados: '+e.message); }
  migrate(); setSync(store.mode==='local' ? 'local' : 'ok');
  const r = location.hash.slice(1); ui.route = ROUTES.includes(r) ? r : 'inicio';
  render(); store.subscribe(scheduleRefresh);
}
let refreshT = null;
function scheduleRefresh(){
  clearTimeout(refreshT);
  refreshT = setTimeout(async ()=>{
    const busy = store.flushing || store.dirty || $('#drawer-wrap').classList.contains('open') || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    if(busy){ scheduleRefresh(); return; }
    try{ const data = await store.load(); if(data){ state = data; migrate(); render(); } }catch(e){ console.error(e); }
  }, 900);
}
document.addEventListener('submit', async e=>{
  const form = e.target.closest('form[data-form="login"],form[data-form="forgot"],form[data-form="recovery"]'); if(!form) return; e.preventDefault();
  const d = fd(form); const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  if(form.dataset.form==='login'){ const err = await store.signIn(d.email.trim(), d.password); if(err){ btn.disabled=false; showLogin('login', err); return; } await boot(); }
  else if(form.dataset.form==='forgot'){ const err = await store.resetPassword(d.email.trim()); btn.disabled=false; if(err) showLogin('forgot', err); else { toast('Link enviado. Confira sua caixa de entrada.'); showLogin('login'); } }
  else { const err = await store.updatePassword(d.password); if(err){ btn.disabled=false; showLogin('recovery', err); return; } toast('Senha atualizada'); await boot(); }
});
window.addEventListener('online', ()=>{ if(store.mode==='supabase') setSync(store.dirty?'saving':'ok'); });
window.addEventListener('offline', ()=>{ if(store.mode==='supabase') setSync('offline'); });
async function start(){
  ui.month = monthKey(todayISO());
  try{ await store.init(); }catch(e){ console.error(e); $('#login').hidden=false; $('.app').hidden=true; $('#login-body').innerHTML = '<p class="err">Não consegui carregar o serviço de dados. Verifique a conexão e recarregue a página.</p>'; return; }
  if(store.mode==='supabase'){
    store.onAuth((ev)=>{ if(ev==='PASSWORD_RECOVERY') showLogin('recovery'); if(ev==='SIGNED_OUT') showLogin(); });
    const session = await store.getSession();
    if(!session){ showLogin(); return; }
  }
  await boot();
}
start();
