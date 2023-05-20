// base: https://github.com/panva/node-oidc-provider/blob/37a036bbefd534bf42e410483ab4b25fc744b2cc/example/standalone.js

import * as http from "http";
import {AccountStore, mockAccount} from './account-store';
import {koaRouter} from './koa-router';
import type Provider from 'oidc-provider';
import * as jose from "node-jose";
import type {Configuration} from "oidc-provider";

export async function serveOpenIdProvider({ port, clientId, clientSecret, redirectUri }: {
  port: number,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
}): Promise<http.Server> {
  const accountStore = new AccountStore();
  accountStore.set(mockAccount);
  accountStore.setLogin(mockAccount);
  const Provider = (await eval(`import('oidc-provider')`)).default;
  const MemoryAdapter = (await eval(`import('oidc-provider/lib/adapters/memory_adapter.js')`)).default;
  const rsaKey = await jose.JWK.createKeyStore().generate("RSA", 2048, {
    alg: 'RS256',
    use: 'sig',
  });
  const ecKey = await jose.JWK.createKeyStore().generate("EC", "P-256", {
    use: 'sig',
  });
  const issuerUrl =  `http://localhost:${port}`;
  const configuration: Configuration = {
    clients: [
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_types: ['refresh_token', 'authorization_code'],
        redirect_uris: [redirectUri],
      },
    ],
    interactions: {
      url(ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },
    cookies: {
      keys: ['some secret key', 'and also the old rotated away some time ago', 'and one more'],
    },
    claims: {
      address: ['address'],
      email: ['email', 'email_verified'],
      phone: ['phone_number', 'phone_number_verified'],
      profile: ['birthdate', 'family_name', 'gender', 'given_name', 'locale', 'middle_name', 'name',
        'nickname', 'picture', 'preferred_username', 'profile', 'updated_at', 'website', 'zoneinfo'],
    },
    findAccount: accountStore.findAccount,
    features: {
      devInteractions: { enabled: false }, // defaults to true

      deviceFlow: { enabled: true }, // defaults to false
      revocation: { enabled: true }, // defaults to false
    },
    jwks: {
      keys: [
        rsaKey.toJSON(true),
        ecKey.toJSON(true),
      ],
    },
    // To disable "oidc-provider WARNING: a quick start development-only in-memory adapter is used, you MUST change it in order to not lose all stateful provider data upon restart and to be able to share these between processes"
    adapter: new Proxy(MemoryAdapter, {
      get(...args) {
        return Reflect.get(...args);
      },
      set(...args) {
        return Reflect.set(...args);
      }
    }),
    ttl: { AccessToken: 60, IdToken: 60, Interaction: 60, Grant: 60, Session: 60 },
  };

  const provider: Provider = new Provider(issuerUrl, configuration);

  provider.app.context.render = async function (view: unknown, _context: unknown) {
    const ctx = this;
    ctx.type = 'html';
    ctx.body = `<h1>DUMMY HTML</h1>view=${view}, _context=${JSON.stringify(_context)}`;
  };
  provider.use(koaRouter(provider, accountStore).routes());
  return new Promise(resolve => {
    const server = provider.listen(port, () => {
      resolve(server);
    });
  })
}
