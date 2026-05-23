import { useT } from "../lib/i18n";
import { useSettings } from "../lib/settings";

type Platform = {
  name: string;
  intro: string;
  needsCloudinary: boolean;
  can: string[];
  watch: string[];
};

type HelpContent = {
  flowTitle: string;
  flowSteps: string[];
  schedulerTitle: string;
  schedulerNotes: string[];
  platforms: Platform[];
};

const content: Record<"zh" | "en", HelpContent> = {
  zh: {
    flowTitle: "按下「發布」之後會發生什麼?",
    flowSteps: [
      "如果有圖片或影片要傳到 IG、Threads 等需要外網網址的平台,App 會自動把這些檔案先上傳到你的 Cloudinary。",
      "依照你勾選的平台,依序呼叫對應的官方 API 發文。",
      "不論發布成功或失敗,剛剛上傳到 Cloudinary 的檔案都會立刻被刪掉,不會占用免費額度。",
    ],
    schedulerTitle: "排程發文要注意",
    schedulerNotes: [
      "排程只記錄你選的「本機檔案路徑」,到時間才會去讀檔案上傳/發送。",
      "排程建立後,圖片/影片請留在原本的位置,不要移動、改名、刪除。",
      "外接硬碟或隨身碟上的檔案,如果排程到時裝置沒接,會找不到檔案而失敗。",
      "排程到時電腦必須是開機 + App 在執行(可最小化到系統匣)才會自動發。",
      "如果不確定能不能保留檔案,建議排程前先把媒體複製到固定資料夾再選。",
    ],
    platforms: [
      {
        name: "Instagram",
        intro: "發到 IG 商業帳號或創作者帳號:單圖、輪播、Reels 短影音。",
        needsCloudinary: true,
        can: ["一篇貼文 1 ~ 10 張圖。", "支援 Reels 短影音。"],
        watch: [
          "全部圖片/影片都會自動先傳到 Cloudinary。",
          "單張圖片不要超過 8 MB,建議用 JPEG。",
          "影片不要超過 100 MB、長度 90 秒以內。",
          "IG 官方 API 一個帳號一天最多 50 篇。",
          "IG API 一律公開發布,沒辦法發私人貼文。",
        ],
      },
      {
        name: "Threads",
        intro: "發 Threads 貼文:純文字、圖文、或影片。",
        needsCloudinary: true,
        can: ["可純文字、單一媒體、或最多 10 項輪播。"],
        watch: [
          "圖片/影片會自動傳到 Cloudinary。",
          "影片不要超過 100 MB、長度 5 分鐘以內。",
          "一個帳號一天最多 250 篇 API 貼文。",
          "Threads API 一律公開發布,沒辦法發私人。",
        ],
      },
      {
        name: "YouTube",
        intro: "上傳影片,可以設標題、描述、公開程度。",
        needsCloudinary: false,
        can: [
          "影片從電腦直接上傳,不用先傳到 Cloudinary。",
          "可選擇公開、不公開、私人。",
        ],
        watch: [
          "Google 每天有配額,每上傳一支影片約消耗配額的 16%,所以一天約 6 部就會到上限。",
          "標題必填,沒填會失敗。",
          "如果你的 OAuth App 還在 Testing 模式,只能讓你自己跟最多 100 個測試帳號使用,要對外開放要先送 Google 審核。",
          "Refresh token 如果超過 6 個月沒用就會失效,需要重新授權。",
        ],
      },
      {
        name: "TikTok",
        intro: "上傳影片。可選擇送到 App 收件匣再審,或直接公開發布。",
        needsCloudinary: false,
        can: [
          "兩種發布模式:送到收件匣(在 TikTok App 內二次確認)或直接公開發布。",
          "兩種來源:本機檔案直接傳、或從 Cloudinary 網址抓。",
        ],
        watch: [
          "本機上傳單檔不能超過 64 MiB,本工具不支援切塊,超過要用網址拉的方式。",
          "如果用「從 URL 拉取」模式,必須先到 TikTok 開發者後台把 res.cloudinary.com 加進白名單。",
          "如果你的 App 還沒通過 TikTok 官方審核,只能發 SELF_ONLY(僅自己可見),而且每天上傳次數會被限制得比較嚴。",
          "影片標題最多 2200 字。",
        ],
      },
      {
        name: "Cloudinary",
        intro:
          "本工具用來臨時寄放圖片/影片的雲端,給 IG、Threads、FB 圖文這些只接受公開網址的 API 用。",
        needsCloudinary: false,
        can: [
          "簽名上傳後拿到一個公開網址,發文成功(或失敗)後立刻刪除。",
          "「驗證 Cloudinary」按鈕會去查你的剩餘額度,順便確認三個欄位是同一個帳號的。",
        ],
        watch: [
          "免費方案每月 25 點(約等於 25 GB 儲存 + 傳輸 + 轉檔總和)。",
          "因為發完就會立刻刪掉,正常用不會累積空間。",
          "免費方案單檔圖片不超過 10 MB、單檔影片不超過 100 MB。",
          "如果你只用 YouTube 或 TikTok 本機上傳,完全不需要設 Cloudinary。",
        ],
      },
    ],
  },
  en: {
    flowTitle: "What happens when you press Publish?",
    flowSteps: [
      "If any media is going to IG / Threads / etc. (platforms that need a public URL), the app auto-uploads it to your Cloudinary first.",
      "Then it calls each selected platform's API one by one to publish.",
      "Whether publishing succeeded or failed, the files just uploaded to Cloudinary are deleted immediately so they don't eat free-tier credits.",
    ],
    schedulerTitle: "Heads-up about scheduled posts",
    schedulerNotes: [
      "The scheduler only stores the local file path you picked at scheduling time. It reads the file when the scheduled time arrives.",
      "Once a post is scheduled, do not move, rename, or delete the image/video files — keep them where they were.",
      "Files on external drives or USB sticks will fail to publish if the drive isn't plugged in when the schedule fires.",
      "The schedule only fires while your computer is on and the app is running (minimizing to the tray is fine).",
      "If you're not sure the files will stay put, copy the media into a permanent folder before picking them.",
    ],
    platforms: [
      {
        name: "Instagram",
        intro:
          "Post to a Business / Creator account — single image, carousel, or Reels.",
        needsCloudinary: true,
        can: ["1–10 images per post.", "Reels short video is supported."],
        watch: [
          "All media gets auto-uploaded to Cloudinary first.",
          "Each image ≤ 8 MB, JPEG works best.",
          "Reels videos ≤ 100 MB and ≤ 90 seconds.",
          "IG API allows max 50 posts per account per 24 hours.",
          "IG API only publishes publicly — no private option.",
        ],
      },
      {
        name: "Threads",
        intro: "Text, photo, or video posts to Threads.",
        needsCloudinary: true,
        can: ["Text-only, single media, or up to a 10-item carousel."],
        watch: [
          "Media is auto-uploaded to Cloudinary.",
          "Videos ≤ 100 MB and ≤ 5 minutes.",
          "Max 250 API posts per account per 24 hours.",
          "Always public — no private posting via API.",
        ],
      },
      {
        name: "YouTube",
        intro: "Upload a video with title, description, and privacy setting.",
        needsCloudinary: false,
        can: [
          "Videos upload directly from your computer — no Cloudinary needed.",
          "Choose Public, Unlisted, or Private.",
        ],
        watch: [
          "Google enforces a daily quota — each upload eats about 16%, so roughly 6 videos a day max.",
          "Title is required.",
          "If your OAuth app is in Testing mode, only you and up to 100 test users can use it. Public access requires Google verification.",
          "Refresh tokens revoke after about 6 months of inactivity.",
        ],
      },
      {
        name: "TikTok",
        intro:
          "Upload a video — send to your TikTok inbox for review, or publish directly.",
        needsCloudinary: false,
        can: [
          "Two publish modes: Inbox (you confirm in the TikTok app) or Direct Post (publishes immediately).",
          "Two sources: local file upload, or pull from a Cloudinary URL.",
        ],
        watch: [
          "Local file upload is single-chunk, max 64 MiB. Larger files require Pull-from-URL.",
          "If you use Pull-from-URL, add res.cloudinary.com to the URL prefix whitelist in the TikTok developer console.",
          "Unaudited apps can only publish as SELF_ONLY and hit daily limits faster.",
          "Caption ≤ 2200 characters.",
        ],
      },
      {
        name: "Cloudinary",
        intro:
          "Temporary hosting for images/videos, used only by APIs that require a public URL (IG, Threads, FB photo posts).",
        needsCloudinary: false,
        can: [
          "Signed upload returns a public URL; we delete it immediately after the post.",
          "The Verify button checks your remaining quota and confirms the three credentials belong to the same account.",
        ],
        watch: [
          "Free plan: 25 credits/month (≈ 25 GB of storage + bandwidth + transformations combined).",
          "Because every file is deleted right after publish, normal usage doesn't accumulate.",
          "Free-tier per-file caps: image ≤ 10 MB, video ≤ 100 MB.",
          "If you only use YouTube or TikTok local upload, you don't need Cloudinary at all.",
        ],
      },
    ],
  },
};

