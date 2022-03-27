import * as http from "http";
import * as http2 from "http2";
import * as getPort from "get-port";
import * as piping from "piping-server";
import * as log4js from "log4js";

/**
 * Listen on the specify port
 * @param server
 * @param port
 */
function listenPromise(server: http.Server | http2.Http2Server, port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });
}

/**
 * Close the server
 * @param server
 */
export function closePromise(server: http.Server | http2.Http2Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

export async function servePromise(): Promise<{ pipingPort: number, pipingUrl: string, pipingServer: http.Server }> {
  // Create a logger
  const logger = log4js.getLogger();
  // Get available port
  const pipingPort = await getPort();
  // Define Piping URL
  const pipingUrl = `http://localhost:${pipingPort}`;
  // Create a Piping server
  const pipingServer = http.createServer(new piping.Server({logger}).generateHandler(false));
  // Listen on the port
  await listenPromise(pipingServer, pipingPort);

  return {
    pipingPort,
    pipingUrl,
    pipingServer,
  };
}
