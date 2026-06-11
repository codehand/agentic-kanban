# MCP usage log

The MCP core appends one JSON line per tool call to an append-only JSONL file.
It is **write-only**: the server never reads it back. Developers query it
manually for usage analysis (which tools are used, what gets rejected, errors,
latency).

## Where

```
<USAGE_LOG_DIR>/usage-YYYY-MM-DD.jsonl
```

One file per UTC day. The directory is created automatically on first write.

## Config

| Env var         | Default      | Notes                                   |
| --------------- | ------------ | --------------------------------------- |
| `USAGE_LOG_DIR` | `logs/usage` | Set to `off` (or empty) to disable.     |

Writes are fire-and-forget: if the directory is unwritable or anything else
fails, the error is swallowed and the tool call returns normally.

## Event schema

Each line is one JSON object:

| Field           | Type                          | Description                                                  |
| --------------- | ----------------------------- | ------------------------------------------------------------ |
| `ts`            | string (ISO 8601)             | When the call completed.                                     |
| `tool`          | string                        | Tool name, e.g. `project.list`, `task.transition`.           |
| `role`          | string                        | Caller role, e.g. `implementer`.                             |
| `token_id`      | string                        | Caller token id (never the bearer secret).                   |
| `project`       | string \| null                | Project slug/id from args, else null.                        |
| `task_key`      | string \| null                | Task key from args, else null.                               |
| `outcome`       | `ok` \| `rejected` \| `error` | `rejected` = domain/authz/validation; `error` = system fault.|
| `error_message` | string \| null                | Failure message, null when `outcome=ok`.                     |
| `duration_ms`   | number                        | Handler wall-clock duration.                                 |

Sensitive/oversized data is never recorded: no bearer secret, no `secret_hash`,
no full tool args, no evidence manifest.

## Querying

```sh
# Follow today's calls live
tail -f logs/usage/usage-$(date -u +%F).jsonl

# Pretty-print every event
jq . logs/usage/usage-2026-06-11.jsonl

# Only rejected/error calls
grep -v '"outcome":"ok"' logs/usage/usage-2026-06-11.jsonl | jq .

# Count calls per tool
jq -r .tool logs/usage/usage-2026-06-11.jsonl | sort | uniq -c | sort -rn

# Slowest calls
jq -s 'sort_by(-.duration_ms) | .[:10]' logs/usage/usage-2026-06-11.jsonl
```
