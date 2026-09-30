export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const forbidden = (message = 'ليس لديك صلاحية لهذا الإجراء') => new HttpError(403, message);
export const notFound = (message = 'غير موجود') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, message, details);
