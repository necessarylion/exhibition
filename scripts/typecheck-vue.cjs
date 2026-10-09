// Checks the types of the `.vue` files (and of everything they import).
// vue-tsc works by changing the JavaScript compiler of TypeScript. TypeScript 7 is a
// native program with no such compiler, so vue-tsc gets TypeScript 6 here.
// `tsc` itself (TypeScript 7) still checks every `.ts` file.
require("vue-tsc").run(require.resolve("typescript-6/lib/tsc"));
