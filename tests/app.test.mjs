import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, lerArquivo } from './harness.mjs';

const pronto = (opcoes) => { const a = setup(opcoes); a.login(); a.semente(); return a; };
const aplicar = (a, campos) => { a.form({ fATalhao: 't2', fAArea: 2, fAReceita: 'r1', fAData: '2026-11-15', ...campos }); a.run('saveAplicacao()'); };
test('harness: app carrega, cria a base padrão e grava', () => {
  const a = setup();
  assert.equal(a.salvo().usuarios.length, 3);
  assert.equal(a.run('today()'), '2026-11-15');
});

test('A1 aplicação: salva, avisa e atualiza a lista', () => {
  const a = pronto();
  assert.doesNotThrow(() => aplicar(a));
  assert.equal(a.run('DB.aplicacoes.length'), 1);
  assert.match(a.toast().msg, /^Aplicação registrada! Custo: R\$/);
  assert.equal(a.toast().erro, false);
  assert.match(a.el('tab-talhoes').innerHTML, /<div class="li-value">1<\/div>/);
});

test('A1 tratorista registra aplicação e o aviso não mostra custo', () => {
  const a = pronto(); a.login('u3');
  aplicar(a);
  assert.equal(a.run('DB.aplicacoes.length'), 1);
  assert.equal(a.toast().msg, 'Aplicação registrada!');
  assert.equal(a.run('DB.aplicacoes[0].custo_operacional'), 300); // (80+40+30) × 2 ha, da configuração
});

test('A2 estoque exato não é recusado por arredondamento', () => {
  const a = pronto();
  a.run('DB.produtos[0].estoque_atual = 0.3');
  aplicar(a, { fAArea: 3 });
  assert.equal(a.run('DB.aplicacoes.length'), 1, a.toast().msg);
  assert.equal(a.run('DB.produtos[0].estoque_atual'), 0);
});

test('A2 estoque gravado com resíduo de ponto flutuante compara certo', () => {
  const a = pronto();
  a.run('DB.produtos[0].estoque_atual = 0.1 + 0.2');
  a.form({ fMTipo: 'saida', fMQtd: 0.3, fMData: '2026-11-15' }); a.run(`saveMovimento('p1')`);
  assert.equal(a.run('DB.produtos[0].estoque_atual'), 0, a.toast().msg);
  a.form({ fMTipo: 'entrada', fMQtd: 0.1, fMData: '2026-11-15' }); a.run(`saveMovimento('p1')`);
  a.form({ fMTipo: 'entrada', fMQtd: 0.2, fMData: '2026-11-15' }); a.run(`saveMovimento('p1')`);
  assert.equal(a.run('DB.produtos[0].estoque_atual'), 0.3);
});

test('A4 gravação que falha avisa em vez de dizer que salvou', () => {
  const a = pronto();
  a.falharGravacao = true;
  a.form({ fTNome: 'Fantasma', fTArea: 5 }); a.run(`saveTalhao('')`);
  assert.equal(a.toast().erro, true);
  assert.match(a.toast().msg, /Não foi possível salvar neste aparelho/);
  a.falharGravacao = false;
  a.form({ fTNome: 'Real', fTArea: 5 }); a.run(`saveTalhao('')`);
  assert.equal(a.toast().msg, 'Talhão cadastrado!');
  assert.ok(a.salvo().talhoes.some(t => t.nome === 'Real'));
});

test('A4 banco ilegível é guardado antes de recomeçar', () => {
  const quebrado = '{"version":1,"talhoes":[{"id":"t1","nome":"Serra"';
  const a = setup({ armazenado: quebrado });
  assert.equal(a.store.get('pvgest_v1_corrompido'), quebrado);
  assert.equal(a.salvo().usuarios.length, 3);
  const b = setup();
  assert.equal(b.store.has('pvgest_v1_corrompido'), false);
});

test('A4 outra janela gravou: esta passa a usar os dados novos sem regravar', () => {
  const a = pronto();
  const novo = a.salvo(); novo.talhoes.push({ id: 't9', nome: 'Novo', area: 1 }); novo.usuarios[0].nome = 'Chefe';
  const antes = a.store.get('pvgest_v1');
  a.run(`sincronizarDeOutraJanela(${JSON.stringify(JSON.stringify(novo))})`);
  assert.equal(a.run('DB.talhoes.length'), 3);
  assert.equal(a.run('currentUser.nome'), 'Chefe');
  assert.equal(a.run('currentUser === DB.usuarios[0]'), true);
  assert.equal(a.store.get('pvgest_v1'), antes);
});

