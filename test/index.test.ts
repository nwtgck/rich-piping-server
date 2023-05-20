import * as assert from "power-assert";
import * as http from "http";
import {
  closePromise,
  createTransferAssertions,
  readConfigWithoutVersionAndMigrateToV1AndNormalize,
  requestWithoutKeepAlive,
  servePromise
} from "./test-utils";
import {ConfigRef} from "../src/ConfigRef";

describe("Rich Piping Server", () => {
  let richPipingServerHttpServer: http.Server;
  let pipingPort: number;
  let pipingUrl: string;
  let configRef: ConfigRef = new ConfigRef();

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

  const {
    shouldTransfer,
    shouldNotTransferAndSocketClosed
  } = createTransferAssertions({ getPipingUrl: () => pipingUrl });

  it("should transfer when all path allowed", async () => {
    // language=yaml
    configRef.set(readConfigWithoutVersionAndMigrateToV1AndNormalize(`
allowPaths:
  - type: regexp
    value: "/.*"
rejection: socket-close
`));
    await shouldTransfer({path: "/mypath1"});
  });

  it("should transfer at only allowed path", async () => {
    // language=yaml
    configRef.set(readConfigWithoutVersionAndMigrateToV1AndNormalize(`
allowPaths:
  - /myallowedpath1
rejection: socket-close
`));
    await shouldTransfer({path: "/myallowedpath1" });
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
  });

  it("should reject with Nginx error page", async () => {
    // language=yaml
    configRef.set(readConfigWithoutVersionAndMigrateToV1AndNormalize(`
allowPaths:
  - /myallowedpath1
rejection: nginx-down
`));
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/1.17.8");
  });

  it("should reject with Nginx error page with Nginx version", async () => {
    // language=yaml
    configRef.set(readConfigWithoutVersionAndMigrateToV1AndNormalize(`
allowPaths:
  - /myallowedpath1
rejection:
  type: nginx-down
  nginxVersion: 99.9.9
`));
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/99.9.9");
  });

  it("should transfer with basic auth", async () => {
    // language=yaml
    configRef.set(readConfigWithoutVersionAndMigrateToV1AndNormalize(`
basicAuthUsers:
  - username: user1
    password: pass1234
allowPaths:
  - /myallowedpath1
rejection: socket-close
`));
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
    await shouldTransfer({
      path: "/myallowedpath1",
      headers: {
        "Authorization": `Basic ${Buffer.from("user1:pass1234").toString("base64")}`,
      },
    });
  });
});
