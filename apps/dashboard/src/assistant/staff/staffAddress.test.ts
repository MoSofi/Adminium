// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { configAddress, openLabel } from './loader.js';
import { panelQuery } from './panel.js';

const LABELS = { 'en-US': 'Ask {name}', 'de-DE': '{name} fragen', 'zh-TW': '詢問 {name}' };

describe('the button on a staff address', () => {
  it('is named in the page\'s language, else the browser\'s, else English', () => {
    expect(openLabel(LABELS, 'Milo', ['de-DE'])).toBe('Milo fragen');
    expect(openLabel(LABELS, 'Milo', ['de_DE'])).toBe('Milo fragen');
    // A language with no exact entry takes its nearest; one with none at all falls to the next asked.
    expect(openLabel(LABELS, 'Milo', ['de-AT'])).toBe('Milo fragen');
    expect(openLabel(LABELS, 'Milo', ['sv-SE', 'zh-TW'])).toBe('詢問 Milo');
    expect(openLabel(LABELS, 'Ada', ['sv-SE'])).toBe('Ask Ada');
    expect(openLabel(LABELS, 'Ada', [])).toBe('Ask Ada');
  });

  it('reads the side\'s configuration under the side\'s own path, or at the root of a host of its own', () => {
    expect(configAddress('/apps/clinic/staff/')).toBe('/apps/clinic/staff/surface-config.json');
    expect(configAddress('/apps/clinic/staff')).toBe('/apps/clinic/staff/surface-config.json');
    expect(configAddress('/apps/clinic/staff/desk/today')).toBe('/apps/clinic/staff/surface-config.json');
    // An extra instance of the app.
    expect(configAddress('/apps/clinic/north/staff/desk')).toBe('/apps/clinic/north/staff/surface-config.json');
    // A mapped host: the side is the whole address.
    expect(configAddress('/')).toBe('/surface-config.json');
    expect(configAddress('/desk/today')).toBe('/surface-config.json');
    expect(configAddress('/apps/clinic/customer/')).toBe('/surface-config.json');
  });
});

describe('what the panel takes from its address', () => {
  it('keeps an app key, a configuration path of this origin, a direction and a theme, and nothing else', () => {
    expect(panelQuery('?app=clinic&config=%2Fapps%2Fclinic%2Fstaff%2Fsurface-config.json&dir=rtl&theme=dark')).toEqual({
      app: 'clinic',
      config: '/apps/clinic/staff/surface-config.json',
      dir: 'rtl',
      theme: 'dark',
    });
    expect(panelQuery('?app=clinic&config=%2Fapps%2Fclinic%2Fnorth%2Fstaff%2Fsurface-config.json').config).toBe('/apps/clinic/north/staff/surface-config.json');
    // Anything that is not the side's own configuration is not fetched: the root's is asked instead.
    for (const config of ['https://evil.example/surface-config.json', '//evil.example/surface-config.json', '/api/v1/users', '/apps/clinic/customer/surface-config.json', '../surface-config.json']) {
      expect(panelQuery(`?config=${encodeURIComponent(config)}`).config, config).toBe('/surface-config.json');
    }
    expect(panelQuery('?app=cli%22%3E%3Cx&dir=up&theme=pink')).toEqual({ app: 'clix', config: '/surface-config.json', dir: 'ltr', theme: 'light' });
  });
});
