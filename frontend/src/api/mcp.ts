/** Verify the same token/transport an external client uses, without reading work. */
export async function testMcpConnection(path: string, token: string): Promise<number> {
  let protocolVersion = "2025-06-18";
  async function request(id: number, method: string, params: object = {}) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": protocolVersion,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) throw new Error("Token rejected. Create a new token and check that your account and Projects access are active.");
    if (!response.ok) throw new Error(`Connection failed (${response.status}). Try again or ask an administrator to check the MCP endpoint.`);
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The endpoint returned a webpage instead of MCP. Check the server URL and proxy configuration.");
    const reply = await response.json();
    if (reply.error || !reply.result) throw new Error("The server could not complete the MCP request. Ask an administrator to check the endpoint.");
    return reply.result;
  }
  const initialized = await request(1, "initialize", {
    protocolVersion, capabilities: {}, clientInfo: { name: "company-tools-connection-check", version: "1" },
  });
  protocolVersion = initialized.protocolVersion;
  const result = await request(2, "tools/list");
  if (!Array.isArray(result.tools) || !result.tools.length) throw new Error("Connected, but no project tools were returned.");
  return result.tools.length;
}
