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

# Respond a fake nginx 500 down page when rejected
rejection: fake_nginx_down

# Close socket when rejected
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
