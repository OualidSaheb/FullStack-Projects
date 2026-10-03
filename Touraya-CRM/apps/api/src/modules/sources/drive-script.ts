export interface DriveScriptParams {
  endpoint: string;
  token: string;
  folderName: string;
  startDate: string;
  /** Trigger interval allowed by Apps Script: 1, 5, 10, 15 or 30 minutes. */
  syncMinutes: number;
}

/**
 * The one Google Apps Script for every Facebook form: installed once (as its
 * own project at script.google.com), it reads every spreadsheet put in one
 * Drive folder, every tab, and sends new rows to the CRM.
 * - a file is opened only when Drive says it changed since the last pass;
 * - per tab it remembers the last row delivered, so only new rows are sent;
 *   a row the CRM could not take is retried on the next run;
 * - once a day it re-sends the last 7 days of every tab (the CRM ignores
 *   leads it already has: the Facebook Lead ID is unique);
 * - every hour it tells the CRM which files and tabs it sees, so the platform
 *   can show them and warn when a connection stops;
 * - keeps free hosting awake (light /api/health request every 10 minutes);
 * - never modifies anything in the sheets.
 */
export function renderDriveScript(p: DriveScriptParams): string {
  const config = JSON.stringify(
    {
      endpoint: p.endpoint,
      token: p.token,
      folderName: p.folderName,
      startDate: p.startDate,
      everyMinutes: p.syncMinutes,
      recheckDays: 7,
      fullPassHours: 24,
      inventoryMinutes: 60,
      keepAwakeMinutes: 10,
      batchSize: 200,
    },
    null,
    2,
  );
  return `/**
 * Touraya CRM — استقبال الطلبيات من كل الشيتات في مجلد Google Drive
 *
 * مرة واحدة فقط:
 * 1) افتح script.google.com ← New project، الصق هذا الكود واحفظ
 * 2) شغّل الدالة setupTouraya ووافق على الصلاحيات (ينشئ المجلد «${p.folderName}» إن لم يكن موجوداً)
 * 3) ضع في المجلد شيتات Facebook (أو انقلها إليه) — كل الأوراق تُقرأ تلقائياً
 * 4) (اختياري) شغّل testTouraya لإرسال طلبية تجريبية
 * بعدها: كل شيت جديد تضعه في المجلد يُقرأ وحده كل ${p.syncMinutes} دقيقة. السكريبت لا يعدل أي شيت.
 */
var TOURAYA = ${config};

var P_DONE = 'touraya_done_';
var P_SEEN = 'touraya_seen_';
var P_INV = 'touraya_inv_';
var P_FULL = 'touraya_full_at';
var P_INV_AT = 'touraya_inventory_at';
var P_WAKE = 'touraya_wake_at';

/** تشغيل مرة واحدة: ينشئ المجلد والمؤقت ويرسل الطلبيات الحالية. */
function setupTouraya() {
  folder_(true);
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

/** يعيد إرسال كل الطلبيات من كل الشيتات (المنصة تتجاهل ما عندها). */
function resendAllTouraya() {
  var store = PropertiesService.getScriptProperties();
  Object.keys(store.getProperties()).forEach(function (k) {
    if (k.indexOf(P_DONE) === 0 || k.indexOf(P_SEEN) === 0) store.deleteProperty(k);
  });
  return run_(true, true);
}

/** يرسل طلبية تجريبية (اسمها TEST Touraya). احذفها بعد ذلك من المنصة. */
function testTouraya() {
  var res = post_({ spreadsheetId: 'test', spreadsheetName: 'TEST', sheetName: 'test', rows: [{ rowNumber: 0, values: {
    id: 'test-' + new Date().getTime(),
    created_time: new Date().toISOString(),
    form_name: 'TEST Touraya',
    full_name: 'TEST Touraya',
    phone_number: 'p:+213550000000',
    'الولاية': 'الجزائر',
    'البلدية': 'باب الزوار'
  } }] });
  var msg = res ? 'نجح الاتصال بالمنصة: ' + JSON.stringify(res.results) : 'فشل الاتصال بالمنصة — راجع Executions';
  Logger.log(msg);
  return msg;
}

function folder_(create) {
  var it = DriveApp.getFoldersByName(TOURAYA.folderName);
  if (it.hasNext()) return it.next();
  if (create) return DriveApp.createFolder(TOURAYA.folderName);
  throw new Error('المجلد «' + TOURAYA.folderName + '» غير موجود في Google Drive');
}

function run_(forceFull, everything) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { skipped: 'already running' };
  try {
    var props = PropertiesService.getScriptProperties();
    var now = new Date().getTime();
    var full = forceFull || now - Number(props.getProperty(P_FULL) || 0) >= TOURAYA.fullPassHours * 3600000;
    var summary = { ok: true, files: 0, sent: 0, created: 0, duplicates: 0, skipped: 0, errors: 0 };
    var files = folder_(false).getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      var file = files.next();
      summary.files++;
      var id = file.getId();
      var updated = String(file.getLastUpdated().getTime());
      if (!full && props.getProperty(P_SEEN + id) === updated) continue; // nothing changed in this file
      if (readFile_(file, full, everything, summary)) props.setProperty(P_SEEN + id, updated);
    }
    if (full && summary.ok) props.setProperty(P_FULL, String(now));
    if (full || now - Number(props.getProperty(P_INV_AT) || 0) >= TOURAYA.inventoryMinutes * 60000) {
      if (sendInventory_()) props.setProperty(P_INV_AT, String(now));
    } else if (!summary.sent && now - Number(props.getProperty(P_WAKE) || 0) >= TOURAYA.keepAwakeMinutes * 60000) {
      wake_();
    }
    if (summary.sent) props.setProperty(P_WAKE, String(now));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/** Sends the new rows of every tab of one spreadsheet; true when all were delivered. */
function readFile_(file, full, everything, summary) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(file.getId());
  var start = new Date(TOURAYA.startDate + 'T00:00:00+01:00');
  var recheckFrom = new Date(new Date().getTime() - TOURAYA.recheckDays * 86400000);
  var complete = true;
  var tabs = [];
  ss.getSheets().forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    tabs.push({ name: sheet.getName(), rows: Math.max(lastRow - 1, 0) });
    var doneKey = P_DONE + file.getId() + '_' + sheet.getSheetId();
    var done = Number(props.getProperty(doneKey) || 1); // last row delivered (1 = titles)
    if (lastRow < done) done = 1; // rows were deleted: read again
    var from = full ? 1 : done;
    if (lastRow <= from || lastCol < 1) return;

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var data = sheet.getRange(from + 1, 1, lastRow - from, lastCol).getValues();
    var pending = [];
    data.forEach(function (cells, i) {
      var values = {};
      var empty = true;
      headers.forEach(function (h, c) {
        if (!h) return;
        var v = cells[c];
        if (v instanceof Date) v = v.toISOString();
        else if (v !== '' && v !== null) v = String(v);
        if (v !== '') empty = false;
        values[h] = v;
      });
      if (empty) return;
      var created = values.created_time ? new Date(values.created_time) : null;
      var valid = created && !isNaN(created);
      if (valid && created < start) return;
      // Daily pass: only the recent rows are checked again (older ones were delivered long ago).
      if (full && !everything && from + 1 + i <= done && valid && created < recheckFrom) return;
      pending.push({ rowNumber: from + 1 + i, values: values });
    });

    var delivered = full ? done : from;
    var tabOk = true;
    for (var b = 0; b < pending.length; b += TOURAYA.batchSize) {
      var batch = pending.slice(b, b + TOURAYA.batchSize);
      var res = post_({ spreadsheetId: file.getId(), spreadsheetName: file.getName(), sheetName: sheet.getName(), rows: batch });
      if (!res) { tabOk = false; summary.ok = false; break; } // CRM unreachable: retry next run
      summary.sent += batch.length;
      var failed = null;
      res.results.forEach(function (r) {
        if (r.result === 'error') { summary.errors++; if (failed === null || r.row < failed) failed = r.row; return; }
        if (r.result === 'created') summary.created++;
        else if (r.result === 'duplicate') summary.duplicates++;
        else summary.skipped++;
      });
      if (failed !== null) { delivered = Math.max(delivered, failed - 1); tabOk = false; break; }
      delivered = Math.max(delivered, batch[batch.length - 1].rowNumber);
    }
    if (tabOk) delivered = Math.max(delivered, lastRow);
    else complete = false;
    props.setProperty(doneKey, String(delivered));
  });
  props.setProperty(P_INV + file.getId(), JSON.stringify({ spreadsheetId: file.getId(), name: file.getName(), tabs: tabs }));
  return complete;
}

/** Tells the CRM which spreadsheets and tabs the folder holds (and that the script is alive). */
function sendInventory_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var files = [];
  var ids = {};
  var it = folder_(false).getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) ids[it.next().getId()] = 1;
  Object.keys(props).forEach(function (k) {
    if (k.indexOf(P_INV) !== 0 || !ids[k.slice(P_INV.length)]) return;
    try { files.push(JSON.parse(props[k])); } catch (e) {}
  });
  return post_({ spreadsheetId: '', sheetName: '', rows: [], files: files }) !== null;
}

function post_(body) {
  try {
    var response = UrlFetchApp.fetch(TOURAYA.endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Touraya-Token': TOURAYA.token },
      payload: JSON.stringify(body),
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

function wake_() {
  try {
    UrlFetchApp.fetch(TOURAYA.endpoint.replace('/ingest/sheets', '/health'), { muteHttpExceptions: true });
    PropertiesService.getScriptProperties().setProperty(P_WAKE, String(new Date().getTime()));
  } catch (e) {
    Logger.log('Touraya CRM unreachable: ' + e);
  }
}
`;
}
