import * as http from "http";
import * as http2 from "http2";
import * as getPort from "get-port";
import * as piping from "piping-server";
import * as richPipingServer from "../src/rich-piping-server";
import * as log4js from "log4js";
import * as yaml from "js-yaml";
import {Config, configSchema} from "../src/rich-piping-server";

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

export async function servePromise(): Promise<{ pipingPort: number, pipingUrl: string, richPipingServerHttpServer: http.Server, configRef: { ref: Config | undefined } }> {
  // Create a logger
  const logger = log4js.getLogger();
  // Get available port
  const pipingPort = await getPort();
  // Define Piping URL
  const pipingUrl = `http://localhost:${pipingPort}`;
  // Create a Piping server
  const pipingServer = new piping.Server({logger});
  const configRef: { ref: Config | undefined } = { ref: undefined };
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

export function readConfig(yamlString: string): Config {
  const configYaml = yaml.safeLoad(yamlString);
  return configSchema.parse(configYaml);
}
