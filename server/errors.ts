export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'not_found', m);
export const badRequest = (m: string) => new HttpError(400, 'invalid', m);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Please sign in');
