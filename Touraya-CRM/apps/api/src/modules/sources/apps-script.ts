export interface AppsScriptParams {
  sourceName: string;
  endpoint: string;
  token: string;
  spreadsheetId: string;
  sheets: string[];
  startDate: string;
}

/**
 * Google Apps Script pasted into each offer's sheet (Extensions → Apps Script).
 * - reads every configured tab (Sheet1 + Sheet2), from the start date on;
 * - sends only rows it has not delivered yet (local cache), in batches;
 * - the CRM is idempotent on the Facebook Lead ID, so a lost cache or a
 *   double run can never create duplicates;
 * - a failing row does not block the others; nothing is ever deleted from the sheet.
 */
export function renderAppsScript(p: AppsScriptParams): string {
  const config = JSON.stringify(
    { endpoint: p.endpoint, token: p.token, spreadsheetId: p.spreadsheetId, sheets: p.sheets, startDate: p.startDate, batchSize: 100 },
    null,
    2,
  );
  return `/**
 * Touraya CRM — مزامنة الطلبيات من Google Sheets
 * المصدر: ${p.sourceName}
 *
 * 1) الصق هذا الكود في Extensions → Apps Script
 * 2) شغّل الدالة setupTouraya مرة واحدة ووافق على الصلاحيات
 * بعدها تُرسل الطلبيات الجديدة تلقائياً كل دقيقة.
 * ملاحظة: حذف هذا السكريبت يوقف إرسال الطلبيات من هذا الملف.
 */
var TOURAYA = ${config};

var TOURAYA_CACHE_PREFIX = 'touraya_sent_';

/** تشغيل مرة واحدة: ينشئ المؤقت ويرسل الطلبيات الحالية. */
function setupTouraya() {
  if (SpreadsheetApp.getActive().getId() !== TOURAYA.spreadsheetId) {
    throw new Error('هذا السكريبت خاص بملف آخر. انسخ الكود الصحيح من CRM لهذا الملف.');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTouraya') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTouraya').timeBased().everyMinutes(1).create();
  var result = syncTouraya();
  Logger.log('Touraya جاهز: ' + JSON.stringify(result));
}

/** يعيد إرسال كل الطلبيات (بدون تكرار داخل CRM). */
function resendAllTouraya() {
  clearCache_();
  return syncTouraya();
}

function syncTouraya() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { skipped: 'already running' };
  try {
    return syncSheets_();
  } finally {
    lock.releaseLock();
  }
}

function syncSheets_() {
  var ss = SpreadsheetApp.getActive();
  var sent = loadCache_();
  var start = new Date(TOURAYA.startDate + 'T00:00:00+01:00');
  var summary = { created: 0, duplicates: 0, skipped: 0, errors: 0 };

  TOURAYA.sheets.forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
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

    for (var b = 0; b < pending.length; b += TOURAYA.batchSize) {
      var batch = pending.slice(b, b + TOURAYA.batchSize);
      var res = post_(sheetName, batch.map(function (p) { return p.row; }));
      if (!res) break; // CRM unreachable: retry next minute
      var byRow = {};
      batch.forEach(function (p) { byRow[p.row.rowNumber] = p.key; });
      res.results.forEach(function (r) {
        if (r.result === 'error') { summary.errors++; return; }
        if (r.result === 'created') summary.created++;
        else if (r.result === 'duplicate') summary.duplicates++;
        else summary.skipped++;
        sent[byRow[r.row]] = 1;
      });
      saveCache_(sent);
    }
  });
  return summary;
}

function post_(sheetName, rows) {
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
}

function rowKey_(values) {
  var id = String(values.id || '').replace(/^l:/i, '');
  return id || ['row', values.created_time, values.full_name, values.phone_number].join('|');
}

function loadCache_() {
  var props = PropertiesService.getDocumentProperties().getProperties();
  var sent = {};
  Object.keys(props).forEach(function (k) {
    if (k.indexOf(TOURAYA_CACHE_PREFIX) !== 0) return;
    props[k].split('\\n').forEach(function (id) { if (id) sent[id] = 1; });
  });
  return sent;
}

function saveCache_(sent) {
  clearCache_();
  var keys = Object.keys(sent);
  var props = {};
  var chunk = [];
  var size = 0;
  var n = 0;
  keys.forEach(function (k) {
    if (size + k.length > 8000) { props[TOURAYA_CACHE_PREFIX + n++] = chunk.join('\\n'); chunk = []; size = 0; }
    chunk.push(k);
    size += k.length + 1;
  });
  if (chunk.length) props[TOURAYA_CACHE_PREFIX + n] = chunk.join('\\n');
  PropertiesService.getDocumentProperties().setProperties(props);
}

function clearCache_() {
  var store = PropertiesService.getDocumentProperties();
  Object.keys(store.getProperties()).forEach(function (k) {
    if (k.indexOf(TOURAYA_CACHE_PREFIX) === 0) store.deleteProperty(k);
  });
}
`;
}
