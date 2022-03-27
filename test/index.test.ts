import * as assert from "power-assert";
import * as http from "http";
import {closePromise, readConfig, servePromise} from "./test-utils";
import thenRequest from "then-request";
import {Config} from "../src/rich-piping-server";

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

  async function shouldTransfer(params: { path: string, headers?: http.IncomingHttpHeaders }) {
    // Get request promise
    const resPromise = thenRequest("GET", `${pipingUrl}${params.path}`, {
      headers: params.headers,
    });

    // Send data
    await thenRequest("POST", `${pipingUrl}${params.path}`, {
      headers: params.headers,
      body: "this is a content",
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
    } catch (err: any) {
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

  it("should reject with Nginx error page", async () => {
    // language=yaml
    configRef.ref = readConfig(`
allowPaths:
  - /myallowedpath1
rejection: nginx-down
`);
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await thenRequest("GET", `${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/1.17.8");
  });

  it("should transfer with basic auth", async () => {
    // language=yaml
    configRef.ref = readConfig(`
basicAuthUsers:
  - username: user1
    password: pass1234
allowPaths:
  - /myallowedpath1
rejection: socket-close
`);
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
    await shouldTransfer({
      path: "/myallowedpath1",
      headers: {
        "Authorization": `Basic ${Buffer.from("user1:pass1234").toString("base64")}`,
      },
    });
  });
});
