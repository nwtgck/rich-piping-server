#!/usr/bin/env node
// (from: https://qiita.com/takayukioda/items/a149bc2907ef77121229)

import * as fs from "fs";
import * as http from "http";
import * as http2 from "http2";
import * as log4js from "log4js";
import * as yargs from "yargs";
import { z } from "zod";
import * as yaml from "js-yaml";
import * as piping from "piping-server";

import {Config, configSchema, generateHandler} from "./rich-piping-server";


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

const configRef: {ref?: Config} = { };

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
    logger.error(`Config load error: ${formatZodErrorPath(issue.path)}: ${issue.message}`);
  }
}

function loadAndUpdateConfig(logger: log4js.Logger,configYamlPath: string): void {
  // Load config
  logger.info(`Loading ${JSON.stringify(configYamlPath)}...`);
  try {
    const configYaml = yaml.load(fs.readFileSync(configYamlPath, 'utf8'));
    const configParsed = configSchema.safeParse(configYaml);
    if (!configParsed.success) {
      logZodError(configParsed.error);
      return;
    }
    // Update config
    configRef.ref = configParsed.data;
    logger.info(`${JSON.stringify(configYamlPath)} is loaded successfully`);
  } catch (err) {
    logger.error("Failed to load config", err);
  }
}

// Create a logger
const logger = log4js.getLogger();
logger.level = "info";

// Load config
loadAndUpdateConfig(logger, configYamlPath);

// Watch config yaml
fs.watch(configYamlPath, () => {
  loadAndUpdateConfig(logger, configYamlPath);
});

// Create a piping server
const pipingServer = new piping.Server({logger});

http.createServer(generateHandler({pipingServer, configRef, useHttps: false}))
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
      generateHandler({pipingServer, configRef, useHttps: true})
    ).listen(httpsPort, () => {
      logger.info(`Listen HTTPS on ${httpsPort}...`);
    });
  }
}

// Catch and ignore error
process.on("uncaughtException", (err) => {
  logger.error("on uncaughtException", err);
});