test('A3 backup restaura em outro aparelho', () => {
  const a = pronto();
  const arquivo = a.run('JSON.stringify(DB)');
  const b = setup(); b.login();
  assert.equal(b.run(`restaurarBackup(${JSON.stringify(arquivo)})`), true);
  assert.equal(b.salvo().talhoes.length, 2);
  assert.equal(b.run('currentUser'), null);
  assert.ok(b.store.has('pvgest_v1_antes_restauracao'));
  assert.equal(b.toast().msg, 'Backup restaurado. Entre de novo.');
});

test('A3 backup antigo, sem ordens nem apontamentos, é completado', () => {
  const a = pronto();
  const velho = a.salvo(); delete velho.ordens; delete velho.apontamentos;
  assert.equal(a.run(`restaurarBackup(${JSON.stringify(JSON.stringify(velho))})`), true);
  assert.deepEqual(a.json('[DB.ordens, DB.apontamentos]'), [[], []]);
});

test('A3 arquivos ruins são recusados sem mexer nos dados', () => {
  const a = pronto();
  const base = a.salvo();
  const tenta = obj => a.run(`validarBackup(${JSON.stringify(typeof obj === 'string' ? obj : JSON.stringify(obj))}).erro`);
  assert.equal(tenta('isto não é json'), 'Arquivo não é um backup do PVGest.');
  assert.equal(tenta({ talhoes: [] }), 'Arquivo não é um backup do PVGest.');
  assert.equal(tenta({ ...base, talhoes: 'x' }), 'Arquivo não é um backup do PVGest.');
  assert.equal(tenta({ ...base, talhoes: [{ id: "x');alert(1)//", nome: 'T', area: 1 }] }), 'Backup com identificador inválido.');
  assert.equal(tenta({ ...base, usuarios: base.usuarios.filter(u => u.perfil !== 'gestor') }), 'Backup sem gestor ativo: não daria para entrar depois de restaurar.');
  assert.equal(a.run(`restaurarBackup('isto não é json')`), false);
  assert.equal(a.run('DB.talhoes.length'), 2);
});

test('A3 restauração com gravação falhando não troca os dados', () => {
  const a = pronto();
  const outro = a.salvo(); outro.talhoes = [];
  a.falharGravacao = true;
  assert.equal(a.run(`restaurarBackup(${JSON.stringify(JSON.stringify(outro))})`), false);
  assert.equal(a.run('DB.talhoes.length'), 2);
  assert.equal(a.toast().erro, true);
});

test('A3 campo do banco não vira HTML', () => {
  const a = pronto();
  a.run(`DB.talhoes[0].area = '<b>x</b>'; DB.produtos[0].unidade = '<i>L</i>'; renderTalhoes(); renderEstoque(); renderDT();`);
  for (const id of ['tab-talhoes', 'tab-estoque', 'tab-dt']) assert.doesNotMatch(a.el(id).innerHTML, /<b>x<\/b>|<i>L<\/i>/);
});

test('A3 tela mostra o backup e cobra quando está velho', () => {
  const a = pronto();
  assert.equal(a.run('diasSemBackup()'), Infinity);
  a.run('renderRelatorios()'); assert.match(a.el('tab-relatorios').innerHTML, /Nenhum backup feito ainda/);
  a.run(`DB.config.ultimo_backup = '2026-10-01'; renderRelatorios(); renderConfig();`);
  assert.match(a.el('tab-relatorios').innerHTML, /Sem backup há 45 dias/);
  assert.match(a.el('tab-config').innerHTML, /Último backup: 01\/10\/2026/);
  a.run(`DB.config.ultimo_backup = '2026-11-10'; renderRelatorios();`);
  assert.doesNotMatch(a.el('tab-relatorios').innerHTML, /backup/i);
  assert.equal(setup().run('diasSemBackup()'), null);
});

