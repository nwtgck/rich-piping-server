// (base: https://github.com/nwtgck/http-knocking/blob/47a894a377845beb88b95cf3d27042efb632cbe6/src/fake-response-generator.ts)
import * as http from "http";
import * as http2 from "http2";
import * as useragent from "useragent";

export function fakeNginxResponse(res: http.ServerResponse | http2.Http2ServerResponse, nginxVersion: string, userAgent: string): void {
  // (INFO: Ruby one-liner(localhost:8181 is an actual Nginx Server): puts `curl -i -H 'User-Agent: Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1)' localhost:8081`.split("\r\n").map{|e| (e+"\r\n").inspect}.join(" +\n")
  const body =
    "<html>\r\n" +
    "<head><title>500 Internal Server Error</title></head>\r\n" +
    "<body bgcolor=\"white\">\r\n" +
    "<center><h1>500 Internal Server Error</h1></center>\r\n" +
    `<hr><center>nginx/${nginxVersion}</center>\r\n` +
    "</body>\r\n" +
    "</html>\r\n" +
    (
      useragent.is(userAgent).ie || useragent.is(userAgent).chrome ?
      "<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n" +
      "<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n" +
      "<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n" +
      "<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n" +
      "<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n" +
      "<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n" :

      ""
    );

  if ("shouldKeepAlive" in res) {
    res.shouldKeepAlive = false;
  }
  // TODO: set false
  res.writeHead(500, "Internal Server Error", {
    "Server": `nginx/${nginxVersion}`,
    "Date": new Date().toUTCString(), // (from: https://github.com/nodejs/node/blob/8b4af64f50c5e41ce0155716f294c24ccdecad03/lib/internal/http.js#L9)
    "Content-Type": "text/html",
    "Content-Length": body.length
  });
  res.end(body);
}