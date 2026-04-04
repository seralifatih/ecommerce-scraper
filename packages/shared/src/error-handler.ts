import { ErrorType } from './types.js';

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export function classifyError(error: Error, statusCode?: number): ErrorType {
  const message = error.message.toLowerCase();
  const errorCode = 'code' in error && typeof error.code === 'string' ? error.code : undefined;

  if (/captcha|recaptcha|hcaptcha|robot check|challenge/.test(message)) {
    return ErrorType.CAPTCHA;
  }

  if (statusCode === 429 || statusCode === 503 || /rate limit|too many requests/.test(message)) {
    return ErrorType.RATE_LIMITED;
  }

  if (statusCode === 401 || statusCode === 403 || /forbidden|access denied|blocked/.test(message)) {
    return ErrorType.BLOCKED;
  }

  if (error instanceof SyntaxError || /parse|selector|schema|invalid json|unexpected token/.test(message)) {
    return ErrorType.PARSE_ERROR;
  }

  if ((errorCode && NETWORK_ERROR_CODES.has(errorCode)) || /network|socket|timeout|dns|fetch failed/.test(message)) {
    return ErrorType.NETWORK_ERROR;
  }

  return ErrorType.NETWORK_ERROR;
}

export function shouldRetry(errorType: ErrorType): boolean {
  return errorType === ErrorType.RATE_LIMITED || errorType === ErrorType.NETWORK_ERROR;
}

export function getRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(1_000 * (2 ** safeAttempt), 30_000);
}
