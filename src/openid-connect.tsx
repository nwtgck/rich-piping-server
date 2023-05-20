import * as cookie from "cookie";
import {NormalizedConfig} from "./config/normalized-config";
import {OpenIdConnectUserStore} from "./OpenIdConnectUserStore";
import * as http from "http";
import * as http2 from "http2";
import {Logger} from "log4js";
import * as openidClient from "openid-client";
import { h } from 'preact';
import {renderToString} from "preact-render-to-string";


type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;

export async function handleOpenIdConnect({logger, openIdConnectUserStore, codeVerifier, codeChallenge, client, openidConnectConfig, req, res}: {
  logger: Logger | undefined,
  client: openidClient.BaseClient,
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
    const params = client.callbackParams(req);
    let returnUrl: string | undefined;
    try {
      returnUrl = JSON.parse(params.state ?? "").return_url;
    } catch {

    }
    try {
      const tokenSet = await client.callback(openidConnectConfig.redirect.uri, params, {
        state: params.state,
        code_verifier: codeVerifier,
      });
      if (tokenSet.access_token === undefined) {
        res.writeHead(400);
        res.end("Access token not set\n");
        return "responded";
      }
      const userinfo = await client.userinfo(tokenSet.access_token);
      if (!userinfoIsAllowed(openidConnectConfig.allow_userinfos, userinfo)) {
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
        res.end(renderToString(
          <html>
          <head>
            <meta http-equiv="refresh" content={`0;${returnUrl}`}></meta>
          </head>
          </html>
        ));
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
  if (sessionId === undefined) {
    startAuthorization(client, codeChallenge, req, res);
    return "responded";
  }
  const userinfo = openIdConnectUserStore.findValidUserInfo(sessionId);
  if (userinfo === undefined) {
    startAuthorization(client, codeChallenge, req, res);
    return "responded";
  }
  if (!userinfoIsAllowed(openidConnectConfig.allow_userinfos, userinfo)) {
    res.writeHead(400, {"Content-Type": "text/plain"});
    res.end(`NOT allowed user: ${JSON.stringify(userinfo)}\n`);
    return "responded";
  }
  return "authorized";
}

function userinfoIsAllowed(allowUserinfos: NonNullable<NormalizedConfig["openid_connect"]>["allow_userinfos"], userinfo: { sub?: string, email?: string }): boolean {
  const allowedUserinfo = allowUserinfos.find(u => {
    return "sub" in u && u.sub === userinfo.sub || "email" in u && u.email === userinfo.email;
  });
  return allowedUserinfo !== undefined;
}

// usually go to login page
function startAuthorization(client: openidClient.BaseClient, codeChallenge: string, req: HttpReq, res: HttpRes) {
  // Start authorization request
  const authorizationUrl = client.authorizationUrl({
    scope: "openid email",
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: JSON.stringify({
      return_url: new URL(req.url!, `http://${req.headers["x-forwarded-for"] ?? req.headers.host}`),
    }),
  });
  res.writeHead(302, {Location: authorizationUrl});
  res.end();
}
