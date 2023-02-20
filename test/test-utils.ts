import * as http from "http";
import * as http2 from "http2";
import * as getPort from "get-port";
import * as piping from "piping-server";
import * as richPipingServer from "../src/rich-piping-server";
import * as log4js from "log4js";
import * as yaml from "js-yaml";
import {configWihtoutVersionSchema} from "../src/config/without-version";
import {configV1Schema, migrateToConfigV1} from "../src/config/v1";
import {NormalizedConfig, normalizeConfigV1} from "../src/config/normalized-config";
import * as undici from "undici";
import {URL, UrlObject} from "url";
import * as assert from "power-assert";

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

export async function servePromise(): Promise<{ pipingPort: number, pipingUrl: string, richPipingServerHttpServer: http.Server, configRef: { ref?: NormalizedConfig | undefined } }> {
  // Create a logger
  const logger = log4js.getLogger();
  // Get available port
  const pipingPort = await getPort();
  // Define Piping URL
  const pipingUrl = `http://localhost:${pipingPort}`;
  // Create a Piping server
  const pipingServer = new piping.Server({logger});
  const configRef: { ref?: NormalizedConfig | undefined } = { };
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


export function createTransferAssertions({getPipingUrl}: { getPipingUrl: () => string }) {
  async function shouldTransfer(params: { path: string, headers?: http.IncomingHttpHeaders }) {
    const pipingUrl = getPipingUrl();

    // Get request promise
    const resPromise = requestWithoutKeepAlive(`${pipingUrl}${params.path}`, {
      headers: params.headers,
    });

    // Send data
    await requestWithoutKeepAlive(`${pipingUrl}${params.path}`, {
      method: "POST",
      headers: params.headers,
      body: "this is a content",
    });

    // Wait for response
    const res = await resPromise;

    // Body should be the sent data
    assert.strictEqual(await res.body.text(), "this is a content");
    // Content-length should be returned
    assert.strictEqual(res.headers["content-length"], "this is a content".length.toString());
  }

  async function shouldNotTransferAndSocketClosed(params: { path: string }) {
    try {
      await shouldTransfer({path: params.path});
      throw new Error("should not transfer");
    } catch (err: unknown) {
      if (err instanceof undici.errors.SocketError && err.message === "other side closed") {
        return;
      }
      throw new Error("socket not closed");
    }
  }

  return {
    shouldTransfer,
    shouldNotTransferAndSocketClosed,
  };
}

export function readConfigWithoutVersionAndMigrateToV1AndNormalize(yamlString: string): NormalizedConfig {
  const configYaml = yaml.load(yamlString);
  const configWithoutVersion = configWihtoutVersionSchema.parse(configYaml);
  return normalizeConfigV1(migrateToConfigV1(configWithoutVersion));
}

export function readConfigV1AndNormalize(yamlString: string): NormalizedConfig {
  const configYaml = yaml.load(yamlString);
  return normalizeConfigV1(configV1Schema.parse(configYaml));
}
