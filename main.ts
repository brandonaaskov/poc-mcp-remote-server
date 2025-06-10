import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts"

// Load environment variables
await load()

const PORT = parseInt(Deno.env.get("PORT") || "3000")

// MCP server state
const serverInfo = {
  name: "poc-mcp-server",
  version: "1.0.0",
}

const tools = [
  {
    name: "echo",
    description: "Echo back the provided message",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message to echo back",
        },
      },
      required: ["message"],
    },
  },
]

// Handle tool calls
function handleToolCall(name: string, arguments_: any) {
  if (name === "echo") {
    return {
      content: [
        {
          type: "text",
          text: `Echo: ${arguments_.message}`,
        },
      ],
    }
  }
  
  throw new Error(`Unknown tool: ${name}`)
}

// SSE handler
async function handleSSE(req: Request): Promise<Response> {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      
      // Send initial connection message
      controller.enqueue(encoder.encode("data: " + JSON.stringify({
        jsonrpc: "2.0",
        method: "connection_established",
      }) + "\n\n"))
      
      // Process incoming messages
      req.body?.pipeThrough(new TextDecoderStream()).pipeTo(
        new WritableStream({
          write(chunk) {
            try {
              const lines = chunk.trim().split("\n")
              
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const data = JSON.parse(line.slice(6))
                  
                  // Handle different message types
                  let response: any
                  
                  switch (data.method) {
                    case "initialize":
                      response = {
                        jsonrpc: "2.0",
                        id: data.id,
                        result: {
                          protocolVersion: "2024-11-05",
                          capabilities: {
                            tools: {},
                          },
                          serverInfo,
                        },
                      }
                      break
                      
                    case "tools/list":
                      response = {
                        jsonrpc: "2.0",
                        id: data.id,
                        result: { tools },
                      }
                      break
                      
                    case "tools/call":
                      try {
                        const result = handleToolCall(
                          data.params.name,
                          data.params.arguments
                        )
                        response = {
                          jsonrpc: "2.0",
                          id: data.id,
                          result,
                        }
                      } catch (error) {
                        response = {
                          jsonrpc: "2.0",
                          id: data.id,
                          error: {
                            code: -32603,
                            message: error.message,
                          },
                        }
                      }
                      break
                      
                    default:
                      response = {
                        jsonrpc: "2.0",
                        id: data.id,
                        error: {
                          code: -32601,
                          message: `Method not found: ${data.method}`,
                        },
                      }
                  }
                  
                  if (response) {
                    controller.enqueue(
                      encoder.encode("data: " + JSON.stringify(response) + "\n\n")
                    )
                  }
                }
              }
            } catch (error) {
              console.error("Error processing message:", error)
            }
          },
        })
      )
    },
  })
  
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}

// Main server
Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url)
  
  if (url.pathname === "/sse" && req.method === "POST") {
    return handleSSE(req)
  }
  
  return new Response("MCP Server - Use POST /sse for SSE transport", {
    status: 200,
  })
})

console.log(`MCP Server running on http://localhost:${PORT}`)
console.log(`SSE endpoint: http://localhost:${PORT}/sse`)
