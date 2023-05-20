// base: https://github.com/panva/node-oidc-provider/blob/37a036bbefd534bf42e410483ab4b25fc744b2cc/example/support/account.js

import type {FindAccount, Account, ClaimsParameterMember} from "oidc-provider";

class MockAccount implements Account {
  constructor(readonly accountId: string) { }

  [key: string]: unknown;

  async claims(use: string, scope: string, claims: { [key: string]: null | ClaimsParameterMember }, rejected: string[]) {
    // NOTE: always same account claims because of mock
    return {
      sub: this.accountId,
      address: {
        country: '000',
        formatted: '000',
        locality: '000',
        postal_code: '000',
        region: '000',
        street_address: '000',
      },
      birthdate: '1987-10-16',
      email: 'johndoe@example.com',
      email_verified: false,
      family_name: 'Doe',
      gender: 'male',
      given_name: 'John',
      locale: 'en-US',
      middle_name: 'Middle',
      name: 'John Doe',
      nickname: 'Johny',
      phone_number: '+49 000 000000',
      phone_number_verified: false,
      picture: 'http://lorempixel.com/400/200/',
      preferred_username: 'johnny',
      profile: 'https://johnswebsite.com',
      updated_at: 1454704946,
      website: 'http://example.com',
      zoneinfo: 'Europe/Berlin',
    };
  }
}

export const mockAccount = new MockAccount("user001");

export class AccountStore {
  private store: Map<string, MockAccount> = new Map();
  private logins: Map<string, MockAccount> = new Map();

  set(account: MockAccount) {
    this.store.set(account.accountId, account);
  }

  setLogin(account: MockAccount) {
    this.logins.set(account.accountId, account);
  }

  async findByLogin(login: string) {
    return this.logins.get(login);
  }

  findAccount: FindAccount = async (ctx, sub, token) => {
    return this.store.get(sub);
  };
}
