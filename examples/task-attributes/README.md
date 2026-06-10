# Task Attributes — MCP Client Example

This example demonstrates how to use the MCP client to create and update task
attributes via the `task.create` and `task.update` tools.

## Prerequisites

- A running agentic-kanban server with MCP endpoint.
- A valid bearer token (obtain via the sign-in flow or `POST /api/tokens`).

## Example: Create a task with attributes

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp'),
  { requestInit: { headers: { Authorization: 'Bearer YOUR_TOKEN' } } }
)
const client = new Client({ name: 'example-client', version: '1.0.0' })
await client.connect(transport)

// Create a task with attributes
const createResult = await client.callTool({
  name: 'task.create',
  arguments: {
    project: 'my-project',
    key: 'TASK-100',
    title: 'Add search functionality',
    priority: 'P1',
    complexity: 'L',
    estimate_hours: 16,
    tags: ['feature', 'search', 'backend'],
    link_document: 'https://docs.example.com/search-spec',
  },
})
console.log('Created:', JSON.parse(createResult.content[0].text))
```

## Example: Update task attributes

```javascript
// Update just the priority and tags
const updateResult = await client.callTool({
  name: 'task.update',
  arguments: {
    project: 'my-project',
    key: 'TASK-100',
    priority: 'P0',
    tags: ['urgent', 'feature', 'search', 'backend'],
  },
})
console.log('Updated:', JSON.parse(updateResult.content[0].text))
```

## Example: Partial update (single field)

```javascript
// Just update estimate
const estResult = await client.callTool({
  name: 'task.update',
  arguments: {
    project: 'my-project',
    key: 'TASK-100',
    estimate_hours: 24,
  },
})
console.log('Estimate updated:', JSON.parse(estResult.content[0].text))
```
