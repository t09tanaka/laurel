# Telemetry

Nectar does not send crash reports automatically. If the CLI hits an uncaught
exception in an interactive terminal, it prints the normal error first and then
asks:

```text
Send anonymous crash report? (y/N/never)
```

Answering `y` sends an anonymous crash payload. Answering `N` or pressing Enter
skips that crash only. Answering `never` writes:

```text
~/.config/nectar/telemetry.json
```

with crash reports disabled for future crashes. `XDG_CONFIG_HOME` is honoured
when set.

Crash reporting is disabled by default when stdin or stderr is not a TTY, so CI
jobs and piped commands do not prompt or send.

The crash payload contains only:

- error class and message;
- a stack trace with local filesystem paths replaced by `[path]`;
- the command line shape with argument values redacted;
- Nectar, Bun, Node, and commit versions.

Network transport is best-effort. Tests inject a sender and never perform real
network requests.
