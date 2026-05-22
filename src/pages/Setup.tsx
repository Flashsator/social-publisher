import { useEffect, useState } from "react";
import { vault, oauth, type FbPage, type Platform } from "../lib/tauri";

type CardState = {
  busy: boolean;
  error: string | null;
  info: string | null;
};

const card = "border border-(--color-border) bg-(--color-surface) rounded-xl p-5 space-y-4";
const label = "block text-xs uppercase tracking-wide text-(--color-muted) mb-1";
const input =
  "w-full bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm focus:outline-none focus:border-(--color-accent)";
const btn =
  "px-3 py-2 rounded-md bg-(--color-accent) text-black text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "px-3 py-2 rounded-md bg-(--color-surface-2) text-(--color-text) text-sm font-medium hover:bg-(--color-border) disabled:opacity-50";
const pill = (ok: boolean) =>
  `inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
    ok
      ? "bg-(--color-success)/15 text-(--color-success)"
      : "bg-(--color-surface-2) text-(--color-muted)"
  }`;

function useVaultField(key: string) {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    vault.get(key).then((v) => {
      if (cancelled) return;
      setValue(v ?? "");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const save = async (v: string) => {
    setValue(v);
    if (v) await vault.set(key, v);
    else await vault.delete(key);
  };
  return { value, setValue, save, loaded };
}

function StatusRow({ status, name }: { status: Record<string, boolean>; name: string }) {
  const ok = !!status[name];
  return <span className={pill(ok)}>{ok ? "Connected" : "Not set"}</span>;
}

export default function Setup() {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const refreshStatus = async () => {
    const list = await vault.status();
    const obj: Record<string, boolean> = {};
    for (const [k, v] of list) obj[k] = v;
    setStatus(obj);
  };
  useEffect(() => {
    refreshStatus();
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="text-sm text-(--color-muted)">
          Paste your own Meta App and Cloudinary credentials. Nothing leaves your machine — every
          value is stored in your OS keychain.
        </p>
      </header>

      <FacebookCard status={status} refresh={refreshStatus} />
      <InstagramCard status={status} refresh={refreshStatus} />
      <ThreadsCard status={status} refresh={refreshStatus} />
      <YouTubeCard status={status} refresh={refreshStatus} />
      <TikTokCard status={status} refresh={refreshStatus} />
      <CloudinaryCard status={status} refresh={refreshStatus} />

      <DangerZone refresh={refreshStatus} />
    </div>
  );
}

function CardShell({
  title,
  accent,
  badge,
  children,
}: {
  title: string;
  accent: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={card}>
      <header className="flex items-center gap-3">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: accent }}
        />
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="ml-auto">{badge}</div>
      </header>
      {children}
    </section>
  );
}

function ErrorLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-(--color-danger) bg-(--color-danger)/10 px-3 py-2 rounded-md">
      {msg}
    </p>
  );
}
function InfoLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-(--color-success) bg-(--color-success)/10 px-3 py-2 rounded-md">
      {msg}
    </p>
  );
}

function FacebookCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const appId = useVaultField("fb_app_id");
  const appSecret = useVaultField("fb_app_secret");
  const pageId = useVaultField("fb_page_id");
  const pageToken = useVaultField("fb_page_token");
  const [pages, setPages] = useState<FbPage[]>([]);
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!appId.value || !appSecret.value) throw new Error("App ID and Secret are required");
      const result = await oauth.flow(
        "facebook" as Platform,
        appId.value,
        appSecret.value
      );
      const list = await oauth.facebookListPages(result.access_token);
      setPages(list);
      setS({
        busy: false,
        error: null,
        info: `Got ${list.length} Page(s) — pick the one to publish to.`,
      });
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  const choosePage = async (p: FbPage) => {
    await pageId.save(p.id);
    await pageToken.save(p.access_token);
    setS({ busy: false, error: null, info: `Saved Page: ${p.name}` });
    refresh();
  };

  return (
    <CardShell
      title="Facebook Page"
      accent="#1877f2"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="fb_app_id" />
          <StatusRow status={status} name="fb_page_token" />
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>App ID</label>
          <input
            className={input}
            value={appId.value}
            onChange={(e) => appId.setValue(e.currentTarget.value)}
            onBlur={(e) => appId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>App Secret</label>
          <input
            className={input}
            type="password"
            value={appSecret.value}
            onChange={(e) => appSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => appSecret.save(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btn} disabled={s.busy} onClick={connect}>
          {s.busy ? "Waiting for browser…" : "Connect via OAuth"}
        </button>
        {pageId.value && (
          <span className="text-xs text-(--color-muted)">
            Active Page: <span className="text-(--color-text)">{pageId.value}</span>
          </span>
        )}
      </div>

      {pages.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-(--color-muted)">Select a Page:</div>
          <div className="grid grid-cols-2 gap-2">
            {pages.map((p) => (
              <button
                key={p.id}
                className={`${btnGhost} text-left`}
                onClick={() => choosePage(p)}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-(--color-muted)">{p.id}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function InstagramCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const appId = useVaultField("ig_app_id");
  const appSecret = useVaultField("ig_app_secret");
  const userId = useVaultField("ig_user_id");
  const token = useVaultField("ig_token");
  const expires = useVaultField("ig_token_expires_at");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!appId.value || !appSecret.value) throw new Error("App ID and Secret are required");
      const r = await oauth.flow("instagram", appId.value, appSecret.value);
      const uid = await oauth.instagramResolveUser(r.access_token);
      await token.save(r.access_token);
      await userId.save(uid);
      if (r.expires_in) {
        const expAt = Date.now() + r.expires_in * 1000;
        await expires.save(String(expAt));
      }
      setS({ busy: false, error: null, info: `Connected as IG user ${uid}` });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title="Instagram"
      accent="#e1306c"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="ig_app_id" />
          <StatusRow status={status} name="ig_token" />
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>App ID</label>
          <input
            className={input}
            value={appId.value}
            onChange={(e) => appId.setValue(e.currentTarget.value)}
            onBlur={(e) => appId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>App Secret</label>
          <input
            className={input}
            type="password"
            value={appSecret.value}
            onChange={(e) => appSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => appSecret.save(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btn} disabled={s.busy} onClick={connect}>
          {s.busy ? "Waiting for browser…" : "Connect via OAuth"}
        </button>
        {userId.value && (
          <span className="text-xs text-(--color-muted)">
            IG user: <span className="text-(--color-text)">{userId.value}</span>
          </span>
        )}
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function ThreadsCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const appId = useVaultField("th_app_id");
  const appSecret = useVaultField("th_app_secret");
  const userId = useVaultField("th_user_id");
  const token = useVaultField("th_token");
  const expires = useVaultField("th_token_expires_at");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!appId.value || !appSecret.value) throw new Error("App ID and Secret are required");
      const r = await oauth.flow("threads", appId.value, appSecret.value);
      const uid = await oauth.threadsResolveUser(r.access_token);
      await token.save(r.access_token);
      await userId.save(uid);
      if (r.expires_in) {
        const expAt = Date.now() + r.expires_in * 1000;
        await expires.save(String(expAt));
      }
      setS({ busy: false, error: null, info: `Connected as Threads user ${uid}` });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title="Threads"
      accent="#a855f7"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="th_app_id" />
          <StatusRow status={status} name="th_token" />
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>App ID</label>
          <input
            className={input}
            value={appId.value}
            onChange={(e) => appId.setValue(e.currentTarget.value)}
            onBlur={(e) => appId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>App Secret</label>
          <input
            className={input}
            type="password"
            value={appSecret.value}
            onChange={(e) => appSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => appSecret.save(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btn} disabled={s.busy} onClick={connect}>
          {s.busy ? "Waiting for browser…" : "Connect via OAuth"}
        </button>
        {userId.value && (
          <span className="text-xs text-(--color-muted)">
            Threads user: <span className="text-(--color-text)">{userId.value}</span>
          </span>
        )}
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function YouTubeCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const clientId = useVaultField("yt_client_id");
  const clientSecret = useVaultField("yt_client_secret");
  const refreshToken = useVaultField("yt_refresh_token");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!clientId.value || !clientSecret.value)
        throw new Error("Client ID and Secret are required");
      const r = await oauth.flow("youtube", clientId.value, clientSecret.value);
      if (!r.refresh_token) {
        throw new Error(
          "Google returned no refresh_token. Make sure the OAuth consent screen has been re-approved (revoke prior access in your Google account and reconnect)."
        );
      }
      await refreshToken.save(r.refresh_token);
      setS({
        busy: false,
        error: null,
        info: "Connected — refresh token saved.",
      });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title="YouTube"
      accent="#ff0000"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="yt_client_id" />
          <StatusRow status={status} name="yt_refresh_token" />
        </div>
      }
    >
      <p className="text-xs text-(--color-muted)">
        Create OAuth credentials in Google Cloud Console with scope{" "}
        <code>youtube.upload</code>. Add{" "}
        <code>http://127.0.0.1/callback</code> as the authorized redirect URI (the
        loopback port is chosen at runtime — Google accepts any port on 127.0.0.1).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Client ID</label>
          <input
            className={input}
            value={clientId.value}
            onChange={(e) => clientId.setValue(e.currentTarget.value)}
            onBlur={(e) => clientId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>Client Secret</label>
          <input
            className={input}
            type="password"
            value={clientSecret.value}
            onChange={(e) => clientSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => clientSecret.save(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btn} disabled={s.busy} onClick={connect}>
          {s.busy ? "Waiting for browser…" : "Connect via OAuth"}
        </button>
        {refreshToken.value && (
          <span className="text-xs text-(--color-muted)">
            Refresh token stored ✓
          </span>
        )}
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function TikTokCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const clientId = useVaultField("tt_client_id");
  const clientSecret = useVaultField("tt_client_secret");
  const refreshToken = useVaultField("tt_refresh_token");
  const openId = useVaultField("tt_open_id");
  const [s, setS] = useState<CardState>({ busy: false, error: null, info: null });

  const connect = async () => {
    setS({ busy: true, error: null, info: null });
    try {
      if (!clientId.value || !clientSecret.value)
        throw new Error("Client Key and Secret are required");
      const r = await oauth.flow("tiktok", clientId.value, clientSecret.value);
      if (!r.refresh_token) throw new Error("TikTok returned no refresh_token");
      await refreshToken.save(r.refresh_token);
      if (r.open_id) await openId.save(r.open_id);
      setS({
        busy: false,
        error: null,
        info: `Connected${r.open_id ? ` as ${r.open_id}` : ""}.`,
      });
      refresh();
    } catch (e) {
      setS({ busy: false, error: String(e), info: null });
    }
  };

  return (
    <CardShell
      title="TikTok"
      accent="#25f4ee"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="tt_client_id" />
          <StatusRow status={status} name="tt_refresh_token" />
        </div>
      }
    >
      <p className="text-xs text-(--color-muted)">
        Register an app on the TikTok Developer Portal. Add scopes{" "}
        <code>user.info.basic, video.upload, video.publish</code> and add{" "}
        <code>res.cloudinary.com</code> to the URL prefix whitelist (TikTok requires
        Cloudinary URLs to be pre-authorized for PULL_FROM_URL).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Client Key</label>
          <input
            className={input}
            value={clientId.value}
            onChange={(e) => clientId.setValue(e.currentTarget.value)}
            onBlur={(e) => clientId.save(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>Client Secret</label>
          <input
            className={input}
            type="password"
            value={clientSecret.value}
            onChange={(e) => clientSecret.setValue(e.currentTarget.value)}
            onBlur={(e) => clientSecret.save(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={btn} disabled={s.busy} onClick={connect}>
          {s.busy ? "Waiting for browser…" : "Connect via OAuth"}
        </button>
        {openId.value && (
          <span className="text-xs text-(--color-muted)">
            open_id: <span className="text-(--color-text)">{openId.value}</span>
          </span>
        )}
      </div>

      <ErrorLine msg={s.error} />
      <InfoLine msg={s.info} />
    </CardShell>
  );
}

function CloudinaryCard({
  status,
  refresh,
}: {
  status: Record<string, boolean>;
  refresh: () => void;
}) {
  const cn = useVaultField("cl_cloud_name");
  const ak = useVaultField("cl_api_key");
  const as = useVaultField("cl_api_secret");

  const saveAll = async () => {
    await Promise.all([
      cn.save(cn.value),
      ak.save(ak.value),
      as.save(as.value),
    ]);
    refresh();
  };

  return (
    <CardShell
      title="Cloudinary"
      accent="#3448c5"
      badge={
        <div className="flex gap-2">
          <StatusRow status={status} name="cl_cloud_name" />
          <StatusRow status={status} name="cl_api_secret" />
        </div>
      }
    >
      <p className="text-xs text-(--color-muted)">
        Used to host images for Instagram and Threads, which require a public URL.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label}>Cloud name</label>
          <input
            className={input}
            value={cn.value}
            onChange={(e) => cn.setValue(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>API key</label>
          <input
            className={input}
            value={ak.value}
            onChange={(e) => ak.setValue(e.currentTarget.value)}
          />
        </div>
        <div>
          <label className={label}>API secret</label>
          <input
            className={input}
            type="password"
            value={as.value}
            onChange={(e) => as.setValue(e.currentTarget.value)}
          />
        </div>
      </div>
      <button className={btn} onClick={saveAll}>
        Save Cloudinary credentials
      </button>
    </CardShell>
  );
}

function DangerZone({ refresh }: { refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const wipe = async () => {
    if (!confirm("Erase ALL stored credentials from the OS keychain?")) return;
    setBusy(true);
    try {
      await vault.wipeAll();
      await refresh();
      location.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${card} border-(--color-danger)/30`}>
      <h2 className="text-lg font-semibold text-(--color-danger)">Danger zone</h2>
      <p className="text-xs text-(--color-muted)">
        Removes every key this app has stored from your OS keychain.
      </p>
      <button
        className="px-3 py-2 rounded-md bg-(--color-danger) text-black text-sm font-medium disabled:opacity-50"
        disabled={busy}
        onClick={wipe}
      >
        {busy ? "Wiping…" : "Wipe all credentials"}
      </button>
    </section>
  );
}
