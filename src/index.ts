#!/usr/bin/env node
// (from: https://qiita.com/takayukioda/items/a149bc2907ef77121229)

import * as fs from "fs";
import * as http from "http";
import * as http2 from "http2";
import * as tls from "tls";
import * as log4js from "log4js";
import * as yargs from "yargs";
import { z } from "zod";
import * as piping from "piping-server";

import {generateHandler} from "./rich-piping-server";
import {configWihtoutVersionSchema} from "./config/without-version";
import {configV1Schema, migrateToConfigV1} from "./config/v1";
import {normalizeConfigV1} from "./config/normalized-config";
import {configBasicSchema} from "./config/basic";
import {ConfigRef} from "./ConfigRef";
import {customYamlLoad} from "./custom-yaml-load";
import {migrateConfigCommand} from "./command/migrate-config-command";

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
  .epilogue(`\
Example configs are found in
https://github.com/nwtgck/rich-piping-server#readme
`)
  .option("debug-config", {
    describe: "Print normalized config as JSON (all env! and other tangs are evaluated)",
    boolean: true,
    default: false
  })
  .command("migrate-config", "Print migrated config", (yargs) => {
  }, (argv) => {
    migrateConfigCommand(argv.configPath);
  });


// Parse arguments
const args = parser.parseSync(process.argv.slice(2));
const configRef: ConfigRef = new ConfigRef();
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
    printConfigJson: args["debug-config"],
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

function loadAndUpdateConfig(logger: log4js.Logger, configYamlPath: string, printConfigJson: boolean): void {
  // Load config
  logger.info(`Loading ${JSON.stringify(configYamlPath)}...`);
  try {
    const configYaml = customYamlLoad(fs.readFileSync(configYamlPath, 'utf8'));
    // NOTE: using configBasicSchema makes error message better
    const configBasicParsed = configBasicSchema.safeParse(configYaml);
    if (!configBasicParsed.success) {
      logZodError(configBasicParsed.error);
      return;
    }
    if (configBasicParsed.data.version === undefined) {
      logger.warn("config format is old");
      logger.warn(`Migration guide: rich-piping-server --config-path=${configYamlPath} migrate-config`);
      const configWithoutVersionParsed = configWihtoutVersionSchema.safeParse(configYaml);
      if (!configWithoutVersionParsed.success) {
        logZodError(configWithoutVersionParsed.error);
        return;
      }
      configRef.set(normalizeConfigV1(logger, migrateToConfigV1(configWithoutVersionParsed.data)));
    }
    if (configBasicParsed.data.version === "1" || configBasicParsed.data.version === 1) {
      const configParsed = configV1Schema.safeParse(configYaml);
      if (!configParsed.success) {
        logZodError(configParsed.error);
        return;
      }
      configRef.set(normalizeConfigV1(logger, configParsed.data));
    }
    logger.info(`${JSON.stringify(configYamlPath)} is loaded successfully`);
    if (printConfigJson) {
      console.log(`Normalized config:\n${JSON.stringify(configRef.get(), null, 2)}`);
    }
  } catch (err) {
    logger.error("Failed to load config", err);
  }
}

async function serve({ host, httpPort, enableHttps, httpsPort, serverKeyPath, serverCrtPath, configYamlPath, printConfigJson }: {
  host: string | undefined,
  httpPort: number,
  enableHttps: boolean,
  httpsPort: number | undefined,
  serverKeyPath: string | undefined,
  serverCrtPath: string | undefined,
  configYamlPath: string,
  printConfigJson: boolean,
}) {
  // Load config
  loadAndUpdateConfig(logger, configYamlPath, printConfigJson);

  // Watch config yaml
  fs.watch(configYamlPath, () => {
    loadAndUpdateConfig(logger, configYamlPath, printConfigJson);
  });

  // Create a piping server
  const pipingServer = new piping.Server({logger});

  const httpServedPromise = new Promise<void>(resolve => {
    http.createServer({ requestTimeout: 0 }, generateHandler({pipingServer, configRef, logger, useHttps: false}))
      .listen({ host, port: httpPort }, () => {
        logger.info(`Listen HTTP on ${httpPort}...`);
        resolve();
      });
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

    const generateSecureContextOptions: () => tls.SecureContextOptions = () => ({
      key: fs.readFileSync(serverKeyPath),
      cert: fs.readFileSync(serverCrtPath),
    });
    const http2Server = http2.createSecureServer(
      {
        ...generateSecureContextOptions(),
        allowHTTP1: true
      },
      generateHandler({pipingServer, configRef, logger, useHttps: true})
    );
    const updateSecureContext = () => {
      try {
        http2Server.setSecureContext(generateSecureContextOptions());
        logger.info("Certificate loaded");
      } catch (e) {
        logger.error("Failed to load certificate", e);
      }
    };
    fs.watchFile(serverCrtPath, updateSecureContext);
    fs.watchFile(serverKeyPath, updateSecureContext);

    await new Promise<void>(resolve => {
      http2Server.listen({ host, port: httpsPort }, () => {
        logger.info(`Listen HTTPS on ${httpsPort}...`);
        resolve();
      });
    });
  }

  await httpServedPromise;

  // Catch and ignore error
  process.on("uncaughtException", (err) => {
    logger.error("on uncaughtException", err);
  });
}
