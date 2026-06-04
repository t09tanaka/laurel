# Laurel Telemetry

Laurel telemetry is off by default. The CLI sends anonymous usage statistics only
after a user runs:

```sh
laurel telemetry enable
```

Disable it at any time:

```sh
laurel telemetry disable
```

Check the current state:

```sh
laurel telemetry status
```

## Endpoint

The default endpoint is:

```text
https://telemetry.laurel.dev/v1/usage
```

Set a stored endpoint when enabling:

```sh
laurel telemetry enable --endpoint https://telemetry.example.test/v1/usage
```

Override the endpoint for a single process with:

```sh
LAUREL_TELEMETRY_ENDPOINT=https://telemetry.example.test/v1/usage laurel build
```

Tests and local automation can isolate the telemetry settings file with
`LAUREL_TELEMETRY_CONFIG=/path/to/telemetry.json`.

## Payload

Laurel sends one `POST` request after a command finishes. It does not send
telemetry for `laurel telemetry`, top-level help, or version commands.

Exact JSON payload:

```json
{
  "schema_version": 1,
  "event": "cli_command",
  "anonymous_machine_id": "550e8400-e29b-41d4-a716-446655440000",
  "command": "build",
  "duration_ms": 124,
  "success": true,
  "exit_code": 0,
  "laurel_version": "0.1.0",
  "bun_version": "1.3.0",
  "os": {
    "platform": "darwin",
    "arch": "arm64",
    "release": "25.5.0"
  }
}
```

Field notes:

| Field | Description |
| --- | --- |
| `schema_version` | Payload schema version. Currently `1`. |
| `event` | Always `cli_command`. |
| `anonymous_machine_id` | Random UUID generated on opt-in and stored locally. It is not derived from hardware, hostname, user name, project path, git data, or network identifiers. |
| `command` | Canonical top-level Laurel command, such as `build`, `check`, or `serve`. |
| `duration_ms` | Rounded command duration in milliseconds. |
| `success` | `true` when `exit_code` is `0`; otherwise `false`. |
| `exit_code` | CLI exit code. |
| `laurel_version` | Running Laurel version. |
| `bun_version` | Running Bun version, or `null` if unavailable. |
| `os.platform` | Node/Bun OS platform string. |
| `os.arch` | Node/Bun CPU architecture string. |
| `os.release` | Node/Bun OS release string. |

The payload intentionally excludes command arguments, current working directory,
project configuration, content paths, environment variables, git remotes,
hostnames, usernames, IP addresses, stack traces, and file contents.
