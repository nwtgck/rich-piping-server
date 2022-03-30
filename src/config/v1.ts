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
  allow_paths: z.array(
    z.union([
      z.string(),
      z.object({
        regexp: z.string(),
      }),
      z.object({
        new_index: z.string(),
      }),
    ]),
  ),
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
  };
}
