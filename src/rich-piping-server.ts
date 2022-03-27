import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import { z } from "zod";
import * as basicAuth from "basic-auth";

import {typeAssert} from "./utils";
import {fakeNginxResponse} from "./fake-nginx-response";


type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

const socketCloseRejectionSchema = z.literal('socket-close');
const nginxDownRejectionSchema = z.union([
  z.literal('nginx-down'),
  z.object({
    type: z.literal('nginx-down'),
    nginxVersion: z.string(),
  })
]);
const rejectionSchema = z.union([socketCloseRejectionSchema, nginxDownRejectionSchema]);

export const configSchema = z.object({
  basicAuthUsers: z.union([
    z.array(z.object({
      username: z.string(),
      password: z.string(),
    })),
    z.undefined(),
  ]),
  allowPaths: z.array(
    z.union([
      z.string(),
      z.object({
        type: z.literal('regexp'),
        value: z.string(),
      })
    ])
  ),
  rejection: rejectionSchema,
});

export type Config = z.infer<typeof configSchema>;

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
