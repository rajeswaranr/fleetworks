/* The attendance parser turns a text message into a payroll record: a
   misread reply is a day's wage on the wrong side of the ledger, and nobody
   notices until settlement. It lives inside a Deno edge function, so the
   function is extracted from source and evaluated here rather than imported. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));

function loadFn(file, name) {
  const src = readFileSync(resolve(__dirname, file), 'utf8');
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found in ${file}`);

  // Parameters: balance parentheses, since a signature may span lines.
  const openParen = src.indexOf('(', start);
  let d = 0, i = openParen;
  for (; i < src.length; i++) {
    if (src[i] === '(') d++;
    else if (src[i] === ')' && --d === 0) break;
  }
  const closeParen = i;
  const params = src.slice(openParen + 1, closeParen)
    .split(',').map((a) => a.split(':')[0].trim()).filter(Boolean);

  // Body: the return type may itself contain braces, e.g.
  //   ): { url: string; headers: Record<string, string> } {
  // so the body brace is the LAST one on the signature line, not the first
  // after the parameters.
  const eol = src.indexOf('\n', closeParen);
  const bodyBrace = src.lastIndexOf('{', eol);
  assert.ok(bodyBrace > closeParen, `could not locate body of ${name}`);

  d = 0;
  for (i = bodyBrace; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) break;
  }
  return new Function(...params, src.slice(bodyBrace + 1, i));
}

const readAttendance = loadFn('../supabase/functions/whatsapp-webhook/index.ts', 'readAttendance');

test('digit replies map to the four statuses the template offers', () => {
  assert.equal(readAttendance('1'), 'present');
  assert.equal(readAttendance('2'), 'on_trip');
  assert.equal(readAttendance('3'), 'rest');
  assert.equal(readAttendance('4'), 'leave');
});

test('a digit with trailing text still counts', () => {
  assert.equal(readAttendance('1 sir'), 'present');
  assert.equal(readAttendance('2 - going to Salem'), 'on_trip');
});

test('word answers are accepted, including transliterated ones', () => {
  assert.equal(readAttendance('on duty'), 'present');
  assert.equal(readAttendance('Haazir'), 'present');
  assert.equal(readAttendance('on trip'), 'on_trip');
  assert.equal(readAttendance('rest'), 'rest');
  assert.equal(readAttendance('chutti'), 'leave');
});

test('case and surrounding whitespace do not matter', () => {
  assert.equal(readAttendance('  ON DUTY  '), 'present');
});

/* The important half. Anything the parser is not sure about must return null
   so the webhook records the message and leaves attendance alone, rather than
   marking a day from a guess. */
test('ambiguous or unrelated replies mark nothing', () => {
  for (const s of ['', 'ok', 'thanks', 'call me', '5', 'yes', 'gaadi kharab hai', '12']) {
    assert.equal(readAttendance(s), null, `expected null for ${JSON.stringify(s)}`);
  }
});

/* FleetWorks runs on Meta direct. The provider adapter exists as an escape
   hatch, so the thing worth guarding is that the DEFAULT stays Meta and that an
   unrecognised value falls back to it rather than silently addressing nowhere. */
const endpoint = loadFn('../supabase/functions/whatsapp-send/index.ts', 'endpoint');

test('default provider is Meta direct', () => {
  const ep = endpoint('meta', 'tok', '123456', 'v21.0');
  assert.equal(ep.url, 'https://graph.facebook.com/v21.0/123456/messages');
  assert.equal(ep.headers.Authorization, 'Bearer tok');
  assert.equal(ep.headers['D360-API-KEY'], undefined);
});

test('an unset or unknown provider still routes to Meta', () => {
  for (const p of ['', 'nonsense', 'aisensy']) {
    assert.match(endpoint(p, 'tok', '123456', 'v21.0').url, /graph\.facebook\.com/);
  }
});

test('360dialog swaps base URL and auth header, nothing else', () => {
  const ep = endpoint('360dialog', 'key', '123456', 'v21.0');
  assert.equal(ep.url, 'https://waba-v2.360dialog.io/v1/messages');
  assert.equal(ep.headers['D360-API-KEY'], 'key');
  assert.equal(ep.headers.Authorization, undefined);
});
