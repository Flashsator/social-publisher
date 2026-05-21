import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cloudinary,
  publish,
  vault,
  type Platform,
  type PublishResult,
} from "../lib/tauri";
import { PLATFORMS } from "../lib/platforms";

type ImageItem = {
  localPath: string;
  remoteUrl: string | null;
  uploading: boolean;
  error: string | null;
};

type Result = { platform: Platform; ok: boolean; message: string; permalink?: string | null };

const card = "border border-(--color-border) bg-(--color-surface) rounded-xl p-5 space-y-4";
const btn =
  "px-3 py-2 rounded-md bg-(--color-accent) text-black text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "px-3 py-2 rounded-md bg-(--color-surface-2) text-(--color-text) text-sm font-medium hover:bg-(--color-border) disabled:opacity-50";

const fileName = (p: string) => {
  const norm = p.replace(/\\/g, "/");
  return norm.split("/").pop() ?? p;
};

export default function Compose() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selected, setSelected] = useState<Record<Platform, boolean>>({
    facebook: true,
    instagram: false,
    threads: false,
  });
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [vaultMap, setVaultMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    vault.status().then((list) => {
      const obj: Record<string, boolean> = {};
      for (const [k, v] of list) obj[k] = v;
      setVaultMap(obj);
    });
  }, []);

  const cloudinaryConfigured =
    !!vaultMap.cl_cloud_name && !!vaultMap.cl_api_key && !!vaultMap.cl_api_secret;

  const allRemote = useMemo(
    () => images.length === 0 || images.every((i) => i.remoteUrl),
    [images]
  );

  const pickImages = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const next = paths.map<ImageItem>((p) => ({
      localPath: p as string,
      remoteUrl: null,
      uploading: false,
      error: null,
    }));
    setImages((prev) => [...prev, ...next]);
  };

  const removeImage = (idx: number) =>
    setImages((prev) => prev.filter((_, i) => i !== idx));

  const uploadAll = async () => {
    const cn = await vault.get("cl_cloud_name");
    const ak = await vault.get("cl_api_key");
    const as = await vault.get("cl_api_secret");
    if (!cn || !ak || !as) {
      alert("Cloudinary credentials not set. Go to Setup first.");
      return;
    }
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img.remoteUrl || img.uploading) continue;
      setImages((prev) =>
        prev.map((x, idx) => (idx === i ? { ...x, uploading: true, error: null } : x))
      );
      try {
        const r = await cloudinary.upload({
          cloudName: cn,
          apiKey: ak,
          apiSecret: as,
          filePath: img.localPath,
        });
        setImages((prev) =>
          prev.map((x, idx) =>
            idx === i ? { ...x, remoteUrl: r.url, uploading: false } : x
          )
        );
      } catch (e) {
        setImages((prev) =>
          prev.map((x, idx) =>
            idx === i ? { ...x, uploading: false, error: String(e) } : x
          )
        );
      }
    }
  };

  const doPublish = async () => {
    setPublishing(true);
    setResults([]);
    const out: Result[] = [];
    const urls = images.map((i) => i.remoteUrl!).filter(Boolean);

    for (const p of PLATFORMS) {
      if (!selected[p.id]) continue;
      try {
        let r: PublishResult;
        if (p.id === "facebook") {
          const pageId = await vault.get("fb_page_id");
          const pageToken = await vault.get("fb_page_token");
          if (!pageId || !pageToken) throw new Error("Facebook Page not connected");
          r = await publish.facebook({ pageId, pageToken, text, imageUrls: urls });
        } else if (p.id === "instagram") {
          const igUserId = await vault.get("ig_user_id");
          const accessToken = await vault.get("ig_token");
          if (!igUserId || !accessToken) throw new Error("Instagram not connected");
          r = await publish.instagram({
            igUserId,
            accessToken,
            text,
            imageUrls: urls,
          });
        } else {
          const thUserId = await vault.get("th_user_id");
          const accessToken = await vault.get("th_token");
          if (!thUserId || !accessToken) throw new Error("Threads not connected");
          r = await publish.threads({
            thUserId,
            accessToken,
            text,
            imageUrls: urls,
          });
        }
        out.push({
          platform: p.id,
          ok: true,
          message: `Posted (${r.post_id})`,
          permalink: r.permalink,
        });
      } catch (e) {
        out.push({ platform: p.id, ok: false, message: String(e) });
      }
      setResults([...out]);
    }
    setPublishing(false);
  };

  const anySelected = Object.values(selected).some(Boolean);
  const igSelected = selected.instagram;
  const igNeedsImage = igSelected && images.length === 0;
  const canPublish =
    !publishing && anySelected && !igNeedsImage && allRemote && (text.length > 0 || images.length > 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
        <p className="text-sm text-(--color-muted)">
          One post → Facebook Page, Instagram, and Threads.
        </p>
      </header>

      <section className={card}>
        <label className="text-xs uppercase tracking-wide text-(--color-muted)">Text</label>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="What do you want to publish?"
          className="w-full bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-(--color-accent)"
        />
        <CharCounters text={text} selected={selected} />
      </section>

      <section className={card}>
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Images</h2>
            <p className="text-xs text-(--color-muted)">
              Required by Instagram. Optional for Facebook and Threads.
            </p>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={pickImages}>
              + Add images
            </button>
            <button
              className={btn}
              onClick={uploadAll}
              disabled={!cloudinaryConfigured || images.length === 0 || allRemote}
              title={
                !cloudinaryConfigured
                  ? "Set Cloudinary credentials in Setup first"
                  : ""
              }
            >
              Upload to Cloudinary
            </button>
          </div>
        </header>

        {images.length === 0 ? (
          <p className="text-xs text-(--color-muted)">No images attached.</p>
        ) : (
          <ul className="space-y-2">
            {images.map((img, i) => (
              <li
                key={i}
                className="flex items-center gap-3 bg-(--color-bg) border border-(--color-border) rounded-md px-3 py-2 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{fileName(img.localPath)}</div>
                  <div className="text-xs text-(--color-muted) truncate">
                    {img.remoteUrl ? img.remoteUrl : img.localPath}
                  </div>
                  {img.error && (
                    <div className="text-xs text-(--color-danger)">{img.error}</div>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    img.remoteUrl
                      ? "bg-(--color-success)/15 text-(--color-success)"
                      : img.uploading
                        ? "bg-(--color-accent)/15 text-(--color-accent)"
                        : "bg-(--color-surface-2) text-(--color-muted)"
                  }`}
                >
                  {img.remoteUrl ? "uploaded" : img.uploading ? "uploading…" : "local"}
                </span>
                <button
                  className="text-xs text-(--color-muted) hover:text-(--color-danger)"
                  onClick={() => removeImage(i)}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Publish to</h2>
        <div className="grid grid-cols-3 gap-3">
          {PLATFORMS.map((p) => {
            const connectedKey =
              p.id === "facebook"
                ? "fb_page_token"
                : p.id === "instagram"
                  ? "ig_token"
                  : "th_token";
            const connected = !!vaultMap[connectedKey];
            return (
              <label
                key={p.id}
                className={`flex items-center gap-3 px-3 py-3 rounded-md border cursor-pointer transition-colors ${
                  selected[p.id]
                    ? "border-(--color-accent) bg-(--color-accent)/10"
                    : "border-(--color-border) bg-(--color-bg) hover:border-(--color-muted)"
                } ${!connected ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected[p.id]}
                  disabled={!connected}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [p.id]: e.currentTarget.checked }))
                  }
                />
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: p.accent }}
                />
                <div>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-(--color-muted)">
                    {connected ? "Connected" : "Not connected"}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {igNeedsImage && (
          <p className="text-xs text-(--color-danger)">
            Instagram requires at least one image.
          </p>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button className={btn} onClick={doPublish} disabled={!canPublish}>
          {publishing ? "Publishing…" : "Publish"}
        </button>
        {!allRemote && images.length > 0 && (
          <span className="text-xs text-(--color-muted)">
            Upload images to Cloudinary before publishing.
          </span>
        )}
      </div>

      {results.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-semibold">Results</h2>
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li
                key={i}
                className={`text-sm px-3 py-2 rounded-md ${
                  r.ok
                    ? "bg-(--color-success)/10 text-(--color-success)"
                    : "bg-(--color-danger)/10 text-(--color-danger)"
                }`}
              >
                <span className="font-semibold capitalize">{r.platform}</span>: {r.message}{" "}
                {r.permalink && (
                  <a
                    href={r.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-(--color-accent)"
                  >
                    open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CharCounters({
  text,
  selected,
}: {
  text: string;
  selected: Record<Platform, boolean>;
}) {
  const len = text.length;
  return (
    <div className="flex gap-4 text-xs text-(--color-muted)">
      {PLATFORMS.filter((p) => selected[p.id]).map((p) => {
        if (p.charLimit == null) return null;
        const over = len > p.charLimit;
        return (
          <span
            key={p.id}
            className={over ? "text-(--color-danger) font-medium" : ""}
          >
            {p.label}: {len} / {p.charLimit}
          </span>
        );
      })}
    </div>
  );
}
