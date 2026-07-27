NINJA AIRS 練習予定表　保守版 v6

【固定構成】
・index.html：LINE選手専用
・coach.html：コーチ専用パスワードログイン
・Code.gs：Apps Script API
・月別シート：予定の唯一の保存先・提出用
・schedule_data：使用しない
・attendance：出欠保存
・schedule_attachments：添付管理

【最初に1か所だけ設定】
config.jsを開き、次の文字列を現在のApps Script WebアプリURLへ置換してください。

ここにApps ScriptのWebアプリURLを貼り付ける

例：
https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec

【Apps Script】
1. 現在のCode.gsをバックアップ
2. このフォルダのCode.gsで全文置換
3. プロジェクトの設定→スクリプトプロパティを確認
   SCHEDULE_SPREADSHEET_ID
   COACH_PASSWORD
   ATTACHMENT_FOLDER_ID
   MASTER_SPREADSHEET_ID
   LINE_LOGIN_CHANNEL_ID
   LINE_LIFF_ID
4. 新しいバージョンとしてWebアプリを再デプロイ
5. 発行された /exec URLをconfig.jsへ設定

【GitHub】
次の6ファイルをリポジトリ直下へアップロードまたは全置換します。
index.html
coach.html
config.js
manifest.json
sw.js
README_導入手順.txt

Code.gsはGitHubへ公開しないでください。

【LIFF Endpoint】
選手用：
https://ninja326.github.io/ninja-schedule/index.html?v=6

コーチ用：
https://ninja326.github.io/ninja-schedule/coach.html?v=6

【確認表示】
選手用：build v6-player-only
コーチ用：build v6-coach-only

【重要】
・月別シートで削除した予定は、再読み込み後に両画面から消えます。
・schedule_dataは読込・保存に使用しません。
・月別シートのセル内容を手作業で削除すると、その予定は表示されません。
・アプリで登録した詳細情報は月別シートのセルメモに保存されます。
・index.htmlにはコーチログイン画面を含めません。
・coach.htmlではLINE選手認証を実行しません。
