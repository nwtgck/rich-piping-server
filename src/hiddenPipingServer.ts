import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as t from "io-ts";
import * as basicAuth from "basic-auth";

import {fakeNginxResponse} from "./fake-nginx-response";


type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

const socketCloseRejectionType = t.literal('socket-close');
const nginxDownRejectionType = t.union([
  t.literal('nginx-down'),
  t.type({
    type: t.literal('nginx-down'),
    nginxVersion: t.string,
  })
]);
const rejectionType = t.union([socketCloseRejectionType, nginxDownRejectionType]);

export const configType = t.type({
  basicAuthUsers: t.union([
    t.array(t.type({
      username: t.string,
      password: t.string,
    })),
    t.undefined
  ]),
  allowPaths: t.array(
    t.union([
      t.string,
      t.type({
        type: t.literal('regexp'),
        regexp: t.string,
      })
    ])
  ),
  rejection: rejectionType,
});

export type Config = t.TypeOf<typeof configType>;

function createAllows(config: Config): (req: HttpReq) => boolean {
  return (req) => {
    const allowsPath: boolean = config.allowPaths.some(path => {
      if (typeof path === "string") {
        return req.url?.startsWith(path) ?? false;
      }
      // TODO: handle regexp
      return false;
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
export function generateHandler({pipingServer, config, useHttps}: {pipingServer: PipingServer, config: Config, useHttps: boolean}): Handler {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  const allows = createAllows(config);
  return (req, res) => {
    if (!allows(req)) {
      if (config.rejection === 'socket-close') {
        req.socket.end();
        return;
      }
      if (config.rejection === 'nginx-down' || config.rejection.type === 'nginx-down') {
        const nginxVersion = (typeof config.rejection === "object" && "type" in config.rejection) && config.rejection.type === 'nginx-down' ? config.rejection.nginxVersion : defaultFakeNginxVersion;
        fakeNginxResponse(res, nginxVersion, req.headers["user-agent"] ?? "");
        return;
      }
      throw Error('never reach');
    }
    // Basic auth is enabled
    if (config.basicAuthUsers !== undefined) {
      // TODO: this type assertion may not be safe. confirm later
      const user = basicAuth(req as http.IncomingMessage);
      if (user === undefined) {
        basicAuthDenied(res);
        return;
      }
      const {name, pass} = user;
      const allowsUser = config.basicAuthUsers.some(({username, password}) =>
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
