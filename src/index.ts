#!/usr/bin/env node
// (from: https://qiita.com/takayukioda/items/a149bc2907ef77121229)

import * as fs from "fs";
import * as http from "http";
import * as http2 from "http2";
import * as log4js from "log4js";
import * as yargs from "yargs";
import * as t from "io-ts";
import { Either } from 'fp-ts/lib/Either'
import * as yaml from "js-yaml";
import * as piping from "piping-server";
import {Server as PipingServer} from "piping-server";

type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
type Handler = (req: HttpReq, res: HttpRes) => void;

function generateHandler({pipingServer, allows, useHttps, rejection}: {pipingServer: PipingServer, useHttps: boolean, allows: (req: HttpReq) => boolean, rejection: Rejection}): Handler {
  const pipingHandler = pipingServer.generateHandler(useHttps);
  return (req, res) => {
    if (!allows(req)) {
      if (rejection === 'socket-close') {
        req.socket.end();
        return;
      }
      throw Error('never reach');
    }
    pipingHandler(req, res);
  };
}

const socketCloseRejectionType = t.literal('socket-close');
const rejectionType = socketCloseRejectionType;
type Rejection = t.TypeOf<typeof rejectionType>;

const configType = t.type({
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

type Config = t.TypeOf<typeof configType>;

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

// Create option parser
const parser = yargs
  .option("http-port", {
    describe: "Port of HTTP server",
    default: 8080
  })
  .option("enable-https", {
    describe: "Enable HTTPS",
    default: false
  })
  .option("https-port", {
    describe: "Port of HTTPS server",
    type: "number"
  })
  .option("key-path", {
    describe: "Private key path",
    type: "string"
  })
  .option("crt-path", {
    describe: "Certification path",
    type: "string"
  })
  .option('config-yaml-path', {
    describe: "Config YAML path",
    type: "string",
    required: true,
  });

// Parse arguments
const args = parser.parse(process.argv);
const httpPort: number = args["http-port"];
const enableHttps: boolean = args["enable-https"];
const httpsPort: number | undefined = args["https-port"];
const serverKeyPath: string | undefined = args["key-path"];
const serverCrtPath: string | undefined = args["crt-path"];
const configYamlPath: string = args["config-yaml-path"];

// Load config
// TODO: any
const configYaml = yaml.safeLoad(fs.readFileSync(configYamlPath) as any, 'utf8' as any);
const configEither: Either<t.Errors, Config> = configType.decode(configYaml);
if (configEither._tag === "Left") {
  process.stderr.write("Config error found.\n");
  process.exit(1);
}
const config: Config = configEither.right;

// Create a logger
const logger = log4js.getLogger();
logger.level = "info";

// Create a piping server
const pipingServer = new piping.Server(logger);

// Create allows
const allows = createAllows(config);
const rejection = config.rejection;

http.createServer(generateHandler({pipingServer, allows, rejection, useHttps: false}))
  .listen(httpPort, () => {
    logger.info(`Listen HTTP on ${httpPort}...`);
  });

if (enableHttps && httpsPort !== undefined) {
  if (serverKeyPath === undefined || serverCrtPath === undefined) {
    logger.error("Error: --key-path and --crt-path should be specified");
  } else {
    http2.createSecureServer(
      {
        key: fs.readFileSync(serverKeyPath),
        cert: fs.readFileSync(serverCrtPath),
        allowHTTP1: true
      },
      generateHandler({pipingServer, allows, rejection, useHttps: true})
    ).listen(httpsPort, () => {
      logger.info(`Listen HTTPS on ${httpsPort}...`);
    });
  }
}

// Catch and ignore error
process.on("uncaughtException", (err) => {
  logger.error("on uncaughtException", err);
});
