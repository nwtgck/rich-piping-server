import * as http from "http";
import * as http2 from "http2";
import {Server as PipingServer} from "piping-server";
import * as t from "io-ts";

type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

const socketCloseRejectionType = t.literal('socket-close');
const rejectionType = socketCloseRejectionType;

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
    // TODO: handle basic auth
    return allowsPath;
  };
}

export function generateHandler({pipingServer, config, useHttps}: {pipingServer: PipingServer, config: Config, useHttps: boolean}): Handler {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  const allows = createAllows(config);
  return (req, res) => {
    if (!allows(req)) {
      if (config.rejection === 'socket-close') {
        req.socket.end();
        return;
      }
      throw Error('never reach');
    }
    pipingHandler(req, res);
  };
}
