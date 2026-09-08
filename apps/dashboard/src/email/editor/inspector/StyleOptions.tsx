// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block's eight style axes (comp 741-766, 1516-1527; Appendix A §E3):
 * Alignment · Background · Text colour · Spacing · Text size (sized kinds) ·
 * Border · Corner radius · Full-width. Every button writes ONE axis to
 * `block.style`; the canvas's `blockWrapperClasses` reads them back.
 */
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { Switch } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { EmailBlockStyle } from '../../api.js';
import { OptionButton, PanelLabel, Swatch } from './parts.js';

export interface StyleOptionsProps {
  /** The block's eight axes (`block.style`; named `blockStyle` because a `style` prop is the banned inline-CSS one). */
  blockStyle: EmailBlockStyle;
  sized: boolean;
  onChange: (patch: Partial<EmailBlockStyle>) => void;
}

export function StyleOptions({ blockStyle: style, sized, onChange }: StyleOptionsProps) {
  const align = style.align ?? 'start';
  const bg = style.bg ?? 'none';
  const fg = style.fg ?? 'auto';
  const pad = style.pad ?? 'none';
  const size = style.size ?? 'm';
  const border = style.border ?? 'none';
  const radius = style.radius ?? 'md';
  const full = style.full === true;

  return (
    <div data-testid="email-style-options" className="flex flex-col gap-3.5">
      <PanelLabel className="mb-0">{t('email:style.title', 'Block style')}</PanelLabel>
      <div>
        <PanelLabel>{t('email:style.alignment', 'Alignment')}</PanelLabel>
        <div className="flex gap-1.5" role="group" aria-label={t('email:style.alignment', 'Alignment')}>
          <OptionButton on={align === 'start'} label={t('email:style.align.start', 'Left')} onClick={() => onChange({ align: 'start' })} testId="email-style-align" value="start">
            <AlignLeft className="size-3.5" aria-hidden="true" />
          </OptionButton>
          <OptionButton on={align === 'center'} label={t('email:style.align.center', 'Centre')} onClick={() => onChange({ align: 'center' })} testId="email-style-align" value="center">
            <AlignCenter className="size-3.5" aria-hidden="true" />
          </OptionButton>
          <OptionButton on={align === 'end'} label={t('email:style.align.end', 'Right')} onClick={() => onChange({ align: 'end' })} testId="email-style-align" value="end">
            <AlignRight className="size-3.5" aria-hidden="true" />
          </OptionButton>
        </div>
      </div>
      <div>
        <PanelLabel>{t('email:style.background', 'Background')}</PanelLabel>
        <div className="flex gap-[7px]" role="group" aria-label={t('email:style.background', 'Background')}>
          <Swatch on={bg === 'none'} label={t('email:style.bg.none', 'None')} onClick={() => onChange({ bg: 'none' })} className="bg-transparent" testId="email-style-bg" value="none" />
          <Swatch on={bg === 'soft'} label={t('email:style.bg.soft', 'Grey')} onClick={() => onChange({ bg: 'soft' })} className="bg-[#fafafa]" testId="email-style-bg" value="soft" />
          <Swatch on={bg === 'tint'} label={t('email:style.bg.tint', 'Brand tint')} onClick={() => onChange({ bg: 'tint' })} className="bg-accent-soft" testId="email-style-bg" value="tint" />
          <Swatch on={bg === 'accent'} label={t('email:style.bg.accent', 'Brand')} onClick={() => onChange({ bg: 'accent' })} className="bg-accent" testId="email-style-bg" value="accent" />
          <Swatch on={bg === 'dark'} label={t('email:style.bg.dark', 'Dark')} onClick={() => onChange({ bg: 'dark' })} className="bg-[#17171c]" testId="email-style-bg" value="dark" />
        </div>
      </div>
      <div>
        <PanelLabel>{t('email:style.textColour', 'Text colour')}</PanelLabel>
        <div className="flex gap-[7px]" role="group" aria-label={t('email:style.textColour', 'Text colour')}>
          <Swatch on={fg === 'auto'} label={t('email:style.fg.auto', 'Body')} onClick={() => onChange({ fg: 'auto' })} className="bg-[#55555f]" testId="email-style-fg" value="auto" />
          <Swatch on={fg === 'strong'} label={t('email:style.fg.strong', 'Strong')} onClick={() => onChange({ fg: 'strong' })} className="bg-[#17171c]" testId="email-style-fg" value="strong" />
          <Swatch on={fg === 'muted'} label={t('email:style.fg.muted', 'Muted')} onClick={() => onChange({ fg: 'muted' })} className="bg-[#9a9aa5]" testId="email-style-fg" value="muted" />
          <Swatch on={fg === 'accent'} label={t('email:style.fg.accent', 'Brand')} onClick={() => onChange({ fg: 'accent' })} className="bg-accent" testId="email-style-fg" value="accent" />
          <Swatch on={fg === 'white'} label={t('email:style.fg.white', 'White')} onClick={() => onChange({ fg: 'white' })} className="bg-white" testId="email-style-fg" value="white" />
        </div>
      </div>
      <div>
        <PanelLabel>{t('email:style.spacing', 'Spacing')}</PanelLabel>
        <div className="flex gap-1.5" role="group" aria-label={t('email:style.spacing', 'Spacing')}>
          <OptionButton on={pad === 'none'} label={t('email:style.pad.none', 'None')} onClick={() => onChange({ pad: 'none' })} testId="email-style-pad" value="none" />
          <OptionButton on={pad === 's'} label="S" onClick={() => onChange({ pad: 's' })} testId="email-style-pad" value="s" />
          <OptionButton on={pad === 'm'} label="M" onClick={() => onChange({ pad: 'm' })} testId="email-style-pad" value="m" />
          <OptionButton on={pad === 'l'} label="L" onClick={() => onChange({ pad: 'l' })} testId="email-style-pad" value="l" />
        </div>
      </div>
      {sized ? (
        <div>
          <PanelLabel>{t('email:style.textSize', 'Text size')}</PanelLabel>
          <div className="flex gap-1.5" role="group" aria-label={t('email:style.textSize', 'Text size')}>
            <OptionButton on={size === 's'} label={t('email:style.size.s', 'Small')} onClick={() => onChange({ size: 's' })} testId="email-style-size" value="s" />
            <OptionButton on={size === 'm'} label={t('email:style.size.m', 'Medium')} onClick={() => onChange({ size: 'm' })} testId="email-style-size" value="m" />
            <OptionButton on={size === 'l'} label={t('email:style.size.l', 'Large')} onClick={() => onChange({ size: 'l' })} testId="email-style-size" value="l" />
          </div>
        </div>
      ) : null}
      <div>
        <PanelLabel>{t('email:style.border', 'Border')}</PanelLabel>
        <div className="flex gap-1.5" role="group" aria-label={t('email:style.border', 'Border')}>
          <OptionButton on={border === 'none'} label={t('email:style.borderKind.none', 'None')} onClick={() => onChange({ border: 'none' })} testId="email-style-border" value="none" />
          <OptionButton on={border === 'thin'} label={t('email:style.borderKind.thin', 'Solid')} onClick={() => onChange({ border: 'thin' })} testId="email-style-border" value="thin" />
          <OptionButton on={border === 'dashed'} label={t('email:style.borderKind.dashed', 'Dashed')} onClick={() => onChange({ border: 'dashed' })} testId="email-style-border" value="dashed" />
        </div>
      </div>
      <div>
        <PanelLabel>{t('email:style.radius', 'Corner radius')}</PanelLabel>
        <div className="flex gap-1.5" role="group" aria-label={t('email:style.radius', 'Corner radius')}>
          <OptionButton on={radius === 'none'} label={t('email:style.radiusKind.none', 'Square')} onClick={() => onChange({ radius: 'none' })} testId="email-style-radius" value="none" />
          <OptionButton on={radius === 'md'} label={t('email:style.radiusKind.md', 'Rounded')} onClick={() => onChange({ radius: 'md' })} testId="email-style-radius" value="md" />
          <OptionButton on={radius === 'lg'} label={t('email:style.radiusKind.lg', 'Large')} onClick={() => onChange({ radius: 'lg' })} testId="email-style-radius" value="lg" />
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div id="email-style-full-label" className="text-[12.5px] font-bold text-fg">
            {t('email:style.fullWidth', 'Full-width')}
          </div>
          <div className="text-[10.5px] text-fg-subtle">{t('email:style.fullWidthHint', 'Bleed to the email edges')}</div>
        </div>
        <Switch aria-labelledby="email-style-full-label" data-testid="email-style-full" checked={full} onCheckedChange={(checked) => onChange({ full: checked })} />
      </div>
    </div>
  );
}
