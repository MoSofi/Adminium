/**
 * Nav rows carry lucide icon names in kebab-case (`bar-chart-3`); resolve them
 * to components via the `icons` map, falling back to a neutral file glyph so
 * an unknown name can never crash the sidebar (09-generated-app.md §2.2).
 */
import { File, icons, type LucideIcon } from 'lucide-react';

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join('');
}

export function lucideByName(name: string): LucideIcon {
  return (icons as Record<string, LucideIcon>)[pascalCase(name)] ?? File;
}
