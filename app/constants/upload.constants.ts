/** Uploaded files are served under this URL and stored in `<storageDir>/uploads`. */
export const UPLOADS_URL = "/uploads";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// A multipart request is a little bigger than the file inside it.
export const MAX_PHOTO_REQUEST_BYTES = MAX_PHOTO_BYTES + 64 * 1024;
