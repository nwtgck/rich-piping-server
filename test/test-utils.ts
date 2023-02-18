import * as http from "http";
import * as http2 from "http2";
import * as getPort from "get-port";
import * as piping from "piping-server";
import * as richPipingServer from "../src/rich-piping-server";
import * as log4js from "log4js";
import * as yaml from "js-yaml";
import {configWihtoutVersionSchema} from "../src/config/without-version";
import {ConfigV1, configV1Schema, migrateToConfigV1} from "../src/config/v1";
import * as undici from "undici";
import {URL, UrlObject} from "url";

/**
 * Listen on the specified port
 * @param server
 * @param port
 */
function listenPromise(server: http.Server | http2.Http2Server, port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });
}

/**
 * Close the server
 * @param server
 */
export function closePromise(server: http.Server | http2.Http2Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

export async function servePromise(): Promise<{ pipingPort: number, pipingUrl: string, richPipingServerHttpServer: http.Server, configRef: { ref?: ConfigV1 | undefined } }> {
  // Create a logger
  const logger = log4js.getLogger();
  // Get available port
  const pipingPort = await getPort();
  // Define Piping URL
  const pipingUrl = `http://localhost:${pipingPort}`;
  // Create a Piping server
  const pipingServer = new piping.Server({logger});
  const configRef: { ref?: ConfigV1 | undefined } = { };
  const richPipingServerHttpServer = http.createServer(richPipingServer.generateHandler({
    pipingServer,
    configRef,
    useHttps: false,
  }));
  // Listen on the port
  await listenPromise(richPipingServerHttpServer, pipingPort);

  return {
    pipingPort,
    pipingUrl,
    richPipingServerHttpServer,
    configRef,
  };
}

// NOTE: with keep-alive test will be slow
export function requestWithoutKeepAlive(
  url: string | URL | UrlObject,
  options?: Omit<undici.Dispatcher.RequestOptions, 'origin' | 'path' | 'method'> & Partial<Pick<undici.Dispatcher.RequestOptions, 'method'>>,
): Promise<undici.Dispatcher.ResponseData> {
  return undici.request(url, {
    ...options,
    dispatcher: new undici.Agent({ pipelining: 0 }), // For disabling keep alive
  });
}

export function readConfigWithoutVersionAndMigrateToV1(yamlString: string): ConfigV1 {
  const configYaml = yaml.load(yamlString);
  const configWithoutVersion = configWihtoutVersionSchema.parse(configYaml);
  return migrateToConfigV1(configWithoutVersion);
}

export function readConfigV1(yamlString: string): ConfigV1 {
  const configYaml = yaml.load(yamlString);
  return configV1Schema.parse(configYaml);
}
