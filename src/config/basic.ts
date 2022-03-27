import {z} from "zod";
import {configV1VersionSchema} from "./v1";

export const configBasicSchema = z.object({
  version: z.union([
    z.undefined(),
    configV1VersionSchema,
  ]),
});
