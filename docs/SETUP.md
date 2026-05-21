# Social Publisher 申請與設定教學

這份文件給「拿到這個 app 但沒申請過 Meta 開發者帳號」的人。照著做一次就能用，全程免費、不需要被 Meta 審核（用 **Development mode** 即可）。

> **資料隱私說明**：所有你填的 App ID / Secret / Token 都只存在你電腦的 OS 金鑰庫（Windows Credential Manager / macOS Keychain），不會上傳任何地方。原始碼可審。

---

## 你需要先準備

1. 一個 Facebook **個人帳號**（用來申請 Meta 開發者）
2. 你要發文的 **Facebook 粉絲專頁**（Page）
3. 一個 **Instagram 專業帳號**（商業 / 創作者皆可，個人帳號不行）
4. 一個 **Threads 帳號**（綁同一個 IG 即可）
5. 一個免費的 **Cloudinary** 帳號（用來託管圖片）

---

## Step 1 — 申請 Meta 開發者

1. 開瀏覽器到 <https://developers.facebook.com/>
2. 右上角 **登入** → 用你的 Facebook 帳號登入
3. 接受開發者條款（第一次會跳出來）
4. 點 **My Apps** → **Create App**

> **重要**：Meta 把同一個 App 分三種「Product」（FB Pages、IG、Threads）。一個 App 可以同時啟用三個 Product，**所以你只要建一個 App 就好**。

### 1.1 建立 App

- **Use case**：選 **Other**（這個選項才會讓你 enable 全部 Product）→ Next
- **App type**：選 **Business** → Next
- 填 **App name**（隨便取，例如「My Publisher」）和 **Email**
- **Business Portfolio**：選你自己的（沒有的話跳過）
- 點 **Create App**

### 1.2 記下 App ID 和 App Secret

進到 App Dashboard 後：

- 左側選單 → **App settings** → **Basic**
- 上面就是 **App ID**（一串數字）
- **App secret** 右邊有 **Show**，點下去輸入你的 FB 密碼後會顯示一串亂碼

**這兩個值待會三平台都會用到，先放記事本。**

---

## Step 2 — 設定 OAuth Redirect URI（三平台都要設）

App Dashboard 左側 → **App settings** → **Basic**，往下捲到最底，按 **Save Changes** 一次（確保你按過儲存）。

接著三平台都要把 `http://127.0.0.1` 加進 redirect URI 白名單。每個平台位置不一樣，照下面做：

### 2.1 Facebook Login

1. 左側 → **Add Product** → 找 **Facebook Login for Business** → **Set up**
2. 左側 → **Facebook Login for Business** → **Settings**
3. **Valid OAuth Redirect URIs**：貼上
   ```
   http://127.0.0.1
   ```
   （只要這一行，不要加埠號 — 我們的 app 會隨機選 port，Meta 的白名單只比對 host）
4. **Allow HTTP redirect URIs**：開啟（127.0.0.1 是 HTTP，必須勾這個）
5. **Save changes**

### 2.2 Instagram

1. 左側 → **Add Product** → **Instagram** → **Set up**
2. 左側 → **Instagram** → **API setup with Instagram Login**
3. 區塊 **3. Set up Instagram business login**：
   - **OAuth redirect URIs**：點 **Add Callback URL** → 貼 `http://127.0.0.1/` → 儲存
   - **Deauthorize callback URL** 隨意填一個（不會用到，但欄位必填）
   - **Data deletion request URL** 同上
4. 區塊 **1. Generate access tokens** 下方會列出可用的 IG 帳號 — 如果還沒看到你的 IG，先做 Step 4（把 IG 加進測試帳號）再回來

### 2.3 Threads

1. 左側 → **Add Product** → **Threads API** → **Set up**
2. 左側 → **Use cases** → **Threads API** → **Customize**
3. 在 **Permissions** 區塊確認有勾：
   - `threads_basic`
   - `threads_content_publish`
4. 在 **Settings** 區塊：
   - **Redirect Callback URLs**：貼 `http://127.0.0.1/`
   - **Save**

---

## Step 3 — 取得各種 ID

### 3.1 Facebook Page ID

1. 到你的粉絲專頁
2. 左側選單拉到底 → **About** → 往下找 **Page ID**
3. 記下這串數字

> Social Publisher 在你 OAuth 完之後會自動列出你管理的所有 Page 讓你選，**通常不需要手動填這個**，但備著以防萬一。

### 3.2 Instagram User ID

不用手動找，OAuth 完 Social Publisher 會自動解析。

### 3.3 Threads User ID

同上，OAuth 自動解析。

