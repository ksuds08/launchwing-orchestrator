export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export function withReqId<T extends (req: Request, ...args: any[]) => Promise<Response>>(
  handler: T
) {
  return async (req: Request, ...rest: any[]) => {
    const reqId = crypto.randomUUID();
    const res = await handler(req, ...rest);
    const headers = new Headers(res.headers);
    headers.set("x-request-id", reqId);
    return new Response(await res.text(), { status: res.status, headers });
  };
}