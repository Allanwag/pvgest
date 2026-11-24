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
