# Example modules

Copy one of these into your project's `.claude/superstatus/modules/` folder, change the command and the
numbers to yours, then open a new session or press Reload in `/ss`. The module appears in 新增卡片 under
its own group. Nothing here is installed for you: they are examples to copy.

What a file may hold is in the project's docs/modules.md. In short: `runs` are argv (no shell, no pipe,
3 seconds each), `reads` are absolute paths, a value is picked by line and column, and a chart names a
shape superstatus already draws (`rings` or `bars`).
