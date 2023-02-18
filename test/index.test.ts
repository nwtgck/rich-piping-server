import * as assert from "power-assert";
import * as http from "http";
import {
  closePromise,
  readConfigWithoutVersionAndMigrateToV1,
  requestWithoutKeepAlive,
  servePromise
} from "./test-utils";
import * as undici from "undici";
import {ConfigV1} from "../src/config/v1";

describe("Rich Piping Server", () => {
  let richPipingServerHttpServer: http.Server;
  let pipingPort: number;
  let pipingUrl: string;
  let configRef: { ref?: ConfigV1 } = { };

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

  it("should transfer when all path allowed", async () => {
    // language=yaml
    configRef.ref = readConfigWithoutVersionAndMigrateToV1(`
allowPaths:
  - type: regexp
    value: "/.*"
rejection: socket-close
`);
    await shouldTransfer({path: "/mypath1"});
  });

  it("should transfer at only allowed path", async () => {
    // language=yaml
    configRef.ref = readConfigWithoutVersionAndMigrateToV1(`
allowPaths:
  - /myallowedpath1
rejection: socket-close
`);
    await shouldTransfer({path: "/myallowedpath1" });
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
  });

  it("should reject with Nginx error page", async () => {
    // language=yaml
    configRef.ref = readConfigWithoutVersionAndMigrateToV1(`
allowPaths:
  - /myallowedpath1
rejection: nginx-down
`);
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/1.17.8");
  });

  it("should reject with Nginx error page with Nginx version", async () => {
    // language=yaml
    configRef.ref = readConfigWithoutVersionAndMigrateToV1(`
allowPaths:
  - /myallowedpath1
rejection:
  type: nginx-down
  nginxVersion: 99.9.9
`);
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/99.9.9");
  });

  it("should transfer with basic auth", async () => {
    // language=yaml
    configRef.ref = readConfigWithoutVersionAndMigrateToV1(`
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
