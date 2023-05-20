import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as basicAuth from "basic-auth";

import {fakeNginxResponse} from "./fake-nginx-response";
import {type NormalizedConfig} from "./config/normalized-config";
import * as log4js from "log4js";
import * as openidClient from "openid-client";
import {ConfigRef} from "./ConfigRef";
import {OpenIdConnectUserStore} from "./OpenIdConnectUserStore";
import {handleOpenIdConnect} from "./openid-connect";

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
      const result: "authorized" | "responded" = await handleOpenIdConnect({
        logger,
        openIdClient: await configRef.openidClientPromise!,
        codeVerifier,
        codeChallenge,
        openIdConnectUserStore,
        openidConnectConfig: config.openid_connect,
        req,
        res,
      });
      switch (result) {
        case "responded":
          return;
        case "authorized":
          break;
        default:
          const exhaustiveCheck: never = result;
          throw new Error(`unexpected result: ${exhaustiveCheck}`);
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
