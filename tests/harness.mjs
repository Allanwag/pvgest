// Roda o app.js do PVGest dentro de node:vm com um DOM mínimo de mentira.
// O app monta HTML em texto e lê os campos por document.getElementById(id).value,
// então basta um elemento falso por id, criado na primeira vez que é pedido.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'America/Sao_Paulo';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const lerArquivo = nome => fs.readFileSync(path.join(RAIZ, nome), 'utf8');

function novoEl(id) {
  const classes = new Set();
  let valor = '';
  return {
    // como no navegador, .value sempre devolve texto
    get value() { return valor; }, set value(v) { valor = String(v ?? ''); },
    id, innerHTML: '', textContent: '', dataset: {}, checked: false, selectedOptions: [],
    style: { setProperty() {} },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle(c, f) { const on = f === undefined ? !classes.has(c) : !!f; on ? classes.add(c) : classes.delete(c); return on; }
    },
    appendChild() {}, remove() {}, addEventListener() {}, click() {},
    insertAdjacentHTML(_pos, html) { this.innerHTML += html; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

// agora: relógio do app (hora local de São Paulo). armazenado: conteúdo inicial de localStorage.pvgest_v1
// (objeto ou texto). extras: globais a mais no contexto (Notification, navigator, ...).
export function setup({ agora = '2026-11-15T10:00:00', armazenado, extras = {} } = {}) {
  const els = new Map(), consultas = new Map(), store = new Map();
  if (armazenado !== undefined) store.set('pvgest_v1', typeof armazenado === 'string' ? armazenado : JSON.stringify(armazenado));
  const a = { confirmar: true, falharGravacao: false, confirms: [], store };
  const el = id => { if (!els.has(id)) els.set(id, novoEl(id)); return els.get(id); };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById: el, createElement: () => novoEl(''),
      querySelector: s => consultas.get(s) ?? null, querySelectorAll: () => []
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem(k, v) { if (a.falharGravacao) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
      removeItem: k => { store.delete(k); }
    },
    navigator: {}, setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
    confirm: m => { a.confirms.push(m); return a.confirmar; },
    ...extras
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(`{ const R = Date; let agora = new R(${JSON.stringify(agora)}).getTime();
    globalThis.Date = class extends R { constructor(...p) { p.length ? super(...p) : super(agora); } static now() { return agora; } };
    globalThis.__setAgora = s => { agora = new R(s).getTime(); }; }`, ctx);
  vm.runInContext(lerArquivo('app.js'), ctx, { filename: 'app.js' });

  a.run = codigo => vm.runInContext(codigo, ctx);
  a.json = codigo => JSON.parse(vm.runInContext(`JSON.stringify(${codigo})`, ctx));
  a.el = el;
  a.setAgora = s => a.run(`__setAgora(${JSON.stringify(s)})`);
  a.consulta = (seletor, obj) => consultas.set(seletor, obj);
  // Zera os campos de formulário e preenche só os dados: os elementos falsos sobrevivem entre modais
  a.form = valores => { els.forEach(e => { e.value = ''; }); Object.entries(valores).forEach(([id, v]) => { el(id).value = String(v); }); };
  a.login = (id = 'u1') => a.run(`currentUser = byId(DB.usuarios, ${JSON.stringify(id)}); curTab = 'talhoes';`);
  a.toast = () => ({ msg: el('toast').textContent, erro: el('toast').classList.contains('error') });
  a.salvo = () => JSON.parse(store.get('pvgest_v1'));
  // Base de exemplo: T1 (10 ha), T2 (3 ha); Fung X em L (5 L, R$ 100); receita r1 = 0,1 L/ha de Fung X
  a.semente = () => a.run(`
    DB.talhoes = [{id:'t1',nome:'T1',area:10,cultura:'Soja',safra:'26/27'},{id:'t2',nome:'T2',area:3,cultura:'Café',safra:'26/27'}];
    DB.produtos = [{id:'p1',nome:'Fung X',classe:'Fungicida',unidade:'L',estoque_atual:5,estoque_min:0,preco:100,validade:''}];
    DB.receitas = [{id:'r1',nome:'Rec 1',cultura:'Soja',volume_ha:150,alvo:'Ferrugem',itens:[{produto:'p1',dose:0.1,unidade:'L/ha',nome_livre:'Fung X'}]}];
    DB.aplicacoes = []; DB.movimentos = []; DB.ordens = []; DB.apontamentos = []; saveDB();`);
  return a;
}
