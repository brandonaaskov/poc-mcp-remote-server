# MCP Remote Server POC

A proof-of-concept implementation of a Model Context Protocol (MCP) server with OAuth 2.0 authentication support and streamable HTTP transport, built with Deno.

## Features

- MCP protocol version 2025-03-26 implementation
- OAuth 2.0 authorization flow with dynamic client registration
- Streamable HTTP transport with support for both JSON-RPC and JSONL
- Built-in "echo" tool for testing
- CORS support for browser-based clients

## Prerequisites

- [Deno](https://deno.land/) (latest version)
- Node.js (for running the MCP Inspector)

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd poc-mcp-remote-server
```

2. Create a `.env` file (optional):
```bash
HOST=http://localhost
PORT=3000
```

## Running the Server

Start the MCP server:
```bash
deno task start
# or
deno task dev
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

## Testing with MCP Inspector

The MCP Inspector is a tool for testing and debugging MCP servers. To use it:

1. In a separate terminal, run:
```bash
deno task inspector
```

2. In the Inspector UI:
   - Enter your server URL: `http://localhost:3000/mcp`
   - Click "Connect" to establish a connection
   - Test the available tools and endpoints

## API Endpoints

### MCP Endpoints

- `GET /` or `GET /mcp` - Server information
- `POST /` or `POST /mcp` - MCP protocol endpoint (supports both JSON-RPC and JSONL)

### OAuth 2.0 Endpoints

- `GET /.well-known/oauth-authorization-server` - OAuth server metadata
- `POST /oauth/register` - Dynamic client registration
- `GET /oauth/authorize` - Authorization endpoint
- `POST /oauth/token` - Token exchange endpoint

## OAuth 2.0 Flow

1. **Discover OAuth metadata**:
   ```bash
   curl http://localhost:3000/.well-known/oauth-authorization-server
   ```

2. **Register a client**:
   ```bash
   curl -X POST http://localhost:3000/oauth/register \
     -H "Content-Type: application/json" \
     -d '{"redirect_uris": ["http://localhost:8080/callback"]}'
   ```

3. **Authorize** (visit in browser):
   ```
   http://localhost:3000/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:8080/callback&response_type=code&state=random_state
   ```

4. **Exchange code for token**:
   ```bash
   curl -X POST http://localhost:3000/oauth/token \
     -d "grant_type=authorization_code" \
     -d "code=YOUR_AUTH_CODE" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET"
   ```

5. **Use the access token** for authenticated MCP requests:
   ```bash
   curl -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}'
   ```

## Available MCP Methods

- `initialize` - Initialize the MCP connection
- `tools/list` - List available tools
- `tools/call` - Execute a tool
- `completions/list` - List available completions (empty in this POC)

## Built-in Tools

### Echo Tool
Echoes back the provided message.

Example:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "echo",
    "arguments": {
      "message": "Hello, MCP!"
    }
  }
}
```

## Transport Formats

The server supports two content types:

1. **JSON-RPC** (`application/json`):
   - Single or batch requests
   - Synchronous request/response

2. **JSONL** (`application/jsonl` or `application/x-ndjson`):
   - Streaming line-delimited JSON
   - Each line is a separate JSON-RPC message

## Development

Run tests:
```bash
deno test
```

## Notes

This is a proof-of-concept implementation. For production use, consider:
- Persistent storage for OAuth clients and tokens
- Proper token expiration and refresh handling
- Rate limiting and security hardening
- Additional MCP tools and capabilities
- Comprehensive error handling and logging