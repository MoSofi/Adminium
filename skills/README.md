# Adminium skills

Skills that teach a coding agent (Claude Code, Codex and others that read `SKILL.md` files) to build
an app on [Adminium](https://adminium.dev).

| Skill | For |
|---|---|
| `adminium` | Start here: what to build, where logic lives, the loop |
| `adminium-app` | An app from an empty folder: tables, pages, roles, sample data, check, try, pack |
| `adminium-surface` | Screens for staff and for customers |
| `adminium-add-ons` | Building on an add-on such as Invoices & Receipts |
| `adminium-project` | The project around the app: custom dashboard pages, widgets, hooks, actions |
| `adminium-design` | Designing an app's screens: the first screen, type, space, colour, pictures, the logo, and ten ready styles |

## Install

```bash
npx skills add Adminiumjs/skills
```

Or copy the folders into your agent's skills folder (`.claude/skills/` for Claude Code).

Then ask for what you want: "Create an Adminium app for a bike repair shop, with a screen where
customers can send a request."

## Version

These skills are written for the Adminium version in `VERSION`, and are released with it. Each
`references/` folder is produced from the Adminium documentation of that version; do not edit it.

## Licence

AGPL-3.0-only, as Adminium is. The apps you build with them are yours.
