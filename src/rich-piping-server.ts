import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as basicAuth from "basic-auth";

import {fakeNginxResponse} from "./fake-nginx-response";
import {type NormalizedConfig} from "./config/normalized-config";
import * as log4js from "log4js";

type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

type AllowPath = NonNullable<NormalizedConfig["allow_paths"]>[number];

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

export function generateHandler({pipingServer, configRef, logger, useHttps}: {pipingServer: PipingServer, configRef: {ref?: NormalizedConfig | undefined}, logger?: log4js.Logger, useHttps: boolean}): Handler {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  return (req, res) => {
    const config = configRef.ref;
    if (config === undefined) {
      logger?.error("requested but config not loaded");
      req.socket.end();
      return;
    }
    let allowedPathOrAlwaysAllowed: AllowPath | { type: "always_allowed" };
    if (config.allow_paths === undefined) {
      allowedPathOrAlwaysAllowed = { type: "always_allowed" };
    } else {
      const allowedPath = findAllowedPath(config.allow_paths, req);
      if (req.url === undefined || allowedPath === undefined) {
        if (config.rejection.type === 'socket_close') {
          req.socket.end();
          return;
        }
        if (config.rejection.type === "fake_nginx_down") {
          fakeNginxResponse(res, config.rejection.nginx_version, req.headers["user-agent"] ?? "");
          return;
        }
        // TODO: 500 error
        throw Error('never reach');
      }
      allowedPathOrAlwaysAllowed = allowedPath;
    }
    // Basic auth is enabled
    if (config.basic_auth_users !== undefined) {
      const user = basicAuth(req);
      if (user === undefined) {
        basicAuthDenied(res);
        return;
      }
      const {name, pass} = user;
      const allowsUser = config.basic_auth_users.some(({username, password}) =>
        username === name && password === pass
      );
      if (!allowsUser) {
        basicAuthDenied(res);
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
