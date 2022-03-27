import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as basicAuth from "basic-auth";

import {typeAssert} from "./utils";
import {fakeNginxResponse} from "./fake-nginx-response";
import {ConfigV1} from "./config/v1";


type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

function createAllows(config: ConfigV1): (req: HttpReq) => boolean {
  return (req) => {
    const allowsPath: boolean = config.allow_paths.some(path => {
      if (typeof path === "string") {
        return req.url === path;
      }
      typeAssert<"regexp">(path.type);
      const r = new RegExp(path.value);
      return req.url?.match(r) ?? false;
    });
    return allowsPath;
  };
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
    const allows = createAllows(config);
    if (!allows(req)) {
      if (config.rejection === 'socket_close') {
        req.socket.end();
        return;
      }
      if (config.rejection === 'fake_nginx_down' || config.rejection.type === 'fake_nginx_down') {
        const nginxVersion = (typeof config.rejection === "object" && "type" in config.rejection) && config.rejection.type === 'fake_nginx_down' ? config.rejection.nginx_version : defaultFakeNginxVersion;
        fakeNginxResponse(res, nginxVersion, req.headers["user-agent"] ?? "");
        return;
      }
      throw Error('never reach');
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

    pipingHandler(req, res);
  };
}
