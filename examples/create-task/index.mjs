#!/usr/bin/env node
/**
 * Example: Create a task via MCP client.
 *
 * Prerequisites:
 *   - MCP server running at MCP_SERVER_URL (default: http://localhost:3000/mcp)
 *   - Valid human token in KANBAN_TOKEN env var
 *
 * Usage:
 *   MCP_SERVER_URL=http://localhost:3000/mcp \
 *   KANBAN_TOKEN=<token> \
 *   node index.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000/mcp';
const TOKEN = process.env.KANBAN_TOKEN;

if (!TOKEN) {
  console.error('Error: KANBAN_TOKEN environment variable is required.');
  process.exit(1);
}

async function main() {
  console.log('Connecting to MCP server at', MCP_SERVER_URL);

  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_SERVER_URL),
    {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
        },
      },
    }
  );

  const client = new Client({
    name: 'create-task-example',
    version: '1.0.0',
  });

  await client.connect(transport);
  console.log('Connected to MCP server');

  // Generate unique task key
  const taskKey = `TASK-EXAMPLE-${Date.now().toString(36).toUpperCase()}`;

  console.log('Creating task...');
  const result = await client.callTool({
    name: 'task.create',
    arguments: {
      project: 'opf-hub',
      key: taskKey,
      title: 'Example task created via MCP',
      body_md: '## Purpose\nThis task was created using the MCP client example.\n\n## Scope\nDemonstrate task creation via MCP protocol.',
      repos: ['.'],
      allow_no_code_change: false,
    },
  });

  console.log('Task created:');
  if (result.content && result.content[0]) {
    const taskData = JSON.parse(result.content[0].text);
    console.log(JSON.stringify(taskData, null, 2));
  }

  await client.close();
  console.log('Disconnected from MCP server');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