const cardCls =
  "border border-(--color-border) bg-(--color-surface) rounded-xl p-5 space-y-4";

function CheckList({
  items,
  variant,
}: {
  items: string[];
  variant: "can" | "watch";
}) {
  const dotCls =
    variant === "can"
      ? "bg-(--color-success)"
      : "bg-(--color-warn,--color-accent)";
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
          <span
            className={`mt-[0.55rem] h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`}
            aria-hidden
          />
          <span className="text-(--color-text)">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Help() {
  const t = useT();
  const { lang } = useSettings();
  const c = content[lang] ?? content.zh;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("helpTitle")}
        </h1>
        <p className="text-sm text-(--color-muted) mt-1">{t("helpSub")}</p>
      </header>

      <section className={cardCls}>
        <h2 className="text-base font-semibold tracking-tight">
          {c.flowTitle}
        </h2>
        <ol className="space-y-3">
          {c.flowSteps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full bg-(--color-accent) text-black text-xs font-semibold">
                {i + 1}
              </span>
              <span className="pt-0.5 text-(--color-text)">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={cardCls}>
        <h2 className="text-base font-semibold tracking-tight">
          {c.schedulerTitle}
        </h2>
        <CheckList items={c.schedulerNotes} variant="watch" />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {c.platforms.map((p) => (
          <section key={p.name} className={cardCls}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight">
                {p.name}
              </h2>
              {p.needsCloudinary && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-(--color-surface-2) text-(--color-muted) whitespace-nowrap">
                  {t("helpNeedCl")}
                </span>
              )}
            </div>
            <p className="text-sm text-(--color-muted) leading-relaxed">
              {p.intro}
            </p>

            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide font-medium text-(--color-success)">
                {t("helpCan")}
              </div>
              <CheckList items={p.can} variant="can" />
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide font-medium text-(--color-muted)">
                {t("helpWatch")}
              </div>
              <CheckList items={p.watch} variant="watch" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
