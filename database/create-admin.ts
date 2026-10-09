import "reflect-metadata";
import { SQL } from "bun";
import { container } from "tsyringe";
import { registerDependencies } from "../app/container";
import { AdminSchema } from "../app/schemas/auth.schema";
import { AuthService } from "../app/services/auth.service";

// Usage: bun run create-admin "<name>" <email>
// The password is asked for, so it does not stay in the shell history.
// Without a terminal (a script, a CI job) nothing can be asked: set ADMIN_PASSWORD then.
const [name, email] = Bun.argv.slice(2);
if (!name || !email) {
  console.error('Usage: bun run create-admin "<name>" <email>');
  process.exit(1);
}
const password = Bun.env.ADMIN_PASSWORD || prompt("Password:");
if (!password) {
  console.error("No password. Run this in a terminal, or set ADMIN_PASSWORD.");
  process.exit(1);
}
const input = AdminSchema.safeParse({ name, email, password });
if (!input.success) {
  // Every message is a plain sentence with the label of its field.
  for (const issue of input.error.issues) {
    console.error(issue.message);
  }
  process.exit(1);
}
await registerDependencies();
const user = await container.resolve(AuthService).registerAdmin(input.data);
console.log(`Admin created: ${user.email}`);
await container.resolve(SQL).close();
