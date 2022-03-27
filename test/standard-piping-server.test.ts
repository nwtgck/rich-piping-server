import * as assert from "power-assert";
import * as http from "http";
import {closePromise, servePromise} from "./test-utils";
import thenRequest from "then-request";
import {Config} from "../dist/src/rich-piping-server";

describe("standard Piping Server", () => {
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

  it("should transfer", async () => {
    configRef.ref = {
      basicAuthUsers: undefined,
      allowPaths: [
        { type: "regexp", value: "/.*" },
      ],
      rejection: "socket-close",
    };
    // Get request promise
    const resPromise = thenRequest("GET", `${pipingUrl}/mydataid`);

    // Send data
    await thenRequest("POST", `${pipingUrl}/mydataid`, {
      body: "this is a content"
    });

    // Wait for response
    const res = await resPromise;

    // Body should be the sent data
    assert.strictEqual(res.getBody("UTF-8"), "this is a content");
    // Content-length should be returned
    assert.strictEqual(res.headers["content-length"], "this is a content".length.toString());
    assert.strictEqual(res.headers["content-length"], "this is a content".length.toString());
  });
});
