export async function handler(event) {
  const path = event.rawPath ?? "/";
  const method = event.requestContext?.http?.method ?? "GET";

  if (method === "GET" && path === "/health") {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, agent_id: "aws-nova" }),
    };
  }

  return {
    statusCode: 501,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      error: {
        code: "not_implemented",
        message:
          "aws-nova handler deployment is provisioned; runtime implementation lands in follow-up issues",
      },
    }),
  };
}
