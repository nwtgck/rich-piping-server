import assert from "power-assert";
import * as http from "http";
import {closePromise, readConfigV1, servePromise} from "./test-utils";
import thenRequest from "then-request";
import {ConfigV1} from "../src/config/v1";
import * as pipingVersion from "piping-server/dist/src/version";

describe("Rich Piping Server (config v1)", () => {
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
    configRef.ref = readConfigV1(`
      version: "1"
      config_for: rich_piping_server

      rejection: socket_close
    `);
    await shouldTransfer({path: "/mypath1"});
  });

  it("should transfer with regular expression", async () => {
    // language=yaml
    configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - regexp: "^/[a-c]+"
rejection: socket_close
`);
    await shouldTransfer({path: "/aabbcc"});
    await shouldTransfer({path: "/abchoge"});
    await shouldNotTransferAndSocketClosed({path: "/hoge"});
  });

  it("should transfer at only allowed path", async () => {
    // language=yaml
    configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - /myallowedpath1
rejection: socket_close
`);
    await shouldTransfer({path: "/myallowedpath1" });
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
    await shouldNotTransferAndSocketClosed({path: "/myallowedpath1/path1"});
  });

  context("index", () => {
    it("should create a new index", async () => {
      // language=yaml
      configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - index: /myindex1
rejection: socket_close
`);
      await shouldTransfer({path: "/myindex1/path1" });
      // Should respond simple Web UI
      {
        const res = await thenRequest("GET", `${pipingUrl}/myindex1`);
        assert(res.getBody("UTF-8").includes("Piping"));
      }
      // Should respond version
      {
        const res = await thenRequest("GET", `${pipingUrl}/myindex1/version`);
        assert.strictEqual(res.getBody("UTF-8").trim(), pipingVersion.VERSION);
      }
    });

    it("should create multiple indexes", async () => {
      // language=yaml
      configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - index: /myindex1
  - index: /myindex2
rejection: socket_close
`);
      await shouldTransfer({path: "/myindex1/path1" });
      // Should respond simple Web UI
      {
        const res = await thenRequest("GET", `${pipingUrl}/myindex1`);
        assert(res.getBody("UTF-8").includes("Piping"));
      }
      // Should respond version
      {
        const res = await thenRequest("GET", `${pipingUrl}/myindex1/version`);
        assert.strictEqual(res.getBody("UTF-8").trim(), pipingVersion.VERSION);
      }

      await shouldTransfer({path: "/myindex2/path1" });
      // Should respond simple Web UI
      {
        const res = await thenRequest("GET", `${pipingUrl}/myindex2`);
        assert(res.getBody("UTF-8").includes("Piping"));
      }
      // Should respond version
      {
        const res = await thenRequest("GET", `${pipingUrl}/myindex2/version`);
        assert.strictEqual(res.getBody("UTF-8").trim(), pipingVersion.VERSION);
      }
    });
  });

  it("should reject with Nginx error page", async () => {
    // language=yaml
    configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - /myallowedpath1
rejection: fake_nginx_down
`);
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await thenRequest("GET", `${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/1.17.8");
  });

  it("should reject with Nginx error page with Nginx version", async () => {
    // language=yaml
    configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - /myallowedpath1
rejection:
  fake_nginx_down:
    nginx_version: 99.9.9
`);
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await thenRequest("GET", `${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/99.9.9");
  });

  it("should transfer with basic auth", async () => {
    // language=yaml
    configRef.ref = readConfigV1(`
version: "1"
config_for: rich_piping_server

basic_auth_users:
  - username: user1
    password: pass1234
allow_paths:
  - /myallowedpath1
rejection: socket_close
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
