# Loop prompt — Fish Tank To-Do

Paste after `/loop` (dynamic pacing), or run as a plain prompt repeatedly.
One iteration = one story, start to finish.

---

You are implementing the Fish Tank To-Do app one story at a time.

**Read first, every iteration:**
- `docs/stories.md` — the story list, waves, file ownership, invariants
- `docs/progress.md` — what is already done (create it if missing, from the story list)
- `CLAUDE.md` — project rules
- `docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md` — only the sections your story touches

**Pick exactly one story:** the lowest-numbered story in `docs/progress.md` marked
`todo` whose wave gate is satisfied — every story in every earlier wave is `done`.
If none qualifies, or all are `done`, say so and stop the loop.

**Do the story:**
1. Mark it `in-progress` in `docs/progress.md` before touching code.
2. Write the tests from the story's "Done when" line first, watch them fail, then
   implement until they pass. Pure-layer stories (S3–S7) are strictly test-first.
3. Touch only the files in that story's **Owns** list. If you need a file another
   story owns, stop and record the gap in `docs/progress.md` under `Blocked` —
   do not reach across.
4. Run `npm test` and `npm run build`. Both must pass. Quote real output; if
   something fails, fix it or mark the story `blocked` with the error — never
   report a green run you did not see.
5. Re-check the story against the invariant list at the bottom of `docs/stories.md`.
   Soft-delete filtering, absolute `now`, derived pearls, never-revoked koi, and the
   import-direction rules break silently and are not caught by types.
6. Mark it `done` in `docs/progress.md` with a one-line note on anything the next
   story needs to know.

**Then stop.** One story per iteration. Do not continue to the next story in the
same run — the next wake-up picks it up.

**Report:** story id, what shipped, test/build result, and what is next.

---

## Progress file format

`docs/progress.md`, initialised once from the story list:

```markdown
# Progress

| Story | Status | Note |
| --- | --- | --- |
| S0 | todo | |
| S1 | todo | |
...
```

Status is one of `todo`, `in-progress`, `done`, `blocked`.
