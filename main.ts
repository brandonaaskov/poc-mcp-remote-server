import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts"

// Load environment variables
await load()

const HOST = Deno.env.get("HOST") || "http://localhost"
const PORT = parseInt(Deno.env.get("PORT") || "3000")
const BASE_URL = `${HOST}:${PORT}`

// Helper function to safely extract error messages
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return "An unknown error occurred"
}

// OAuth state storage (in-memory for POC)
const clients = new Map()
const authorizationCodes = new Map()
const accessTokens = new Map()

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
                            message: getErrorMessage(error),
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

// Generate random string for client IDs, codes, and tokens
function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Main server
Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url)
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers })
  }
  
  // OAuth endpoints
  if (url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
    // Step 1: Metadata discovery
    return new Response(JSON.stringify({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      registration_endpoint: `${BASE_URL}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
    }), { headers })
  }
  
  if (url.pathname === "/oauth/register" && req.method === "POST") {
    // Step 2: Client registration
    const body = await req.json()
    const clientId = generateRandomString(32)
    const clientSecret = generateRandomString(48)
    
    clients.set(clientId, {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: body.redirect_uris || [],
    })
    
    return new Response(JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: body.redirect_uris || [],
    }), { headers })
  }
  
  if (url.pathname === "/oauth/authorize" && req.method === "GET") {
    // Step 3 & 4: Authorization request
    const clientId = url.searchParams.get("client_id")
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")
    
    if (!clientId || !clients.has(clientId)) {
      return new Response("Invalid client", { status: 400 })
    }
    
    // Generate authorization code
    const code = generateRandomString(32)
    authorizationCodes.set(code, {
      client_id: clientId,
      redirect_uri: redirectUri,
      expires_at: Date.now() + 600000, // 10 minutes
    })
    
    // For POC, auto-approve and redirect with code
    const redirectUrl = new URL(redirectUri!)
    redirectUrl.searchParams.set("code", code)
    if (state) {
      redirectUrl.searchParams.set("state", state)
    }
    
    return Response.redirect(redirectUrl.toString(), 302)
  }
  
  if (url.pathname === "/oauth/token" && req.method === "POST") {
    // Step 5: Token exchange
    const body = await req.formData()
    const grantType = body.get("grant_type")
    const code = body.get("code")
    const clientId = body.get("client_id")
    const clientSecret = body.get("client_secret")
    
    if (grantType !== "authorization_code") {
      return new Response(JSON.stringify({
        error: "unsupported_grant_type",
      }), { status: 400, headers })
    }
    
    const codeData = authorizationCodes.get(code as string)
    if (!codeData || codeData.client_id !== clientId) {
      return new Response(JSON.stringify({
        error: "invalid_grant",
      }), { status: 400, headers })
    }
    
    const client = clients.get(clientId as string)
    if (!client || client.client_secret !== clientSecret) {
      return new Response(JSON.stringify({
        error: "invalid_client",
      }), { status: 401, headers })
    }
    
    // Generate access token
    const accessToken = generateRandomString(64)
    accessTokens.set(accessToken, {
      client_id: clientId,
      expires_at: Date.now() + 3600000, // 1 hour
    })
    
    // Clean up used authorization code
    authorizationCodes.delete(code as string)
    
    return new Response(JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
    }), { headers })
  }
  
  // SSE endpoint (protected)
  if (url.pathname === "/sse" && req.method === "POST") {
    // Check for authorization header
    const authHeader = req.headers.get("Authorization")
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7)
      const tokenData = accessTokens.get(token)
      
      if (!tokenData || tokenData.expires_at < Date.now()) {
        return new Response("Unauthorized", { status: 401 })
      }
    }
    
    return handleSSE(req)
  }
  
  return new Response("MCP Server - Use POST /sse for SSE transport", {
    status: 200,
  })
})

console.log(`MCP Server running on http://localhost:${PORT}`)
console.log(`SSE endpoint: http://localhost:${PORT}/sse`)
