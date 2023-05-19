import * as crypto from "crypto";

type Userinfo = { sub?: string, email?: string }

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
    setTimeout(() => {
      this.sessionIdToUserInfo.delete(sessionId);
    }, this.ageSeconds * 1000);
    return sessionId;
  }

  isValidSessionId(sessionId: string): boolean {
    const userInfo = this.sessionIdToUserInfo.get(sessionId);
    if (userInfo === undefined) {
      return false;
    }
    return new Date().getTime() <= userInfo.createdAt.getTime() + (this.ageSeconds * 1000);
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
