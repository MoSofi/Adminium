import { describe, expect, it } from 'vitest';

import { PAGE_CRUD_TEMPLATE_ID as CRUD_TEMPLATE_COMPONENT_ID } from '../templates/page-crud/index.js';
import {
  DuplicatePageTemplateIdError,
  PAGE_CRUD_TEMPLATE_ID,
  PAGE_DASHBOARD_TEMPLATE_ID,
  buildPageTemplateRegistry,
  getPageTemplate,
  pageTemplateDefinitions,
  pageTemplateRegistry,
  type PageTemplateDefinition,
} from './page-templates.js';

describe('pageTemplateRegistry', () => {
  it('registers exactly the templates the runtime ships today', () => {
    expect([...pageTemplateRegistry.keys()].sort()).toEqual(['page-crud', 'page-dashboard']);
  });

  it('page-crud is renderable but never recommendable (06 §5 decision 6)', () => {
    expect(getPageTemplate(PAGE_CRUD_TEMPLATE_ID)?.recommendable).toBe(false);
  });

  it('page-dashboard is a recommendable candidate', () => {
    expect(getPageTemplate(PAGE_DASHBOARD_TEMPLATE_ID)?.recommendable).toBe(true);
  });

  it('every registered template carries an i18n description key', () => {
    for (const template of pageTemplateDefinitions) {
      expect(template.descriptionKey.length).toBeGreaterThan(0);
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
});
