import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as basicAuth from "basic-auth";

import {fakeNginxResponse} from "./fake-nginx-response";
import {ConfigV1} from "./config/v1";


type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

type AllowPath = NonNullable<ConfigV1["allow_paths"]>[number];

function normalizePath(path: string): string {
  return path.endsWith("/") ? path : path + "/";
}

function findAllowedPath(configAllowPaths: readonly AllowPath[], req: HttpReq): AllowPath | undefined {
  const reqUrl = req.url;
  if (reqUrl === undefined) {
    return undefined;
  }
  return configAllowPaths.find(path => {
    if (typeof path === "string") {
      return reqUrl === path;
    }
    if ("regexp" in path) {
      const r = new RegExp(path.regexp);
      return reqUrl.match(r) ?? false;
    }
    const reqUrlNormalized = normalizePath(reqUrl);
    const newIndexNormalized = normalizePath(path.new_index);
    return reqUrlNormalized.startsWith(newIndexNormalized);
  });
}

function basicAuthDenied(res: HttpRes) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="example"'
  });
  res.end("Access denied\n");
}

const defaultFakeNginxVersion = "1.17.8";
export function generateHandler({pipingServer, configRef, useHttps}: {pipingServer: PipingServer, configRef: {ref?: ConfigV1 | undefined}, useHttps: boolean}): Handler {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  return (req, res) => {
    const config = configRef.ref;
    if (config === undefined) {
      req.socket.end();
      return;
    }
    let allowedPathOrAlwaysAllowed: AllowPath | { "always_allowed": undefined };
    if (config.allow_paths === undefined) {
      allowedPathOrAlwaysAllowed = { "always_allowed": undefined };
    } else {
      const allowedPath = findAllowedPath(config.allow_paths, req);
      if (req.url === undefined || allowedPath === undefined) {
        if (config.rejection === 'socket_close') {
          req.socket.end();
          return;
        }
        if (config.rejection === 'fake_nginx_down' || "fake_nginx_down" in config.rejection) {
          const nginxVersion = (typeof config.rejection === "object" && "fake_nginx_down" in config.rejection) ? config.rejection.fake_nginx_down.nginx_version : defaultFakeNginxVersion;
          fakeNginxResponse(res, nginxVersion, req.headers["user-agent"] ?? "");
          return;
        }
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
    if (typeof allowedPathOrAlwaysAllowed !== "string" && "new_index" in allowedPathOrAlwaysAllowed) {
      if (req.url === allowedPathOrAlwaysAllowed.new_index) {
        req.url = "/";
      } else {
        req.url = req.url?.substring(allowedPathOrAlwaysAllowed.new_index.length);
      }
    }

    pipingHandler(req, res);
  };
}
