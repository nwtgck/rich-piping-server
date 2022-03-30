#!/usr/bin/env node
// (from: https://qiita.com/takayukioda/items/a149bc2907ef77121229)

import * as fs from "fs";
import * as http from "http";
import * as http2 from "http2";
import * as tls from "tls";
import * as log4js from "log4js";
import * as yargs from "yargs";
import { z } from "zod";
import * as yaml from "js-yaml";
import * as piping from "piping-server";

import {generateHandler} from "./rich-piping-server";
import {configWihtoutVersionSchema} from "./config/without-version";
import {ConfigV1, configV1Schema, migrateToConfigV1} from "./config/v1";
import {configBasicSchema} from "./config/basic";


// Create option parser
const parser = yargs
  .option("host", {
    describe: "Bind address (e.g. 127.0.0.1, ::1)",
    type: "string",
  })
  .option("http-port", {
    describe: "Port of HTTP server",
    default: 8080
  })
  .option("enable-https", {
    describe: "Enable HTTPS",
    boolean: true,
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
  .option('config-path', {
    describe: "Config YAML path",
    type: "string",
    required: true,
  })
  .alias("config-path", "config-yaml-path")
  .command("migrate-config", "migrate an existing config to new one", (yargs) => {
  }, (argv) => {
    // TODO: impl
    console.log("migrate config", argv);
  });


// Parse arguments
const args = parser.parseSync(process.argv.slice(2));
const configRef: {ref?: ConfigV1} = { };
// Create a logger
const logger = log4js.getLogger();
logger.level = "info";

if (args._.length === 0) {
  serve({
    host: args["host"],
    httpPort: args["http-port"],
    enableHttps: args["enable-https"],
    httpsPort: args["https-port"],
    serverKeyPath:  args["key-path"],
    serverCrtPath: args["crt-path"],
    configYamlPath:  args["config-yaml-path"],
  });
}


function formatZodErrorPath(path: (string | number)[]): string {
  return `${path[0]}${path.splice(1).map(p => `[${JSON.stringify(p)}]`).join("")}`;
}

function logZodError<T>(zodError: z.ZodError<T>) {
  for (const issue of zodError.issues) {
    if (issue.code === "invalid_union") {
      for (const e of issue.unionErrors) {
        logZodError(e);
      }
      continue;
    }
    logger.error(`Config fix hint: ${formatZodErrorPath(issue.path)}: ${issue.message}`);
  }
}

function loadAndUpdateConfig(logger: log4js.Logger, configYamlPath: string): void {
  // Load config
  logger.info(`Loading ${JSON.stringify(configYamlPath)}...`);
  try {
    const configYaml = yaml.load(fs.readFileSync(configYamlPath, 'utf8'));
    // NOTE: using configBasicSchema makes error message better
    const configBasicParsed = configBasicSchema.safeParse(configYaml);
    if (!configBasicParsed.success) {
      logZodError(configBasicParsed.error);
      return;
    }
    if (configBasicParsed.data.version === undefined) {
      logger.warn("config format is old");
      const configWithoutVersionParsed = configWihtoutVersionSchema.safeParse(configYaml);
      if (!configWithoutVersionParsed.success) {
        logZodError(configWithoutVersionParsed.error);
        return;
      }
      configRef.ref = migrateToConfigV1(configWithoutVersionParsed.data);
    }
    if (configBasicParsed.data.version === "1" || configBasicParsed.data.version === 1) {
      const configParsed = configV1Schema.safeParse(configYaml);
      if (!configParsed.success) {
        logZodError(configParsed.error);
        return;
      }
      configRef.ref = configParsed.data;
    }
    logger.info(`${JSON.stringify(configYamlPath)} is loaded successfully`);
  } catch (err) {
    logger.error("Failed to load config", err);
  }
}

function serve({ host, httpPort, enableHttps, httpsPort, serverKeyPath, serverCrtPath, configYamlPath }: {
  host: string | undefined,
  httpPort: number,
  enableHttps: boolean,
  httpsPort: number | undefined,
  serverKeyPath: string | undefined,
  serverCrtPath: string | undefined,
  configYamlPath: string,
}) {
// Load config
  loadAndUpdateConfig(logger, configYamlPath);

// Watch config yaml
  fs.watch(configYamlPath, () => {
    loadAndUpdateConfig(logger, configYamlPath);
  });

// Create a piping server
  const pipingServer = new piping.Server({logger});

  http.createServer(generateHandler({pipingServer, configRef, useHttps: false}))
    .listen({ host, port: httpPort }, () => {
      logger.info(`Listen HTTP on ${httpPort}...`);
    });

  if (enableHttps) {
    if (httpsPort === undefined) {
      logger.error("--https-port is required");
      process.exit(1);
    }
    if (serverKeyPath === undefined) {
      logger.error("--key-path is required");
      process.exit(1);
    }
    if (serverCrtPath === undefined) {
      logger.error("--crt-path is required");
      process.exit(1);
    }

    let secureContext: tls.SecureContext | undefined;
    const updateSecureContext = () => {
      try {
        secureContext = tls.createSecureContext({
          key: fs.readFileSync(serverKeyPath),
          cert: fs.readFileSync(serverCrtPath),
        });
        logger.info("Certificate loaded");
      } catch (e) {
        logger.error("Failed to load certificate", e);
      }
    }
    updateSecureContext();
    if (secureContext === undefined) {
      throw new Error("No certificate");
    }
    fs.watchFile(serverCrtPath, updateSecureContext);
    fs.watchFile(serverKeyPath, updateSecureContext);

    http2.createSecureServer(
      {
        SNICallback: (servername, cb) => cb(null, secureContext!),
        allowHTTP1: true
      },
      generateHandler({pipingServer, configRef, useHttps: true})
    ).listen({ host, port: httpsPort }, () => {
      logger.info(`Listen HTTPS on ${httpsPort}...`);
    });
  }

// Catch and ignore error
  process.on("uncaughtException", (err) => {
    logger.error("on uncaughtException", err);
  });
}
