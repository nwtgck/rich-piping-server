# hidden-piping-server
Hidden [Piping Server](https://github.com/nwtgck/piping-server)

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
npx nwtgck/hidden-piping-server --config-yaml-path=config.yaml
```

Sender and receiver can transfer over `http://localhost:8080/0s6twklxkrcfs1u/path-you-want-to-use` with basic auth. If the path doesn't start with `/0s6twklxkrcfs1u`, `/aacacdb` or etc., requests is rejected.

## Config syntax

The config YAML syntax is strictly typed with [io-ts](https://github.com/gcanti/io-ts). The definition of config is as follows:  
<https://github.com/nwtgck/hidden-piping-server/blob/45ce65177e2cdcc2f6d0513e964e84aa78504a70/src/hidden-piping-server.ts#L15-L45>

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
