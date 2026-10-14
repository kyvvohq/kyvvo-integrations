const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dentroDoHorario } = require('..');

test('dentro do horário padrão (08:00-18:00 São Paulo)', () => {
  // 2026-01-14 é uma quarta-feira; 12:00 em São Paulo (UTC-3) = 15:00 UTC
  assert.equal(dentroDoHorario(null, new Date('2026-01-14T15:00:00Z')), true);
});

test('fora do horário padrão: antes das 08:00', () => {
  assert.equal(dentroDoHorario(null, new Date('2026-01-14T10:00:00Z')), false); // 07:00 em SP
});

test('fora do horário padrão: depois das 18:00', () => {
  assert.equal(dentroDoHorario(null, new Date('2026-01-14T22:00:00Z')), false); // 19:00 em SP
});

test('horário customizado + dia da semana restrito', () => {
  const horario = { inicio: '09:00', fim: '12:00', dias: [1, 2, 3, 4, 5] }; // seg-sex
  // 2026-01-17 é sábado, 10:00 em SP = 13:00 UTC
  assert.equal(dentroDoHorario(horario, new Date('2026-01-17T13:00:00Z')), false);
  // 2026-01-14 é quarta, 10:00 em SP = 13:00 UTC
  assert.equal(dentroDoHorario(horario, new Date('2026-01-14T13:00:00Z')), true);
});

test('borda: exatamente no fim não conta como dentro', () => {
  // 18:00 em SP = 21:00 UTC
  assert.equal(dentroDoHorario(null, new Date('2026-01-14T21:00:00Z')), false);
});
