import {z} from "zod";

// Legacy config

const socketCloseRejectionSchema = z.literal('socket-close');
const nginxDownRejectionSchema = z.union([
  z.literal('nginx-down'),
  z.object({
    type: z.literal('nginx-down'),
    nginxVersion: z.string(),
  })
]);
const rejectionSchema = z.union([socketCloseRejectionSchema, nginxDownRejectionSchema]);
export const configWihtoutVersionSchema = z.object({
  basicAuthUsers: z.union([
    z.array(z.object({
      username: z.string(),
      password: z.string(),
    })),
    z.undefined(),
  ]),
  allowPaths: z.array(
    z.union([
      z.string(),
      z.object({
        type: z.literal('regexp'),
        value: z.string(),
      })
    ])
  ),
  rejection: rejectionSchema,
});
export type ConfigWithoutVersion = z.infer<typeof configWihtoutVersionSchema>;
