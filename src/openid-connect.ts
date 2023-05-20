import * as cookie from "cookie";
import {NormalizedConfig} from "./config/normalized-config";
import {OpenIdConnectUserStore} from "./OpenIdConnectUserStore";
import * as http from "http";
import * as http2 from "http2";
import {Logger} from "log4js";
import * as openidClient from "openid-client";


type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;

export async function handleOpenIdConnect({logger, openIdConnectUserStore, codeVerifier, codeChallenge, openIdClient, openidConnectConfig, req, res}: {
  logger: Logger | undefined,
  openIdClient: openidClient.BaseClient,
  codeVerifier: string,
  codeChallenge: string,
  openIdConnectUserStore: OpenIdConnectUserStore
  openidConnectConfig: NonNullable<NormalizedConfig["openid_connect"]>,
  req: HttpReq,
  res: HttpRes,
}): Promise<"authorized" | "responded"> {
  // Always set because config may be hot reloaded
  openIdConnectUserStore.setAgeSeconds(openidConnectConfig.session.age_seconds);
  const url = new URL(req.url!, `http://${req.headers.host}`);
  if (url.pathname === openidConnectConfig.redirect.path) {
    const params = openIdClient.callbackParams(req);
    let returnUrl: string | undefined;
    try {
      returnUrl = JSON.parse(params.state ?? "").return_url;
    } catch {

    }
    try {
      const tokenSet = await openIdClient.callback(openidConnectConfig.redirect.uri, params, {
        state: params.state,
        code_verifier: codeVerifier,
      });
      if (tokenSet.access_token === undefined) {
        res.writeHead(400);
        res.end("Access token not set\n");
        return "responded";
      }
      const userinfo = await openIdClient.userinfo(tokenSet.access_token);
      const allowedUserinfo = openidConnectConfig.allow_userinfos.find(u => {
        return "sub" in u && u.sub === userinfo.sub || "email" in u && u.email === userinfo.email;
      });
      if (allowedUserinfo === undefined) {
        res.writeHead(400, {"Content-Type": "text/plain"});
        res.end(`NOT allowed user\n`);
        return "responded";
      }
      const newSessionId = openIdConnectUserStore.setUserinfo(userinfo);
      const setCookieValue = cookie.serialize(openidConnectConfig.session.cookie.name, newSessionId, {
        httpOnly: openidConnectConfig.session.cookie.http_only,
        maxAge: openidConnectConfig.session.age_seconds,
      })
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": setCookieValue,
      });
      if (returnUrl === undefined) {
        res.end(`allowed: ${JSON.stringify(userinfo)}\n`);
      } else {
        // TODO: XSS OK?
        res.end(`<html><head><meta http-equiv="refresh" content=0;url=${JSON.stringify(returnUrl)}></head></html>`);
      }
    } catch (err: unknown) {
      logger?.info(err);
      res.writeHead(400);
      res.end();
    }
    return "responded";
  }
  const parsedCookie = cookie.parse(req.headers.cookie ?? "");
  const sessionId: string | undefined = parsedCookie[openidConnectConfig.session.cookie.name];
  if (sessionId === undefined || !openIdConnectUserStore.isValidSessionId(sessionId)) {
    // Start authorization request
    const authorizationUrl = openIdClient.authorizationUrl({
      scope: "openid email",
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: JSON.stringify({
        return_url: new URL(req.url!, `http://${req.headers["x-forwarded-for"] ?? req.headers.host}`),
      }),
    });
    res.writeHead(302, {Location: authorizationUrl});
    res.end();
    return "responded";
  }
  return "authorized";
}
