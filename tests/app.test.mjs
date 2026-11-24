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
