import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { sliceBoundaries } from './slice-boundaries.js';

const root = path.resolve(import.meta.dirname, '../src');
function violations(file, specifier, kind = 'ImportDeclaration') {
  const reports = [];
  const visitors = sliceBoundaries.create({
    filename: path.join(root, file),
    report: (report) => reports.push(report),
  });
  visitors[kind]({ source: { value: specifier } });
  return reports.length;
}

for (const [file, specifier] of [
  ['app/App.tsx', '../features/greeting/Greeting'],
  ['features/orders/Order.tsx', '../greeting/api'],
  ['features/greeting/Greeting.tsx', '../../app/App'],
  ['shared/http.ts', '../features/greeting'],
  ['shared/http.ts', '../app/App'],
]) {
  test(`rejects forbidden dependency ${file} -> ${specifier}`, () => {
    assert.equal(violations(file, specifier), 1);
  });
}

for (const [file, specifier] of [
  ['app/App.tsx', '../features/greeting'],
  ['app/App.tsx', '../features/greeting/index'],
  ['features/orders/Order.tsx', '../greeting/index.ts'],
  ['features/greeting/Greeting.tsx', './api'],
  ['features/greeting/Greeting.tsx', '../../shared/http'],
  ['features/greeting/Greeting.tsx', 'react'],
]) {
  test(`allows public dependency ${file} -> ${specifier}`, () => {
    assert.equal(violations(file, specifier), 0);
  });
}

for (const kind of [
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
]) {
  test(`checks ${kind} as well as static imports`, () => {
    assert.equal(
      violations('app/App.tsx', '../features/greeting/api', kind),
      1,
    );
  });
}
