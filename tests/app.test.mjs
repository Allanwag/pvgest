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
