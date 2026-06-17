'use strict';
// ═══════════════════════════════════════════════════════
//  PVGest — app.js
// ═══════════════════════════════════════════════════════

// ──────────── CONSTANTS ────────────
const STORAGE_KEY = 'pvgest_v1';
const CLASSES = ['Herbicida','Fungicida','Inseticida','Acaricida','Nematicida','Adjuvante','Fertilizante Foliar','Bioracional','Cúprico','Outro'];
const UNIDADES = ['L','kg','mL','g','t','un'];
const CULTURAS = ['Soja','Milho','Café','Cana-de-açúcar','Algodão','Feijão','Trigo','Pastagem','Outro'];
const EQUIPS = ['Pulverizador Barras','Pulverizador Canhão','Costal Manual','Costal Motorizado','Drone','Avião Agrícola'];

const PERFIS = {
  gestor:    { label:'Gestor',     icon:'👔', color:'#1B5E20', tabs:['dt','talhoes','receitas','estoque','relatorios'] },
  agronomo:  { label:'Agrônomo',   icon:'🌿', color:'#2E7D32', tabs:['dt','talhoes','receitas','estoque','relatorios'] },
  tratorista:{ label:'Tratorista', icon:'🚜', color:'#F57C00', tabs:['dt','execucao'] }
};

// ──────────── DATABASE ────────────
let DB = {};

function loadDB() {
  try { DB = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { DB = {}; }
  if (!DB.version) DB = defaultDB();
  normalizeDB();
  saveDB();
}
function saveDB() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); }
  catch { console.warn('PVGest: nao foi possivel salvar no armazenamento local.'); }
}
function defaultDB() {
  return {
    version:1,
    config:{ propriedade:'Minha Fazenda', mao_obra_ha:80, combustivel_ha:40, depreciacao_ha:30, retrabalho_dias:21 },
    usuarios:[
      { id:'u1', nome:'Gestor',     perfil:'gestor',     pin:'1234', ativo:true },
      { id:'u2', nome:'Agrônomo',   perfil:'agronomo',   pin:'2345', ativo:true },
      { id:'u3', nome:'Tratorista', perfil:'tratorista', pin:'3456', ativo:true }
    ],
    talhoes:[], produtos:[], receitas:[], aplicacoes:[], movimentos:[], leituras:[]
  };
}
function normalizeDB() {
  const base = defaultDB();
  DB.version = DB.version || base.version;
  DB.config = { ...base.config, ...(DB.config||{}) };
  ['usuarios','talhoes','produtos','receitas','aplicacoes','movimentos','leituras'].forEach(k=>{
    if (!Array.isArray(DB[k])) DB[k] = base[k] || [];
  });
  if (!DB.usuarios.length) DB.usuarios = base.usuarios;
}

