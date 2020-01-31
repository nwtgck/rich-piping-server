# hidden-piping-server
Hidden Piping Server

## Usage

Run the server as follows.


```bash
npx nwtgck/hidden-piping-server --allow-path=/0s6twklxkrcfs1u
```

Sender and receiver can transfer over `http://localhost:8080/0s6twklxkrcfs1u/path-you-want-to-use`. If the path doesn't start with `/0s6twklxkrcfs1u`, the request is rejected.

## Options

```
Options:
  --help          Show help                                            [boolean]
  --version       Show version number                                  [boolean]
  --http-port     Port of HTTP server                            [default: 8080]
  --enable-https  Enable HTTPS                                  [default: false]
  --https-port    Port of HTTPS server                                  [number]
  --key-path      Private key path                                      [string]
  --crt-path      Certification path                                    [string]
  --allow-path    Allow HTTP path                            [string] [required]
```
