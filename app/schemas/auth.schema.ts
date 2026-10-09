import { z } from "@hono/zod-openapi";
import { Role } from "../constants/role.constants";
import { email, id, name, newPassword, text } from "./fields";
import { UserSchema } from "./user.schema";

const personName = text("Name", 100, { min: 1 }).openapi({ example: "Aung Aung" });
const password = newPassword("Password").openapi({
  example: "a-long-password",
});

const account = {
  name: personName,
  email: email().openapi({ example: "aung@example.com" }),
  password,
};

/** Input of the create-admin script. */
export const AdminSchema = z.object(account);

export const CreateUserSchema = z
  .object({
    ...account,
    companyId: id("Company").optional().openapi({
      description: "Leave it out for my own company. Only an admin can name another company.",
    }),
  })
  .openapi("CreateUserInput");

export const RegisterSchema = z
  .object({
    ...account,
    // `admin` is not in the list on purpose. Nobody can sign up as an admin.
    role: z
      .enum([Role.Supplier, Role.Customer], "Choose supplier or customer.")
      .openapi({ example: Role.Customer }),
    companyName: name("Company name", 100).openapi({ example: "Aung Trading" }),
  })
  .openapi("RegisterInput");

export const LoginSchema = z
  .object({
    email: email().openapi({ example: "aung@example.com" }),
    password: text("Password", 128, { min: 1, trim: false }).openapi({
      example: "a-long-password",
    }),
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

export const UpdateMeSchema = z.object({ name: personName }).openapi("UpdateMeInput");

export const ChangePasswordSchema = z
  .object({
    currentPassword: text("Current password", 128, { min: 1, trim: false }),
    newPassword: newPassword("New password"),
  })
  .openapi("ChangePasswordInput");

export const ResetPasswordSchema = z
  .object({ newPassword: newPassword("New password") })
  .openapi("ResetPasswordInput");

export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type AdminInput = z.infer<typeof AdminSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