// ──────────── UTILS ────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const today = () => new Date().toISOString().slice(0,10);
const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtNum  = n => (n||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2});
const fmtMoney = n => 'R$ ' + (n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const byId = (arr,id) => (arr||[]).find(x=>x.id===id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escAttr = s => esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const toNum = (v, fallback=0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const UNIT_META = {
  L:{group:'volume', factor:1}, mL:{group:'volume', factor:0.001},
  kg:{group:'mass', factor:1}, g:{group:'mass', factor:0.001}, t:{group:'mass', factor:1000},
  un:{group:'unit', factor:1}
};
const doseUnitLabel = unit => unit || 'L/ha';
const baseDoseUnit = unit => doseUnitLabel(unit).replace('/ha','');
function convertUnit(qtd, fromUnit, toUnit) {
  if (fromUnit === toUnit) return qtd;
  const from = UNIT_META[fromUnit], to = UNIT_META[toUnit];
  if (!from || !to || from.group !== to.group) return null;
  return qtd * from.factor / to.factor;
}
function doseUsage(item, area, product) {
  const displayUnit = baseDoseUnit(item.unidade);
  const displayQtd = toNum(item.dose) * area;
  const estoqueUnit = product?.unidade || displayUnit;
  const converted = convertUnit(displayQtd, displayUnit, estoqueUnit);
  const conversionMissing = product && converted === null;
  const estoqueQtd = converted === null ? displayQtd : converted;
  return {
    displayQtd, displayUnit, estoqueQtd, estoqueUnit,
    converted: converted !== null && displayUnit !== estoqueUnit,
    conversionMissing,
    custo: estoqueQtd * toNum(product?.preco)
  };
}

function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast ${type}`;
  setTimeout(()=>el.classList.add('hidden'), 2800);
}

// ──────────── AUTH ────────────
let currentUser = null, selUserId = null, pinBuf = '';

function renderLogin() {
  document.getElementById('appScreen').classList.add('hidden');
  const ls = document.getElementById('loginScreen');
  ls.classList.remove('hidden'); ls.classList.add('active');
  showUserSelect();
}

function showUserSelect() {
  document.getElementById('pinSection').classList.add('hidden');
  document.getElementById('userSelect').classList.remove('hidden');
  const cards = DB.usuarios.filter(u=>u.ativo).map(u => {
    const p = PERFIS[u.perfil]||{};
    return `<div class="user-card" onclick="selectUser('${u.id}')">
      <div class="user-card-icon">${p.icon||'👤'}</div>
      <div><div class="user-card-name">${esc(u.nome)}</div>
      <div class="user-card-role">${p.label||u.perfil}</div></div>
    </div>`;
  }).join('');
  document.getElementById('userCards').innerHTML = cards;
}

function selectUser(id) {
  selUserId = id;
  const u = byId(DB.usuarios, id);
  if (!u) return;
  document.getElementById('userSelect').classList.add('hidden');
  document.getElementById('pinSection').classList.remove('hidden');
  document.getElementById('pinHint').textContent = `PIN de ${u.nome}`;
  pinBuf = ''; updatePinDots();
  document.getElementById('pinError').classList.add('hidden');
}

function pinKey(k) {
  if (pinBuf.length >= 4) return;
  pinBuf += k; updatePinDots();
  if (pinBuf.length === 4) setTimeout(tryLogin, 120);
}
function pinBack() { pinBuf = pinBuf.slice(0,-1); updatePinDots(); }
function pinCancel() { pinBuf = ''; selUserId = null; showUserSelect(); }
function updatePinDots() {
  document.querySelectorAll('#pinDots span').forEach((s,i)=>
    s.classList.toggle('filled', i < pinBuf.length));
}
function tryLogin() {
  const u = DB.usuarios.find(x=>x.id===selUserId && x.pin===pinBuf && x.ativo);
  if (!u) {
    document.getElementById('pinError').classList.remove('hidden');
    pinBuf=''; updatePinDots(); return;
  }
  currentUser = u;
  document.getElementById('loginScreen').classList.add('hidden');
  renderApp();
}
function logout() {
  currentUser=null; selUserId=null; pinBuf='';
  closeModal(); closeUserMenu();
  renderLogin();
}
function can(action) {
  if (!currentUser) return false;
  const p = currentUser.perfil;
  const rules = {
    manageUsers:['gestor'], config:['gestor'],
    viewCosts:['gestor','agronomo'],
    manageReceitas:['gestor','agronomo'],
    manageEstoque:['gestor','agronomo'],
    viewRelatorios:['gestor','agronomo'],
    deleteTalhao:['gestor'], deleteProduto:['gestor'],
    addAplicacao:['gestor','agronomo','tratorista'],
    execucao:['tratorista','gestor','agronomo']
  };
  return (rules[action]||[]).includes(p);
}

// ──────────── APP SHELL ────────────
function renderApp() {
  const as = document.getElementById('appScreen');
  as.classList.remove('hidden');
  document.getElementById('hdrProp').textContent = DB.config.propriedade;
  const p = PERFIS[currentUser.perfil]||{};
  document.getElementById('hdrAvatar').textContent = p.icon||'👤';
  document.getElementById('hdrName').textContent = currentUser.nome;
  document.getElementById('menuConfig').classList.toggle('hidden', !can('config'));
  renderNav();
  const tabs = p.tabs||['dt'];
  navTo(tabs[0]);
}

function renderNav() {
  const p = PERFIS[currentUser.perfil]||{};
  const tabs = p.tabs||['dt'];
  const labels = { dt:'ΔT', talhoes:'Talhões', receitas:'Receitas', estoque:'Estoque', relatorios:'Relatórios', execucao:'Execução', config:'Config' };
  const icons  = { dt:'🌡️', talhoes:'🗺️', receitas:'🧪', estoque:'📦', relatorios:'📊', execucao:'🚜', config:'⚙️' };
  document.getElementById('botNav').innerHTML = tabs.map(t =>
    `<button class="nav-btn" data-tab="${t}" onclick="navTo('${t}')">
      <span class="nav-icon">${icons[t]||'📋'}</span>${labels[t]||t}
    </button>`).join('');
}

let curTab = '';
function navTo(tab) {
  curTab = tab;
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el=>el.classList.remove('active'));
  const tc = document.getElementById('tab-'+tab);
  if (tc) tc.classList.add('active');
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  renderTabContent(tab);
  closeUserMenu();
}
function renderTabContent(tab) {
  switch(tab) {
    case 'dt':         renderDT();         break;
    case 'talhoes':    renderTalhoes();    break;
    case 'receitas':   renderReceitas();   break;
    case 'estoque':    renderEstoque();    break;
    case 'relatorios': renderRelatorios(); break;
    case 'execucao':   renderExecucao();   break;
    case 'config':     renderConfig();     break;
  }
}

function toggleUserMenu() {
  document.getElementById('userMenu').classList.toggle('hidden');
}
function closeUserMenu() {
  document.getElementById('userMenu').classList.add('hidden');
}

// ──────────── MODAL ────────────
function openModal(html) {
  document.getElementById('modalSheet').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalSheet').innerHTML = '';
}
function handleOverlayClick(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

// ──────────── DELTA T ────────────
let dtT=26, dtRh=55, dtWind=8;

function calcWetBulb(T,rh) {
  return T*Math.atan(0.151977*Math.pow(rh+8.313659,.5))+Math.atan(T+rh)-Math.atan(rh-1.676331)+0.00391838*Math.pow(rh,1.5)*Math.atan(0.023101*rh)-4.686035;
}
function calcDewPoint(T,rh) {
  const a=17.27,b=237.7,al=((a*T)/(b+T))+Math.log(rh/100);
  return (b*al)/(a-al);
}
function calcVPD(T,rh) {
  const es=0.6108*Math.exp((17.27*T)/(T+237.3));
  return (es-es*(rh/100));
}
function dtStatus(dt) {
  if (dt<2)  return {cls:'badge-low',   hero:'#1E88E5', label:'UR muito alta',      adv:`<b>Delta T abaixo de 2.</b> Umidade excessiva — risco de inversão térmica e deriva descendente. Não pulverize.`};
  if (dt<=8) return {cls:'badge-ideal', hero:'#43A047', label:'Condição ideal',      adv:`<b>Janela ideal (Delta T 2–8).</b> Boa evaporação, mínima deriva, cobertura uniforme. Prossiga com a aplicação.`};
  if (dt<=10)return {cls:'badge-caution',hero:'#F57C00',label:'Limiar — atenção',   adv:`<b>Delta T no limiar (8–10).</b> Evaporação elevada. Use gotas maiores e horários mais frescos.`};
  return       {cls:'badge-risk',   hero:'#E53935', label:'Crítico — suspender', adv:`<b>Delta T acima de 10 — crítico.</b> Evaporação extrema. Suspenda e aguarde condições melhores.`};
}
function windStatus(w) {
  if (w<3)   return {color:'#1E88E5', txt:`<b>Vento calmo (< 3 km/h).</b> Risco de inversão térmica. Monitorar.`};
  if (w<=15) return {color:'#43A047', txt:`<b>Vento ideal (3–15 km/h).</b> Boa dispersão, mínima deriva.`};
  if (w<=20) return {color:'#F57C00', txt:`<b>Vento no limite (15–20 km/h).</b> Risco moderado de deriva. Use gotas maiores.`};
  return       {color:'#E53935', txt:`<b>Vento excessivo (> 20 km/h).</b> Suspenda a aplicação imediatamente.`};
}

function renderDT() {
  document.querySelectorAll('.fab').forEach(f=>f.remove());
  const wb = calcWetBulb(dtT,dtRh);
  const dt = dtT - wb;
  const dp = calcDewPoint(dtT,dtRh);
  const vpd = calcVPD(dtT,dtRh);
  const s = dtStatus(dt);
  const ws = windStatus(dtWind);
  const needlePct = Math.min(Math.max((dt/15)*100,0),100);
  const windPct = Math.min((dtWind/30)*100,100);

  const talhaoOptions = DB.talhoes.map(t=>`<option value="${t.id}">${esc(t.nome)} (${t.area} ha)</option>`).join('');

  document.getElementById('tab-dt').innerHTML = `
    <div class="page-hdr"><div><div class="page-title">Delta T</div><div class="page-sub">Janela de pulverização</div></div>
      <span class="badge ${s.cls}" style="font-size:.75rem">${s.label}</span>
    </div>

    <div class="card"><div class="slider-row">
      <div class="slider-top"><span class="slider-name">Temperatura</span>
        <span class="slider-val" id="vT">${dtT.toFixed(1)}<span class="slider-unit"> °C</span></span></div>
      <input type="range" id="slT" min="5" max="45" step=".5" value="${dtT}" oninput="dtT=+this.value;updateDT()">
    </div><div class="slider-row">
      <div class="slider-top"><span class="slider-name">Umidade Relativa</span>
        <span class="slider-val" id="vRh">${dtRh}<span class="slider-unit"> %UR</span></span></div>
      <input type="range" id="slRh" min="10" max="100" step="1" value="${dtRh}" oninput="dtRh=+this.value;updateDT()">
    </div><div class="slider-row">
      <div class="slider-top"><span class="slider-name">Vento</span>
        <span class="slider-val" id="vW">${dtWind.toFixed(1)}<span class="slider-unit"> km/h</span></span></div>
      <input type="range" id="slW" min="0" max="30" step=".5" value="${dtWind}" oninput="dtWind=+this.value;updateDT()">
    </div></div>

    <div class="dt-result" id="dtResult" style="--hero:${s.hero}">
      <div class="dt-lbl">Delta T</div>
      <div class="dt-val" id="dtBig">${dt.toFixed(1)}</div>
      <div><span class="dt-badge ${s.cls}" id="dtBadge">${s.label}</span></div>
      <div class="dt-advice" id="dtAdv">${s.adv}</div>
      <div class="gauge-wrap">
        <div class="gauge-track"><div class="gauge-needle" id="needle" style="left:${needlePct}%"></div></div>
        <div class="gauge-lbls"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span><span>15+</span></div>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card"><div class="metric-lbl">Bulbo Úmido</div>
        <div class="metric-val" id="mWB">${wb.toFixed(1)}</div><div class="metric-unit">°C</div></div>
      <div class="metric-card"><div class="metric-lbl">Ponto Orvalho</div>
        <div class="metric-val" id="mDP">${dp.toFixed(1)}</div><div class="metric-unit">°C</div></div>
      <div class="metric-card"><div class="metric-lbl">VPD</div>
        <div class="metric-val" id="mVPD">${vpd.toFixed(2)}</div><div class="metric-unit">kPa</div></div>
    </div>

    <div class="card card-body mb-2">
      <div class="card-title">Condição do vento</div>
      <div class="wind-bar-wrap">
        <div class="wind-bar-bg"><div class="wind-bar-fill" id="windFill" style="width:${windPct}%;background:${ws.color}"></div></div>
        <span style="font-size:.85rem;font-weight:600;color:var(--txt);min-width:36px" id="windKmh">${dtWind.toFixed(0)} km/h</span>
      </div>
      <div class="wind-zones"><span>Calmo</span><span>Ideal</span><span>Atenção</span><span>Risco</span></div>
      <div class="dt-advice mt-1" id="windAdv">${ws.txt}</div>
    </div>

    <div class="card card-body mb-2">
      <div class="card-title">Salvar leitura</div>
      <div class="form-group">
        <label class="form-label">Talhão (opcional)</label>
        <select class="form-input" id="dtTalhao"><option value="">— Nenhum —</option>${talhaoOptions}</select>
      </div>
      <button class="btn btn-primary btn-block" onclick="saveDTReading()">💾 Salvar leitura</button>
    </div>

    ${DB.leituras.length ? `<div class="sec-lbl">Últimas leituras</div>
    <div class="list-card">${DB.leituras.slice(0,5).map(l=>{
      const st = dtStatus(l.dt);
      return `<div class="list-item" style="cursor:default">
        <div class="li-icon" style="background:var(--g50)">🌡️</div>
        <div class="li-body">
          <div class="li-title">ΔT ${l.dt} — ${l.talhao ? esc(byId(DB.talhoes,l.talhao)?.nome||'?') : 'Sem talhão'}</div>
          <div class="li-sub">${fmtDate(l.data)} · T:${l.temp}°C · UR:${l.rh}% · Vento:${l.vento}km/h</div>
        </div>
        <span class="badge ${st.cls}" style="font-size:.65rem">${st.label}</span>
      </div>`;}).join('')}</div>` : ''}
  `;
}

function updateDT() {
  const wb = calcWetBulb(dtT,dtRh);
  const dt = dtT - wb;
  const dp = calcDewPoint(dtT,dtRh);
  const vpd = calcVPD(dtT,dtRh);
  const s = dtStatus(dt);
  const ws = windStatus(dtWind);
  const needlePct = Math.min(Math.max((dt/15)*100,0),100);
  const windPct = Math.min((dtWind/30)*100,100);

  document.getElementById('vT').innerHTML = dtT.toFixed(1)+'<span class="slider-unit"> °C</span>';
  document.getElementById('vRh').innerHTML = dtRh+'<span class="slider-unit"> %UR</span>';
  document.getElementById('vW').innerHTML = dtWind.toFixed(1)+'<span class="slider-unit"> km/h</span>';
  document.getElementById('dtBig').textContent = dt.toFixed(1);
  document.getElementById('dtBadge').textContent = s.label;
  document.getElementById('dtBadge').className = `dt-badge ${s.cls}`;
  document.getElementById('dtAdv').innerHTML = s.adv;
  document.getElementById('dtResult').style.setProperty('--hero', s.hero);
  document.getElementById('needle').style.left = needlePct+'%';
  document.getElementById('mWB').textContent = wb.toFixed(1);
  document.getElementById('mDP').textContent = dp.toFixed(1);
  document.getElementById('mVPD').textContent = vpd.toFixed(2);
  document.getElementById('windFill').style.width = windPct+'%';
  document.getElementById('windFill').style.background = ws.color;
  document.getElementById('windKmh').textContent = dtWind.toFixed(0)+' km/h';
  document.getElementById('windAdv').innerHTML = ws.txt;
}

function saveDTReading() {
  const wb = calcWetBulb(dtT,dtRh);
  const dt = dtT - wb;
  const talhao = document.getElementById('dtTalhao')?.value || '';
  DB.leituras.unshift({ id:uid(), data:today(), dt:+dt.toFixed(1), temp:dtT, rh:dtRh, vento:dtWind, talhao, usuario:currentUser.id });
  if (DB.leituras.length > 100) DB.leituras = DB.leituras.slice(0,100);
  saveDB(); toast('Leitura salva!'); renderDT();
}

// ──────────── TALHÕES ────────────
function renderTalhoes() {
  const el = document.getElementById('tab-talhoes');
  const list = DB.talhoes.length ? DB.talhoes.map(t => {
    const aps = DB.aplicacoes.filter(a=>a.talhao===t.id);
    const last = aps.sort((a,b)=>(b.data||'').localeCompare(a.data||''))[0];
    return `<div class="list-card">
      <div class="list-item" onclick="openTalhaoDetail('${t.id}')">
        <div class="li-icon" style="background:var(--g50);color:var(--g800)">🗺️</div>
        <div class="li-body">
          <div class="li-title">${esc(t.nome)}</div>
          <div class="li-sub">${t.area} ha · ${esc(t.cultura||'—')} · ${esc(t.safra||'—')}</div>
        </div>
        <div class="li-right">
          <div class="li-value">${aps.length}</div>
          <div class="li-unit">aplicações</div>
        </div>
      </div>
      <div class="li-actions">
        <button class="btn btn-secondary btn-sm" onclick="openTalhaoForm('${t.id}')">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="openNovaAplicacao('${t.id}')">💧 Aplicação</button>
        ${can('deleteTalhao')?`<button class="btn btn-danger btn-sm" onclick="deleteTalhao('${t.id}')">🗑️</button>`:''}
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="empty-icon">🗺️</div>
    <div class="empty-title">Nenhum talhão cadastrado</div>
    <div class="empty-sub">Toque no + para adicionar</div></div>`;

  el.innerHTML = `<div class="page-hdr"><div><div class="page-title">Talhões</div>
    <div class="page-sub">${DB.talhoes.length} cadastrados</div></div></div>${list}`;
  el.insertAdjacentHTML('beforeend','<div style="height:80px"></div>');
  manageFab('fab-talhao', ()=>openTalhaoForm());
}

function openTalhaoDetail(id) {
  const t = byId(DB.talhoes, id); if (!t) return;
  const aps = DB.aplicacoes.filter(a=>a.talhao===id).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const totalCusto = aps.reduce((s,a)=>s+(a.custo_total||0),0);
  openModal(`
    <div class="modal-hdr"><span class="modal-title">📍 ${esc(t.nome)}</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-lbl">Área</div><div class="stat-val">${t.area}</div><div class="stat-sub">hectares</div></div>
        <div class="stat-card"><div class="stat-lbl">Aplicações</div><div class="stat-val">${aps.length}</div><div class="stat-sub">total</div></div>
        <div class="stat-card"><div class="stat-lbl">Cultura</div><div class="stat-val" style="font-size:1.1rem">${esc(t.cultura||'—')}</div></div>
        <div class="stat-card"><div class="stat-lbl">Custo Total</div><div class="stat-val" style="font-size:1.1rem">${fmtMoney(totalCusto)}</div></div>
      </div>
      ${aps.length ? `<div class="sec-lbl mt-2">Histórico de aplicações</div>
      ${aps.map(a=>{
        const r = byId(DB.receitas,a.receita);
        return `<div class="list-item" style="cursor:default;border:1px solid var(--brd);border-radius:var(--rs);margin-bottom:.5rem">
          <div class="li-icon" style="background:var(--g50)">💧</div>
          <div class="li-body">
            <div class="li-title">${r?esc(r.nome):'Sem receita'}</div>
            <div class="li-sub">${fmtDate(a.data)} · ${a.area_ha||t.area} ha · ΔT ${a.delta_t||'—'}</div>
          </div>
          <div class="li-right"><div class="li-value">${fmtMoney(a.custo_total||0)}</div></div>
        </div>`;}).join('')}` : '<div class="empty-state" style="padding:1.5rem 0"><div class="empty-sub">Nenhuma aplicação registrada</div></div>'}
    </div>
    <div class="modal-footer"><button class="btn btn-primary btn-block" onclick="closeModal();openNovaAplicacao('${id}')">💧 Nova Aplicação</button></div>
  `);
}

function openTalhaoForm(id) {
  const t = id ? byId(DB.talhoes,id) : null;
  openModal(`
    <div class="modal-hdr"><span class="modal-title">${t?'Editar':'Novo'} Talhão</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome do Talhão</label>
        <input class="form-input" id="fTNome" placeholder="Ex: Talhão A / Gleba 01" value="${escAttr(t?.nome||'')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Área (ha)</label>
          <input class="form-input" id="fTArea" type="number" step=".1" min="0" placeholder="0.0" value="${t?.area||''}"></div>
        <div class="form-group"><label class="form-label">Safra</label>
          <input class="form-input" id="fTSafra" placeholder="2024/25" value="${escAttr(t?.safra||'')}"></div>
      </div>
      <div class="form-group"><label class="form-label">Cultura</label>
        <select class="form-input" id="fTCultura">${CULTURAS.map(c=>`<option ${(t?.cultura||'')==c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Observações</label>
        <textarea class="form-input" id="fTObs" rows="2">${esc(t?.obs||'')}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" onclick="saveTalhao('${id||''}')">💾 Salvar</button>
    </div>
  `);
}

function saveTalhao(id) {
  const nome = document.getElementById('fTNome').value.trim();
  const area = parseFloat(document.getElementById('fTArea').value);
  if (!nome) { toast('Informe o nome do talhão','error'); return; }
  if (!area || area<=0) { toast('Informe a área em hectares','error'); return; }
  if (id) {
    const t = byId(DB.talhoes,id);
    if (!t) { toast('Talhão não encontrado para atualização','error'); return; }
    Object.assign(t, { nome, area, safra:document.getElementById('fTSafra').value, cultura:document.getElementById('fTCultura').value, obs:document.getElementById('fTObs').value });
  } else {
    DB.talhoes.push({ id:uid(), nome, area, safra:document.getElementById('fTSafra').value, cultura:document.getElementById('fTCultura').value, obs:document.getElementById('fTObs').value });
  }
  saveDB(); closeModal(); toast(id?'Talhão atualizado!':'Talhão cadastrado!'); renderTalhoes();
}

function deleteTalhao(id) {
  if (!confirm('Excluir este talhão? As aplicações associadas serão mantidas.')) return;
  DB.talhoes = DB.talhoes.filter(t=>t.id!==id);
  saveDB(); toast('Talhão excluído'); renderTalhoes();
}

// ──────────── ESTOQUE ────────────
function renderEstoque() {
  const el = document.getElementById('tab-estoque');
  const alertas = DB.produtos.filter(p => {
    const pct = p.estoque_min>0 ? p.estoque_atual/p.estoque_min : 1;
    return pct <= 1 || isExpiring(p);
  });

  const alertHtml = alertas.length ? alertas.map(p=>{
    if (p.estoque_atual <= (p.estoque_min||0))
      return `<div class="alert alert-danger">⚠️ <b>${esc(p.nome)}</b> — Estoque baixo: ${fmtNum(p.estoque_atual)} ${p.unidade}</div>`;
    if (isExpiring(p))
      return `<div class="alert alert-warn">🗓️ <b>${esc(p.nome)}</b> — Vencimento: ${fmtDate(p.validade)}</div>`;
    return '';
  }).join('') : '';

  const list = DB.produtos.length ? DB.produtos.map(p => {
    const pct = p.estoque_min>0 ? Math.min(p.estoque_atual/(p.estoque_min*2),1) : (p.estoque_atual>0?1:0);
    const barColor = p.estoque_atual<=(p.estoque_min||0) ? 'var(--r600)' : p.estoque_atual<=(p.estoque_min||0)*1.5 ? 'var(--a600)' : 'var(--g600)';
    return `<div class="list-card">
      <div class="list-item" onclick="openMovimentoForm('${p.id}')">
        <div class="li-icon" style="background:var(--g50);color:var(--g800)">📦</div>
        <div class="li-body">
          <div class="li-title">${esc(p.nome)}</div>
          <div class="li-sub">${esc(p.classe||'—')} · ${fmtMoney(p.preco||0)}/${p.unidade}</div>
          <div class="stock-bar"><div class="stock-bar-fill" style="width:${(pct*100).toFixed(0)}%;background:${barColor}"></div></div>
        </div>
        <div class="li-right">
          <div class="li-value" style="color:${barColor}">${fmtNum(p.estoque_atual)}</div>
          <div class="li-unit">${p.unidade}</div>
        </div>
      </div>
      <div class="li-actions">
        <button class="btn btn-secondary btn-sm" onclick="openProdutoForm('${p.id}')">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="openMovimentoForm('${p.id}')">± Movimentar</button>
        ${can('deleteProduto')?`<button class="btn btn-danger btn-sm" onclick="deleteProduto('${p.id}')">🗑️</button>`:''}
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="empty-icon">📦</div>
    <div class="empty-title">Nenhum produto cadastrado</div>
    <div class="empty-sub">Toque no + para adicionar</div></div>`;

  el.innerHTML = `<div class="page-hdr"><div><div class="page-title">Estoque</div>
    <div class="page-sub">${DB.produtos.length} produtos</div></div></div>
    ${alertHtml}${list}`;
  el.insertAdjacentHTML('beforeend','<div style="height:80px"></div>');
  manageFab('fab-estoque', ()=>openProdutoForm());
}

function isExpiring(p) {
  if (!p.validade) return false;
  const diff = (new Date(p.validade)-new Date())/(1000*60*60*24);
  return diff >= 0 && diff <= 30;
}

function openProdutoForm(id) {
  const p = id ? byId(DB.produtos,id) : null;
  openModal(`
    <div class="modal-hdr"><span class="modal-title">${p?'Editar':'Novo'} Produto</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome do produto</label>
        <input class="form-input" id="fPNome" placeholder="Ex: Glifosato 480" value="${escAttr(p?.nome||'')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Classe</label>
          <select class="form-input" id="fPClasse">${CLASSES.map(c=>`<option ${(p?.classe||'')==c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Unidade</label>
          <select class="form-input" id="fPUn">${UNIDADES.map(u=>`<option ${(p?.unidade||'L')==u?'selected':''}>${u}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Estoque atual</label>
          <input class="form-input" id="fPEst" type="number" step=".1" min="0" value="${p?.estoque_atual||0}"></div>
        <div class="form-group"><label class="form-label">Estoque mínimo</label>
          <input class="form-input" id="fPMin" type="number" step=".1" min="0" value="${p?.estoque_min||0}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Preço (R$/${p?.unidade||'un'})</label>
          <input class="form-input" id="fPPreco" type="number" step=".01" min="0" value="${p?.preco||''}"></div>
        <div class="form-group"><label class="form-label">Validade</label>
          <input class="form-input" id="fPVal" type="date" value="${p?.validade||''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Fabricante</label>
        <input class="form-input" id="fPFab" placeholder="Nome do fabricante" value="${escAttr(p?.fabricante||'')}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" onclick="saveProduto('${id||''}')">💾 Salvar</button>
    </div>
  `);
}

function saveProduto(id) {
  const nome = document.getElementById('fPNome').value.trim();
  if (!nome) { toast('Informe o nome do produto','error'); return; }
  const estoqueAtual = toNum(document.getElementById('fPEst').value);
  const estoqueMin = toNum(document.getElementById('fPMin').value);
  const preco = toNum(document.getElementById('fPPreco').value);
  if (estoqueAtual < 0 || estoqueMin < 0 || preco < 0) {
    toast('Estoque e preço não podem ser negativos','error');
    return;
  }
  const data = {
    nome, classe:document.getElementById('fPClasse').value,
    unidade:document.getElementById('fPUn').value,
    estoque_atual:estoqueAtual,
    estoque_min:estoqueMin,
    preco,
    validade:document.getElementById('fPVal').value,
    fabricante:document.getElementById('fPFab').value
  };
  if (id) {
    const produto = byId(DB.produtos,id);
    if (!produto) { toast('Produto não encontrado para atualização','error'); return; }
    Object.assign(produto, data);
  }
  else DB.produtos.push({id:uid(), ...data});
  saveDB(); closeModal(); toast(id?'Produto atualizado!':'Produto cadastrado!'); renderEstoque();
}

function deleteProduto(id) {
  if (!confirm('Excluir este produto?')) return;
  DB.produtos = DB.produtos.filter(p=>p.id!==id);
  saveDB(); toast('Produto excluído'); renderEstoque();
}

function openMovimentoForm(produtoId) {
  const p = byId(DB.produtos, produtoId); if (!p) return;
  openModal(`
    <div class="modal-hdr"><span class="modal-title">± ${esc(p.nome)}</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="metric-grid" style="grid-template-columns:1fr 1fr;margin-bottom:1rem">
        <div class="metric-card"><div class="metric-lbl">Estoque Atual</div>
          <div class="metric-val">${fmtNum(p.estoque_atual)}</div><div class="metric-unit">${p.unidade}</div></div>
        <div class="metric-card"><div class="metric-lbl">Mínimo</div>
          <div class="metric-val">${fmtNum(p.estoque_min)}</div><div class="metric-unit">${p.unidade}</div></div>
      </div>
      <div class="form-group"><label class="form-label">Tipo de movimentação</label>
        <select class="form-input" id="fMTipo" onchange="updateMovLabel()">
          <option value="entrada">📥 Entrada (compra / recebimento)</option>
          <option value="saida">📤 Saída (uso / descarte)</option>
        </select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label" id="fMQtdLbl">Quantidade (${p.unidade})</label>
          <input class="form-input" id="fMQtd" type="number" step=".1" min="0" placeholder="0.0"></div>
        <div class="form-group"><label class="form-label">Preço unitário (R$)</label>
          <input class="form-input" id="fMPreco" type="number" step=".01" min="0" value="${p.preco||''}"></div>
      </div>
      <div class="form-group"><label class="form-label">Data</label>
        <input class="form-input" id="fMData" type="date" value="${today()}"></div>
      <div class="form-group"><label class="form-label">Observações</label>
        <input class="form-input" id="fMObs" placeholder="NF, lote, etc."></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" onclick="saveMovimento('${produtoId}')">💾 Registrar</button>
    </div>
  `);
}

function updateMovLabel() {
  const t = document.getElementById('fMTipo')?.value;
  const lbl = document.getElementById('fMQtdLbl');
  if (lbl) lbl.textContent = t==='entrada' ? 'Quantidade recebida' : 'Quantidade retirada';
}

function saveMovimento(produtoId) {
  const p = byId(DB.produtos, produtoId); if (!p) return;
  const tipo  = document.getElementById('fMTipo').value;
  const qtd   = parseFloat(document.getElementById('fMQtd').value)||0;
  const preco = toNum(document.getElementById('fMPreco').value, toNum(p.preco));
  const data  = document.getElementById('fMData').value || today();
  const obs   = document.getElementById('fMObs').value;
  if (!qtd || qtd<=0) { toast('Informe a quantidade','error'); return; }
  if (preco < 0) { toast('Preço não pode ser negativo','error'); return; }
  if (tipo==='saida' && qtd>p.estoque_atual) { toast('Quantidade maior que o estoque atual','error'); return; }
  p.estoque_atual += tipo==='entrada' ? qtd : -qtd;
  if (preco) p.preco = preco;
  DB.movimentos.push({ id:uid(), produto:produtoId, tipo, qtd, preco, data, obs, usuario:currentUser.id });
  saveDB(); closeModal(); toast('Movimentação registrada!'); renderEstoque();
}

// ──────────── RECEITAS ────────────
function renderReceitas() {
  const el = document.getElementById('tab-receitas');
  const list = DB.receitas.length ? DB.receitas.map(r => {
    const itens = (r.itens||[]).map(i=>{
      const p = byId(DB.produtos,i.produto);
      return `<div class="prod-item">
        <span class="prod-item-name">${p?esc(p.nome):esc(i.nome_livre||'?')}</span>
        <span class="prod-item-dose">${fmtNum(i.dose)} ${doseUnitLabel(i.unidade)}</span>
      </div>`;
    }).join('');
    return `<div class="list-card">
      <div class="list-item" onclick="openReceitaDetail('${r.id}')">
        <div class="li-icon" style="background:var(--g50);color:var(--g800)">🧪</div>
        <div class="li-body">
          <div class="li-title">${esc(r.nome)}</div>
          <div class="li-sub">${esc(r.cultura||'—')} · ${esc(r.alvo||'—')} · ${r.volume_ha||200} L/ha</div>
        </div>
        <div class="li-right"><div class="li-value">${(r.itens||[]).length}</div><div class="li-unit">produtos</div></div>
      </div>
      <div class="li-actions">
        <button class="btn btn-secondary btn-sm" onclick="openReceitaForm('${r.id}')">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="openCalculadora('${r.id}')">📐 Calcular</button>
        ${can('manageReceitas')?`<button class="btn btn-danger btn-sm" onclick="deleteReceita('${r.id}')">🗑️</button>`:''}
      </div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="empty-icon">🧪</div>
    <div class="empty-title">Nenhuma receita cadastrada</div>
    <div class="empty-sub">Toque no + para adicionar</div></div>`;

  el.innerHTML = `<div class="page-hdr"><div><div class="page-title">Receitas de Calda</div>
    <div class="page-sub">${DB.receitas.length} receitas</div></div></div>${list}`;
  el.insertAdjacentHTML('beforeend','<div style="height:80px"></div>');
  manageFab('fab-receita', ()=>openReceitaForm());
}

function openReceitaDetail(id) {
  const r = byId(DB.receitas,id); if (!r) return;
  const custo_ha = (r.itens||[]).reduce((s,i)=>{
    const p = byId(DB.produtos,i.produto);
    return s + i.dose*(p?.preco||0);
  },0);
  openModal(`
    <div class="modal-hdr"><span class="modal-title">🧪 ${esc(r.nome)}</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-lbl">Volume calda</div><div class="stat-val">${r.volume_ha||200}</div><div class="stat-sub">L/ha</div></div>
        <div class="stat-card"><div class="stat-lbl">Custo produto/ha</div><div class="stat-val" style="font-size:1.1rem">${fmtMoney(custo_ha)}</div></div>
      </div>
      <div class="sec-lbl mt-2">Produtos na calda</div>
      ${(r.itens||[]).map(i=>{
        const p = byId(DB.produtos,i.produto);
        const custo_item = i.dose*(p?.preco||0);
        return `<div class="prod-item">
          <div style="flex:1"><div style="font-size:.85rem;font-weight:600">${p?esc(p.nome):esc(i.nome_livre||'?')}</div>
            <div style="font-size:.72rem;color:var(--txt3)">${p?esc(p.classe||''):'—'}</div></div>
          <div style="text-align:right"><div style="font-size:.85rem;font-weight:600">${fmtNum(i.dose)} ${doseUnitLabel(i.unidade)}</div>
            <div style="font-size:.72rem;color:var(--txt3)">${fmtMoney(custo_item)}/ha</div></div>
        </div>`;}).join('')}
      ${r.obs?`<div class="alert alert-info mt-2">📝 ${esc(r.obs)}</div>`:''}
    </div>
    <div class="modal-footer"><button class="btn btn-primary btn-block" onclick="closeModal();openCalculadora('${id}')">📐 Calcular para minha área</button></div>
  `);
}

// Items temporários da receita sendo editada
let receitaItems = [];

function openReceitaForm(id) {
  const r = id ? byId(DB.receitas,id) : null;
  receitaItems = r ? JSON.parse(JSON.stringify(r.itens||[])) : [];
  renderReceitaFormModal(id, r);
}

function renderReceitaFormModal(id, r) {
  const hasProdutos = DB.produtos.length > 0;
  const prodOptions = hasProdutos
    ? DB.produtos.map(p=>`<option value="${p.id}">${esc(p.nome)} (${p.unidade})</option>`).join('')
    : '<option value="">— Nenhum produto cadastrado —</option>';
  const itemsHtml = receitaItems.map((it,idx)=>{
    const p = byId(DB.produtos,it.produto);
    return `<div class="prod-item" style="align-items:center">
      <div style="flex:1"><div style="font-size:.85rem;font-weight:600">${p?esc(p.nome):esc(it.nome_livre||'?')}</div>
        <div style="font-size:.72rem;color:var(--txt3)">${fmtNum(it.dose)} ${doseUnitLabel(it.unidade)}</div></div>
      <button class="btn-icon" style="font-size:.85rem" onclick="removeReceitaItem(${idx})">✕</button>
    </div>`;
  }).join('');

  openModal(`
    <div class="modal-hdr"><span class="modal-title">${r?'Editar':'Nova'} Receita</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body" data-id="${escAttr(id||'')}">
      <div class="form-group"><label class="form-label">Nome da receita</label>
        <input class="form-input" id="fRNome" placeholder="Ex: Fungicida soja fase R1" value="${escAttr(r?.nome||'')}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cultura</label>
          <select class="form-input" id="fRCultura">${CULTURAS.map(c=>`<option ${(r?.cultura||'')==c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Volume calda (L/ha)</label>
          <input class="form-input" id="fRVol" type="number" min="1" value="${r?.volume_ha||200}"></div>
      </div>
      <div class="form-group"><label class="form-label">Alvo (praga/doença)</label>
        <input class="form-input" id="fRAlvo" placeholder="Ex: Ferrugem asiática" value="${escAttr(r?.alvo||'')}"></div>

      <div class="sec-lbl mt-2">Produtos na calda</div>
      <div id="receitaItemsList">${itemsHtml||'<div class="empty-sub" style="font-size:.8rem;margin-bottom:.75rem">Nenhum produto adicionado</div>'}</div>

      <div class="card card-body" style="background:var(--surf3)">
        <div class="sec-lbl">Adicionar produto</div>
        ${!hasProdutos?'<div class="alert alert-warn" style="font-size:.8rem;margin-bottom:.5rem">⚠️ Cadastre produtos no Estoque antes de montar a receita.</div>':''}
        <select class="form-input mb-1" id="fRProd" style="margin-bottom:.5rem" ${!hasProdutos?'disabled':''}>${prodOptions}</select>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Dose</label>
            <input class="form-input" id="fRDose" type="number" step=".01" min="0" placeholder="0.0" ${!hasProdutos?'disabled':''}></div>
          <div class="form-group"><label class="form-label">Unidade</label>
            <select class="form-input" id="fRDoseUn" ${!hasProdutos?'disabled':''}>${['L/ha','mL/ha','kg/ha','g/ha'].map(u=>`<option>${u}</option>`).join('')}</select></div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="addReceitaItem()" ${!hasProdutos?'disabled':''}>+ Adicionar</button>
      </div>

      <div class="form-group mt-2"><label class="form-label">Observações / Recomendações</label>
        <textarea class="form-input" id="fRObs" rows="2">${esc(r?.obs||'')}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" onclick="saveReceita('${id||''}')">💾 Salvar Receita</button>
    </div>
  `);
}

function addReceitaItem() {
  const prodId = document.getElementById('fRProd')?.value;
  const dose   = parseFloat(document.getElementById('fRDose')?.value)||0;
  const un     = document.getElementById('fRDoseUn')?.value||'L/ha';
  if (!prodId) { toast('Selecione um produto','error'); return; }
  if (!dose||dose<=0) { toast('Informe a dose','error'); return; }
  const p = byId(DB.produtos, prodId);
  if (!p) return;
  receitaItems.push({ produto:prodId, dose, unidade:un, nome_livre:p.nome });
  const values = getReceitaFormValues();
  const id = document.querySelector('#modalSheet [data-id]')?.dataset.id||'';
  const r = id ? byId(DB.receitas,id) : null;
  renderReceitaFormModal(id||'', r);
  applyReceitaFormValues(values);
}

function removeReceitaItem(idx) {
  receitaItems.splice(idx,1);
  const id = document.querySelector('#modalSheet [data-id]')?.dataset.id||'';
  const r = id ? byId(DB.receitas,id) : null;
  const values = getReceitaFormValues();
  renderReceitaFormModal(id||'', r);
  applyReceitaFormValues(values);
}

function getReceitaFormValues() {
  return {
    nome:document.getElementById('fRNome')?.value ?? '',
    vol:document.getElementById('fRVol')?.value ?? '',
    alvo:document.getElementById('fRAlvo')?.value ?? '',
    obs:document.getElementById('fRObs')?.value ?? '',
    cultura:document.getElementById('fRCultura')?.value ?? ''
  };
}
function applyReceitaFormValues(values) {
  if (!values) return;
  const fields = { fRNome:'nome', fRVol:'vol', fRAlvo:'alvo', fRObs:'obs', fRCultura:'cultura' };
  Object.entries(fields).forEach(([id,key])=>{
    const el = document.getElementById(id);
    if (el) el.value = values[key] ?? '';
  });
}

function saveReceita(id) {
  const nome = document.getElementById('fRNome').value.trim();
  if (!nome) { toast('Informe o nome da receita','error'); return; }
  if (!receitaItems.length) { toast('Adicione ao menos um produto','error'); return; }
  const data = {
    nome, cultura:document.getElementById('fRCultura').value,
    volume_ha:parseFloat(document.getElementById('fRVol').value)||200,
    alvo:document.getElementById('fRAlvo').value,
    obs:document.getElementById('fRObs').value,
    itens:receitaItems.map(i=>({ ...i, dose:toNum(i.dose), unidade:doseUnitLabel(i.unidade) }))
  };
  if (id) {
    const receita = byId(DB.receitas,id);
    if (!receita) { toast('Receita não encontrada para atualização','error'); return; }
    Object.assign(receita, data);
  }
  else DB.receitas.push({id:uid(), ...data, criado_por:currentUser.id});
  saveDB(); closeModal(); toast(id?'Receita atualizada!':'Receita salva!'); renderReceitas();
}

function deleteReceita(id) {
  if (!confirm('Excluir esta receita?')) return;
  DB.receitas = DB.receitas.filter(r=>r.id!==id);
  saveDB(); toast('Receita excluída'); renderReceitas();
}

function openCalculadora(receitaId) {
  const r = byId(DB.receitas, receitaId); if (!r) return;
  const tOpts = DB.talhoes.map(t=>`<option value="${t.area}" data-id="${t.id}">${esc(t.nome)} — ${t.area} ha</option>`).join('');
  openModal(`
    <div class="modal-hdr"><span class="modal-title">📐 Calcular Receita</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body" data-receita-id="${receitaId}">
      <div style="font-size:.9rem;font-weight:600;color:var(--g800);margin-bottom:.75rem">🧪 ${esc(r.nome)}</div>
      <div class="form-group"><label class="form-label">Escolha o talhão</label>
        <select class="form-input" id="calcTalhao" onchange="calcAreaFromTalhao()">
          <option value="">— Área manual —</option>${tOpts}</select></div>
      <div class="form-group"><label class="form-label">Área a pulverizar (ha)</label>
        <input class="form-input" id="calcArea" type="number" step=".1" min="0" placeholder="0.0" oninput="calcResult('${receitaId}')"></div>
      <div id="calcOutput"></div>
    </div>
  `);
}

function calcAreaFromTalhao() {
  const sel = document.getElementById('calcTalhao');
  if (sel.value) {
    document.getElementById('calcArea').value = sel.value;
  }
  // Get receita ID from data attribute
  const receitaId = document.querySelector('#modalSheet .modal-body[data-receita-id]')?.dataset.receitaId;
  if (receitaId) calcResult(receitaId);
}

function calcResult(receitaId) {
  const r = byId(DB.receitas,receitaId); if(!r) return;
  const area = parseFloat(document.getElementById('calcArea')?.value)||0;
  const out = document.getElementById('calcOutput'); if(!out) return;
  if (!area||area<=0) { out.innerHTML=''; return; }
  const totalVol = (r.volume_ha||200)*area;
  const itens = (r.itens||[]).map(i=>{
    const p = byId(DB.produtos,i.produto);
    const usage = doseUsage(i, area, p);
    const estOk = !p || (!usage.conversionMissing && toNum(p.estoque_atual) >= usage.estoqueQtd);
    return { p, ...usage, estOk, i };
  });
  const totalCusto = itens.reduce((s,i)=>s+i.custo,0);
  out.innerHTML = `
    <div class="divider"></div>
    <div class="sec-lbl">Resultado para ${fmtNum(area)} ha</div>
    <div class="card card-body">
      ${itens.map(it=>`
        <div class="calc-result-item">
          <span>${it.p?esc(it.p.nome):esc(it.i.nome_livre||'?')}</span>
          <div style="text-align:right">
            <strong>${fmtNum(it.displayQtd)} ${it.displayUnit}</strong>
            <div style="font-size:.72rem;color:var(--txt3)">${fmtMoney(it.custo)}</div>
            ${it.converted?`<div style="font-size:.65rem;color:var(--txt3)">Baixa: ${fmtNum(it.estoqueQtd)} ${it.estoqueUnit}</div>`:''}
            ${it.conversionMissing?`<div style="font-size:.65rem;color:var(--r600)">⚠️ Unidade incompatível com o estoque</div>`:''}
            ${!it.estOk?`<div style="font-size:.65rem;color:var(--r600)">⚠️ Estoque insuficiente</div>`:''}
          </div>
        </div>`).join('')}
      <div class="calc-result-item" style="font-weight:700">
        <span>Volume total de calda</span><strong>${fmtNum(totalVol)} L</strong>
      </div>
      <div class="calc-result-item" style="font-weight:700">
        <span>Custo total de produtos</span><strong style="color:var(--g800)">${fmtMoney(totalCusto)}</strong>
      </div>
      <div class="calc-result-item">
        <span>Custo por hectare</span><strong>${fmtMoney(totalCusto/area)}</strong>
      </div>
    </div>`;
}

// ──────────── APLICAÇÕES ────────────
function openNovaAplicacao(talhaoId) {
  const tOpts = `<option value="">— Selecione o talhão —</option>` + DB.talhoes.map(t=>`<option value="${t.id}" ${t.id===talhaoId?'selected':''}>${esc(t.nome)} — ${t.area} ha</option>`).join('');
  const rOpts = DB.receitas.map(r=>`<option value="${r.id}">${esc(r.nome)}</option>`).join('');
  const wb = calcWetBulb(dtT,dtRh);
  const dt = (dtT-wb).toFixed(1);
  const retrabalho = checkRetrabalho(talhaoId);

  openModal(`
    <div class="modal-hdr"><span class="modal-title">💧 Nova Aplicação</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      ${retrabalho?`<div class="alert alert-warn">⚠️ <b>Possível retrabalho:</b> ${esc(retrabalho.receita)} aplicado há ${retrabalho.dias} dias neste talhão.</div>`:''}
      <div class="form-group"><label class="form-label">Talhão</label>
        <select class="form-input" id="fATalhao" onchange="autoFillArea()">${tOpts}</select></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Data</label>
          <input class="form-input" id="fAData" type="date" value="${today()}"></div>
        <div class="form-group"><label class="form-label">Área aplicada (ha)</label>
          <input class="form-input" id="fAArea" type="number" step=".1" min="0" placeholder="0.0"></div>
      </div>
      <div class="form-group"><label class="form-label">Receita de calda</label>
        <select class="form-input" id="fAReceita"><option value="">— Sem receita —</option>${rOpts}</select></div>
      <div class="form-group"><label class="form-label">Equipamento</label>
        <select class="form-input" id="fAEquip">${EQUIPS.map(e=>`<option>${e}</option>`).join('')}</select></div>
      <div class="sec-lbl mt-2">Condições na aplicação</div>
      <div class="form-row-3">
        <div class="form-group"><label class="form-label">ΔT</label>
          <input class="form-input" id="fADT" type="number" step=".1" value="${dt}"></div>
        <div class="form-group"><label class="form-label">Temp (°C)</label>
          <input class="form-input" id="fATemp" type="number" step=".5" value="${dtT}"></div>
        <div class="form-group"><label class="form-label">UR (%)</label>
          <input class="form-input" id="fARh" type="number" value="${dtRh}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Vento (km/h)</label>
          <input class="form-input" id="fAVento" type="number" step=".5" value="${dtWind}"></div>
        <div class="form-group"><label class="form-label">Vol. real calda (L)</label>
          <input class="form-input" id="fAVolReal" type="number" step="1" placeholder="0"></div>
      </div>
      ${can('viewCosts')?`<div class="sec-lbl mt-2">Custos adicionais</div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Mão de obra (R$/ha)</label>
          <input class="form-input" id="fAMO" type="number" step=".01" value="${DB.config.mao_obra_ha||0}"></div>
        <div class="form-group"><label class="form-label">Combustível (R$/ha)</label>
          <input class="form-input" id="fAComb" type="number" step=".01" value="${DB.config.combustivel_ha||0}"></div>
      </div>`:''}
      <div class="form-group"><label class="form-label">Operador</label>
        <input class="form-input" id="fAOper" value="${escAttr(currentUser.nome)}"></div>
      <div class="form-group"><label class="form-label">Observações</label>
        <textarea class="form-input" id="fAObs" rows="2"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" onclick="saveAplicacao()">💾 Registrar Aplicação</button>
    </div>
  `);
  setTimeout(autoFillArea, 100);
}

function autoFillArea() {
  const sel = document.getElementById('fATalhao');
  if (!sel) return;
  const t = byId(DB.talhoes, sel.value);
  if (t) { const a = document.getElementById('fAArea'); if (a&&!a.value) a.value=t.area; }
}

function checkRetrabalho(talhaoId) {
  if (!talhaoId) return null;
  const limite = DB.config.retrabalho_dias||21;
  const aps = DB.aplicacoes.filter(a=>a.talhao===talhaoId).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  if (!aps.length) return null;
  const last = aps[0];
  const dias = Math.floor((new Date()-new Date(last.data+'T00:00:00'))/(1000*60*60*24));
  if (dias < limite) {
    const r = byId(DB.receitas,last.receita);
    return { dias, receita: r?.nome||'Aplicação anterior' };
  }
  return null;
}

function saveAplicacao() {
  const talhaoId = document.getElementById('fATalhao')?.value;
  const area = parseFloat(document.getElementById('fAArea')?.value)||0;
  if (!talhaoId) { toast('Selecione o talhão','error'); return; }
  if (!area||area<=0) { toast('Informe a área aplicada','error'); return; }
  const talhao = byId(DB.talhoes,talhaoId);
  if (!talhao) { toast('Talhão selecionado não encontrado','error'); return; }
  if (toNum(talhao.area) > 0 && area > toNum(talhao.area)) {
    toast(`Área aplicada maior que o talhão (${fmtNum(talhao.area)} ha)`,'error');
    return;
  }

  const data = document.getElementById('fAData')?.value||today();
  const receitaId = document.getElementById('fAReceita')?.value||'';
  const mo = can('viewCosts') ? (parseFloat(document.getElementById('fAMO')?.value)||0) : DB.config.mao_obra_ha||0;
  const comb = can('viewCosts') ? (parseFloat(document.getElementById('fAComb')?.value)||0) : DB.config.combustivel_ha||0;
  const dep = DB.config.depreciacao_ha||0;
  const delta_t = parseFloat(document.getElementById('fADT')?.value)||0;

  // Gerar ID da aplicação uma única vez
  const aplicId = uid();

  // Calcula custo de produto da receita
  let custo_produto = 0;
  const consumos = [];
  if (receitaId) {
    const r = byId(DB.receitas, receitaId);
    if (!r) { toast('Receita selecionada não encontrada','error'); return; }
    for (const i of (r.itens||[])) {
      const p = byId(DB.produtos,i.produto);
      if (!p) { toast(`Produto da receita não encontrado: ${i.nome_livre||'item removido'}`,'error'); return; }
      const uso = doseUsage(i, area, p);
      if (uso.conversionMissing) {
        toast(`Unidade incompatível em ${p.nome}: receita em ${uso.displayUnit}, estoque em ${p.unidade}`,'error');
        return;
      }
      if (toNum(p.estoque_atual) < uso.estoqueQtd) {
        toast(`Estoque insuficiente de ${p.nome}: precisa ${fmtNum(uso.estoqueQtd)} ${uso.estoqueUnit}, disponível ${fmtNum(p.estoque_atual)} ${p.unidade}`,'error');
        return;
      }
      custo_produto += uso.custo;
      consumos.push({ item:i, produto:p, uso });
    }
    consumos.forEach(({item, produto, uso})=>{
      produto.estoque_atual = Math.max(0, toNum(produto.estoque_atual)-uso.estoqueQtd);
      DB.movimentos.push({
        id:uid(), produto:item.produto, tipo:'saida', qtd:uso.estoqueQtd, preco:toNum(produto.preco),
        data, aplicacao:aplicId, obs:`Aplicação em ${byId(DB.talhoes,talhaoId)?.nome}`,
        usuario:currentUser.id, dose_qtd:uso.displayQtd, dose_unidade:uso.displayUnit
      });
    });
  }

  const custo_operacional = (mo+comb+dep)*area;
  const custo_total = custo_produto + custo_operacional;

  const aplic = {
    id:aplicId, data, talhao:talhaoId, receita:receitaId, area_ha:area,
    delta_t, temp:parseFloat(document.getElementById('fATemp')?.value)||dtT,
    rh:parseFloat(document.getElementById('fARh')?.value)||dtRh,
    vento:parseFloat(document.getElementById('fAVento')?.value)||dtWind,
    vol_real:parseFloat(document.getElementById('fAVolReal')?.value)||0,
    equip:document.getElementById('fAEquip')?.value||'',
    operador:document.getElementById('fAOper')?.value||currentUser.nome,
    obs:document.getElementById('fAObs')?.value||'',
    custo_produto, custo_operacional, custo_total, usuario:currentUser.id
  };

  DB.aplicacoes.unshift(aplic);
  saveDB(); closeModal();
  toast(`Aplicação registrada! Custo: ${fmtMoney(custo_total)}`);
  if (curTab==='talhoes') renderTalhoes();
}

// ──────────── EXECUÇÃO (Tratorista) ────────────
function renderExecucao() {
  document.querySelectorAll('.fab').forEach(f=>f.remove());
  const el = document.getElementById('tab-execucao');
  const wb = calcWetBulb(dtT,dtRh);
  const dt = dtT-wb;
  const s = dtStatus(dt);

  el.innerHTML = `
    <div class="page-hdr"><div><div class="page-title">Execução</div>
      <div class="page-sub">Condições e registro</div></div>
      <span class="badge ${s.cls}">${s.label}</span></div>

    <div class="card card-body mb-2" style="--hero:${s.hero};border-top:4px solid ${s.hero}">
      <div class="flex-between mb-1">
        <span class="card-title" style="margin:0">Delta T atual</span>
        <span style="font-size:2rem;font-weight:800;letter-spacing:-.04em">${dt.toFixed(1)}</span>
      </div>
      <div class="dt-advice">${s.adv}</div>
    </div>

    <div class="card card-body mb-2">
      <div class="card-title">Ajustar condições</div>
      <div class="slider-top"><span class="slider-name">Temperatura</span>
        <span class="slider-val" id="exVT">${dtT.toFixed(1)}<span class="slider-unit">°C</span></span></div>
      <input type="range" min="5" max="45" step=".5" value="${dtT}" oninput="dtT=+this.value;renderExecucao()">
      <div class="slider-top mt-1"><span class="slider-name">Umidade</span>
        <span class="slider-val" id="exVRh">${dtRh}<span class="slider-unit">%UR</span></span></div>
      <input type="range" min="10" max="100" step="1" value="${dtRh}" oninput="dtRh=+this.value;renderExecucao()">
      <div class="slider-top mt-1"><span class="slider-name">Vento</span>
        <span class="slider-val" id="exVW">${dtWind.toFixed(1)}<span class="slider-unit">km/h</span></span></div>
      <input type="range" min="0" max="30" step=".5" value="${dtWind}" oninput="dtWind=+this.value;renderExecucao()">
    </div>

    <button class="btn btn-primary btn-block" onclick="openNovaAplicacao('')">💧 Registrar Aplicação</button>

    ${DB.aplicacoes.filter(a=>a.usuario===currentUser.id).slice(0,5).length?`
    <div class="sec-lbl mt-2">Minhas últimas aplicações</div>
    <div class="list-card">${DB.aplicacoes.filter(a=>a.usuario===currentUser.id).slice(0,5).map(a=>{
      const t = byId(DB.talhoes,a.talhao);
      return `<div class="list-item" style="cursor:default">
        <div class="li-icon" style="background:var(--g50)">💧</div>
        <div class="li-body"><div class="li-title">${t?esc(t.nome):'Talhão removido'}</div>
          <div class="li-sub">${fmtDate(a.data)} · ${a.area_ha} ha · ΔT ${a.delta_t}</div></div>
      </div>`;}).join('')}</div>` : ''}
  `;
}

// ──────────── RELATÓRIOS ────────────
function renderRelatorios() {
  document.querySelectorAll('.fab').forEach(f=>f.remove());
  if (!can('viewRelatorios')) {
    document.getElementById('tab-relatorios').innerHTML='<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Acesso restrito</div></div>';
    return;
  }
  const el = document.getElementById('tab-relatorios');
  const totalHa = DB.aplicacoes.reduce((s,a)=>s+(a.area_ha||0),0);
  const totalCusto = DB.aplicacoes.reduce((s,a)=>s+(a.custo_total||0),0);
  const custoPorHa = totalHa>0 ? totalCusto/totalHa : 0;
  const mesAtual = new Date().toISOString().slice(0,7);
  const apMes = DB.aplicacoes.filter(a=>a.data?.startsWith(mesAtual));
  const desperdicioApps = DB.aplicacoes.filter(a=>{
    if (!a.receita||!a.vol_real||!a.area_ha) return false;
    const r = byId(DB.receitas,a.receita);
    if (!r) return false;
    const planejado = (r.volume_ha||200)*a.area_ha;
    return a.vol_real < planejado*0.85;
  });

  el.innerHTML = `
    <div class="page-hdr"><div><div class="page-title">Relatórios</div>
      <div class="page-sub">Visão geral da propriedade</div></div></div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-lbl">Total aplicado</div><div class="stat-val">${fmtNum(totalHa)}</div><div class="stat-sub">hectares</div></div>
      <div class="stat-card"><div class="stat-lbl">Custo total</div><div class="stat-val" style="font-size:1.25rem">${fmtMoney(totalCusto)}</div></div>
      <div class="stat-card"><div class="stat-lbl">Custo médio/ha</div><div class="stat-val" style="font-size:1.25rem">${fmtMoney(custoPorHa)}</div></div>
      <div class="stat-card"><div class="stat-lbl">Aplicações no mês</div><div class="stat-val">${apMes.length}</div></div>
    </div>

    ${desperdicioApps.length?`<div class="alert alert-warn">⚠️ <b>${desperdicioApps.length} aplicação(ões) com possível desperdício</b> — volume real abaixo de 85% do planejado.</div>`:''}

    <div class="sec-lbl mt-2">Custo por talhão</div>
    <div class="list-card">${DB.talhoes.length ? DB.talhoes.map(t=>{
      const aps = DB.aplicacoes.filter(a=>a.talhao===t.id);
      const custo = aps.reduce((s,a)=>s+(a.custo_total||0),0);
      const ha = aps.reduce((s,a)=>s+(a.area_ha||0),0);
      return `<div class="list-item" style="cursor:default">
        <div class="li-icon" style="background:var(--g50)">🗺️</div>
        <div class="li-body"><div class="li-title">${esc(t.nome)}</div>
          <div class="li-sub">${aps.length} aplicações · ${fmtNum(ha)} ha total</div></div>
        <div class="li-right"><div class="li-value" style="font-size:.9rem">${fmtMoney(custo)}</div>
          <div class="li-unit">${ha>0?fmtMoney(custo/ha)+'/ha':''}</div></div>
      </div>`;}).join('') : '<div class="list-item" style="cursor:default"><span style="font-size:.85rem;color:var(--txt3)">Nenhum talhão cadastrado</span></div>'}</div>

    <div class="sec-lbl mt-2">Exportar</div>
    <div class="export-btns">
      <button class="btn btn-secondary" onclick="exportPDF()">📄 Exportar PDF</button>
      <button class="btn btn-secondary" onclick="exportExcel()">📊 Exportar Excel</button>
    </div>
    <div style="height:80px"></div>
  `;
}

// ──────────── CONFIG ────────────
function renderConfig() {
  document.querySelectorAll('.fab').forEach(f=>f.remove());
  const el = document.getElementById('tab-config');
  const usersHtml = DB.usuarios.map(u=>{
    const p = PERFIS[u.perfil]||{};
    return `<div class="list-item">
      <div class="li-icon">${p.icon||'👤'}</div>
      <div class="li-body"><div class="li-title">${esc(u.nome)}</div>
        <div class="li-sub">${p.label||u.perfil} · PIN: ${'●'.repeat(u.pin?.length||4)}</div></div>
      <div style="display:flex;gap:.5rem">
        <button class="btn-icon" onclick="openUserForm('${u.id}')">✏️</button>
        ${u.id!==currentUser.id?`<button class="btn-icon" onclick="toggleUserActive('${u.id}')">${u.ativo?'🔒':'🔓'}</button>`:''}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="page-hdr"><div><div class="page-title">Configurações</div>
      <div class="page-sub">Propriedade e usuários</div></div></div>

    <div class="sec-lbl">Propriedade</div>
    <div class="card card-body mb-2">
      <div class="form-group"><label class="form-label">Nome da propriedade</label>
        <input class="form-input" id="cfgProp" value="${escAttr(DB.config.propriedade)}"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Mão de obra (R$/ha)</label>
          <input class="form-input" id="cfgMO" type="number" value="${DB.config.mao_obra_ha||0}"></div>
        <div class="form-group"><label class="form-label">Combustível (R$/ha)</label>
          <input class="form-input" id="cfgComb" type="number" value="${DB.config.combustivel_ha||0}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Depreciação (R$/ha)</label>
          <input class="form-input" id="cfgDep" type="number" value="${DB.config.depreciacao_ha||0}"></div>
        <div class="form-group"><label class="form-label">Retrabalho (dias)</label>
          <input class="form-input" id="cfgRet" type="number" value="${DB.config.retrabalho_dias||21}"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="saveConfig()">💾 Salvar Configurações</button>
    </div>

    <div class="sec-lbl">Usuários</div>
    <div class="list-card mb-2">${usersHtml}</div>
    <button class="btn btn-outline btn-block" onclick="openUserForm('')">+ Novo Usuário</button>
    <div style="height:80px"></div>
  `;
}

function saveConfig() {
  const mo = toNum(document.getElementById('cfgMO').value);
  const combustivel = toNum(document.getElementById('cfgComb').value);
  const depreciacao = toNum(document.getElementById('cfgDep').value);
  const retrabalho = parseInt(document.getElementById('cfgRet').value)||21;
  if (mo < 0 || combustivel < 0 || depreciacao < 0 || retrabalho < 1) {
    toast('Custos devem ser positivos e retrabalho deve ter ao menos 1 dia','error');
    return;
  }
  Object.assign(DB.config, {
    propriedade:document.getElementById('cfgProp').value.trim()||DB.config.propriedade,
    mao_obra_ha:mo,
    combustivel_ha:combustivel,
    depreciacao_ha:depreciacao,
    retrabalho_dias:retrabalho
  });
  saveDB(); toast('Configurações salvas!');
  document.getElementById('hdrProp').textContent = DB.config.propriedade;
}

function openUserForm(id) {
  const u = id ? byId(DB.usuarios,id) : null;
  openModal(`
    <div class="modal-hdr"><span class="modal-title">${u?'Editar':'Novo'} Usuário</span>
      <button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Nome</label>
        <input class="form-input" id="fUNome" value="${escAttr(u?.nome||'')}"></div>
      <div class="form-group"><label class="form-label">Perfil</label>
        <select class="form-input" id="fUPerfil">
          ${Object.entries(PERFIS).map(([k,v])=>`<option value="${k}" ${(u?.perfil||'')==k?'selected':''}>${v.icon} ${v.label}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">PIN (4 dígitos)</label>
        <input class="form-input" id="fUPin" type="password" maxlength="4" pattern="[0-9]{4}" placeholder="••••" value="${escAttr(u?.pin||'')}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-block" onclick="saveUser('${id||''}')">💾 Salvar</button>
    </div>
  `);
}

function saveUser(id) {
  const nome = document.getElementById('fUNome').value.trim();
  const perfil = document.getElementById('fUPerfil').value;
  const pin = document.getElementById('fUPin').value.trim();
  if (!nome) { toast('Informe o nome','error'); return; }
  if (!/^\d{4}$/.test(pin)) { toast('PIN deve ter 4 dígitos','error'); return; }
  if (id) {
    Object.assign(byId(DB.usuarios,id), { nome, perfil, pin });
  } else {
    DB.usuarios.push({ id:uid(), nome, perfil, pin, ativo:true });
  }
  saveDB(); closeModal(); toast(id?'Usuário atualizado!':'Usuário criado!'); renderConfig();
}

function toggleUserActive(id) {
  const u = byId(DB.usuarios,id); if (!u) return;
  u.ativo = !u.ativo;
  saveDB(); toast(u.ativo?'Usuário ativado':'Usuário bloqueado'); renderConfig();
}

// ──────────── FAB MANAGER ────────────
function manageFab(cls, onClick) {
  document.querySelectorAll('.fab').forEach(f=>f.remove());
  const fab = document.createElement('button');
  fab.className=`fab ${cls}`; fab.textContent='+';
  fab.onclick = onClick;
  document.getElementById('appScreen').appendChild(fab);
}

// ──────────── EXPORT PDF ────────────
function exportPDF() {
  if (!window.jspdf?.jsPDF) {
    toast('Biblioteca de PDF não carregada. Verifique a conexão e tente novamente.','error');
    return;
  }
  try {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  if (typeof doc.autoTable !== 'function') {
    toast('Biblioteca de tabelas PDF não carregada. Tente novamente online.','error');
    return;
  }
  const prop = DB.config.propriedade;
  const dateStr = new Date().toLocaleDateString('pt-BR');
  let y = 20;

  // Header
  doc.setFillColor(27,94,32);
  doc.rect(0,0,210,14,'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(12); doc.setFont(undefined,'bold');
  doc.text('PVGest — Relatório de Pulverização', 14, 9);
  doc.setFontSize(8); doc.setFont(undefined,'normal');
  doc.text(`${prop} · ${dateStr}`, 210-14, 9, {align:'right'});
  doc.setTextColor(30,30,30);
  y = 24;

  // Resumo
  const totalHa = DB.aplicacoes.reduce((s,a)=>s+(a.area_ha||0),0);
  const totalCusto = DB.aplicacoes.reduce((s,a)=>s+(a.custo_total||0),0);
  doc.setFontSize(11); doc.setFont(undefined,'bold');
  doc.text('Resumo Geral', 14, y); y+=6;
  doc.autoTable({
    startY:y, margin:{left:14,right:14},
    head:[['Indicador','Valor']],
    body:[
      ['Total de aplicações', DB.aplicacoes.length],
      ['Área total aplicada (ha)', fmtNum(totalHa)],
      ['Custo total', fmtMoney(totalCusto)],
      ['Custo médio por ha', fmtMoney(totalHa>0?totalCusto/totalHa:0)],
      ['Produtos em estoque', DB.produtos.length],
      ['Receitas cadastradas', DB.receitas.length]
    ],
    styles:{fontSize:9},
    headStyles:{fillColor:[27,94,32]},
    alternateRowStyles:{fillColor:[240,244,236]}
  });
  y = doc.lastAutoTable.finalY + 10;

  // Talhões
  if (y > 240) { doc.addPage(); y = 20; }
  doc.setFontSize(11); doc.setFont(undefined,'bold');
  doc.text('Custo por Talhão', 14, y); y+=6;
  const talhaoRows = DB.talhoes.map(t=>{
    const aps = DB.aplicacoes.filter(a=>a.talhao===t.id);
    const custo = aps.reduce((s,a)=>s+(a.custo_total||0),0);
    const ha = aps.reduce((s,a)=>s+(a.area_ha||0),0);
    return [t.nome, t.area+' ha', t.cultura||'—', aps.length, fmtNum(ha)+' ha', fmtMoney(custo), ha>0?fmtMoney(custo/ha):'—'];
  });
  doc.autoTable({
    startY:y, margin:{left:14,right:14},
    head:[['Talhão','Área','Cultura','Aplicações','Ha aplicado','Custo Total','Custo/Ha']],
    body:talhaoRows.length?talhaoRows:[['Nenhum talhão cadastrado','','','','','','']],
    styles:{fontSize:8}, headStyles:{fillColor:[27,94,32]},
    alternateRowStyles:{fillColor:[240,244,236]}
  });
  y = doc.lastAutoTable.finalY + 10;

  // Aplicações
  if (y > 200) { doc.addPage(); y = 20; }
  doc.setFontSize(11); doc.setFont(undefined,'bold');
  doc.text('Histórico de Aplicações', 14, y); y+=6;
  const apRows = DB.aplicacoes.slice(0,30).map(a=>{
    const t = byId(DB.talhoes,a.talhao);
    const r = byId(DB.receitas,a.receita);
    return [fmtDate(a.data), t?t.nome:'—', r?r.nome:'—', (a.area_ha||0)+' ha', a.delta_t||'—', fmtMoney(a.custo_total||0)];
  });
  doc.autoTable({
    startY:y, margin:{left:14,right:14},
    head:[['Data','Talhão','Receita','Área','ΔT','Custo']],
    body:apRows.length?apRows:[['Nenhuma aplicação registrada','','','','','']],
    styles:{fontSize:8}, headStyles:{fillColor:[27,94,32]},
    alternateRowStyles:{fillColor:[240,244,236]}
  });

  // Footer
  const pages = doc.internal.getNumberOfPages();
  for (let i=1;i<=pages;i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(150);
    doc.text(`PVGest · Página ${i}/${pages}`, 105, 292, {align:'center'});
  }

  doc.save(`PVGest_Relatorio_${dateStr.replace(/\//g,'-')}.pdf`);
  toast('PDF gerado com sucesso!');
  } catch (err) {
    console.error(err);
    toast('Não foi possível gerar o PDF','error');
  }
}

// ──────────── EXPORT EXCEL ────────────
function exportExcel() {
  if (!window.XLSX?.utils?.book_new || !window.XLSX.writeFile) {
    toast('Biblioteca de Excel não carregada. Verifique a conexão e tente novamente.','error');
    return;
  }
  try {
  const wb = XLSX.utils.book_new();

  // Aba: Aplicações
  const apData = [['Data','Talhão','Receita','Área (ha)','Delta T','Temp (°C)','UR (%)','Vento (km/h)','Equipamento','Operador','Custo Produto (R$)','Custo Operacional (R$)','Custo Total (R$)','Obs']];
  DB.aplicacoes.forEach(a=>{
    const t = byId(DB.talhoes,a.talhao);
    const r = byId(DB.receitas,a.receita);
    apData.push([a.data, t?.nome||'—', r?.nome||'—', a.area_ha||0, a.delta_t||'', a.temp||'', a.rh||'', a.vento||'', a.equip||'', a.operador||'', a.custo_produto||0, a.custo_operacional||0, a.custo_total||0, a.obs||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(apData), 'Aplicações');

  // Aba: Estoque
  const estData = [['Produto','Classe','Unidade','Estoque Atual','Estoque Mínimo','Preço Unitário (R$)','Valor em Estoque (R$)','Validade','Fabricante']];
  DB.produtos.forEach(p=>{
    estData.push([p.nome, p.classe||'', p.unidade, p.estoque_atual||0, p.estoque_min||0, p.preco||0, (p.estoque_atual||0)*(p.preco||0), p.validade||'', p.fabricante||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(estData), 'Estoque');

  // Aba: Movimentações
  const movData = [['Data','Produto','Tipo','Quantidade','Unidade','Preço Unit. (R$)','Total (R$)','Observações']];
  DB.movimentos.forEach(m=>{
    const p = byId(DB.produtos,m.produto);
    movData.push([m.data, p?.nome||'—', m.tipo==='entrada'?'Entrada':'Saída', m.qtd||0, p?.unidade||'', m.preco||0, (m.qtd||0)*(m.preco||0), m.obs||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(movData), 'Movimentações');

  // Aba: Custo por Talhão
  const talData = [['Talhão','Área (ha)','Cultura','Safra','Aplicações','Área Total Aplicada (ha)','Custo Produto (R$)','Custo Operacional (R$)','Custo Total (R$)','Custo/Ha (R$)']];
  DB.talhoes.forEach(t=>{
    const aps = DB.aplicacoes.filter(a=>a.talhao===t.id);
    const haAp = aps.reduce((s,a)=>s+(a.area_ha||0),0);
    const cprod = aps.reduce((s,a)=>s+(a.custo_produto||0),0);
    const coper = aps.reduce((s,a)=>s+(a.custo_operacional||0),0);
    const ctot = aps.reduce((s,a)=>s+(a.custo_total||0),0);
    talData.push([t.nome, t.area, t.cultura||'', t.safra||'', aps.length, haAp, cprod, coper, ctot, haAp>0?+(ctot/haAp).toFixed(2):0]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(talData), 'Custo por Talhão');

  // Aba: Leituras ΔT
  const dtData = [['Data','Delta T','Temperatura (°C)','UR (%)','Vento (km/h)','Talhão','Usuário']];
  DB.leituras.forEach(l=>{
    const t = byId(DB.talhoes,l.talhao);
    const u = byId(DB.usuarios,l.usuario);
    dtData.push([l.data, l.dt, l.temp, l.rh, l.vento, t?.nome||'—', u?.nome||'—']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dtData), 'Leituras ΔT');

  const dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
  XLSX.writeFile(wb, `PVGest_${dateStr}.xlsx`);
  toast('Excel gerado com sucesso!');
  } catch (err) {
    console.error(err);
    toast('Não foi possível gerar o Excel','error');
  }
}

// ──────────── PWA ────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', ()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e=>{e.preventDefault();deferredPrompt=e;});

// ──────────── INIT ────────────
loadDB();
renderLogin();
