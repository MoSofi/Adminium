import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileText,
  FileVideo,
  Folder,
  Image,
  Link as LinkIcon,
  Sheet,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { kindOf } from './media-lib.js';
import type { FileKind } from './media-lib.js';

/**
 * Kind → Lucide glyph for the `media` family's type-coded icon chips (annex §8;
 * File Manager's `ftMeta` icon map). Separated from `media-lib.ts` so that module
 * stays JSX-free and the registry-metadata graph (`media-config.ts`) never pulls
 * `lucide-react` into the eager chunk (04 §2.3; the `feeds/feed-icons` convention).
 */

const KIND_ICON: Record<FileKind, ReactNode> = {
  folder: <Folder />,
  pdf: <FileText />,
  sheet: <Sheet />,
  image: <Image />,
  archive: <FileArchive />,
  doc: <FileText />,
  code: <FileCode2 />,
  video: <FileVideo />,
  audio: <FileAudio />,
  file: <File />,
};

/** Glyph for a resolved kind. */
export function fileKindIcon(kind: FileKind): ReactNode {
  return KIND_ICON[kind];
}

/**
 * Glyph for an untrusted row, honouring a config `typeIconMap` override
 * (annex §8 `file-browser` config): the map remaps a raw `type` value onto a
 * DIFFERENT kind's glyph (e.g. `{ blueprint: 'image' }`), keeping the icon
 * vocabulary closed — a widget never renders an arbitrary icon name from data.
 */
export function fileIconFor(
  type: unknown,
  mime: unknown,
  name: unknown,
  typeIconMap?: Record<string, string> | undefined,
): ReactNode {
  if (typeIconMap !== undefined && typeof type === 'string') {
    const mapped = typeIconMap[type];
    if (mapped !== undefined) return fileKindIcon(kindOf(mapped, undefined, undefined));
  }
  return fileKindIcon(kindOf(type, mime, name));
}

/** The `link-list` row chip glyph (annex §8 — reference links, not files). */
export function linkIcon(): ReactNode {
  return <LinkIcon />;
}
