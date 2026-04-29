/**
 * RA Recorder - Google Apps Script (バックエンド)
 * 
 * 以下の手順で設定してください。
 * 1. 新しいGoogleスプレッドシートを作成し、1行目にヘッダー（例: Date, Start, End, Break, Content, Formatted）を入力します。
 * 2. メニューから「拡張機能」>「Apps Script」を選択します。
 * 3. 元からあるコードをすべて消去し、このファイルのコードを貼り付けます。
 * 4. 「デプロイ」>「新しいデプロイ」を選択します。
 * 5. 種類の選択で「ウェブアプリ」を選択します。
 * 6. 「アクセスできるユーザー」を「全員」に設定してデプロイします。
 * 7. 表示された「ウェブアプリのURL」をコピーし、アプリの設定画面に入力してください。
 */

// ==========================================
// 設定
// ==========================================
// アクセスがあった際にメール通知を受け取る場合は true にします
var ENABLE_EMAIL_NOTIFICATION = true;

// 通知を受け取るメールアドレス（空欄の場合はスクリプト作成者のGmailアドレスに届きます）
var NOTIFY_EMAIL = "";

function sendNotification(type, details) {
  if (!ENABLE_EMAIL_NOTIFICATION) return;

  try {
    var email = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    var subject = "【RA Recorder】" + type + "がありました";
    var body = "RA RecorderのGoogle Apps Scriptにアクセスがありました。\n\n" +
      "【種類】: " + type + "\n" +
      "【日時】: " + new Date().toLocaleString("ja-JP") + "\n\n" +
      "【詳細情報】\n" + details + "\n\n" +
      "※このメールはRA Recorderのセキュリティ通知機能によって自動送信されています。";

    MailApp.sendEmail(email, subject, body);
  } catch (e) {
    // メール送信失敗時はエラーを出さない（メイン処理を止めないため）
    console.error("メール通知に失敗しました: " + e.message);
  }
}

// 対象年月のシートを取得（存在しなければ作成）
function getOrCreateSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // 新規シートの1行目にヘッダーを追加
    sheet.appendRow(['Date', 'Start', 'End', 'Break', 'Content', 'Formatted']);
  }
  return sheet;
}

// どんな日付文字列が来ても必ず YYYY-MM-DD に変換する関数
function normalizeDateStr(rawDate) {
  var d = new Date(rawDate);
  if (isNaN(d.getTime())) {
    // パースできない場合は無理やりスラッシュをハイフンに（保険）
    return String(rawDate).replace(/\//g, '-');
  }
  var y = d.getFullYear();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var data = JSON.parse(e.postData.contents);

    // データの日付（例: 2026-04-23）から「2026-04」を取り出してシート名にする
    var sheetName = String(data.date).substring(0, 7);
    var sheet = getOrCreateSheet(sheetName);

    // シート上の日付データを取得
    var dates = sheet.getRange(1, 1, sheet.getLastRow() || 1, 1).getDisplayValues();
    var rowIndex = -1;
    var reqDate = normalizeDateStr(data.date);

    // 同じ日付の行を探す
    for (var i = 0; i < dates.length; i++) {
      if (!dates[i][0]) continue;
      var sheetDate = normalizeDateStr(dates[i][0]);
      if (sheetDate === reqDate) {
        rowIndex = i + 1; // GASの行番号は1始まり
        break;
      }
    }

    // 削除リクエストの場合
    if (data.action === 'delete') {
      if (rowIndex !== -1) {
        sheet.deleteRow(rowIndex);
        sendNotification("データの削除 (POST)", sheetName + " シートの " + data.date + " のデータを削除しました。");
      }
      output.setContent(JSON.stringify({ success: true }));
      return output;
    }

    var rowData = [
      data.date,
      data.startTime,
      data.endTime,
      data.breakTime,
      data.content,
      data.formattedText
    ];

    if (rowIndex !== -1) {
      // 既存の行を上書き
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
      sendNotification("既存データの更新 (POST)", sheetName + " シートのデータを上書きしました:\n" + e.postData.contents);
    } else {
      // シートに新規追記
      sheet.appendRow(rowData);
      sendNotification("新規データの保存 (POST)", sheetName + " シートにデータを保存しました:\n" + e.postData.contents);
    }

    output.setContent(JSON.stringify({ success: true }));
  } catch (error) {
    output.setContent(JSON.stringify({ success: false, error: error.message }));
  }

  return output;
}

function doGet(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var records = [];

    // すべてのシートをループしてデータを集める
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var data = sheet.getDataRange().getDisplayValues();

      // 1行目はヘッダーと仮定して2行目から読み込み
      for (var i = 1; i < data.length; i++) {
        if (!data[i][0]) continue; // 日付が空ならスキップ

        // YYYY-MM-DD に統一
        var dateStr = normalizeDateStr(data[i][0]);

        records.push({
          date: dateStr,
          startTime: data[i][1],
          endTime: data[i][2],
          breakTime: data[i][3],
          content: data[i][4],
          formattedText: data[i][5]
        });
      }
    }

    // データの読み込み（同期）があったことを通知
    // sendNotification("データの読み込み (GET/同期)", "アプリからデータ同期のアクセスがありました。");

    output.setContent(JSON.stringify({ success: true, records: records }));
  } catch (error) {
    output.setContent(JSON.stringify({ success: false, error: error.message }));
  }

  return output;
}
