import type { Context } from "hono";
import { singleton } from "tsyringe";
import { TOTAL_COUNT_HEADER } from "../constants/paging.constants";
import type { AppEnv } from "../middleware/bearer-auth.middleware";
import type {
  ChangePasswordInput,
  CreateUserInput,
  ResetPasswordInput,
  UpdateMeInput,
} from "../schemas/auth.schema";
import type { UserListQuery, UserParam } from "../schemas/user.schema";
import { AuthService } from "../services/auth.service";
import { UserService } from "../services/user.service";

type ListContext = Context<
  AppEnv,
  string,
  { in: { query: UserListQuery }; out: { query: UserListQuery } }
>;
type CreateContext = Context<
  AppEnv,
  string,
  { in: { json: CreateUserInput }; out: { json: CreateUserInput } }
>;
type RemoveContext = Context<
  AppEnv,
  string,
  { in: { param: UserParam }; out: { param: UserParam } }
>;
type UpdateMeContext = Context<
  AppEnv,
  string,
  { in: { json: UpdateMeInput }; out: { json: UpdateMeInput } }
>;
type ChangePasswordContext = Context<
  AppEnv,
  string,
  { in: { json: ChangePasswordInput }; out: { json: ChangePasswordInput } }
>;
type ResetPasswordContext = Context<
  AppEnv,
  string,
  {
    in: { param: UserParam; json: ResetPasswordInput };
    out: { param: UserParam; json: ResetPasswordInput };
  }
>;

@singleton()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  me(c: Context<AppEnv>) {
    return c.json(c.get("user").toPublic(), 200);
  }

  async list(c: ListContext) {
    const query = c.req.valid("query");
    const page = await this.userService.list(c.get("user"), query, query.companyId);
    const result = [];
    for (const user of page.rows) {
      result.push(user.toPublic());
    }
    c.header(TOTAL_COUNT_HEADER, String(page.total));
    return c.json(result, 200);
  }

  async updateMe(c: UpdateMeContext) {
    const user = await this.userService.rename(c.get("user"), c.req.valid("json").name);
    return c.json(user.toPublic(), 200);
  }

  async changePassword(c: ChangePasswordContext) {
    await this.authService.changePassword(c.get("user"), c.get("token"), c.req.valid("json"));
    return c.body(null, 204);
  }

  async resetPassword(c: ResetPasswordContext) {
    await this.userService.resetPassword(
      c.get("user"),
      c.req.valid("param").id,
      c.req.valid("json").newPassword,
    );
    return c.body(null, 204);
  }

  async create(c: CreateContext) {
    const user = await this.userService.create(c.get("user"), c.req.valid("json"));
    return c.json(user.toPublic(), 201);
  }

  async remove(c: RemoveContext) {
    await this.userService.remove(c.get("user"), c.req.valid("param").id);
    return c.body(null, 204);
  }
}
