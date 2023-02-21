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
import * as Babel from "@babel/standalone";
// @ts-ignore
import babelPluginTransformModulesCommonJs from "@babel/plugin-transform-modules-commonjs";

import {generateHandler} from "./rich-piping-server";
import {configWihtoutVersionSchema} from "./config/without-version";
import {configV1Schema, migrateToConfigV1} from "./config/v1";
import {NormalizedConfig, normalizeConfigV1} from "./config/normalized-config";
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
    describe: "Config path",
    type: "string",
    required: true,
  })
  .alias("config-path", "config-yaml-path")
  .command("migrate-config", "Print migrated config", (yargs) => {
  }, (argv) => {
    const configYaml = loadConfig(argv.configPath);
    if (configV1Schema.safeParse(configYaml).success) {
      console.log("The config is already a valid config v1");
      return;
    }
    const configParsed = configWihtoutVersionSchema.safeParse(configYaml);
    if(!configParsed.success) {
      const issueStack = configParsed.error.issues.slice();
      while (issueStack.length > 0) {
        const issue = issueStack.pop()!;
        if (issue.code === "invalid_union") {
          issueStack.push(...issue.unionErrors.flatMap(e => e.issues));
          continue;
        }
        process.stderr.write(`config error hint: ${JSON.stringify(issue)}\n`);
      }
      process.exit(1);
    }
    const configV1 = migrateToConfigV1(configParsed.data);
    // TODO: support .js migration
    console.log(yaml.dump(configV1));
  });


// Parse arguments
const args = parser.parseSync(process.argv.slice(2));
const configRef: {ref?: NormalizedConfig} = { };
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

export function loadConfigJs(configJs: string): unknown {
  const {code} = Babel.transform(configJs, {
    plugins: [ babelPluginTransformModulesCommonJs ],
  });
  if (code === null || code === undefined) {
    throw new Error("code is null or undefined");
  }
  const configExports: { default?: unknown } = {};
  new Function("exports", code)(configExports);
  return configExports.default;
}

function loadConfig(configPath: string): unknown {
  const fileContent = fs.readFileSync(configPath, 'utf8');
  if (configPath.endsWith(".js")) {
    return loadConfigJs(fileContent);
  }
  if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
    return yaml.load(fileContent)
  }
  throw Error("config path should be .js or .yaml");
}

function loadAndUpdateConfig(logger: log4js.Logger, configPath: string): void {
  // Load config
  logger.info(`Loading ${JSON.stringify(configPath)}...`);
  try {
    const configJson = loadConfig(configPath);
    // NOTE: using configBasicSchema makes error message better
    const configBasicParsed = configBasicSchema.safeParse(configJson);
    if (!configBasicParsed.success) {
      logZodError(configBasicParsed.error);
      return;
    }
    if (configBasicParsed.data.version === undefined) {
      logger.warn("config format is old");
      logger.warn(`Migration guide: rich-piping-server --config-path=${configPath} migrate-config`);
      const configWithoutVersionParsed = configWihtoutVersionSchema.safeParse(configJson);
      if (!configWithoutVersionParsed.success) {
        logZodError(configWithoutVersionParsed.error);
        return;
      }
      configRef.ref = normalizeConfigV1(migrateToConfigV1(configWithoutVersionParsed.data));
    }
    if (configBasicParsed.data.version === "1" || configBasicParsed.data.version === 1) {
      const configParsed = configV1Schema.safeParse(configJson);
      if (!configParsed.success) {
        logZodError(configParsed.error);
        return;
      }
      configRef.ref = normalizeConfigV1(configParsed.data);
    }
    logger.info(`${JSON.stringify(configPath)} is loaded successfully`);
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

  http.createServer(generateHandler({pipingServer, configRef, logger, useHttps: false}))
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
    http2Server.listen({ host, port: httpsPort }, () => {
      logger.info(`Listen HTTPS on ${httpsPort}...`);
    });
  }

  // Catch and ignore error
  process.on("uncaughtException", (err) => {
    logger.error("on uncaughtException", err);
  });
}
