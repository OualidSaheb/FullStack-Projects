export interface AppsScriptParams {
  sourceName: string;
  endpoint: string;
  token: string;
  spreadsheetId: string;
  sheets: string[];
  startDate: string;
  /** Trigger interval allowed by Apps Script: 1, 5, 10, 15 or 30 minutes. */
  syncMinutes: number;
}

/** Full re-scan (and "alive" ping) at most this often, whatever the trigger interval. */
const FULL_SCAN_MINUTES = 30;

/**
 * Google Apps Script pasted into each offer's sheet (Extensions → Apps Script).
 * - reads every configured tab (Sheet1 + Sheet2), from the start date on;
 * - cheap runs: a tab is only read when its row count changed, plus a full
 *   re-scan every 30 minutes (Google limits trigger runtime per day: a script
 *   reading whole sheets every minute in several files would hit the quota);
 * - sends only rows it has not delivered yet (local cache), in batches;
 * - the CRM is idempotent on the Facebook Lead ID: a lost cache or a double
 *   run never creates duplicates; a failing row does not block the others;
 * - pings the CRM so the platform can warn when a sheet stops syncing;
 * - never modifies or deletes anything in the sheet.
 */
export function renderAppsScript(p: AppsScriptParams): string {
  const config = JSON.stringify(
    {
      endpoint: p.endpoint,
      token: p.token,
      spreadsheetId: p.spreadsheetId,
      sheets: p.sheets,
      startDate: p.startDate,
      everyMinutes: p.syncMinutes,
      fullScanMinutes: FULL_SCAN_MINUTES,
      batchSize: 100,
    },
    null,
    2,
  );
  return `/**
 * Touraya CRM — مزامنة الطلبيات من Google Sheets
 * المصدر: ${p.sourceName}
 *
 * 1) الصق هذا الكود في Extensions → Apps Script واحفظ
 * 2) شغّل الدالة setupTouraya مرة واحدة ووافق على الصلاحيات
 * 3) (اختياري) شغّل testTouraya لإرسال طلبية تجريبية والتأكد من الربط
 * بعدها تُرسل الطلبيات الجديدة تلقائياً كل ${p.syncMinutes} دقيقة.
 * حذف هذا السكريبت يوقف إرسال الطلبيات من هذا الملف. السكريبت لا يعدل الشيت أبداً.
 */
var TOURAYA = ${config};

var CACHE_PREFIX = 'touraya_sent_';
var ROWS_PREFIX = 'touraya_rows_';
var LAST_FULL_SCAN = 'touraya_full_scan_at';

/** تشغيل مرة واحدة: ينشئ المؤقت ويرسل الطلبيات الحالية. */
function setupTouraya() {
  if (SpreadsheetApp.getActive().getId() !== TOURAYA.spreadsheetId) {
    throw new Error('هذا السكريبت خاص بملف آخر. انسخ الكود الصحيح من CRM لهذا الملف.');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTouraya') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTouraya').timeBased().everyMinutes(TOURAYA.everyMinutes).create();
  var result = run_(true);
  Logger.log('Touraya جاهز: ' + JSON.stringify(result));
  return result;
}

/** المؤقت: يرسل الأسطر الجديدة فقط. */
function syncTouraya() {
  return run_(false);
}

/** يعيد إرسال كل الطلبيات (بدون تكرار داخل CRM). */
function resendAllTouraya() {
  clearProps_(CACHE_PREFIX);
  return run_(true);
}

/** يرسل طلبية تجريبية (اسمها TEST Touraya) للتأكد أن الربط يعمل. احذفها بعد ذلك من المنصة. */
function testTouraya() {
  var id = 'test-' + new Date().getTime();
  var res = post_('test', [{ rowNumber: 0, values: {
    id: id,
    created_time: new Date().toISOString(),
    full_name: 'TEST Touraya',
    phone_number: 'p:+213550000000',
    'الولاية': 'الجزائر',
    'البلدية': 'باب الزوار'
  } }]);
  var msg = res ? 'نجح الاتصال بالمنصة: ' + JSON.stringify(res.results) : 'فشل الاتصال بالمنصة — راجع Executions';
  Logger.log(msg);
  return msg;
}

function run_(forceFullScan) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { skipped: 'already running' };
  try {
    var props = PropertiesService.getDocumentProperties();
    var now = new Date().getTime();
    var lastFull = Number(props.getProperty(LAST_FULL_SCAN) || 0);
    var fullScan = forceFullScan || now - lastFull >= TOURAYA.fullScanMinutes * 60000;
    var summary = sync_(fullScan);
    if (fullScan && summary.ok) {
      props.setProperty(LAST_FULL_SCAN, String(now));
      if (!summary.sent) post_('heartbeat', []); // "still alive" for the CRM monitor
    }
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function sync_(fullScan) {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getDocumentProperties();
  var sent = null; // loaded lazily: most runs read nothing
  var start = new Date(TOURAYA.startDate + 'T00:00:00+01:00');
  var summary = { ok: true, sent: 0, created: 0, duplicates: 0, skipped: 0, errors: 0 };

  TOURAYA.sheets.forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    var rowsKey = ROWS_PREFIX + sheetName;
    // Cheap path: nothing appended since the last complete pass.
    if (!fullScan && String(lastRow) === props.getProperty(rowsKey)) return;
    if (lastRow < 2) { props.setProperty(rowsKey, String(lastRow)); return; }

    if (!sent) sent = loadCache_();
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var pending = [];
    for (var i = 1; i < data.length; i++) {
      var values = {};
      var empty = true;
      headers.forEach(function (h, c) {
        if (!h) return;
        var v = data[i][c];
        if (v instanceof Date) v = v.toISOString();
        else if (v !== '' && v !== null) v = String(v);
        if (v !== '') empty = false;
        values[h] = v;
      });
      if (empty) continue;
      var key = rowKey_(values);
      if (sent[key]) continue;
      var created = values.created_time ? new Date(values.created_time) : null;
      if (created && !isNaN(created) && created < start) continue;
      pending.push({ key: key, row: { rowNumber: i + 1, values: values } });
    }

    var complete = true;
    for (var b = 0; b < pending.length; b += TOURAYA.batchSize) {
      var batch = pending.slice(b, b + TOURAYA.batchSize);
      var res = post_(sheetName, batch.map(function (p) { return p.row; }));
      if (!res) { complete = false; summary.ok = false; break; } // CRM unreachable: retry next run
      var byRow = {};
      batch.forEach(function (p) { byRow[p.row.rowNumber] = p.key; });
      summary.sent += batch.length;
      res.results.forEach(function (r) {
        if (r.result === 'error') { summary.errors++; complete = false; return; }
        if (r.result === 'created') summary.created++;
        else if (r.result === 'duplicate') summary.duplicates++;
        else summary.skipped++;
        sent[byRow[r.row]] = 1;
      });
      saveCache_(sent);
    }
    // Remember the row count only when everything was delivered, so failures are retried.
    if (complete) props.setProperty(rowsKey, String(lastRow));
  });
  return summary;
}

function post_(sheetName, rows) {
  try {
    var response = UrlFetchApp.fetch(TOURAYA.endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Touraya-Token': TOURAYA.token },
      payload: JSON.stringify({ spreadsheetId: TOURAYA.spreadsheetId, sheetName: sheetName, rows: rows }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('Touraya CRM error ' + response.getResponseCode() + ': ' + response.getContentText());
      return null;
    }
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('Touraya CRM unreachable: ' + e);
    return null;
  }
}

function rowKey_(values) {
  var id = String(values.id || '').replace(/^l:/i, '');
  return id || ['row', values.created_time, values.full_name, values.phone_number].join('|');
}

function loadCache_() {
  var props = PropertiesService.getDocumentProperties().getProperties();
  var sent = {};
  Object.keys(props).forEach(function (k) {
    if (k.indexOf(CACHE_PREFIX) !== 0) return;
    props[k].split('\\n').forEach(function (id) { if (id) sent[id] = 1; });
  });
  return sent;
}

function saveCache_(sent) {
  clearProps_(CACHE_PREFIX);
  var props = {};
  var chunk = [];
  var size = 0;
  var n = 0;
  Object.keys(sent).forEach(function (k) {
    if (size + k.length > 8000) { props[CACHE_PREFIX + n++] = chunk.join('\\n'); chunk = []; size = 0; }
    chunk.push(k);
    size += k.length + 1;
  });
  if (chunk.length) props[CACHE_PREFIX + n] = chunk.join('\\n');
  PropertiesService.getDocumentProperties().setProperties(props);
}

function clearProps_(prefix) {
  var store = PropertiesService.getDocumentProperties();
  Object.keys(store.getProperties()).forEach(function (k) {
    if (k.indexOf(prefix) === 0) store.deleteProperty(k);
  });
}
`;
}