---

## Step 4 — 加入測試帳號（讓 IG / Threads 能授權）

因為 App 還沒過審核（Development mode），只有「被加進測試名單」的 Facebook 使用者可以拿到 token。**這個帳號就是你自己**，所以加你自己進去就好。

### 4.1 加 FB 測試人員

App Dashboard 左側 → **App roles** → **Roles** → **Add People** → **Developers** → 輸入你自己的 FB 名字 / Email → 送出。再用同一個 FB 帳號去信箱接受邀請（或登入 developers.facebook.com → My Apps 應該會跳出來）。

### 4.2 加 IG 測試帳號

- 左側 → **Instagram** → **API setup with Instagram Login**
- 區塊 **1. Generate access tokens** → **Add account**
- 用要發文的 IG 帳號登入，授權

### 4.3 加 Threads 測試帳號

- 左側 → **Use cases** → **Threads API** → **Customize**
- 找到 **Threads Tester** 區塊 → **Add Threads Testers**
- 輸入你的 Threads handle（不需 @）

---

## Step 5 — 申請 Cloudinary（圖片要用）

1. 到 <https://cloudinary.com/users/register_free> 註冊（用 Google 登入最快）
2. 註冊完進到 Dashboard 第一頁就會看到三個值：
   - **Cloud name**（例如 `dxxxxx`）
   - **API Key**
   - **API Secret**（要點 **Reveal** 才看得到）
3. 三個都記下來

> 為什麼要 Cloudinary：IG 和 Threads 的 API **不接受你直接上傳檔案**，只接受「公開的圖片 URL」。Cloudinary 是免費託管、自動給 URL 的最簡解，每月 25GB 流量、25k 轉換次數，個人用完全夠。

---

## Step 6 — 在 Social Publisher 裡填好

1. 打開 app，左上角點 **Setup**
2. **Facebook Page** 卡片：
   - App ID / App Secret：填 Step 1.2 拿到的兩個值
   - 點 **Connect via OAuth** → 瀏覽器會跳出來 → 登入 → 同意權限
   - 跳回來後會出現你管理的所有 Page，**點你要發文的那個**
3. **Instagram** 卡片：同上，填 App ID / Secret（**和 FB 是同一組**，就是 Step 1.2 那一組）→ Connect
4. **Threads** 卡片：同上 → Connect
5. **Cloudinary** 卡片：填 Step 5 的三個值 → **Save Cloudinary credentials**
6. 三個平台都應該變成綠色的 **Connected**

---

## Step 7 — 發第一則貼文

1. 點上方 **Compose**
2. 輸入文字
3. 想配圖就點 **+ Add images**，挑檔案（PNG / JPG / WebP 都可）
4. 點 **Upload to Cloudinary**，等每張變成 `uploaded`
5. 勾選下面要發到哪些平台（**IG 一定要有圖**，沒圖會 disable）
6. 點 **Publish**
7. 下面會出現每個平台的結果，成功的會給你貼文連結

---

## 常見問題

### Q1: OAuth 跳出來說「URL Blocked」
**A**: Step 2 的 redirect URI 沒設好。回去確認該平台的 redirect URI **完全等於** `http://127.0.0.1` 或 `http://127.0.0.1/`（兩種寫法 Meta 都認）。

### Q2: IG OAuth 完了但抓不到 user ID
**A**: 你的 IG 還是個人帳號。打開 IG app → 設定 → Account → **Switch to Professional Account**，選 Creator 或 Business，之後重做 IG OAuth。

### Q3: Threads 貼文回 「invalid permission」
**A**: 你的 Threads handle 還沒加進 Step 4.3 的 Tester 名單；或者加了還沒接受邀請（用 Threads app 看通知）。

### Q4: Token 過期了
**A**: 
- **FB Page token**：從長期 user token 換來的 Page token 是 **永久** 的，不會過期。
- **IG / Threads token**：60 天，過期就回 Setup 重新點一次 **Connect via OAuth**。

### Q5: 我要怎麼確認資料真的沒被上傳？
**A**: 程式碼開源在 <https://github.com/Flashsator/social-publisher>。整個 `src-tauri/src/vault.rs` 模組除了寫 OS 金鑰庫之外沒有任何網路呼叫；OAuth 和發文呼叫都是直接從你電腦打到 Meta / Cloudinary 的官方 API，中間沒有任何伺服器。

### Q6: 想清掉所有憑證
**A**: Setup 頁面最下面 **Danger zone** → **Wipe all credentials**，會把這個 app 在你 OS 金鑰庫裡存的東西全部刪掉。
