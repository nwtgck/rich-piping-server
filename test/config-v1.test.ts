import * as assert from "power-assert";
import * as http from "http";
import {
  closePromise,
  createTransferAssertions,
  readConfigV1AndNormalize,
  requestWithoutKeepAlive,
  servePromise
} from "./test-utils";
import * as pipingVersion from "piping-server/dist/src/version";
import {ConfigRef} from "../src/ConfigRef";
import * as getPort from "get-port";
import {serveOpenIdProvider} from "./serve-openid-provider";
import axios, {type AxiosError} from 'axios';
import * as axiosCookieJarSupport from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

describe("Rich Piping Server (config v1)", () => {
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
    configRef.set(readConfigV1AndNormalize(`
      version: "1"
      config_for: rich_piping_server

      rejection: socket_close
    `));
    await shouldTransfer({path: "/mypath1"});
  });

  it("should transfer with regular expression", async () => {
    // language=yaml
    configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - regexp: "^/[a-c]+"
rejection: socket_close
`));
    await shouldTransfer({path: "/aabbcc"});
    await shouldTransfer({path: "/abchoge"});
    await shouldNotTransferAndSocketClosed({path: "/hoge"});
  });

  it("should transfer at only allowed path", async () => {
    // language=yaml
    configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - /myallowedpath1
rejection: socket_close
`));
    await shouldTransfer({path: "/myallowedpath1" });
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
    await shouldNotTransferAndSocketClosed({path: "/myallowedpath1/path1"});
  });

  context("index", () => {
    it("should create a new index", async () => {
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - index: /myindex1
rejection: socket_close
`));
      await shouldTransfer({path: "/myindex1/path1" });
      // Should respond simple Web UI
      {
        const res = await requestWithoutKeepAlive(`${pipingUrl}/myindex1`);
        assert((await res.body.text()).includes("Piping"));
      }
      // Should respond version
      {
        const res = await requestWithoutKeepAlive(`${pipingUrl}/myindex1/version`);
        assert.strictEqual((await res.body.text()).trim(), pipingVersion.VERSION);
      }
    });

    it("should create multiple indexes", async () => {
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - index: /myindex1
  - index: /myindex2
rejection: socket_close
`));
      await shouldTransfer({path: "/myindex1/path1" });
      // Should respond simple Web UI
      {
        const res = await requestWithoutKeepAlive(`${pipingUrl}/myindex1`);
        assert((await res.body.text()).includes("Piping"));
      }
      // Should respond version
      {
        const res = await requestWithoutKeepAlive(`${pipingUrl}/myindex1/version`);
        assert.strictEqual((await res.body.text()).trim(), pipingVersion.VERSION);
      }

      await shouldTransfer({path: "/myindex2/path1" });
      // Should respond simple Web UI
      {
        const res = await requestWithoutKeepAlive(`${pipingUrl}/myindex2`);
        assert((await res.body.text()).includes("Piping"));
      }
      // Should respond version
      {
        const res = await requestWithoutKeepAlive(`${pipingUrl}/myindex2/version`);
        assert.strictEqual((await res.body.text()).trim(), pipingVersion.VERSION);
      }
    });
  });

  it("should reject with Nginx error page", async () => {
    // language=yaml
    configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - /myallowedpath1
rejection: fake_nginx_down
`));
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/1.17.8");
  });

  it("should reject with Nginx error page with Nginx version", async () => {
    // language=yaml
    configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

allow_paths:
  - /myallowedpath1
rejection:
  fake_nginx_down:
    nginx_version: 99.9.9
`));
    await shouldTransfer({path: "/myallowedpath1" });
    // Get request promise
    const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath1`);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers.server, "nginx/99.9.9");
  });

  it("should transfer with basic auth", async () => {
    // language=yaml
    configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

basic_auth_users:
  - username: user1
    password: pass1234
allow_paths:
  - /myallowedpath1
rejection: socket_close
`));
    await shouldNotTransferAndSocketClosed({path: "/mypath1"});
    await shouldTransfer({
      path: "/myallowedpath1",
      headers: {
        "Authorization": `Basic ${Buffer.from("user1:pass1234").toString("base64")}`,
      },
    });
    // preflight request
    {
      const res = await requestWithoutKeepAlive(`${pipingUrl}/myallowedpath1`, {
        method: "OPTIONS",
        headers: {
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization',
          'access-control-request-private-network': 'true',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
        },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers["access-control-allow-origin"], "*");
      assert.strictEqual(res.headers["access-control-allow-methods"], "GET, HEAD, POST, PUT, OPTIONS");
      assert.strictEqual(res.headers["access-control-allow-headers"], "Content-Type, Content-Disposition, X-Piping, Authorization");
      assert.strictEqual(res.headers["access-control-allow-private-network"], "true");
    }
  });

  context("custom tag", () => {
    it("should resolve !env tag", async () => {
      assert.strictEqual(process.env["MY_BASIC_PASSWORD"], undefined);
      process.env["MY_BASIC_PASSWORD"] = "my_secret_password";
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

basic_auth_users:
  - username: user1
    password: !env "MY_BASIC_PASSWORD"

rejection: socket_close
`));
      assert.strictEqual(configRef.get()!.basic_auth_users![0].password, process.env["MY_BASIC_PASSWORD"]);
      delete process.env["MY_BASIC_PASSWORD"];
    });

    it("should resolve !concat tag", async () => {
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

basic_auth_users:
  - username: user1
    password: !concat ["my", "secret", "pass", "word"]

rejection: socket_close
`));
      assert.strictEqual(configRef.get()!.basic_auth_users![0].password, ["my", "secret", "pass", "word"].join(""));
    });

    it("should resolve !json_decode tag", async () => {
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
        version: "1"
        config_for: rich_piping_server

        basic_auth_users:
          - username: user1
            password: !json_decode '"mypassword"'

        rejection: socket_close
      `));
      assert.strictEqual(configRef.get()!.basic_auth_users![0].password, "mypassword");
    });

    it("should resolve !unrecommended_js tag", async () => {
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

basic_auth_users:
  - username: user1
    password: !unrecommended_js |
      return "mypasswordfromjavascript"

rejection: socket_close
`));
      assert.strictEqual(configRef.get()!.basic_auth_users![0].password, "mypasswordfromjavascript");
    });

    it("should resolve nested tags", async () => {
      assert.strictEqual(process.env["MY_USER_NAME_PREFIX"], undefined);
      process.env["MY_USER_NAME_PREFIX"] = "myuserprefix_";
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

basic_auth_users:
  - username: !concat [!env "MY_USER_NAME_PREFIX", 1234]
    password: dummy

rejection: socket_close
`));
      assert.strictEqual(configRef.get()!.basic_auth_users![0].username, "myuserprefix_1234");
      delete process.env["MY_USER_NAME_PREFIX"];
    });
  });

  context("OpenID Connect", () => {
    it("should transfer", async () => {
      const clientId = "myclientid";
      const clientSecret = "thisissecret";
      const issuerPort = await getPort();
      const issuerUrl = `http://localhost:${issuerPort}`;

      const providerServer = await serveOpenIdProvider({
        port: issuerPort,
        clientId,
        clientSecret,
        redirectUri: `${pipingUrl}/my_callback`,
      });

      const sessionCookieName = "my_session_id"
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

experimental_openid_connect: true
openid_connect:
  issuer_url: ${issuerUrl}
  client_id: ${clientId}
  client_secret: ${clientSecret}
  redirect:
    uri: ${pipingUrl}/my_callback
    path: /my_callback
  allow_userinfos:
    - sub: user001
  session:
    cookie:
      name: ${sessionCookieName}
      http_only: true
    custom_http_header: X-My-Session-ID
    age_seconds: 60

rejection: socket_close
`));

      const cookieJar = new CookieJar();
      const axiosClient = axiosCookieJarSupport.wrapper(axios.create({ jar: cookieJar }));
      const res1 = await axiosClient.get(`${pipingUrl}/my_first_visit`);
      assert(res1.request.res.responseUrl.startsWith(`${issuerUrl}/interaction/`));
      // NOTE: login should be "user001", any password is OK
      const res2 = await axiosClient.post(`${res1.request.res.responseUrl}/login`,  "login=user001&password=dummypass");
      assert(res2.request.res.responseUrl.startsWith(`${issuerUrl}/interaction/`));
      const res3 = await axiosClient.post(`${res2.request.res.responseUrl}/confirm`);
      assert(res3.request.res.responseUrl.startsWith(`${pipingUrl}/my_callback?code=`));
      const cookie = cookieJar.toJSON().cookies.find(c => c.key === sessionCookieName)!;
      assert.strictEqual(cookie.domain, "localhost");
      assert.strictEqual(cookie.httpOnly, true);
      // HTML redirect included
      assert(res3.data.includes(`content="0;/my_first_visit"`));

      await shouldTransfer({
        path: "/mypath1",
        headers: {
          "Cookie": `${sessionCookieName}=${cookie.value}`,
        },
      });

      await shouldTransfer({
        path: "/mypath2",
        headers: {
          "X-My-Session-ID": cookie.value,
        },
      });

      providerServer.close();
    });

    it("should respond session forward page", async () => {
      const clientId = "myclientid";
      const clientSecret = "thisissecret";
      const issuerPort = await getPort();
      const issuerUrl = `http://localhost:${issuerPort}`;

      const providerServer = await serveOpenIdProvider({
        port: issuerPort,
        clientId,
        clientSecret,
        redirectUri: `${pipingUrl}/my_callback`,
      });

      const sessionCookieName = "my_session_id"
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

experimental_openid_connect: true
openid_connect:
  issuer_url: ${issuerUrl}
  client_id: ${clientId}
  client_secret: ${clientSecret}
  redirect:
    uri: ${pipingUrl}/my_callback
    path: /my_callback
  allow_userinfos:
    - sub: user001
  session:
    forward:
      query_param_name: my_session_forward_url
      allow_url_regexp: (http://dummy_session_forward_url1)|(http://dummy_session_forward_url2)
    cookie:
      name: ${sessionCookieName}
      http_only: true
    age_seconds: 60

rejection: socket_close
`));

      const cookieJar = new CookieJar();
      const axiosClient = axiosCookieJarSupport.wrapper(axios.create({ jar: cookieJar }));
      const res1 = await axiosClient.get(`${pipingUrl}?my_session_forward_url=http://dummy_session_forward_url1`);
      assert(res1.request.res.responseUrl.startsWith(`${issuerUrl}/interaction/`));
      // NOTE: login should be "user001", any password is OK
      const res2 = await axiosClient.post(`${res1.request.res.responseUrl}/login`,  "login=user001&password=dummypass");
      assert(res2.request.res.responseUrl.startsWith(`${issuerUrl}/interaction/`));
      const res3 = await axiosClient.post(`${res2.request.res.responseUrl}/confirm`);
      assert(res3.request.res.responseUrl.startsWith(`${pipingUrl}/my_callback?code=`));
      const cookie = cookieJar.toJSON().cookies.find(c => c.key === sessionCookieName)!;
      assert.strictEqual(cookie.domain, "localhost");
      assert.strictEqual(cookie.httpOnly, true);
      assert(res3.data.includes(`<html>`) && res3.data.includes("</html>"));
      assert(res3.data.includes(`<script>`) && res3.data.includes("</script>"));
      assert(res3.data.includes(`sessionForwardUrl = "http://dummy_session_forward_url1"`));
      assert(res3.data.includes(`window.close()`));

      // Immediately forward page responded after logged in
      {
        const res = await axiosClient.get(`${pipingUrl}?my_session_forward_url=http://dummy_session_forward_url2`);
        assert(res.data.includes(`<html>`) && res.data.includes("</html>"));
        assert(res.data.includes(`<script>`) && res.data.includes("</script>"));
        assert(res.data.includes(`sessionForwardUrl = "http://dummy_session_forward_url2"`));
        assert(res.data.includes(`window.close()`));
      }

      // URL not in "allow_url_regexp" should be rejected
      try {
        await axiosClient.get(`${pipingUrl}?my_session_forward_url=http://should_be_invalid_session_forward_url`);
      } catch (err) {
        const axiosError = err as AxiosError;
        assert.strictEqual(axiosError.response!.status, 400);
        assert.strictEqual(axiosError.response!.data, "session forward URL is not allowed\n");
      }

      providerServer.close();
    });

    it("should handle preflight request", async () => {
      const clientId = "myclientid";
      const clientSecret = "thisissecret";
      const issuerPort = await getPort();
      const issuerUrl = `http://localhost:${issuerPort}`;

      const providerServer = await serveOpenIdProvider({
        port: issuerPort,
        clientId,
        clientSecret,
        redirectUri: `${pipingUrl}/my_callback`,
      });

      const sessionCookieName = "my_session_id"
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
version: "1"
config_for: rich_piping_server

experimental_openid_connect: true
openid_connect:
  issuer_url: ${issuerUrl}
  client_id: ${clientId}
  client_secret: ${clientSecret}
  redirect:
    uri: ${pipingUrl}/my_callback
    path: /my_callback
  allow_userinfos:
    - sub: user001
  session:
    cookie:
      name: ${sessionCookieName}
      http_only: true
    custom_http_header: X-My-Session-ID
    age_seconds: 60

rejection: socket_close
`));
      const res = await requestWithoutKeepAlive(`${pipingUrl}/mypath`, {
        method: "OPTIONS",
        headers: {
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-my-session-id',
          'access-control-request-private-network': 'true',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
        },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers["access-control-allow-origin"], "*");
      assert.strictEqual(res.headers["access-control-allow-methods"], "GET, HEAD, POST, PUT, OPTIONS");
      assert.strictEqual(res.headers["access-control-allow-headers"], "Content-Type, Content-Disposition, X-Piping, X-My-Session-ID");
      assert.strictEqual(res.headers["access-control-allow-private-network"], "true");

      providerServer.close();
    });

    it("should parse log config", async () => {
      // language=yaml
      configRef.set(readConfigV1AndNormalize(`
        version: "1"
        config_for: rich_piping_server

        experimental_openid_connect: true
        openid_connect:
          issuer_url: https://dummyissue
          client_id: myclientid
          client_secret: thisissecret
          redirect:
            uri: https://dummyredirecturi/my_callback
            path: /my_callback
          allow_userinfos: [ ]
          session:
            cookie:
              name: dummycookiename
              http_only: true
            age_seconds: 60
          log:
            userinfo:
              sub: true
              email: false

        rejection: socket_close
      `));
      assert.strictEqual(configRef.get()?.openid_connect?.log?.userinfo?.sub, true);
      assert.strictEqual(configRef.get()?.openid_connect?.log?.userinfo?.email, false);
    });
  });
});
