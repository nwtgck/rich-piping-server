import * as http from "http";
import * as http2 from "http2";

export type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
export type HttpRes = http.ServerResponse | http2.Http2ServerResponse;
