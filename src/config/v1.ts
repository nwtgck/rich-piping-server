import {z} from "zod";
import {ConfigWithoutVersion} from "./without-version";

export const configV1VersionSchema = z.union([z.literal("1"), z.literal(1)]);

export const configV1Schema = z.object({
  version: configV1VersionSchema,
  // "config_for" is for the future standard Piping Server using YAML config, but there is no plan to use YAML in the standard one.
  config_for: z.literal("rich_piping_server"),
  basic_auth_users: z.optional(
    z.array(z.object({
      username: z.string(),
      password: z.string(),
    }))
  ),
  allow_paths: z.optional(z.array(
    z.union([
      z.string(),
      z.object({
        regexp: z.string(),
      }),
      z.object({
        index: z.string(),
      }),
    ]),
  )),
  rejection: z.union([
    z.literal('socket_close'),
    z.object({
      type: z.literal('socket_close'),
    }),
    z.literal('fake_nginx_down'),
    z.object({
      fake_nginx_down: z.object({
        nginx_version: z.string(),
      }),
    }),
  ]),
  experimental_openid_connect: z.optional(z.boolean()),
  openid_connect: z.optional(z.object({
    issuer_url: z.string(),
    client_id: z.string(),
    client_secret: z.string(),
    redirect: z.object({
      uri: z.string(),
      path: z.string(),
    }),
    allow_userinfos: z.array(
      z.union([
        z.object({ sub: z.string() }),
        z.object({
          email: z.string(),
          require_verification: z.optional(z.boolean()),
        }),
      ]),
    ),
    session: z.object({
      forward: z.optional(z.object({
        query_param_name: z.string(),
        allow_url_regexp: z.string(),
      })),
      cookie: z.object({
        name: z.string(),
        http_only: z.boolean(),
      }),
      custom_http_header: z.optional(z.string()),
      age_seconds: z.number(),
    }),
    log: z.optional(z.object({
      userinfo: z.optional(z.object({
        sub: z.boolean(),
        email: z.boolean(),
      })),
    })),
  })),
});
export type ConfigV1 = z.infer<typeof configV1Schema>;

export function migrateToConfigV1(c: ConfigWithoutVersion): ConfigV1 {
  return {
    version: "1",
    config_for: "rich_piping_server",
    basic_auth_users: c.basicAuthUsers?.map(u => ({
      username: u.username,
      password: u.password,
    })),
    allow_paths: c.allowPaths.map(p => {
      if (typeof p === "string") {
        return p;
      }
      return { regexp: p.value };
    }),
    rejection: (() => {
      if (c.rejection === "socket-close") {
        return "socket_close";
      }
      if (c.rejection === "nginx-down") {
        return "fake_nginx_down";
      }
      return {
        "fake_nginx_down": {
          nginx_version: c.rejection.nginxVersion,
        },
      };
    })(),
    experimental_openid_connect: false,
    openid_connect: undefined,
  };
}
