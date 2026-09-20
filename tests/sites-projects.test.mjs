import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const source = readFileSync(resolve(here, '../js/modules/fleet-ops/controllers/fleet.controller.js'), 'utf8');
const projects = readFileSync(resolve(here, '../js/modules/fleet-ops/controllers/projects.controller.js'), 'utf8');
const migration = readFileSync(resolve(here, '../supabase/migrations/20260920190000_projects_and_sites.sql'), 'utf8');

test('site navigation has renderable Projects and Site History panels', () => {
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

test('projects are their own records, filtered by status, created from New Project', () => {
  assert.match(projects, /authGet\("projects"/);
  assert.match(projects, /_projects\.filter\(p => p\.status === _projFilter\)/);
  assert.match(source, /openNewProject\(\)/);
  assert.doesNotMatch(source, /openNewSite\('project'\)/);
});

test('a project can run at many sites and a site can host many projects', () => {
  assert.match(migration, /create table if not exists project_sites/);
  assert.match(migration, /unique \(project_id, site_id\)/);
  assert.match(projects, /function projectsForSite/);
  assert.match(projects, /function sitesForProject/);
});

test('vehicles are deployed to a project at a site, and removal keeps history', () => {
  assert.match(migration, /alter table site_vehicle_assignments add column if not exists project_id/);
  assert.match(projects, /removed_date: today\(\)/);
});

test('the dashboard filter cannot be replaced by another script', () => {
  const overview = readFileSync(resolve(here, '../js/modules/fleet-ops/controllers/overview.controller.js'), 'utf8');
  assert.doesNotMatch(overview, /^function setDashFilter\(/m);
  assert.doesNotMatch(overview, /^function populateFilterDropdowns\(/m);
});
