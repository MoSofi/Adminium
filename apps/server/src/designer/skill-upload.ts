// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Add your own": a design skill a person uploads, saved into the project's
 * `design-skills/`.
 *
 * It is a `.zip` of a skill folder, or one `SKILL.md`. What someone else
 * wrote is data, and is held to it: only the files a design skill has are
 * kept, each under its size, by a name of this server's choosing; a
 * stylesheet that loads anything, a picture with a script in it, a font that
 * is not one are refused with a sentence; nothing in it is ever run. The
 * folder is written whole, in one move, or not at all.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { unzipSync } from 'fflate';

import { BUILT_IN_ORDER, DESIGN_SKILL_KEY, DESIGN_SKILLS_DIR, designCssProblem, plainLine, readFrontMatter, SKILL_LIMITS } from '../project/apps/design-skills.js';

/** The most an upload may be, packed. */
export const SKILL_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 64;

export class SkillUploadError extends Error {
  override readonly name = 'SkillUploadError';
  constructor(
    readonly reason: 'TOO_LARGE' | 'NOT_A_SKILL' | 'UNSAFE' | 'NAME' | 'TAKEN',
    message: string,
  ) {
    super(message);
  }
}

/** The files a design skill may hold, by their path in the folder. */
const KEPT: readonly { path: RegExp; max: number }[] = [
  { path: /^SKILL\.md$/, max: SKILL_LIMITS.skillMd },
  { path: /^theme\.json$/, max: SKILL_LIMITS.themeJson },
  { path: /^design\.css$/, max: SKILL_LIMITS.designCss },
  { path: /^preview\.svg$/, max: SKILL_LIMITS.previewSvg },
  { path: /^fonts\/[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.woff2$/, max: SKILL_LIMITS.font },
  { path: /^references\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/, max: SKILL_LIMITS.reference },
];

/** Why a picture may not be a skill's preview, or null. It is only ever shown through `<img>`; this says so early. */
export function previewProblem(svg: string): string | null {
  if (!/<svg[\s>]/i.test(svg)) return 'preview.svg is not an SVG picture';
  if (/<script[\s>]/i.test(svg)) return 'preview.svg has a script in it';
  if (/\son[a-z]+\s*=/i.test(svg)) return 'preview.svg has an event handler in it';
  if (/<foreignObject[\s>]/i.test(svg)) return 'preview.svg holds a page inside it (foreignObject)';
  if (/(?:href|src)\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|webp);base64,)[^"']/i.test(svg) || /url\(\s*["']?\s*(?!#)[^)"']/i.test(svg)) return 'preview.svg points at another file or site';
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(svg)) return 'preview.svg declares entities';
  return null;
}

const isZip = (bytes: Buffer): boolean => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);

