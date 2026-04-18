const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/":
      case "/health":
        return json({
          status: "ok",
          service: "typing-race-api",
          milestone: "M0",
          time: new Date().toISOString(),
        });

      default:
        return json({ error: "not_found", path: url.pathname }, 404);
    }
  },
} satisfies ExportedHandler;
