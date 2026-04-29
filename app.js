// ===== 設定・状態管理 =====
const state = {
    settings: {
        name: '山田太郎',
        affiliation: '予算名',
        hourlyWage: 1500,
        gasUrl: ''
    },
    records: []
};

// ローカルストレージから設定とデータを読み込み
function loadState() {
    const savedSettings = localStorage.getItem('ra_settings');
    if (savedSettings) {
        state.settings = { ...state.settings, ...JSON.parse(savedSettings) };
    }
    const savedRecords = localStorage.getItem('ra_records');
    if (savedRecords) {
        state.records = JSON.parse(savedRecords);
    }

    // 今日の日付を初期セット
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('date').value = `${yyyy}-${mm}-${dd}`;

    // サマリーの月を今月に初期セット
    document.getElementById('summary-month').value = `${yyyy}-${mm}`;

    // ブラウザのキャッシュ対策: 開始時間・終了時間を初期化
    document.getElementById('start-time').value = '';
    document.getElementById('end-time').value = '';

    updateSettingsUI();
    updateSummary();
}

// 設定を保存
function saveSettings() {
    state.settings.name = document.getElementById('setting-name').value;
    state.settings.affiliation = document.getElementById('setting-affiliation').value;
    state.settings.hourlyWage = parseInt(document.getElementById('setting-hourly-wage').value, 10) || 0;
    state.settings.gasUrl = document.getElementById('setting-gas-url').value;

    localStorage.setItem('ra_settings', JSON.stringify(state.settings));
    updateSummary();
    showToast('設定を保存しました');
    closeSettingsModal();
}

function updateSettingsUI() {
    document.getElementById('setting-name').value = state.settings.name;
    document.getElementById('setting-affiliation').value = state.settings.affiliation;
    document.getElementById('setting-hourly-wage').value = state.settings.hourlyWage;
    document.getElementById('setting-gas-url').value = state.settings.gasUrl;
}

// ===== ユーティリティ =====
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 時間計算 (HH:MM の差分を時間単位(小数)で返す)
function calculateHours(start, end, breakTime) {
    if (!start || !end) return 0;

    // 文字列から HH:MM を安全に抽出（GAS由来のISO日付文字列などにも対応）
    function parseTime(t) {
        if (!t) return [0, 0];
        const match = String(t).match(/(\d{1,2}):(\d{2})/);
        return match ? [Number(match[1]), Number(match[2])] : [0, 0];
    }

    const [sH, sM] = parseTime(start);
    const [eH, eM] = parseTime(end);
    const [bH, bM] = parseTime(breakTime);

    let startMin = sH * 60 + sM;
    let endMin = eH * 60 + eM;
    const breakMin = bH * 60 + bM;

    // 日またぎの対応 (終了が開始より早い場合、翌日とみなす)
    if (endMin < startMin) {
        endMin += 24 * 60;
    }

    let workMin = endMin - startMin - breakMin;
    if (workMin < 0) workMin = 0;

    return workMin / 60;
}

// ===== メイン処理 =====

// フォーマット生成＆保存
async function handleSave(e) {
    e.preventDefault();

    const date = document.getElementById('date').value;
    const start = document.getElementById('start-time').value;
    const end = document.getElementById('end-time').value;
    const breakTime = document.getElementById('break-time').value;
    const content = document.getElementById('work-content').value;

    // すでに同じ日付のデータが存在するかチェック
    const existingRecordIndex = state.records.findIndex(r => r.date === date);
    if (existingRecordIndex !== -1) {
        const confirmOverwrite = confirm(`すでに ${date} のデータが存在します。\n上書きしてもよろしいですか？`);
        if (!confirmOverwrite) {
            return; // キャンセルした場合は処理を中断
        }
    }

    // 日付フォーマットの変換 (YYYY-MM-DD -> YYYY/MM/DD)
    const formattedDate = date.replace(/-/g, '/');

    // テキスト生成: 休憩時間が00:00の場合は R の表記を省略する
    const breakText = (!breakTime || breakTime === '00:00' || breakTime === '0:00') ? '' : ` R${breakTime}`;
    const formattedText = `${state.settings.name} \n${state.settings.affiliation} \n${formattedDate} ${start}-${end}${breakText} \n${content}`;

    // UIに表示
    document.getElementById('output-text').textContent = formattedText;
    document.getElementById('result-section').style.display = 'block';

    // レコード作成
    const record = { date, startTime: start, endTime: end, breakTime, content, formattedText };

    // ローカル保存 (上書き または 追加)
    if (existingRecordIndex !== -1) {
        state.records[existingRecordIndex] = record;
    } else {
        state.records.push(record);
    }
    localStorage.setItem('ra_records', JSON.stringify(state.records));
    updateSummary();

    // クリップボードにコピー
    copyToClipboard(formattedText);

    // GASに送信
    if (state.settings.gasUrl) {
        try {
            // preflight(OPTIONS)を避けるため、text/plainで送信
            fetch(state.settings.gasUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify(record)
            }).then(response => response.json())
                .then(data => {
                    if (data.success) {
                        console.log('GASへ同期完了');
                    } else {
                        console.error('GASエラー:', data.error);
                    }
                }).catch(err => console.error('通信エラー:', err));
        } catch (error) {
            console.error('送信エラー:', error);
        }
    }
}

