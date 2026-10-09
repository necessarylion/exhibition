import { rm } from "node:fs/promises";
import { singleton } from "tsyringe";
import { AppConfig } from "../config/app.config";
import { ErrorCode } from "../constants/api.constants";
import { MAX_PHOTO_BYTES, UPLOADS_URL } from "../constants/upload.constants";
import { AppError } from "../errors/app.error";

// ponytail: photos are files on the local disk. Move them to an object storage when the app
// runs on more than one server.
// ponytail: anyone who has the URL can open a photo. The file name is random, so it cannot be
// guessed. Serve photos through an endpoint with a token check if they must be private.
@singleton()
export class PhotoStorageService {
  constructor(private readonly config: AppConfig) {}

  /** Checks the file and saves it. Returns the new file name. */
  async save(file: File): Promise<string> {
    if (file.size > MAX_PHOTO_BYTES) {
      throw new AppError(413, ErrorCode.FileTooLarge, "The photo can be up to 5 MB.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = this.detectExtension(bytes);
    if (!extension) {
      throw new AppError(422, ErrorCode.InvalidFile, "The photo must be a JPG, PNG or WebP file.");
    }
    const name = `${crypto.randomUUID()}.${extension}`;
    await Bun.write(this.pathOf(name), bytes);
    return name;
  }

  async remove(name: string): Promise<void> {
    await rm(this.pathOf(name), { force: true });
  }

  /**
   * Reads the first bytes of the file. The file name and the type sent by the browser
   * are not trusted, because the user controls them.
   */
  private detectExtension(bytes: Uint8Array): string | null {
    if (this.startsWith(bytes, [0xff, 0xd8, 0xff])) {
      return "jpg";
    }
    if (this.startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return "png";
    }
    // WebP: "RIFF", 4 bytes for the size, then "WEBP".
    const isRiff = this.startsWith(bytes, [0x52, 0x49, 0x46, 0x46]);
    if (isRiff && this.startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
      return "webp";
    }
    return null;
  }

  private startsWith(bytes: Uint8Array, signature: number[]): boolean {
    for (let index = 0; index < signature.length; index++) {
      if (bytes[index] !== signature[index]) {
        return false;
      }
    }
    return true;
  }

  private pathOf(name: string): string {
    return `${this.config.storageDir}${UPLOADS_URL}/${name}`;
  }
}
