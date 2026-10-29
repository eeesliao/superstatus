# Profiles to start from

The installer puts every file here in `~/.claude/superstatus/profiles` (where Claude Code keeps its files
elsewhere, `CLAUDE_CONFIG_DIR`, in that folder instead), so they are already in the list when you open `/ss`
and press **Profile**. A file of yours with the same name is never written over.

- **Empty.json** — nothing but the version: the bare framework, to build your own from scratch. It carries no
  language, so loading it leaves the panel in the one you read.
- **template-en.json**, **template-zh-TW.json**, **template-ja.json** — one per language, each holding every kind
  of card superstatus has: a text card, a countdown, a file card, a command card, two module cards, a switch and
  two buttons, so you can see what each one looks like before you make your own.

Press **Load** beside one. Before it loads, the pane lists every card in it that would run something, and saves
what you have now as **before-load**, so one press takes you back.

Everything that runs or sends something — the command card, the switch and both buttons — arrives **off**.
Nothing in here runs on your machine until you turn it on yourself in `/ss`.

The file card reads `README.md` in your project and shows the first line that starts with `# `; the command card
runs `uptime`; the `!uptime` button runs `uptime` on the host when you press it.
