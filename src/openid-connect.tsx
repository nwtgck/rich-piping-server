import * as cookie from "cookie";
import {NormalizedConfig} from "./config/normalized-config";
import {OpenIdConnectUserStore} from "./OpenIdConnectUserStore";
import * as http from "http";
import * as http2 from "http2";
import {Logger} from "log4js";
import * as openidClient from "openid-client";
import { h } from 'preact';
import {renderToString} from "preact-render-to-string";
import {z} from "zod";

type HttpReq = http.IncomingMessage | http2.Http2ServerRequest;
type HttpRes = http.ServerResponse | http2.Http2ServerResponse;

const oidcStateScheme = z.object({
  return_to: z.string(),
  session_forward_url: z.optional(z.string()),
});

type OidcState = z.infer<typeof oidcStateScheme>

type OidcConfig = NonNullable<NormalizedConfig["openid_connect"]>;

export async function handleOpenIdConnect({logger, openIdConnectUserStore, codeVerifier, codeChallenge, client, oidcConfig, req, res}: {
  logger: Logger | undefined,
  client: openidClient.BaseClient,
  codeVerifier: string,
  codeChallenge: string,
  openIdConnectUserStore: OpenIdConnectUserStore
  oidcConfig: OidcConfig,
  req: HttpReq,
  res: HttpRes,
}): Promise<"authorized" | "responded"> {
  // Always set because config may be hot reloaded
  openIdConnectUserStore.setAgeSeconds(oidcConfig.session.age_seconds);
  const url = new URL(req.url!, `http://${req.headers.host}`);
  if (url.pathname === oidcConfig.redirect.path) {
    await handleRedirect(logger, client, codeVerifier, openIdConnectUserStore, oidcConfig, req, res);
    return "responded";
  }
  const parsedCookie = cookie.parse(req.headers.cookie ?? "");
  const sessionId: string | undefined = parsedCookie[oidcConfig.session.cookie.name];
  if (sessionId === undefined) {
    startAuthorization(client, codeChallenge, oidcConfig, req, res);
    return "responded";
  }
  const userinfo = openIdConnectUserStore.findValidUserInfo(sessionId);
  if (userinfo === undefined) {
    startAuthorization(client, codeChallenge, oidcConfig, req, res);
    return "responded";
  }
  if (!userinfoIsAllowed(oidcConfig.allow_userinfos, userinfo)) {
    res.writeHead(400, {"Content-Type": "text/plain"});
    res.end(`NOT allowed user: ${JSON.stringify(userinfo)}\n`);
    return "responded";
  }
  if (oidcConfig.session.forward !== undefined) {
    const sessionForwardUrl: string | null = url.searchParams.get(oidcConfig.session.forward.query_param_name);
    if (sessionForwardUrl !== null) {
      respondForwardHtml({
        // Already Cookie is set
        setCookieValue: undefined,
        sessionId,
        allowSessionForwardUrlRegexp: oidcConfig.session.forward.allow_url_regexp,
        sessionForwardUrl,
        res
      });
      return "responded";
    }
  }
  return "authorized";
}

function userinfoIsAllowed(allowUserinfos: OidcConfig["allow_userinfos"], userinfo: { sub?: string, email?: string, email_verified?: boolean }): boolean {
  const allowedUserinfo = allowUserinfos.find(u => {
    if ("sub" in u) {
      return u.sub === userinfo.sub;
    }
    if ("email" in u) {
      if (u.email !== userinfo.email) {
        return false;
      }
      if (u.require_verification ?? true) {
        return userinfo.email_verified ?? false;
      }
      return true;
    }
    return false;
  });
  return allowedUserinfo !== undefined;
}

// usually go to login page
function startAuthorization(client: openidClient.BaseClient, codeChallenge: string, oidcConfig: OidcConfig, req: HttpReq, res: HttpRes) {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const state: OidcState = {
    return_to: req.url!,
    ...(oidcConfig.session.forward === undefined ? {} : {
      session_forward_url: url.searchParams.get(oidcConfig.session.forward.query_param_name) ?? undefined
    }),
  };
  // Start authorization request
  const authorizationUrl = client.authorizationUrl({
    scope: "openid email",
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: JSON.stringify(state),
  });
  res.writeHead(302, {Location: authorizationUrl});
  res.end();
}

