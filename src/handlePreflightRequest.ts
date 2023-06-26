import {HttpReq, HttpRes} from "./HttpReqRes";

export function handlePreflightRequest(extraAccessControlAllowHeaders: readonly [string, ...string[]], req: HttpReq, res: HttpRes) {
  res.writeHead(200, {
    "Access-Control-Allow-Origin": '*',
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, Content-Disposition, X-Piping, ${extraAccessControlAllowHeaders.join(", ")}`,
    // Private Network Access preflights: https://developer.chrome.com/blog/private-network-access-preflight/
    ...(req.headers["access-control-request-private-network"] === "true" ? {
      "Access-Control-Allow-Private-Network": "true",
    }: {}),
    // Expose "Access-Control-Allow-Headers" for Web browser detecting X-Piping feature
    "Access-Control-Expose-Headers": "Access-Control-Allow-Headers",
    "Access-Control-Max-Age": 86400,
    "Content-Length": 0
  });
  res.end();
  return;
}
