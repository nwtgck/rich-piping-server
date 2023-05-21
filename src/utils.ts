import * as http from "http";

export function typeAssert<T>(value: T): void { }

export function httpFirstHeaderValue(headers: http.IncomingHttpHeaders, fieldName: string): string | undefined {
  const value = headers[fieldName];
  return Array.isArray(value) ? value[0]: value;
}
