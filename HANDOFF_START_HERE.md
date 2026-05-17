# Start Here For Claude Code

You are taking over the current Roman TD / Gem TD browser game.

Use this order:

1. Read `CLAUDE_CODE_HANDOFF.md`.
2. Read `HANDOFF_RELEVANT_FILES.md`.
3. Check `HANDOFF_FILE_INDEX_NEWEST_TO_OLDEST.md` if you want the newest changed files first.
4. Run the project from the actual project root:

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5175
```

Open:

`http://127.0.0.1:5175/`

Current build status:

`npm run build` passes.

Important: keep the `01_RUNNABLE_PROJECT/roman-td` project structure intact after unpacking the organized archive. Vite expects `src`, `public`, `package.json`, `index.html`, and config files to stay together.
