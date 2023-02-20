import {type ConfigV1} from "./v1";

export type NormalizedConfig = {
  basic_auth_users: Array<{
    username: string,
    password: string,
  }> | undefined,
  allow_paths: Array<
    | { type: "path", value: string }
    | { type: "regexp", value: string }
    | { type: "index", value: string }
  > | undefined,
  rejection:
    | { type: "socket_close" }
    | { type: "fake_nginx_down", nginx_version: string }
};

const defaultFakeNginxVersion = "1.17.8";

export function normalizeConfigV1(c: ConfigV1): NormalizedConfig {
  return {
    basic_auth_users: c.basic_auth_users,
    allow_paths: c.allow_paths?.map(p => {
      if (typeof p === "string") {
        return { type: "path", value: p };
      }
      if ("regexp" in p) {
        return { type: "regexp", value: p.regexp };
      }
      return { type: "index", value: p.index };
    }),
    rejection: (() => {
      if (c.rejection === "socket_close") {
        return { type: "socket_close" };
      }
      if (c.rejection === "fake_nginx_down") {
        return { type: "fake_nginx_down", nginx_version: defaultFakeNginxVersion };
      }
      if ("type" in c.rejection) {
        return { type: "socket_close" };
      }
      return { type: "fake_nginx_down", nginx_version: c.rejection.fake_nginx_down.nginx_version };
    })(),
  };
}
