import { z } from "@hono/zod-openapi";
import { Company } from "../models/company.model";

/**
 * The input fields of the API are built here. Every message is a plain sentence with the
 * label of the field, so a page can show it as it is.
 */

// Control characters. PostgreSQL refuses a NUL in text, and the others break a page.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this pattern finds them on purpose.
const CONTROL = /[\u0000-\u001F\u007F]/;
// A text of more than one line may have a tab and line breaks.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this pattern finds them on purpose.
const CONTROL_MANY_LINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
function isOneCleanLine(value: string): boolean {
  return !CONTROL.test(value);
}

function isCleanText(value: string): boolean {
  return !CONTROL_MANY_LINES.test(value);
}

interface TextOptions {
  /** The shortest text. 0 lets the field be empty. */
  min?: number;
  /** True for a text of more than one line, like notes. */
  manyLines?: boolean;
  /** The message for a missing or empty value. */
  required?: string;
  /** False keeps the spaces at both ends, for a password. */
  trim?: boolean;
}

/** A text field. Every text input of the API uses it, so no control character gets in. */
export function text(label: string, max: number, options: TextOptions = {}) {
  const min = options.min ?? 0;
  const required = options.required ?? `${label} is required.`;
  const tooShort = min > 1 ? `${label} is too short. Use at least ${min} characters.` : required;
  const base = options.trim === false ? z.string(required) : z.string(required).trim();
  return base
    .min(min, tooShort)
    .max(max, `${label} is too long. Use up to ${max} characters.`)
    .refine(
      options.manyLines ? isCleanText : isOneCleanLine,
      `${label} has a character that is not allowed.`,
    );
}

/**
 * The name of a company or of a group. Two names that look the same must be the same text,
 * so the name is stored in one form: Unicode NFKC, no invisible character, one space between
 * words and none at the ends.
 */
export function name(label: string, max: number) {
  return z
    .string(`${label} is required.`)
    .transform(Company.cleanName)
    .pipe(text(label, max, { min: 1 }));
}

// The passwords that everybody tries first. All are 8 characters or longer.
const EASY_PASSWORDS = [
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "abc12345",
];

function isNotEasy(value: string): boolean {
  return !EASY_PASSWORDS.includes(value.toLowerCase());
}

/** A password that somebody chooses: 8 characters or more, and not one that is easy to guess. */
export function newPassword(label: string) {
  return text(label, 128, { min: 8, trim: false }).refine(
    isNotEasy,
    `${label} is too easy to guess. Choose another one.`,
  );
}

/** A whole number from `min` to `max`. */
export function whole(label: string, min: number, max: number) {
  return z
    .int(`${label} must be a whole number.`)
    .min(min, `${label} cannot be below ${min}.`)
    .max(max, `${label} is too high.`);
}

const FIRST_DATE = "2000-01-01";
const LAST_DATE = "2100-12-31";

/** YYYY-MM-DD texts compare like dates. */
function isSensibleDate(value: string): boolean {
  return value >= FIRST_DATE && value <= LAST_DATE;
}

/** A date as YYYY-MM-DD text, from 2000 to 2100. A year like 9999 is a typing mistake. */
export function date(label: string) {
  return (
    z.iso
      // `abort`: a text that is no date gets only this message, not the range message too.
      .date({ error: `${label} must be a date like 2026-11-20.`, abort: true })
      .refine(isSensibleDate, `${label} must be between ${FIRST_DATE} and ${LAST_DATE}.`)
      .openapi({ example: "2026-11-20" })
  );
}

export function email() {
  return z
    .string("Email is required.")
    .trim()
    .toLowerCase()
    .pipe(z.email("Email is not valid.").max(255, "Email is too long."));
}

/** The id of a record, in the body of a request. */
export function id(label: string) {
  return z.uuid(`${label} is not valid.`);
}
