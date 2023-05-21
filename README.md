# rich-piping-server
![Node CI](https://github.com/nwtgck/rich-piping-server/workflows/Node%20CI/badge.svg)

Rich [Piping Server](https://github.com/nwtgck/piping-server)

## Usage

Prepare `config.yaml` as follows.

```yaml
version: '1'
config_for: rich_piping_server

# optional
basic_auth_users:
  - username: user1
    password: pass1234

# optional
allow_paths:
  # Allow transfer over "/0s6twklxkrcfs1u", not "/0s6twklxkrcfs1u/mypath"
  - /0s6twklxkrcfs1u
  # Allow transfer over the regular expression below
  - regexp: ^/[abcd]+.*$
  # Simple at /mytop1/. Show version at /mytop1/version. Show help at /mytop1/help. Allow transfer /mytop1/mypath, /mytop1/hoge,....
  - index: /mytop1
  # Create multiple "index".
  - index: /mytop2

# Respond a fake nginx 500 down page when path not allowed
rejection: fake_nginx_down

# Close socket when path not allowed
#rejection: socket_close

# Respond a fake nginx 500 down with version
#rejection:
#  fake_nginx_down:
#    nginx_version: 99.9.9
```

Run the server as follows. Hot reload of config is available.

```bash
npx nwtgck/rich-piping-server --config-path=config.yaml
```

Here are some example results of the server with the config.

- transferable: `curl -u user1:pass1234 http://localhost:8080/0s6twklxkrcfs1u`
- transferable: `curl -u user1:pass1234 -T- http://localhost:8080/0s6twklxkrcfs1u`
- transferable: `curl -u user1:pass1234 http://localhost:8080/aabbaaccba`
- transferable: `curl -u user1:pass1234 http://localhost:8080/b`
- Web UI because of "index": `curl -u user1:pass1234 http://localhost:8080/mytop1/`
- version because of "index": `curl -u user1:pass1234 http://localhost:8080/mytop1/version`
- help because of "index": `curl -u user1:pass1234 http://localhost:8080/mytop1/help`
- transferable because of "index": `curl -u user1:pass1234 http://localhost:8080/mytop1/mypath`
- Web UI because of "index": `curl -u user1:pass1234 http://localhost:8080/mytop2/`
- reject because path is not allowed: `curl -u user1:pass1234 http://localhost:8080/`
- reject because of no basic auth: `curl http://localhost:8080/0s6twklxkrcfs1u`

### Tags

These tags are available in config.
- `!env MY_VALUE1`
- `!concat [ "hello", !env "MY_VALUE1" ]`
- `!json_decode "true"`
- `!unrecommended_js "return new Date().getMonth() < 5"`

Here is an example.

```yaml
...

basic_auth_users:
  - username: !env "USERNAME1"
    password: !env "PASSWORD1"
...
```

`!unrecommended_js` is not recommended to use because this behavior highly depends on the underlying runtime and the behavior may change. 

### OpenID Connect

This is an experimental feature and it may have breaking changes.

```yaml
version: '1'
config_for: rich_piping_server

# OpenID Connect is experimental
experimental_openid_connect: true

# optional
openid_connect:
  issuer_url: https://example.com
  client_id: <your client id here>
  client_secret: <your client secret here>
  redirect:
    # Rich Piping Server callback URL
    uri: https://your_rich_piping_server/callback
    path: /callback
  allow_userinfos:
    - sub: auth0|0123456789abcdef01234567
    - email: johnsmith@example.com
    - email: alice@example.com
      require_verification: false
  # Session ID is generated after authentication successful and user in "allow_userinfos"
  # Shutting down Rich Piping Server revokes all sessions for now
  session:
    cookie:
      name: my_session_id
      http_only: true
    # optional (useful especially for command line tools to get session ID)
    forward:
      # A CLI may server an ephemeral HTTP server on :65106 and open https://your_rich_piping_server/?my_session_forward_url=http://localhost:65106
      # The opened browser will POST http://localhost:65106 with `{ "session_id": "..." }` after logged in.
      query_param_name: my_session_forward_url
      allow_url_regexp: ^http://localhost:\d+.*$
    age_seconds: 86400
  # optional
  log:
    # optional
    userinfo:
      sub: false
      email: false

# Close socket when path not allowed
rejection: socket_close
```

<details>
<summary>Example CLI to get session ID in Node.js</summary>

```js
const http = require("http");

(async () => {
  const richPipingServerUrl = "https://your_rich_piping_server";
  const sessionId = await getSessionId(richPipingServerUrl);
  console.log("sessionId:", sessionId);
  // (you can use session ID now save to ~/.config/... or something)

  // Example to access the Rich Piping Server
  const res = await fetch(`${richPipingServerUrl}/version`, {
    headers: { "Cookie": `my_session_id=${sessionId}` }
  });
  console.log("Underlying Piping Server version:", await res.text());
})();

// Open default browser and get session ID
function getSessionId(richPipingServerUrl) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          // Private Network Access preflights: https://developer.chrome.com/blog/private-network-access-preflight/
          ...(req.headers["access-control-request-private-network"] === "true" ? {
            "Access-Control-Allow-Private-Network": "true",
          }: {}),
          "Access-Control-Max-Age": 86400,
          "Content-Length": 0
        });
        res.end();
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          res.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
          });
          res.end();
          try {
            const sessionId = JSON.parse(body).session_id;
            resolve(sessionId);
          } catch (err) {
            reject(err);
          }
          server.close();
        });
        req.on("error", (err) => {
          server.close();
          reject(err);
        });
      }
    });
    server.listen(0, () => {
      // This ephemeral server is session forward URL
      const sessionForwardUrl = `http://localhost:${server.address().port}`;
      const serverUrl = new URL(richPipingServerUrl);
      serverUrl.searchParams.set("my_session_forward_url", sessionForwardUrl);
      // Open the browser
      // NOTE: This is only for macOS. Use other command for Windows, Linux
      require("child_process").execSync(`open ${serverUrl.href}`);
      // Use `npm install open` and `open(serverUrl.href)`
    });
  });
}
```
</details>

### Run on Docker

Prepare `./config.yaml` and run as follows on Docker.

```bash
docker run -p 8181:8080 -v $PWD/config.yaml:/config.yaml nwtgck/rich-piping-server --config-path=/config.yaml
```

The server runs on <http://localhost:8181>.

## Config examples

Config examples are found in the tests:  
<https://github.com/nwtgck/rich-piping-server/blob/38e9f42d79fa13465d7ac1ec9e3eb0ab8bcc0520/test/config-v1.test.ts#L60-L218>

## Migration from legacy config

The command below prints new config.

```bash
rich-piping-server --config-path=./config.yaml migrate-config
```

New Rich Piping Server supports the legacy config schema without migration.

## Options

```
rich-piping-server [command]

Commands:
  rich-piping-server migrate-config  Print migrated config

Options:
  --help                             Show help                         [boolean]
  --version                          Show version number               [boolean]
  --host                             Bind address (e.g. 127.0.0.1, ::1) [string]
  --http-port                        Port of HTTP server         [default: 8080]
  --enable-https                     Enable HTTPS     [boolean] [default: false]
  --https-port                       Port of HTTPS server               [number]
  --key-path                         Private key path                   [string]
  --crt-path                         Certification path                 [string]
  --config-path, --config-yaml-path  Config YAML path        [string] [required]
```

## Relation to Piping Server
Rich Piping Server uses internally Piping Server as a library:  
<https://github.com/nwtgck/rich-piping-server/blob/7e687bfef0228eea4879c968729b31c0d839347b/src/rich-piping-server.ts#L3>

Transfer logic is completely the same as the original Piping Server.
