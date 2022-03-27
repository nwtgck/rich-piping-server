import * as assert from "power-assert";
import * as http from "http";
import {closePromise, readConfig, servePromise} from "./test-utils";
import thenRequest from "then-request";
import {Config} from "../dist/src/rich-piping-server";

describe("Rich Piping Server", () => {
  let richPipingServerHttpServer: http.Server;
  let pipingPort: number;
  let pipingUrl: string;
  let configRef: { ref?: Config } = { };

  beforeEach(async () => {
    const serve = await servePromise();
    richPipingServerHttpServer = serve.richPipingServerHttpServer;
    pipingPort = serve.pipingPort;
    pipingUrl = serve.pipingUrl;
    configRef = serve.configRef;
  });

  afterEach(async () => {
    // Close the piping server
    await closePromise(richPipingServerHttpServer);
  });

  async function shouldTransfer(params: { path: string }) {
    // Get request promise
    const resPromise = thenRequest("GET", `${pipingUrl}${params.path}`);

    // Send data
    await thenRequest("POST", `${pipingUrl}${params.path}`, {
      body: "this is a content"
    });

    // Wait for response
    const res = await resPromise;

    // Body should be the sent data
    assert.strictEqual(res.getBody("UTF-8"), "this is a content");
    // Content-length should be returned
    assert.strictEqual(res.headers["content-length"], "this is a content".length.toString());
    assert.strictEqual(res.headers["content-length"], "this is a content".length.toString());
  }

  async function shouldNotTransferAndSocketClosed(params: { path: string }) {
    try {
      await shouldTransfer({path: params.path});
      throw new Error("should not transfer");
    } catch (err) {
      if (err.code !== "ECONNRESET") {
        throw new Error("code is not 'ECONNRESET'");
      }
    }
  }

  it("should transfer when all path allowed", async () => {
    // language=yaml
    configRef.ref = readConfig(`
allowPaths:
  - type: regexp
    value: "/.*"
rejection: socket-close
`);
    await shouldTransfer({path: "/mypath1"});
  });

  it("should transfer at only allowed path", async () => {
    // language=yaml
    configRef.ref = readConfig(`
allowPaths:
  - /myallowedpath1
rejection: socket-close
`);
    await shouldTransfer({path: "/myallowedpath1" });
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
  });

  // TODO: add more tests
});