test('A5 aplicação guarda receita e produtos como foram aplicados', () => {
  const a = pronto();
  aplicar(a);
  assert.deepEqual(a.json('DB.aplicacoes[0].itens'), [{ produto: 'p1', nome: 'Fung X', dose: 0.1, unidade: 'L/ha', qtd: 0.2, qtd_unidade: 'L', custo: 20 }]);
  assert.equal(a.run('DB.aplicacoes[0].receita_volume_ha'), 150);
  a.run(`DB.receitas[0].nome = 'Outra'; DB.receitas[0].itens[0].dose = 9;`);
  assert.equal(a.run('aplicReceitaNome(DB.aplicacoes[0])'), 'Rec 1');
  a.run(`deleteReceita('r1'); openTalhaoDetail('t2')`);
  assert.match(a.el('modalSheet').innerHTML, /Rec 1/);
  assert.match(a.el('modalSheet').innerHTML, /Fung X 0,1 L\/ha/);
});

test('A5 aplicação antiga, sem os campos novos, continua aparecendo', () => {
  const a = pronto();
  a.run(`DB.aplicacoes = [{id:'v1',data:'2026-10-01',talhao:'t2',receita:'r1',area_ha:2,custo_total:50}]; openTalhaoDetail('t2')`);
  assert.equal(a.run('aplicReceitaNome(DB.aplicacoes[0])'), 'Rec 1');
  assert.equal(a.run('aplicItensTexto(DB.aplicacoes[0])'), '');
  assert.match(a.el('modalSheet').innerHTML, /Rec 1/);
});

