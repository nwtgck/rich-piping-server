import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as basicAuth from "basic-auth";
import * as cookie from "cookie";

import {fakeNginxResponse} from "./fake-nginx-response";
import {type NormalizedConfig} from "./config/normalized-config";
import * as log4js from "log4js";
import * as openidClient from "openid-client";
import {ConfigRef} from "./ConfigRef";
import {OpenIdConnectUserStore} from "./OpenIdConnectUserStore";

type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type RichPipingServer = (req: HttpReq, res: HttpRes) => void;

type AllowPath = NonNullable<NormalizedConfig["allow_paths"]>[number];

export function generateHandler({pipingServer, configRef, logger, useHttps}: {pipingServer: PipingServer, configRef: ConfigRef, logger?: log4js.Logger, useHttps: boolean}): RichPipingServer {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  const codeVerifier = openidClient.generators.codeVerifier();
  const codeChallenge = openidClient.generators.codeChallenge(codeVerifier);
  const openIdConnectUserStore = new OpenIdConnectUserStore();
  return async (req, res) => {
    const config = configRef.get();
    if (config === undefined) {
      logger?.error("requested but config not loaded");
      req.socket.end();
      return;
    }
    const allowedPathOrAlwaysAllowed: AllowPath | { type: "always_allowed" } | { type: "rejected" } = getAllowedPathOrReject(config, req, res);
    if ( allowedPathOrAlwaysAllowed.type === "rejected" ) {
      return;
    }
    // Basic auth is enabled and denied
    if (config.basic_auth_users !== undefined && handleBasicAuth(config.basic_auth_users, req, res) === "denied") {
      return
    }
    if (config.openid_connect !== undefined) {
      // Always set because config may be hot reloaded
      openIdConnectUserStore.setAgeSeconds(config.openid_connect.session.age_seconds);
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const client = await configRef.openidClientPromise!;
      if (url.pathname === config.openid_connect.redirect.path) {
        const params = client.callbackParams(req);
        let returnUrl: string | undefined;
        try {
          returnUrl = JSON.parse(params.state ?? "").return_url;
        } catch {

        }
        try {
          const tokenSet = await client.callback(config.openid_connect.redirect.uri, params, {
            state: params.state,
            code_verifier: codeVerifier,
          });
          if (tokenSet.access_token === undefined) {
            res.writeHead(400);
            res.end("Access token not set\n");
            return;
          }
          const userinfo = await client.userinfo(tokenSet.access_token);
          const allowedUserinfo = config.openid_connect.allow_userinfos.find(u => {
            return "sub" in u && u.sub === userinfo.sub || "email" in u && u.email === userinfo.email;
          });
          if (allowedUserinfo === undefined) {
            res.writeHead(400, {"Content-Type": "text/plain"});
            res.end(`NOT allowed user\n`);
          } else {
            const newSessionId = openIdConnectUserStore.setUserinfo(userinfo);
            const setCookieValue = cookie.serialize(config.openid_connect.session.cookie.name, newSessionId, {
              httpOnly: config.openid_connect.session.cookie.http_only,
              maxAge: config.openid_connect.session.age_seconds,
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
          }
        } catch (err: unknown) {
          logger?.info(err);
          res.writeHead(400);
          res.end();
        }
        return;
      }
      const parsedCookie = cookie.parse(req.headers.cookie ?? "");
      const sessionId: string | undefined = parsedCookie[config.openid_connect.session.cookie.name];
      if (sessionId === undefined || !openIdConnectUserStore.isValidSessionId(sessionId)) {
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
        return;
      }
    }
    // Rewrite path for index
    // NOTE: may support "X-Forwarded-Prefix" in the future to tell original path
    if (allowedPathOrAlwaysAllowed.type === "index") {
      if (req.url === allowedPathOrAlwaysAllowed.value) {
        req.url = "/";
      } else {
        req.url = req.url?.substring(allowedPathOrAlwaysAllowed.value.length);
      }
    }

    pipingHandler(req, res);
  };
}

function normalizePath(path: string): string {
  return path.endsWith("/") ? path : path + "/";
}

function findAllowedPath(configAllowPaths: readonly AllowPath[], req: HttpReq): AllowPath | undefined {
  // TODO: consider query parameter
  const reqUrl = req.url;
  if (reqUrl === undefined) {
    return undefined;
  }
  return configAllowPaths.find(path => {
    if (path.type === "path") {
      return reqUrl === path.value;
    }
    if (path.type === "regexp") {
      const r = new RegExp(path.value);
      return reqUrl.match(r) ?? false;
    }
    if (path.type === "index") {
      const reqUrlNormalized = normalizePath(reqUrl);
      const newIndexNormalized = normalizePath(path.value);
      return reqUrlNormalized.startsWith(newIndexNormalized);
    }
    // exhaustive check
    throw new Error(`unknown path type: ${(path as { type: never }).type}`);
  });
}

function basicAuthDenied(res: HttpRes) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="example"'
  });
  res.end("Access denied\n");
}

function getAllowedPathOrReject(config: NormalizedConfig, req: HttpReq, res: HttpRes): AllowPath | { type: "always_allowed" } | { type: "rejected" } {
  let allowedPathOrAlwaysAllowed: AllowPath | { type: "always_allowed" };
  if (config.allow_paths === undefined) {
    allowedPathOrAlwaysAllowed = { type: "always_allowed" };
  } else {
    const allowedPath = findAllowedPath(config.allow_paths, req);
    if (req.url === undefined || allowedPath === undefined) {
      if (config.rejection.type === 'socket_close') {
        req.socket.end();
        return { type: "rejected" };
      }
      if (config.rejection.type === "fake_nginx_down") {
        fakeNginxResponse(res, config.rejection.nginx_version, req.headers["user-agent"] ?? "");
        return { type: "rejected" };
      }
      // exhaustive check
      throw Error(`unknown rejection type: ${(config.rejection as { type: never }).type}`);
    }
    allowedPathOrAlwaysAllowed = allowedPath;
  }
  return allowedPathOrAlwaysAllowed;
}

function handleBasicAuth(basicAuthUsers: NonNullable<NormalizedConfig["basic_auth_users"]>, req: HttpReq, res: HttpRes): "allowed" | "denied" {
  const user = basicAuth(req);
  if (user === undefined) {
    basicAuthDenied(res);
    return "denied";
  }
  const {name, pass} = user;
  const allowsUser = basicAuthUsers.some(({username, password}) =>
    username === name && password === pass
  );
  if (!allowsUser) {
    basicAuthDenied(res);
    return "denied";
  }
  return "allowed"
}
