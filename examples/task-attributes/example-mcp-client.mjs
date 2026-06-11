/**
 * example-mcp-client.mjs — Set task attributes via a real MCP client.
 *
 * Connects to the server's /mcp endpoint over Streamable HTTP using
 * @modelcontextprotocol/sdk, then drives the `task.create` and `task.update`
 * tools to set and modify the 5 task attributes
 * (priority, complexity, estimate_hours, tags, link_document).
 *
 * Usage (run from the repo root so the sdk dependency resolves):
 *   TASK_HUB_URL=http://localhost:3000 TASK_TOKEN=<bearer token> \
 *     node examples/task-attributes/example-mcp-client.mjs
 *
 * Optional: TASK_PROJECT (default 'test-project').
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BASE = process.env.TASK_HUB_URL || 'http://localhost:3000'
const TOKEN = process.env.TASK_TOKEN || ''
const PROJECT = process.env.TASK_PROJECT || 'test-project'

if (!TOKEN) {
  console.error('TASK_TOKEN env var is required')
  process.exit(1)
}

/** Parse the JSON payload out of an MCP tool result. */
function toolJson(result) {
  if (result.isError) {
    const msg = (result.content ?? []).map((c) => c.text).join(' ')
    throw new Error(`MCP tool error: ${msg}`)
  }
  return JSON.parse(result.content[0].text)
}

async function main() {
  // 1. Connect a real MCP client over Streamable HTTP with a bearer token.
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  const client = new Client({ name: 'task-attributes-example', version: '1.0.0' })
  await client.connect(transport)
  console.log(`Connected to MCP at ${BASE}/mcp`)

  try {
    // 2. task.create with all 5 attributes.
    const key = `TASK-EX-${Date.now().toString(36).toUpperCase()}`
    console.log(`\nCreating ${key} via task.create with attributes...`)
    const created = toolJson(await client.callTool({
      name: 'task.create',
      arguments: {
        project: PROJECT,
        key,
        title: 'Example task with attributes',
        priority: 'P2',
        complexity: 'S',
        estimate_hours: 2,
        tags: ['example', 'docs'],
        link_document: 'https://docs.example.com/example',
      },
    }))
    console.log('Created:', JSON.stringify(created, null, 2))

    // 3. task.update — change priority + tags, leave the rest untouched.
    console.log('\nUpdating priority to P0 and tags via task.update...')
    const updated = toolJson(await client.callTool({
      name: 'task.update',
      arguments: {
        project: PROJECT,
        key,
        priority: 'P0',
        tags: ['urgent', 'example', 'docs'],
      },
    }))
    console.log('Updated:', JSON.stringify(updated, null, 2))

    // 4. Partial update — only the estimate.
    console.log('\nUpdating estimate_hours to 4 via task.update...')
    const reEstimated = toolJson(await client.callTool({
      name: 'task.update',
      arguments: { project: PROJECT, key, estimate_hours: 4 },
    }))
    console.log('Estimate updated:', JSON.stringify(reEstimated, null, 2))
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
