import { Actor, ProxyConfiguration } from 'apify';

import type { ProxyInput } from './types.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function getProxyConfig(userConfig: ProxyInput = {}): Promise<ProxyConfiguration | undefined> {
  if (userConfig instanceof ProxyConfiguration) {
    return userConfig;
  }

  const proxyUrls = Array.isArray(userConfig.proxyUrls)
    ? userConfig.proxyUrls.filter(isNonEmptyString)
    : [];

  if (proxyUrls.length > 0) {
    return Actor.createProxyConfiguration({
      proxyUrls,
      checkAccess: userConfig.checkAccess ?? false,
    });
  }

  const useApifyProxy = userConfig.useApifyProxy ?? true;

  if (!useApifyProxy) {
    return undefined;
  }

  const groups = Array.isArray(userConfig.apifyProxyGroups) && userConfig.apifyProxyGroups.length > 0
    ? userConfig.apifyProxyGroups
    : Array.isArray(userConfig.groups) && userConfig.groups.length > 0
      ? userConfig.groups
      : ['RESIDENTIAL'];
  const countryCode = userConfig.apifyProxyCountry ?? userConfig.countryCode ?? 'TR';

  return Actor.createProxyConfiguration({
    useApifyProxy,
    groups,
    countryCode,
    checkAccess: userConfig.checkAccess ?? false,
    tieredProxyConfig: userConfig.tieredProxyConfig ?? [
      {
        groups: ['RESIDENTIAL'],
        countryCode,
      },
      {
        countryCode,
      },
    ],
  });
}
