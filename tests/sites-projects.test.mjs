import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const source = readFileSync(resolve(here, '../js/modules/fleet-ops/controllers/fleet.controller.js'), 'utf8');

test('site navigation has renderable Active Projects and Site History panels', () => {
  assert.match(source, /mk\("projects"/);
  assert.match(source, /mk\("sitehistory"/);
  assert.match(source, /tabName === "projects"[\s\S]{0,100}loadSites\(\)/);
  assert.match(source, /tabName === "sitehistory"[\s\S]{0,100}loadSites\(\)/);
});

test('site history can receive archived records while operational pickers stay active-only', () => {
  assert.match(source, /authGet\("sites", "select=\*&order=created_at\.desc"\)/);
  assert.match(source, /s\.status === "completed" \|\| s\.status === "cancelled"/);
  assert.match(source, /_sites\.filter\(s => s\.status === "active"\)/);
});

test('Active Projects only renders active project rows', () => {
  assert.match(source, /s\.site_type === "project" && s\.status === "active"/);
  assert.match(source, /openNewSite\('project'\)/);
});