/** The files of an upload, by their path inside the skill's folder. */
function filesOf(filename: string, bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > SKILL_UPLOAD_MAX_BYTES) throw new SkillUploadError('TOO_LARGE', 'That file is over 4 MB. A style is a few small files.');
  if (!isZip(bytes)) {
    if (!/\.md$/i.test(filename)) throw new SkillUploadError('NOT_A_SKILL', 'A style is a .zip of its folder, or a single SKILL.md.');
    return new Map([['SKILL.md', bytes]]);
  }
  let total = 0;
  let count = 0;
  let packed: Record<string, Uint8Array>;
  try {
    packed = unzipSync(bytes, {
      // Decided from what the archive says of each file, before a byte of it is unpacked.
      filter: (file) => {
        // A folder's own entry, and what an operating system adds beside the files.
        if (file.name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(file.name)) return false;
        count += 1;
        total += file.originalSize;
        if (count > MAX_ENTRIES) throw new SkillUploadError('TOO_LARGE', 'That archive holds too many files for a style.');
        if (total > SKILL_LIMITS.folder) throw new SkillUploadError('TOO_LARGE', 'That archive unpacks to more than 4 MB.');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SkillUploadError) throw error;
    throw new SkillUploadError('NOT_A_SKILL', 'That archive does not read.');
  }
  const names = Object.keys(packed);
  // One folder around everything is the skill's own folder: its name is taken off.
  const tops = new Set(names.map((name) => name.split('/')[0] as string));
  const wrapped = tops.size === 1 && names.every((name) => name.includes('/'));
  const out = new Map<string, Buffer>();
  for (const name of names) {
    const path = wrapped ? name.slice(name.indexOf('/') + 1) : name;
    // No path that climbs, starts at the root or names a drive: such a file is not a style's, wherever it points.
    if (path.split('/').some((part) => part === '..' || part === '.') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')) {
      throw new SkillUploadError('UNSAFE', 'That archive has a file path that leaves its folder, so it was not added.');
    }
    out.set(path, Buffer.from(packed[name] as Uint8Array));
  }
  return out;
}

export interface AddedSkill {
  key: string;
  /** Files of the upload that are not a style's, and were left out. */
  left: string[];
}

/**
 * Check an upload and save it as `design-skills/<key>/`. Throws
 * `SkillUploadError` with the sentence a person reads.
 */
export function addDesignSkill(root: string, input: { filename: string; bytes: Buffer }): AddedSkill {
  const files = filesOf(input.filename, input.bytes);
  const md = files.get('SKILL.md');
  if (md === undefined) throw new SkillUploadError('NOT_A_SKILL', 'There is no SKILL.md in it: a style is a folder with a SKILL.md file that describes a look.');
  if (md.length > SKILL_LIMITS.skillMd) throw new SkillUploadError('TOO_LARGE', 'Its SKILL.md is larger than a style’s may be.');
  const { fields, body } = readFrontMatter(md.toString('utf8'));
  if (body.trim().length < 20) throw new SkillUploadError('NOT_A_SKILL', 'Its SKILL.md says nothing of a look: write how the style lays out a page.');
  // The key: the skill's own name, else the file's, as a folder may be named.
  const named = (fields['name'] ?? input.filename.replace(/\.(zip|md)$/i, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40);
  if (!DESIGN_SKILL_KEY.test(named) || named === 'skill') throw new SkillUploadError('NAME', 'It has no name to go by: give its SKILL.md a "name" of letters, digits and "-".');
  if ((BUILT_IN_ORDER as readonly string[]).includes(named)) throw new SkillUploadError('TAKEN', `"${named}" is the name of a built-in style. Give yours another name in its SKILL.md.`);
  const target = join(root, DESIGN_SKILLS_DIR, named);
  if (existsSync(target)) throw new SkillUploadError('TAKEN', `There is already a style "${named}" in this project. Remove it first, or give this one another name.`);

  const kept = new Map<string, Buffer>();
  const left: string[] = [];
  let fonts = 0;
  let references = 0;
  for (const [path, bytes] of files) {
    const rule = KEPT.find((entry) => entry.path.test(path));
    if (rule === undefined) {
      left.push(plainLine(path, 80));
      continue;
    }
    if (bytes.length > rule.max) throw new SkillUploadError('TOO_LARGE', `${plainLine(path, 80)} is larger than a style’s file may be, so the folder was not added.`);
    if (path.startsWith('fonts/')) {
      fonts += 1;
      if (fonts > SKILL_LIMITS.fonts) throw new SkillUploadError('TOO_LARGE', 'It has more font files than a style may bring.');
      if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new SkillUploadError('UNSAFE', `${plainLine(path, 80)} is not a font file (.woff2), so the folder was not added.`);
    }
    if (path.startsWith('references/')) {
      references += 1;
      if (references > SKILL_LIMITS.references) throw new SkillUploadError('TOO_LARGE', 'It has more reference pages than a style may bring.');
    }
    if (path === 'theme.json') {
      try {
        JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new SkillUploadError('NOT_A_SKILL', 'Its theme.json is not valid JSON, so the folder was not added.');
      }
    }
    if (path === 'design.css') {
      const problem = designCssProblem(bytes.toString('utf8'));
      if (problem !== null) throw new SkillUploadError('UNSAFE', `Its design.css cannot be used: ${problem}. The folder was not added.`);
    }
    if (path === 'preview.svg') {
      const problem = previewProblem(bytes.toString('utf8'));
      if (problem !== null) throw new SkillUploadError('UNSAFE', `${problem}, so the folder was not added.`);
    }
    kept.set(path, bytes);
  }

  // Written beside where it will live, then moved there in one step: a half-written style is never listed.
  const staging = join(root, DESIGN_SKILLS_DIR, `.adding-${randomBytes(6).toString('hex')}`);
  try {
    for (const [path, bytes] of kept) {
      const file = join(staging, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { key: named, left: left.slice(0, 20) };
}

/** Remove a style of the project's own. False when there is none of that name. */
export function removeDesignSkill(root: string, key: string): boolean {
  if (!DESIGN_SKILL_KEY.test(key)) return false;
  const target = join(root, DESIGN_SKILLS_DIR, key);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
