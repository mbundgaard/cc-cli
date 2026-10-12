import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scopedCriteria} from '../dist/read-filters.js';

test('explicit hierarchy scope plus arbitrary documented filter shapes, fields and operator names', () => {
  assert.equal(scopedCriteria(7), 'where equals(hierUnitId,7)');
  for (const expression of [
    'equals(objectNum,3)', "contains(name,'Prep')", '(equals(futureField,1) OR isNull(other.field))',
    '!(equals(options.futureFlag,false))', "futureFilter(newColumn,'new-value') and greaterThan(slaTime,1e3)",
    "equals(name,'Alice''s (Prep), OR Expo')", 'equals(newField,9007199254740993)',
    "equals(新字段,'值')",
  ]) {
    for (const prefix of ['', 'where ', 'WHERE ']) assert.equal(scopedCriteria(7, prefix + expression), `where (equals(hierUnitId,7) and (${expression}))`);
  }
});
test('scope composition rejects escaping the outer group, trailing syntax, comments, unsafe quote conventions and huge inputs', () => {
  for (const expression of ['', 'where ', 'equals(x,1)) or equals(hierUnitId,8)', '(equals(x,1)',
    'equals(x,1) garbage', 'equals(x,1);', 'equals(x,1) -- comment', 'equals(x,1) /* comment */',
    'equals(x,"value")', "equals(x,'unterminated)", "equals(x,'back\\slash')", 'equals(x,1)\nor equals(x,2)',
    'equals(x,)', 'isNull()', 'where where equals(x,1)', '('.repeat(34) + 'equals(x,1)' + ')'.repeat(34),
    "equals(x,'" + 'x'.repeat(2000) + "')",
  ]) assert.throws(() => scopedCriteria(7, expression), undefined, expression);
  for (const id of [0, -1, 1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => scopedCriteria(id));
});
