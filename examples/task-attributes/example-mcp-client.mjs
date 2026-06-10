/**
 * example-mcp-client.mjs — Demonstrates setting task attributes via MCP.
 *
 * Usage:
 *   TASK_HUB_URL=http://localhost:3000 TASK_TOKEN=<token> node example-mcp-client.mjs
 */

const BASE = process.env.TASK_HUB_URL || 'http://localhost:3000'
const TOKEN = process.env.TASK_TOKEN || ''

if (!TOKEN) {
  console.error('TASK_TOKEN env var is required')
  process.exit(1)
}

// This is a simplified example showing the HTTP API equivalent.
// For real MCP, use the @modelcontextprotocol/sdk client.

async function main() {
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  }

  // Create a task with attributes
  console.log('Creating task with attributes...')
  const key = `TASK-EX-${Date.now().toString(36).toUpperCase()}`
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({
      project: 'test-project',
      key,
      title: 'Example task with attributes',
      priority: 'P2',
      complexity: 'S',
      estimate_hours: 2,
      tags: ['example', 'docs'],
      link_document: 'https://docs.example.com/example',
    }),
  })
  const body = await res.json()
  console.log('Created:', JSON.stringify(body.task, null, 2))

  // Update the task
  console.log('\nUpdating priority to P0...')
  const updateRes = await fetch(`${BASE}/api/tasks/${key}?project=test-project`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ priority: 'P0' }),
  })
  const updateBody = await updateRes.json()
  console.log('Updated:', JSON.stringify(updateBody.task, null, 2))
}

main().catch(console.error)