test('A6 excluir aplicação devolve o estoque e tira os movimentos', () => {
  const a = pronto();
  aplicar(a);
  assert.equal(a.run('DB.produtos[0].estoque_atual'), 4.8);
  a.run('openTalhaoDetail("t2")');
  assert.match(a.el('modalSheet').innerHTML, /deleteAplicacao\('/);
  a.run('deleteAplicacao(DB.aplicacoes[0].id)');
  assert.deepEqual(a.json('[DB.aplicacoes.length, DB.movimentos.length, DB.produtos[0].estoque_atual]'), [0, 0, 5]);
  assert.equal(a.toast().msg, 'Aplicação excluída — estoque devolvido');
});

test('A6 aplicação antiga e produto já excluído não quebram a exclusão', () => {
  const a = pronto();
  a.run(`DB.aplicacoes = [{id:'v1',data:'2026-10-01',talhao:'t2',receita:'r1',area_ha:2}];
    DB.movimentos = [{id:'m1',produto:'p1',tipo:'saida',qtd:0.2,aplicacao:'v1'},{id:'m2',produto:'sumiu',tipo:'saida',qtd:1,aplicacao:'v1'},{id:'m3',produto:'p1',tipo:'entrada',qtd:1}];`);
  a.run(`deleteAplicacao('v1')`);
  assert.deepEqual(a.json('[DB.aplicacoes.length, DB.movimentos.map(m=>m.id), DB.produtos[0].estoque_atual]'), [0, ['m3'], 5.2]);
});

test('A6 tratorista não exclui aplicação; "não" no confirm mantém', () => {
  const a = pronto(); aplicar(a);
  a.login('u3'); a.run('deleteAplicacao(DB.aplicacoes[0].id)');
  assert.equal(a.run('DB.aplicacoes.length'), 1);
  a.login('u1'); a.confirmar = false; a.run('deleteAplicacao(DB.aplicacoes[0].id)');
  assert.equal(a.run('DB.aplicacoes.length'), 1);
});

test('A7 OS com prazo ontem está atrasada; prazo hoje vence hoje', () => {
  const a = pronto();
  a.run(`DB.ordens = [{id:'o1',codigo:'OS-0001',numero:1,status:'aberta',area_total:10,data_prazo:'2026-11-14'},
                      {id:'o2',codigo:'OS-0002',numero:2,status:'aberta',area_total:10,data_prazo:'2026-11-15'}]`);
  assert.deepEqual(a.json('DB.ordens.map(o => [osProgress(o).diasRestantes, osProgress(o).atrasada])'), [[-1, true], [0, false]]);
  a.run(`openOrdemDetail('o2')`);
  assert.match(a.el('modalSheet').innerHTML, /vence hoje/);
  a.setAgora('2026-11-15T23:30:00');
  assert.equal(a.run('osProgress(DB.ordens[1]).atrasada'), false);
});

test('A14 mês do relatório é o mês local', () => {
  const a = pronto({ agora: '2026-11-30T22:00:00' });
  a.run(`DB.aplicacoes = [{id:'x',data:'2026-11-30',talhao:'t1',area_ha:1,custo_total:0}]; renderRelatorios()`);
  assert.match(a.el('tab-relatorios').innerHTML, /Aplicações no mês<\/div><div class="stat-val">1</);
});

const comoAndroid = nav => ({
  Notification: Object.assign(function () { throw new TypeError('Illegal constructor'); }, { permission: 'granted' }),
  navigator: nav
});
const osVencida = a => a.run(`DB.ordens = [{id:'o1',codigo:'OS-0001',numero:1,status:'aberta',tipo:'Plantio',area_total:10,data_prazo:'2026-11-10'}]`);

test('A8 aviso sai pelo service worker quando new Notification não é aceito', async () => {
  const mostradas = [];
  const a = pronto({ extras: comoAndroid({ serviceWorker: { register: () => Promise.resolve(), ready: Promise.resolve({ showNotification: t => { mostradas.push(t); return Promise.resolve(); } }) } }) });
  osVencida(a);
  await a.run('notifyOverdue()');
  assert.equal(mostradas.length, 1);
  assert.match(mostradas[0], /OS-0001/);
  assert.equal(a.run('DB.config.os_notif.o1'), '2026-11-15');
  await a.run('notifyOverdue()');
  assert.equal(mostradas.length, 1); // uma vez por OS por dia
});

test('A8 aviso que não saiu não é marcado como enviado', async () => {
  const a = pronto({ extras: comoAndroid({}) });
  osVencida(a);
  await a.run('notifyOverdue()');
  assert.equal(a.run('(DB.config.os_notif || {}).o1'), undefined);
});

test('A8 sw.js trata o toque na notificação', () => {
  assert.match(lerArquivo('sw.js'), /addEventListener\('notificationclick'/);
});

const abrirOS = (a, campos) => { a.form({ fOSTalhao: 't1', fOSTipo: 'Plantio', fOSArea: 5, fOSInicio: '2026-11-15', ...campos }); a.run(`saveOrdem('')`); };

test('A9 apontamento recusa área negativa, data futura e pergunta acima do restante', () => {
  const a = pronto(); abrirOS(a, { fOSArea: 10 });
  const id = a.run('DB.ordens[0].id');
  const apontar = campos => { a.form({ fAPData: '2026-11-15', ...campos }); a.run(`saveApontamento('${id}')`); };
  apontar({ fAPArea: -5, fAPDesc: 'x' });
  assert.equal(a.toast().msg, 'Área feita não pode ser negativa');
  apontar({ fAPArea: 2, fAPData: '2026-11-16' });
  assert.equal(a.toast().msg, 'Data do apontamento não pode ser futura');
  a.confirmar = false; apontar({ fAPArea: 500 });
  assert.match(a.confirms.at(-1), /Área acima do restante da OS \(10,0 ha\)/);
  assert.equal(a.run('DB.apontamentos.length'), 0);
  a.confirmar = true; apontar({ fAPArea: 10 });
  assert.equal(a.run('DB.apontamentos.length'), 1);
  assert.equal(a.confirms.filter(c => /acima do restante/.test(c)).length, 1);
});

test('A15 número de OS não é reaproveitado', () => {
  const a = pronto();
  abrirOS(a); abrirOS(a);
  a.run('deleteOrdem(DB.ordens[1].id)');
  abrirOS(a);
  assert.deepEqual(a.json('DB.ordens.map(o => o.codigo)'), ['OS-0001', 'OS-0003']);
});

test('A15 OS exige talhão e prazo depois do início', () => {
  const a = pronto();
  abrirOS(a, { fOSTalhao: '' });
  assert.equal(a.toast().msg, 'Selecione o talhão');
  abrirOS(a, { fOSPrazo: '2026-11-10' });
  assert.equal(a.toast().msg, 'Prazo final não pode ser antes do início');
  assert.equal(a.run('DB.ordens.length'), 0);
  assert.doesNotThrow(() => { a.form({ fOSTalhao: 't1', fOSArea: 5 }); a.run(`saveOrdem('nao-existe')`); });
});

test('A10 único gestor não troca o próprio perfil; com outro gestor, pode', () => {
  const a = pronto();
  const salvar = campos => { a.form({ fUNome: 'Gestor', fUPerfil: 'gestor', fUPin: '1234', ...campos }); a.run(`saveUser('u1')`); };
  salvar({ fUPerfil: 'tratorista' });
  assert.equal(a.toast().msg, 'Precisa existir pelo menos um gestor ativo');
  assert.equal(a.run(`byId(DB.usuarios,'u1').perfil`), 'gestor');
  salvar({ fUNome: 'Allan' });
  assert.equal(a.el('hdrName').textContent, 'Allan');
  a.run(`DB.usuarios.push({id:'u9',nome:'Outro',perfil:'gestor',pin:'9999',ativo:true})`);
  salvar({ fUPerfil: 'agronomo' });
  assert.equal(a.run(`byId(DB.usuarios,'u1').perfil`), 'agronomo');
});

test('A11 sw.js pré-cacheia o mesmo endereço de app.js que o index.html pede', () => {
  const src = lerArquivo('index.html').match(/<script src="(app\.js[^"]*)"/)[1];
  assert.ok(lerArquivo('sw.js').includes(`'./${src}'`), `sw.js não tem './${src}' em ASSETS`);
});

test('A19 convite de instalação vira botão no menu', () => {
  assert.match(lerArquivo('index.html'), /id="menuInstall" class="hidden" onclick="instalarApp\(\)"/);
  const a = pronto();
  a.el('menuInstall').classList.add('hidden');
  a.run(`globalThis.__pediu = 0; aoPoderInstalar({ preventDefault() {}, prompt() { __pediu++; } })`);
  assert.equal(a.el('menuInstall').classList.contains('hidden'), false);
  a.run('instalarApp()');
  assert.equal(a.run('__pediu'), 1);
  assert.equal(a.el('menuInstall').classList.contains('hidden'), true);
  assert.doesNotThrow(() => a.run('instalarApp()'));
});

test('A12 saída de estoque não muda o preço; entrada muda', () => {
  const a = pronto();
  a.form({ fMTipo: 'saida', fMQtd: 1, fMPreco: 1, fMData: '2026-11-15' }); a.run(`saveMovimento('p1')`);
  assert.equal(a.run('DB.produtos[0].preco'), 100);
  a.form({ fMTipo: 'entrada', fMQtd: 1, fMPreco: 120, fMData: '2026-11-15' }); a.run(`saveMovimento('p1')`);
  assert.equal(a.run('DB.produtos[0].preco'), 120);
});

test('A13 área acompanha a troca de talhão, mas não apaga o que foi digitado', () => {
  const a = pronto();
  for (const [sel, area, fn] of [['fATalhao', 'fAArea', 'autoFillArea'], ['fOSTalhao', 'fOSArea', 'osFillArea']]) {
    a.form({ [sel]: 't1' }); a.run(`${fn}()`);
    assert.equal(a.el(area).value, '10');
    a.el(sel).value = 't2'; a.run(`${fn}()`);
    assert.equal(a.el(area).value, '3');
    a.el(area).value = '2.5'; a.el(sel).value = 't1'; a.run(`${fn}()`);
    assert.equal(a.el(area).value, '2.5');
  }
});

test('A20 ΔT nunca negativo e acompanha Temp/UR do formulário', () => {
  const a = pronto();
  assert.equal(a.run('calcDeltaT(26, 100)'), 0);
  assert.equal(a.run('calcDeltaT(26, 55).toFixed(1)'), '6.4');
  a.form({ fATemp: 30, fARh: 40, fADT: '6.4' }); a.run('recalcDTForm()');
  assert.equal(a.el('fADT').value, '9.6');
  a.run(`openNovaAplicacao('t1')`);
  assert.match(a.el('modalSheet').innerHTML, /id="fATemp"[^>]*oninput="recalcDTForm\(\)"/);
  assert.match(a.el('modalSheet').innerHTML, /id="fARh"[^>]*oninput="recalcDTForm\(\)"/);
});

test('A16 ficha da receita avisa unidade incompatível em vez de inventar custo', () => {
  const a = pronto();
  a.run(`DB.produtos.push({id:'p2',nome:'Adj',unidade:'un',estoque_atual:10,preco:50});
    DB.receitas.push({id:'r2',nome:'Rec 2',volume_ha:150,itens:[{produto:'p2',dose:2,unidade:'L/ha'}]}); openReceitaDetail('r2')`);
  assert.match(a.el('modalSheet').innerHTML, /Unidade incompatível com o estoque/);
  assert.doesNotMatch(a.el('modalSheet').innerHTML, /R\$\s100,00/);
  a.run(`openReceitaDetail('r1')`);
  assert.match(a.el('modalSheet').innerHTML, /R\$\s10,00\/ha/); // 0,1 L/ha × R$ 100
  assert.equal(a.run('typeof doseFactor'), 'undefined');
});

test('A17 volume fora do planejado: abaixo e acima, cada um com seu aviso', () => {
  const a = pronto();
  const com = vol => { a.run(`DB.aplicacoes = [{id:'x',data:'2026-11-15',talhao:'t1',receita:'r1',receita_volume_ha:150,area_ha:10,vol_real:${vol}}]; renderRelatorios()`); return a.el('tab-relatorios').innerHTML; };
  assert.match(com(3000), /acima de 115% do planejado/);
  assert.match(com(1000), /abaixo de 85% do planejado/);
  assert.doesNotMatch(com(1500), /do planejado<\/b>/);
  a.run(`DB.receitas = []`);
  assert.equal(a.run('desvioVolume(DB.aplicacoes[0])'), 'ok');
  assert.equal(a.run(`desvioVolume({area_ha:10,vol_real:1000,receita:'sumiu'})`), null);
});

const pdfFalso = () => {
  const visto = [];
  class Doc {
    constructor() { this.internal = { getNumberOfPages: () => 1 }; this.lastAutoTable = { finalY: 50 }; }
    text(t) { visto.push(String(t)); }
    autoTable(o) { visto.push(JSON.stringify([o.head, o.body])); }
  }
  for (const m of ['setFillColor', 'rect', 'setTextColor', 'setFontSize', 'setFont', 'addPage', 'setPage', 'save']) Doc.prototype[m] = () => {};
  return { visto, jspdf: { jsPDF: Doc } };
};

test('A18 PDF sem Δ, ordenado e dizendo que cortou em 30', () => {
  const pdf = pdfFalso();
  const a = pronto({ extras: { jspdf: pdf.jspdf } });
  a.run(`for (let i = 1; i <= 31; i++) DB.aplicacoes.push({id:'a'+i,data:'2026-10-'+String(i).padStart(2,'0'),talhao:'t1',area_ha:1,custo_total:0})`);
  a.run('exportPDF()');
  const tudo = pdf.visto.join('\n');
  assert.match(a.toast().msg, /PDF gerado/);
  assert.ok(!tudo.includes('Δ'), 'ainda há Δ no PDF');
  assert.match(tudo, /30 mais recentes de 31/);
  assert.ok(tudo.includes('31/10/2026') && !tudo.includes('01/10/2026'), 'a mais antiga é a que fica de fora');
});

test('A21 não exclui talhão, produto ou receita em uso', () => {
  const a = pronto();
  a.run(`DB.ordens = [{id:'o1',codigo:'OS-0001',numero:1,status:'aberta',talhao:'t1',receita:'r1',area_total:10}]`);
  a.run(`deleteTalhao('t1')`);
  assert.equal(a.toast().msg, 'Talhão com OS em aberto (OS-0001). Conclua ou cancele a OS antes de excluir.');
  a.run(`deleteProduto('p1')`);
  assert.equal(a.toast().msg, 'Produto usado na receita "Rec 1". Tire-o da receita antes de excluir.');
  a.run(`deleteReceita('r1')`);
  assert.equal(a.toast().msg, 'Receita ligada a OS em aberto (OS-0001). Conclua ou cancele a OS antes de excluir.');
  assert.deepEqual(a.json('[DB.talhoes.length, DB.produtos.length, DB.receitas.length]'), [2, 1, 1]);
  assert.equal(a.confirms.length, 0);
  a.run(`DB.ordens[0].status = 'concluida'; deleteReceita('r1'); deleteProduto('p1'); deleteTalhao('t1'); deleteTalhao('t2')`);
  assert.deepEqual(a.json('[DB.talhoes.length, DB.produtos.length, DB.receitas.length]'), [0, 0, 0]);
});

test('versão publicada: app.js?v=8 e cache pvgest-v12', () => {
  assert.match(lerArquivo('index.html'), /<script src="app\.js\?v=8">/);
  assert.match(lerArquivo('sw.js'), /const CACHE = 'pvgest-v12';/);
});
