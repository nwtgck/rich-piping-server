# rich-piping-server
![Node CI](https://github.com/nwtgck/rich-piping-server/workflows/Node%20CI/badge.svg)

Rich [Piping Server](https://github.com/nwtgck/piping-server)

## Usage

Prepare `config.yaml` as follows.

```yaml
# config.yml
allowPaths:
  - /0s6twklxkrcfs1u
  - type: regexp
    value: "/[abcd]+"
basicAuthUsers:
  - username: user1
    password: pass1234
rejection: nginx-down
```

Run the server as follows. The config is hot-reloaded.

```bash
npx nwtgck/rich-piping-server --config-yaml-path=config.yaml
```

Sender and receiver can transfer over `http://localhost:8080/0s6twklxkrcfs1u` or `http://localhost:8080/aacacdb/path-you-want-to-use` with basic auth. If the path is not `/0s6twklxkrcfs1u`, not starting with `/aacacdb` or etc., requests are rejected.

### Run on Docker

Prepare `./config.yaml` and run as follows on Docker.

```bash
docker run -p 8181:8080 -v $PWD/config.yaml:/config.yaml nwtgck/rich-piping-server --config-yaml-path=/config.yaml
```

The server runs on <http://localhost:8181>.

## Config syntax

The config YAML syntax is strictly typed with [io-ts](https://github.com/gcanti/io-ts). The definition of config is as follows:  
<https://github.com/nwtgck/rich-piping-server/blob/005cf373032967b91a6166c19857c29450ba9419/src/rich-piping-server.ts#L15-L45>

You can see other parameters and what fields are optional.

## Options

```
Options:
  --help              Show help                                        [boolean]
  --version           Show version number                              [boolean]
  --http-port         Port of HTTP server                        [default: 8080]
  --enable-https      Enable HTTPS                              [default: false]
  --https-port        Port of HTTPS server                              [number]
  --key-path          Private key path                                  [string]
  --crt-path          Certification path                                [string]
  --config-yaml-path  Config YAML path                       [string] [required]
```
