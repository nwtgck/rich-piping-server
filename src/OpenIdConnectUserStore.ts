import * as crypto from "crypto";

type Userinfo = { sub?: string, email?: string, email_verified?: boolean }

export class OpenIdConnectUserStore {
  private ageSeconds: number = 0;
  private sessionIdToUserInfo: Map<string, Userinfo & { createdAt: Date }> = new Map();

  setAgeSeconds(seconds: number) {
    this.ageSeconds = seconds;
  }

  setUserinfo(userInfo: Userinfo): string {
    const sessionId = this.generateSessionId();
    this.sessionIdToUserInfo.set(sessionId, {
      ...userInfo,
      createdAt: new Date(),
    });
    const timer = setTimeout(() => {
      this.sessionIdToUserInfo.delete(sessionId);
    }, this.ageSeconds * 1000);
    timer.unref();
    return sessionId;
  }

  findValidUserInfo(sessionId: string): Userinfo | undefined {
    const userInfo = this.sessionIdToUserInfo.get(sessionId);
    if (userInfo === undefined) {
      return undefined;
    }
    if (new Date().getTime() <= userInfo.createdAt.getTime() + (this.ageSeconds * 1000)) {
      return userInfo;
    }
    this.sessionIdToUserInfo.delete(sessionId);
    return undefined;
  }

  private generateSessionId(): string {
    while (true) {
      const sessionId = crypto.randomBytes(64).toString("base64url");
      if (!this.sessionIdToUserInfo.has(sessionId)) {
        return sessionId;
      }
    }
  }
}
