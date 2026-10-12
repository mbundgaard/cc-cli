import { CliError, Exit } from './output.js';

// Structural validation only: arbitrary field and function names remain server-defined.
// This bounds a caller's expression before wrapping it with an explicit hierarchy scope;
// it does not evaluate predicates, infer types, or rewrite literals/field names.
function validateExpression(expression: string): void {
  const fail = () => { throw new CliError(Exit.usage, 'Scoped searchCriteria must be a filter expression with balanced groups, AND/OR/! and single-quoted literals; no comments or backslash escapes'); };
  const tokens: { kind: string; text: string }[] = [];
  for (let at = 0; at < expression.length;) {
    const rest = expression.slice(at), character = expression[at]!;
    if (/\s/.test(character)) { at++; continue; }
    if (character === "'") {
      const start = at++;
      let closed = false;
      while (at < expression.length) {
        if (expression[at] === '\\') fail();
        if (expression[at++] === "'") {
          if (expression[at] === "'") { at++; continue; }
          closed = true; break;
        }
      }
      if (!closed) fail();
      tokens.push({ kind: 'literal', text: expression.slice(start, at) }); continue;
    }
    const number = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)?.[0];
    if (number) { tokens.push({ kind: 'literal', text: number }); at += number.length; continue; }
    const word = /^[\p{L}_$][\p{L}\p{N}_.$]*/u.exec(rest)?.[0];
    if (word) { tokens.push({ kind: 'word', text: word }); at += word.length; continue; }
    if ('(),!'.includes(character)) { tokens.push({ kind: character, text: character }); at++; continue; }
    fail();
  }
  let position = 0;
  const take = (kind: string) => { if (tokens[position]?.kind !== kind) fail(); position++; };
  const atom = () => { if (!['word', 'literal'].includes(tokens[position]?.kind ?? '')) fail(); position++; };
  function term(depth: number): void {
    if (depth > 32) fail();
    if (tokens[position]?.kind === '!') { position++; term(depth + 1); return; }
    if (tokens[position]?.kind === '(') { position++; expressionGroup(depth + 1); take(')'); return; }
    take('word'); take('('); atom();
    while (tokens[position]?.kind === ',') { position++; atom(); }
    take(')');
  }
  function expressionGroup(depth: number): void {
    term(depth);
    while (tokens[position]?.kind === 'word' && /^(and|or)$/i.test(tokens[position]!.text)) { position++; term(depth); }
  }
  expressionGroup(0);
  if (position !== tokens.length) fail();
}
export function scopedCriteria(hierarchyUnit: number, criteria?: string): string {
  if (!Number.isSafeInteger(hierarchyUnit) || hierarchyUnit <= 0) throw new CliError(Exit.usage, 'Explicit positive safe-integer hierarchy unit required');
  const scope = `equals(hierUnitId,${hierarchyUnit})`;
  if (criteria === undefined) return `where ${scope}`;
  if (typeof criteria !== 'string' || criteria.length > 2000 || /[\u0000-\u001f\u007f]/.test(criteria)) throw new CliError(Exit.usage, 'Invalid searchCriteria string');
  const expression = criteria.trim().replace(/^where\s+/i, '');
  validateExpression(expression);
  const result = `where (${scope} and (${expression}))`;
  if (result.length > 2000) throw new CliError(Exit.usage, 'Scoped searchCriteria exceeds 2000 characters');
  return result;
}
