import { z } from "@hono/zod-openapi";

export const UserSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    createdAt: z.iso.datetime(),
  })
  .openapi("User");