// データ削除
async function handleDelete() {
    const date = document.getElementById('date').value;
    const existingRecordIndex = state.records.findIndex(r => r.date === date);

    if (existingRecordIndex === -1) {
        showToast(`${date} のデータは見つかりません`);
        return;
    }

    const confirmDelete = confirm(`本当に ${date} のデータを削除しますか？\n（GAS上のデータも削除されます）`);
    if (!confirmDelete) return;

    // ローカルから削除
    state.records.splice(existingRecordIndex, 1);
    localStorage.setItem('ra_records', JSON.stringify(state.records));
    updateSummary();

    // UIリセット
    document.getElementById('result-section').style.display = 'none';
    showToast('削除しました');

    // GASに送信
    if (state.settings.gasUrl) {
        try {
            fetch(state.settings.gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'delete', date: date })
            }).then(response => response.json())
                .then(data => {
                    if (data.success) {
                        console.log('GASから削除完了');
                    } else {
                        console.error('GASエラー:', data.error);
                        showToast('GASの削除に失敗しました');
                    }
                }).catch(err => console.error('通信エラー:', err));
        } catch (error) {
            console.error('送信エラー:', error);
        }
    }
}

// クリップボードコピー
function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('コピーしました');
        }).catch(err => {
            console.error('コピー失敗:', err);
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;

    // 画面外に配置してスクロールやレイアウト崩れを防ぐ
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    textArea.style.color = "transparent";

    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('コピーしました');
    } catch (err) {
        showToast('コピーに失敗しました');
    }
    document.body.removeChild(textArea);
}

// サマリー更新
function updateSummary() {
    const selectedMonth = document.getElementById('summary-month').value; // YYYY-MM
    if (!selectedMonth) return;

    let totalHours = 0;

    state.records.forEach(r => {
        if (r.date.startsWith(selectedMonth)) {
            totalHours += calculateHours(r.startTime, r.endTime, r.breakTime);
        }
    });

    const totalSalary = Math.floor(totalHours * state.settings.hourlyWage);

    document.getElementById('total-hours').textContent = totalHours.toFixed(2);
    document.getElementById('total-salary').textContent = totalSalary.toLocaleString();
}

// CSVダウンロード
function downloadCSV() {
    const selectedMonth = document.getElementById('summary-month').value; // YYYY-MM
    if (!selectedMonth) return;

    let csvContent = "ra_name,date,start_time,end_time,break_time,description\n";

    const targetRecords = state.records.filter(r => r.date.startsWith(selectedMonth));
    targetRecords.sort((a, b) => a.date.localeCompare(b.date));

    if (targetRecords.length === 0) {
        showToast('対象月のデータがありません');
        return;
    }

    targetRecords.forEach(r => {
        const raName = state.settings.affiliation || "";
        
        const dateParts = r.date.split('-');
        const dateNum = parseInt(dateParts[2], 10);
        
        const startTime = (r.startTime || "").replace(':', '');
        const endTime = (r.endTime || "").replace(':', '');
        
        let breakFormatted = 0;
        if (r.breakTime) {
            breakFormatted = parseInt(r.breakTime.replace(':', ''), 10) || 0;
        }
        
        let description = r.content || "";
        if (description.includes(',')) {
            description = `"${description}"`;
        }

        csvContent += `${raName}, ${dateNum}, ${startTime}, ${endTime}, ${breakFormatted}, ${description}\n`;
    });

    // BOM付きにしてExcel等で文字化けしないようにする
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ra_data_${selectedMonth}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// GASから同期
async function syncFromGAS() {
    if (!state.settings.gasUrl) {
        showToast('GASのURLが設定されていません');
        return;
    }

    const syncBtn = document.getElementById('sync-btn');
    const originalText = syncBtn.innerHTML;
    syncBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 同期中...';
    syncBtn.disabled = true;

    try {
        const response = await fetch(state.settings.gasUrl);
        const data = await response.json();

        if (data.success && data.records) {
            state.records = data.records;
            localStorage.setItem('ra_records', JSON.stringify(state.records));
            updateSummary();
            showToast('同期が完了しました');
        } else {
            showToast('同期エラー: ' + (data.error || '不明なエラー'));
        }
    } catch (error) {
        console.error(error);
        showToast('通信エラーが発生しました');
    } finally {
        syncBtn.innerHTML = originalText;
        syncBtn.disabled = false;
    }
}

// ===== イベントリスナー =====
document.addEventListener('DOMContentLoaded', () => {
    loadState();

    // フォーム送信
    document.getElementById('record-form').addEventListener('submit', handleSave);

    // 削除ボタン
    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDelete);
    }

    // コピーボタン
    document.getElementById('copy-btn').addEventListener('click', () => {
        const text = document.getElementById('output-text').textContent;
        copyToClipboard(text);
    });

    // サマリー月変更
    document.getElementById('summary-month').addEventListener('change', updateSummary);

    // 同期ボタン
    document.getElementById('sync-btn').addEventListener('click', syncFromGAS);

    // CSVダウンロードボタン
    const downloadCsvBtn = document.getElementById('download-csv-btn');
    if (downloadCsvBtn) {
        downloadCsvBtn.addEventListener('click', downloadCSV);
    }

    // モーダル制御
    const modal = document.getElementById('settings-modal');
    document.getElementById('settings-btn').addEventListener('click', () => {
        modal.classList.add('active');
    });
    document.getElementById('close-settings').addEventListener('click', closeSettingsModal);
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

    // モーダル外クリックで閉じる
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeSettingsModal();
        }
    });
});

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
}
