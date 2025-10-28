/**
 * Example auth provider module for Google Cloud Run IAM ID tokens.
 *
 * Usage (settings.json):
 * {
 *   "mcpServers": {
 *     "cloud-run-server": {
 *       "url": "https://example.run.app/sse",
 *       "auth": {
 *         "module": "./examples/auth-providers/google-id-token-provider.mjs",
 *         "options": {
 *           "audience": "example.run.app" // optional, falls back to server hostname
 *         }
 *       }
 *     }
 *   }
 * }
 */

import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

function decodeTokenExpiry(idToken) {
  try {
    const [, payload] = idToken.split('.');
    if (!payload) {
      return undefined;
    }
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const data = JSON.parse(json);
    if (typeof data.exp === 'number') {
      return data.exp * 1000; // convert seconds to ms
    }
  } catch {
    // Ignore parse errors; caller will treat token as non-cacheable
  }
  return undefined;
}

export default function createGoogleIdTokenProvider(options = {}, context) {
  const auth = new GoogleAuth();
  let cachedToken;
  let cachedExpiry;
  let clientInformation;

  const targetAudience = (() => {
    if (typeof options.audience === 'string' && options.audience.length > 0) {
      return options.audience;
    }
    const url = context.mcpServerConfig.url || context.mcpServerConfig.httpUrl;
    if (!url) {
      throw new Error(
        'google-id-token provider requires an MCP server url or explicit audience',
      );
    }
    return new URL(url).hostname;
  })();

  return {
    redirectUrl: '',
    clientMetadata: {
      client_name: 'Gemini CLI (Google ID Token)',
      redirect_uris: [],
      grant_types: [],
      response_types: [],
      token_endpoint_auth_method: 'none',
    },
    clientInformation() {
      return clientInformation;
    },
    saveClientInformation(info) {
      clientInformation = info;
    },
    async tokens() {
      const now = Date.now();
      if (
        cachedToken &&
        cachedExpiry &&
        now < cachedExpiry - 5 * 60 * 1000 // 5 minute buffer
      ) {
        return cachedToken;
      }

      const idClient = await auth.getIdTokenClient(targetAudience);
      const idToken =
        await idClient.idTokenProvider.fetchIdToken(targetAudience);

      const token = {
        access_token: idToken,
        token_type: 'Bearer',
      };

      const expiryTime = decodeTokenExpiry(idToken);
      if (expiryTime) {
        cachedToken = token;
        cachedExpiry = expiryTime;
      } else {
        cachedToken = undefined;
        cachedExpiry = undefined;
      }

      return token;
    },
    saveTokens() {
      // no-op, tokens handled internally
    },
    redirectToAuthorization() {
      // no-op
    },
    saveCodeVerifier() {
      // no-op
    },
    codeVerifier() {
      return '';
    },
  };
}
