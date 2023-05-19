import {NormalizedConfig} from "./config/normalized-config";
import * as openidClient from "openid-client";

type GenerateOpenIdClientParams = { issuerUrl: string, clientId: string, clientSecret: string, redirectUri: string }

export class ConfigRef {
  private config: NormalizedConfig| undefined;
  private previousGenerateOpenIdClientParams: GenerateOpenIdClientParams | undefined;
  private cachedOpenidClientPromise: Promise<openidClient.BaseClient> | undefined;

  constructor() { }

  set(config: NormalizedConfig) {
    this.config = config;
    if (config.openid_connect !== undefined) {
      const openid_connect = config.openid_connect;
      const params: GenerateOpenIdClientParams = {
        issuerUrl: openid_connect.issuer_url,
        clientId: openid_connect.client_id,
        clientSecret: openid_connect.client_secret,
        redirectUri: openid_connect.redirect.uri,
      };
      if (JSON.stringify(params) !== JSON.stringify(this.previousGenerateOpenIdClientParams)) {
        this.cachedOpenidClientPromise = generateOpenIdClient(params);
      }
      this.previousGenerateOpenIdClientParams = params;
    }
  }

  get(): NormalizedConfig | undefined {
    return this.config;
  }

  get openidClientPromise(): Promise<openidClient.BaseClient> | undefined {
    return this.cachedOpenidClientPromise;
  }
}

async function generateOpenIdClient({issuerUrl, clientId, clientSecret, redirectUri}: GenerateOpenIdClientParams): Promise<openidClient.BaseClient> {
  const issuer= await openidClient.Issuer.discover(issuerUrl);
  const client = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: ["code"],
  });
  return client;
}
