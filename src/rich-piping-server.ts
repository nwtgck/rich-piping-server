import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as t from "io-ts";
import * as basicAuth from "basic-auth";

import {typeAssert} from "./utils";
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
        value: t.string,
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
export function generateHandler({pipingServer, configRef, useHttps}: {pipingServer: PipingServer, configRef: {ref?: Config | undefined}, useHttps: boolean}): Handler {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  return (req, res) => {
    const config = configRef.ref;
    if (config === undefined) {
      req.socket.end();
      return;
    }
    const allows = createAllows(config);
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
      const user = basicAuth(req);
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
