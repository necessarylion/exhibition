import { z } from "@hono/zod-openapi";
import { UserSchema } from "./user.schema";

const email = z.string().trim().toLowerCase().pipe(z.email().max(255));

export const RegisterSchema = z
  .object({
    name: z.string().trim().min(1).max(100).openapi({ example: "Aung Aung" }),
    email: email.openapi({ example: "aung@example.com" }),
    password: z.string().min(8).max(128).openapi({ example: "a-long-password" }),
  })
  .openapi("RegisterInput");

export const LoginSchema = z
  .object({
    email: email.openapi({ example: "aung@example.com" }),
    password: z.string().min(1).max(128).openapi({ example: "a-long-password" }),
  })
  .openapi("LoginInput");

export const AuthSchema = z
  .object({
    token: z.string().openapi({ description: "Send it as `Authorization: Bearer <token>`." }),
    tokenType: z.literal("Bearer"),
    expiresAt: z.iso.datetime(),
    user: UserSchema,
  })
  .openapi("Auth");

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
