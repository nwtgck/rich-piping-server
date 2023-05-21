import * as crypto from "crypto";

type Userinfo = { sub?: string, email?: string, email_verified?: boolean }

export class OpenIdConnectUserStore {
  private ageSeconds: number = 0;
  private sessionIdToUserInfoWithDate: Map<string, { userinfo: Userinfo, createdAt: Date }> = new Map();

  setAgeSeconds(seconds: number) {
    this.ageSeconds = seconds;
  }

  setUserinfo(userinfo: Userinfo): string {
    const sessionId = this.generateSessionId();
    this.sessionIdToUserInfoWithDate.set(sessionId, {
      userinfo,
      createdAt: new Date(),
    });
    const timer = setTimeout(() => {
      this.sessionIdToUserInfoWithDate.delete(sessionId);
    }, this.ageSeconds * 1000);
    timer.unref();
    return sessionId;
  }

  findValidUserInfo(sessionId: string): Userinfo | undefined {
    const userinfoWithDate = this.sessionIdToUserInfoWithDate.get(sessionId);
    if (userinfoWithDate === undefined) {
      return undefined;
    }
    const {userinfo, createdAt} = userinfoWithDate;
    if (new Date().getTime() <= createdAt.getTime() + (this.ageSeconds * 1000)) {
      return userinfo;
    }
    this.sessionIdToUserInfoWithDate.delete(sessionId);
    return undefined;
  }

  private generateSessionId(): string {
    while (true) {
      const sessionId = crypto.randomBytes(64).toString("base64url");
      if (!this.sessionIdToUserInfoWithDate.has(sessionId)) {
        return sessionId;
      }
    }
  }
}