async function handleRedirect(logger: Logger | undefined, client: openidClient.BaseClient, codeVerifier: string, openIdConnectUserStore: OpenIdConnectUserStore, oidcConfig: OidcConfig, req: HttpReq, res: HttpRes): Promise<void> {
  const params = client.callbackParams(req);
  let oidcState: OidcState | undefined;
  try {
    oidcState = oidcStateScheme.parse(JSON.parse(params.state ?? ""));
  } catch {

  }
  try {
    const tokenSet = await client.callback(oidcConfig.redirect.uri, params, {
      state: params.state,
      code_verifier: codeVerifier,
    });
    if (tokenSet.access_token === undefined) {
      res.writeHead(400);
      res.end("Access token not set\n");
      return;
    }
    const userinfo = await client.userinfo(tokenSet.access_token);
    if (!userinfoIsAllowed(oidcConfig.allow_userinfos, userinfo)) {
      res.writeHead(400, {"Content-Type": "text/plain"});
      res.end(`NOT allowed user: ${JSON.stringify(userinfo)}\n`);
      return;
    }
    const newSessionId = openIdConnectUserStore.setUserinfo(userinfo);
    const setCookieValue = cookie.serialize(oidcConfig.session.cookie.name, newSessionId, {
      httpOnly: oidcConfig.session.cookie.http_only,
      maxAge: oidcConfig.session.age_seconds,
    });
    if (oidcConfig.session.forward !== undefined && oidcState?.session_forward_url !== undefined) {
      respondForwardHtml({
        setCookieValue,
        sessionId: newSessionId,
        allowSessionForwardUrlRegexp: oidcConfig.session.forward.allow_url_regexp,
        sessionForwardUrl: oidcState.session_forward_url,
        res,
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Set-Cookie": setCookieValue,
    });
    if (oidcState?.return_to === undefined) {
      res.end(`allowed: ${JSON.stringify(userinfo)}\n`);
    } else {
      // HTML meta redirection for Set-Cookie
      res.end(renderToString(
        <html>
        <head>
          <meta http-equiv="refresh" content={`0;${oidcState.return_to}`}></meta>
        </head>
        </html>
      ));
    }
  } catch (err: unknown) {
    logger?.info(err);
    res.writeHead(400);
    res.end();
  }
}

function respondForwardHtml({setCookieValue, sessionId, allowSessionForwardUrlRegexp, sessionForwardUrl, res}: {
  setCookieValue: string | undefined,
  sessionId: string,
  allowSessionForwardUrlRegexp: string,
  sessionForwardUrl: string,
  res: HttpRes
}) {
  if (!new RegExp(allowSessionForwardUrlRegexp).test(sessionForwardUrl)) {
    res.writeHead(400, {
      "Content-Type": "text/html",
      ...(setCookieValue === undefined ? {} : {
        "Set-Cookie": setCookieValue,
      }),
    });
    res.end("session forward URL is not allowed\n");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html",
    ...(setCookieValue === undefined ? {} : {
      "Set-Cookie": setCookieValue,
    }),
  });
  const sendingBody: string = JSON.stringify({
    session_id: sessionId,
  });
  // language=js
  const browserScript = `
const sessionForwardUrl = ${JSON.stringify(sessionForwardUrl)};
const body = ${JSON.stringify(sendingBody)};
const retryMax = 10;

(async () => {
  for (let i = 0; i < retryMax; i++) {
    try {
      const res = await fetch(sessionForwardUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        body,
      });
      if (res.ok) {
        break;
      }
    } catch (err) {
      console.error(err);
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  window.close();
})();`;
  res.end(renderToString(
    <html>
    <script dangerouslySetInnerHTML={{__html: browserScript}}>
    </script>
    </html>
  ));
}
