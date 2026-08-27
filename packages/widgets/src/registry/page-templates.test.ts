// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { PAGE_CRUD_TEMPLATE_ID as CRUD_TEMPLATE_COMPONENT_ID } from '../templates/page-crud/index.js';
import { PAGE_RECORD_TEMPLATE_ID as RECORD_TEMPLATE_COMPONENT_ID } from '../templates/page-record/index.js';
import { ARCHETYPE_TEMPLATE_IDS } from './archetypes.js';
import {
  DuplicatePageTemplateIdError,
  PAGE_CRUD_TEMPLATE_ID,
  PAGE_DASHBOARD_TEMPLATE_ID,
  PAGE_RECORD_TEMPLATE_ID,
  buildPageTemplateRegistry,
  getPageTemplate,
  pageTemplateDefinitions,
  pageTemplateRegistry,
  type PageTemplateDefinition,
} from './page-templates.js';

/** The twelve M7 wave-2 templates (builtinTemplates in pages/templates.tsx). */
const M7_RECOMMENDABLE = [
  'page-board',
  'page-calendar',
  'page-scheduler',
  'page-directory',
  'page-master-detail',
  'page-queue-inbox',
  'page-log-viewer',
  'page-files',
  'page-chat',
] as const;

const M7_TOOL_SURFACES = ['page-builder', 'page-wizard', 'page-settings'] as const;

describe('pageTemplateRegistry', () => {
  it('registers exactly the fifteen templates the runtime ships today', () => {
    expect([...pageTemplateRegistry.keys()].sort()).toEqual(
      [
        'page-crud',
        'page-record',
        'page-dashboard',
        ...M7_RECOMMENDABLE,
        ...M7_TOOL_SURFACES,
      ].sort(),
    );
  });

  it('page-crud is renderable but never recommendable (06 §5 decision 6)', () => {
    expect(getPageTemplate(PAGE_CRUD_TEMPLATE_ID)?.recommendable).toBe(false);
  });

  it('page-record is neither recommendable nor standalone (30 D3)', () => {
    // The record page is the crud page's child route; the LLM must not place
    // it per table and the Studio picker must not offer dead-end shells.
    const record = getPageTemplate(PAGE_RECORD_TEMPLATE_ID);
    expect(record?.recommendable).toBe(false);
    expect(record?.standalone).toBe(false);
  });

  it('every template except page-record is standalone-creatable', () => {
    for (const template of pageTemplateDefinitions) {
      expect(template.standalone !== false, template.id).toBe(template.id !== 'page-record');
    }
  });

  it('page-dashboard is a recommendable candidate', () => {
    expect(getPageTemplate(PAGE_DASHBOARD_TEMPLATE_ID)?.recommendable).toBe(true);
  });

  it('the nine data-shaped M7 archetypes are recommendable', () => {
    for (const id of M7_RECOMMENDABLE) {
      expect(getPageTemplate(id)?.recommendable, id).toBe(true);
    }
  });

  it('the three tool surfaces are renderable but never recommendable', () => {
    for (const id of M7_TOOL_SURFACES) {
      expect(getPageTemplate(id)?.recommendable, id).toBe(false);
    }
  });

  it('every template a §14 archetype rule can emit is recommendable (emitter ⊆ vocabulary)', () => {
    // An auto-trigger that emits a non-recommendable (or unregistered) template
    // would produce pages the LLM path cannot round-trip (06 §8.3).
    for (const id of ARCHETYPE_TEMPLATE_IDS) {
      expect(getPageTemplate(id)?.recommendable, id).toBe(true);
    }
  });

  it('every registered template carries the conventional i18n description key', () => {
    // descriptionKey follows 'templates.<camelCaseId>.description' — the Studio
    // picker derives labels from it the way the widget palette does.
    for (const template of pageTemplateDefinitions) {
      const camel = template.id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      expect(template.descriptionKey).toBe(`templates.${camel}.description`);
    }
  });

  it('getPageTemplate returns undefined for unknown ids', () => {
    expect(getPageTemplate('page-does-not-exist')).toBeUndefined();
  });

  it('throws DuplicatePageTemplateIdError on duplicate registration', () => {
    const dup: PageTemplateDefinition = { id: 'page-crud', recommendable: true, descriptionKey: 'x' };
    expect(() => buildPageTemplateRegistry([...pageTemplateDefinitions, dup])).toThrowError(
      DuplicatePageTemplateIdError,
    );
  });

  it('the page-crud id matches the template component constant (drift guard)', () => {
    // If templates/page-crud renames its template id, this fails so the registry
    // (and every LLM allow-list derived from it) cannot silently diverge.
    expect(PAGE_CRUD_TEMPLATE_ID).toBe(CRUD_TEMPLATE_COMPONENT_ID);
  });

  it('the page-record id matches the template component constant (drift guard)', () => {
    expect(PAGE_RECORD_TEMPLATE_ID).toBe(RECORD_TEMPLATE_COMPONENT_ID);
  });
});
