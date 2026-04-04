export type Platform = 'trendyol' | 'hepsiburada' | 'n11';

export interface BaseRecord {
  scrapedAt: string;
  platform: Platform;
  sourceUrl: string;
  dataVersion: string;
}

export interface PriceInfo {
  amount: number;
  currency: string;
}

export interface ProxyInput {
  useApifyProxy?: boolean;
  apifyProxyGroups?: string[];
  apifyProxyCountry?: string;
  groups?: string[];
  countryCode?: string;
  proxyUrls?: string[];
  checkAccess?: boolean;
  tieredProxyConfig?: Array<Record<string, unknown>>;
}

export enum ErrorType {
  BLOCKED = 'BLOCKED',
  RATE_LIMITED = 'RATE_LIMITED',
  PARSE_ERROR = 'PARSE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CAPTCHA = 'CAPTCHA',
}
