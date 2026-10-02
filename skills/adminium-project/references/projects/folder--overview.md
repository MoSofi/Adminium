<!-- produced from apps/docs/src/content/docs/projects/folder.md; do not edit -->

# The project folder

```
my-admin/
├── adminium.config.ts     which databases, and the rest of the settings
├── pages/
│   ├── contacts.json      a generated page
│   ├── sales.json         a generated dashboard
│   └── revenue.tsx        a page you wrote
├── schema/
│   └── main.json          labels, hidden columns and masks for database "main"
├── lists/
│   └── stages.json        the answers a column accepts, named once
├── hooks/                 code that runs before or after a record is saved
├── actions/               buttons on records that run your code
├── widgets/               your own table cells and dashboard cards
├── .env                   the secret and your database URLs — never committed
├── .env.example           the same keys, empty, for whoever clones this
├── .adminium/             build output (gitignored)
├── data/                  Adminium's own database and uploads while you develop
├── Dockerfile             this project on the official Adminium image
├── tsconfig.json
├── README.md
└── package.json           @adminiumjs/adminium, pinned to one exact version
```

`pages/`, `schema/`, `lists/`, `hooks/`, `actions/` and `widgets/` are all
optional: a project with none of them still runs, and the first `npm run dev`
fills the first two in.
