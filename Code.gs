const APP_VERSION = 'maintenance-v9.1-first-load-attendance-fix';
const PROP_SCHEDULE_REVISION = 'SCHEDULE_DATA_REVISION';
const PROP_SCHEDULE_SS_ID = 'SCHEDULE_SPREADSHEET_ID';
const PROP_COACH_PASSWORD = 'COACH_PASSWORD';
const PROP_ATTACHMENT_FOLDER_ID = 'ATTACHMENT_FOLDER_ID';
const PROP_MASTER_SS_ID = 'MASTER_SPREADSHEET_ID';
const PROP_LINE_CHANNEL_ID = 'LINE_LOGIN_CHANNEL_ID';
const PROP_LIFF_ID = 'LINE_LIFF_ID';
const PLAYER_SHEET = 'players';
const ATTENDANCE_SHEET = 'attendance';
const ATTACHMENT_SHEET = 'schedule_attachments';
const TOKEN_PREFIX = 'schedule-token:';
const TOKEN_TTL_SECONDS = 21600;
const UPLOAD_PREFIX = 'schedule-upload:';
const MONTHLY_META_PREFIX = 'NINJA_SCHEDULE_V5:';
const MONTH_CACHE_PREFIX = 'NINJA_SCHEDULE_MONTH_CACHE_V7_1:';
const MONTH_CACHE_TTL_SECONDS = 300;

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  const callback = safeCallback_(p.callback);
  const action = clean_(p.action);
  let result;
  try {
    switch (action) {
      case 'health': result = ok_({version: APP_VERSION}); break;
      case 'publicConfig': result = publicConfig_(); break;
      case 'login': result = login_(p); break;
      case 'lineLogin': result = lineLogin_(p); break;
      case 'logout': result = logout_(p); break;
      case 'monthVersion': result = monthVersion_(p.month, requireSession_(p.token)); break;
      case 'events': result = events_(p.month, requireSession_(p.token)); break;
      case 'event': result = event_(p.scheduleId, requireSession_(p.token)); break;
      case 'save': requireCoach_(p.token); result = saveEvent_(p); break;
      case 'delete': requireCoach_(p.token); result = deleteEvent_(p); break;
      case 'attendanceMy': result = attendanceMy_(p.scheduleId, requirePlayer_(p.token)); break;
      case 'saveAttendance': result = saveAttendance_(p, requirePlayer_(p.token)); break;
      case 'attendanceSummary': requireCoach_(p.token); result = attendanceSummary_(p.scheduleId); break;
      case 'uploadStatus': requireCoach_(p.token); result = uploadStatus_(p.uploadId); break;
      case 'attachmentContent': result = attachmentContent_(p.attachmentId, requireSession_(p.token)); break;
      case 'deleteAttachment': requireCoach_(p.token); result = deleteAttachment_(p.attachmentId); break;
      default: throw new Error('未対応の処理です。');
    }
  } catch (err) {
    result = error_(safeErrorMessage_(err));
  }
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}');
    if (payload.action !== 'uploadAttachment') throw new Error('未対応の処理です。');
    requireCoach_(payload.token);
    const result = uploadAttachment_(payload);
    putUploadResult_(payload.uploadId, result);
  } catch (err) {
    putUploadResult_(payload.uploadId || '', error_(safeErrorMessage_(err)));
  }
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function publicConfig_() {
  const props=PropertiesService.getScriptProperties();
  return ok_({liffId:clean_(props.getProperty(PROP_LIFF_ID)),version:APP_VERSION});
}

function login_(p) {
  const configured = PropertiesService.getScriptProperties().getProperty(PROP_COACH_PASSWORD);
  if (!configured) throw new Error('COACH_PASSWORDが設定されていません。');
  if (!constantTimeEquals_(String(p.password || ''), configured)) throw new Error('パスワードが違います。');
  const session={role:'coach',name:'コーチ'};
  return issueSession_(session);
}

function lineLogin_(p) {
  const idToken=clean_(p.idToken);
  if(!idToken) throw new Error('LINE認証情報を取得できません。');
  const profile=verifyLineIdToken_(idToken);
  const player=findPlayerByLineUserId_(profile.sub);
  if(!player) throw new Error('選手情報とLINEアカウントが連携されていません。');
  return issueSession_({
    role:'player',lineUserId:profile.sub,playerId:player.playerId,
    playerName:player.playerName,category:player.category
  });
}

function issueSession_(session) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(TOKEN_PREFIX + token, JSON.stringify(session), TOKEN_TTL_SECONDS);
  return ok_({token:token,expiresIn:TOKEN_TTL_SECONDS,role:session.role,player:session.role==='player'?{
    playerId:session.playerId,playerName:session.playerName,category:session.category
  }:null});
}

function logout_(p) {
  if (p.token) CacheService.getScriptCache().remove(TOKEN_PREFIX + clean_(p.token));
  return ok_({loggedOut: true});
}

function requireSession_(token) {
  const t=clean_(token);
  const raw=t?CacheService.getScriptCache().get(TOKEN_PREFIX+t):'';
  if(!raw) throw new Error('ログインの有効期限が切れました。再ログインしてください。');
  CacheService.getScriptCache().put(TOKEN_PREFIX+t,raw,TOKEN_TTL_SECONDS);
  try{return JSON.parse(raw)}catch(e){return {role:'coach',name:'コーチ'}}
}
function requireCoach_(token){
  const s=requireSession_(token);
  if(s.role!=='coach') throw new Error('コーチ権限が必要です。');
  return s;
}
function requirePlayer_(token){
  const s=requireSession_(token);
  if(s.role!=='player'||!s.playerId) throw new Error('選手のLINE認証が必要です。');
  return s;
}

function verifyLineIdToken_(idToken) {
  const channelId=clean_(PropertiesService.getScriptProperties().getProperty(PROP_LINE_CHANNEL_ID));
  if(!channelId) throw new Error('LINE_LOGIN_CHANNEL_IDが設定されていません。');
  const response=UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify',{
    method:'post',contentType:'application/x-www-form-urlencoded',
    payload:{id_token:idToken,client_id:channelId},muteHttpExceptions:true
  });
  const body=response.getContentText();
  let data={};try{data=JSON.parse(body)}catch(e){}
  if(response.getResponseCode()!==200||!data.sub) throw new Error('LINE認証を確認できませんでした。');
  return data;
}

function openMasterSpreadsheet_() {
  const id=clean_(PropertiesService.getScriptProperties().getProperty(PROP_MASTER_SS_ID));
  if(!id) throw new Error('MASTER_SPREADSHEET_IDが設定されていません。');
  return SpreadsheetApp.openById(id);
}

function findPlayerByLineUserId_(lineUserId) {
  const ss=openMasterSpreadsheet_();
  const sheet=ss.getSheetByName(PLAYER_SHEET);
  if(!sheet||sheet.getLastRow()<2) return null;
  const values=sheet.getDataRange().getDisplayValues();
  const headers=values[0].map(normalizeHeader_);
  const lineCol=findHeaderIndex_(headers,['lineuserid','line_user_id','lineユーザーid','lineid','line連携id']);
  const idCol=findHeaderIndex_(headers,['playerid','player_id','選手id','id']);
  const nameCol=findHeaderIndex_(headers,['name','playername','player_name','氏名','選手名']);
  const catCol=findHeaderIndex_(headers,['category','カテゴリー','所属カテゴリー']);
  if(lineCol<0||idCol<0||nameCol<0) throw new Error('playersシートの見出しを確認してください。');
  for(let i=1;i<values.length;i++){
    if(clean_(values[i][lineCol])===lineUserId){
      return {playerId:clean_(values[i][idCol]),playerName:clean_(values[i][nameCol]),category:catCol>=0?clean_(values[i][catCol]):''};
    }
  }
  return null;
}

function normalizeHeader_(v){return String(v||'').normalize('NFKC').toLowerCase().replace(/[\s\-]/g,'')}
function findHeaderIndex_(headers,candidates){
  const normalized=candidates.map(normalizeHeader_);
  for(let i=0;i<headers.length;i++) if(normalized.includes(headers[i])) return i;
  return -1;
}

function openScheduleSpreadsheet_() {
  const id = clean_(PropertiesService.getScriptProperties().getProperty(PROP_SCHEDULE_SS_ID));
  if (!id) throw new Error('SCHEDULE_SPREADSHEET_IDが設定されていません。');
  return SpreadsheetApp.openById(id);
}

function ensureAttachmentSheet_(ss) {
  const headers = ['attachmentId','scheduleId','fileId','fileName','mimeType','size','openUrl','viewUrl','createdAt','deleted'];
  let sheet = ss.getSheetByName(ATTACHMENT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ATTACHMENT_SHEET);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}


function scheduleDataVersion_() {
  const props = PropertiesService.getScriptProperties();
  const revision = clean_(props.getProperty(PROP_SCHEDULE_REVISION)) || '0';
  const spreadsheetId = clean_(props.getProperty(PROP_SCHEDULE_SS_ID));
  let modified = '0';
  if (spreadsheetId) {
    try { modified = String(DriveApp.getFileById(spreadsheetId).getLastUpdated().getTime()); } catch (e) {}
  }
  return revision + '-' + modified;
}

function bumpScheduleRevision_() {
  const props = PropertiesService.getScriptProperties();
  const current = Number(props.getProperty(PROP_SCHEDULE_REVISION)) || 0;
  props.setProperty(PROP_SCHEDULE_REVISION, String(current + 1));
  return scheduleDataVersion_();
}

function monthVersion_(requestedMonth, session) {
  const month = normalizeMonthKey_(requestedMonth);
  if (!month) throw new Error('対象月が正しくありません。');
  return ok_({month:month,version:scheduleDataVersion_()});
}

function events_(requestedMonth, session) {
  const month = normalizeMonthKey_(requestedMonth);
  if (!month) throw new Error('対象月が正しくありません。');

  const cache = CacheService.getScriptCache();
  const cacheKey = MONTH_CACHE_PREFIX + month;
  let allEvents = [];
  let sourceUrl = '';
  let cached = false;
  const raw = cache.get(cacheKey);

  if (raw) {
    try {
      const data = JSON.parse(raw);
      allEvents = Array.isArray(data.events) ? data.events : [];
      sourceUrl = clean_(data.sourceUrl);
      cached = true;
    } catch (e) {
      allEvents = [];
    }
  }

  if (!cached) {
    const ss = openScheduleSpreadsheet_();
    const monthlySheet = findScheduleSheet_(ss, month);
    allEvents = monthlySheet ? readMonthlySheetEventsV5_(monthlySheet, month, null) : [];
    allEvents.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      clean_(a.startTime).localeCompare(clean_(b.startTime)) ||
      clean_(a.title).localeCompare(clean_(b.title))
    );
    sourceUrl = monthlySheet
      ? 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/edit#gid=' + monthlySheet.getSheetId()
      : 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/edit';
    cache.put(cacheKey, JSON.stringify({events:allEvents,sourceUrl:sourceUrl}), MONTH_CACHE_TTL_SECONDS);
  }

  let responseEvents = allEvents.map(function(event){ return Object.assign({}, event); });
  if (session.role === 'player') {
    responseEvents = responseEvents.filter(function(event){
      return eventAllowedForPlayer_(event, session);
    }).map(function(event){
      if (event.source === 'app') {
        event.myAttendance = readAttendanceForPlayer_(event.scheduleId, session.playerId);
      }
      return event;
    });
  }

  return ok_({
    month:month,
    events:responseEvents,
    sourceUrl:sourceUrl,
    version:scheduleDataVersion_(),
    cached:cached
  });
}

function invalidateMonthCache_(month) {
  const key = normalizeMonthKey_(month);
  if (key) CacheService.getScriptCache().remove(MONTH_CACHE_PREFIX + key);
}

function event_(scheduleId, session) {
  const ss = openScheduleSpreadsheet_();
  const id = clean_(scheduleId);
  const event = findMonthlyEventByIdV5_(ss, id);

  if (!event) throw new Error('予定が見つかりません。');

  if (event.source === 'app') {
    event.attachments = readAttachments_(ss, event.scheduleId);
    if (session.role === 'player') {
      event.myAttendance = readAttendanceForPlayer_(event.scheduleId, session.playerId);
    }
  }

  return ok_({event: event});
}

function saveEvent_(p) {
  const date = normalizeDate_(p.date);
  const categories = parseJsonArray_(p.categories);
  const type = clean_(p.type) || '練習';
  const title = clean_(p.title);
  const location = clean_(p.location);
  const allDay = toBoolean_(p.allDay);
  const startTime = allDay ? '' : clean_(p.startTime);
  const endTime = allDay ? '' : clean_(p.endTime);
  const note = clean_(p.note);
  const color = sanitizeColor_(p.color, colorForType_(type));
  const attendanceEnabled = toBoolean_(p.attendanceEnabled);
  const deadlineDays = Math.max(0, Math.min(60, Number(p.deadlineDays) || 0));
  const deadlineTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(clean_(p.deadlineTime)) ? clean_(p.deadlineTime) : '21:00';
  const deadlineAt = attendanceEnabled ? calculateDeadline_(date, deadlineDays, deadlineTime) : '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付を正しく入力してください。');
  if (!categories.length) throw new Error('カテゴリーを1つ以上選択してください。');
  if (!title && !location && !type) throw new Error('予定内容を入力してください。');
  if (!allDay && startTime && endTime && startTime >= endTime) throw new Error('終了時間は開始時間より後にしてください。');

  const ss = openScheduleSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const suppliedId = clean_(p.scheduleId);
    const id = suppliedId.indexOf('app-') === 0 ? suppliedId : 'app-' + Utilities.getUuid();

    const event = {
      scheduleId:id,date:date,categories:categories,type:type,title:title,location:location,
      startTime:startTime,endTime:endTime,note:note,color:color,allDay:allDay,
      attendanceEnabled:attendanceEnabled,deadlineDays:deadlineDays,
      deadlineTime:deadlineTime,deadlineAt:deadlineAt,updatedAt:formatDateTime_(new Date())
    };

    // 既存予定を消す前に、移動先・保存先が空いているか確認します。
    const previous = suppliedId ? findMonthlyEventByIdV5_(ss, id) : null;
    assertMonthlyTargetsAvailableV5_(ss, event, id);
    clearMonthlyEventByIdV5_(ss, id);
    try {
      writeEventToMonthlySheetV5_(ss, event);
      SpreadsheetApp.flush();
    } catch (writeError) {
      if (previous && previous.source === 'app') {
        try { writeEventToMonthlySheetV5_(ss, previous); SpreadsheetApp.flush(); } catch (restoreError) {}
      }
      throw writeError;
    }

    const verify = findMonthlyEventByIdV5_(ss, id);
    if (!verify || verify.date !== date) throw new Error('保存確認に失敗しました。');
    invalidateMonthCache_(date.slice(0,7));
    if (previous && previous.date) invalidateMonthCache_(previous.date.slice(0,7));
    verify.attachments = readAttachments_(ss, id);
    const version = bumpScheduleRevision_();
    return ok_({event:verify,version:version});
  } finally {
    lock.releaseLock();
  }
}

function deleteEvent_(p) {
  const id = clean_(p.scheduleId);
  if (!id || id.indexOf('app-') !== 0) throw new Error('削除対象が正しくありません。');
  const ss = openScheduleSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const existing = findMonthlyEventByIdV5_(ss, id);
    const deleted = clearMonthlyEventByIdV5_(ss, id);
    if (!deleted) throw new Error('削除対象が見つかりません。');
    trashAttachmentsForSchedule_(ss, id);
    SpreadsheetApp.flush();
    if (existing && existing.date) invalidateMonthCache_(existing.date.slice(0,7));
    const version = bumpScheduleRevision_();
    return ok_({deleted:true,version:version});
  } finally {
    lock.releaseLock();
  }
}

function assertMonthlyTargetsAvailableV5_(ss,event,scheduleId) {
  const month=event.date.slice(0,7);
  const day=Number(event.date.slice(8,10));
  const sheet=findScheduleSheet_(ss,month);
  if(!sheet)throw new Error(month+'の月別シートがありません。');
  const values=sheet.getDataRange().getDisplayValues();
  const notes=sheet.getDataRange().getNotes();
  const header=detectHeaders_(sheet,values);
  if(!header)throw new Error('予定表の見出しを確認できません。');
  let targetRow=0;
  for(let r=header.headerRow+1;r<=values.length;r++){
    const v=Number(String(values[r-1][header.dayCol-1]||'').replace(/[^0-9]/g,''));
    if(v===day){targetRow=r;break}
  }
  if(!targetRow)throw new Error(day+'日の行が見つかりません。');
  event.categories.forEach(category=>{
    const group=matchCategory_(header.groups,category);
    if(!group)throw new Error('カテゴリー「'+category+'」の列が見つかりません。');
    const cells=values[targetRow-1].slice(group.startCol-1,group.endCol).map(clean_).filter(Boolean);
    const meta=parseMonthlyMetaV5_(notes[targetRow-1][group.startCol-1]);
    const belongsToSelf=meta&&clean_(meta.scheduleId)===scheduleId;
    if(cells.length&&!belongsToSelf){
      throw new Error(event.date+' '+category+'には既に予定があります。先に内容を確認してください。');
    }
  });
}

function writeEventToMonthlySheetV5_(ss,event) {
  const month = event.date.slice(0,7);
  const day = Number(event.date.slice(8,10));
  const sheet = findScheduleSheet_(ss,month);
  if (!sheet) throw new Error(month + 'の月別シートがありません。');
  const values = sheet.getDataRange().getDisplayValues();
  const header = detectHeaders_(sheet,values);
  if (!header) throw new Error('予定表の見出しを確認できません。');

  let targetRow=0;
  for (let r=header.headerRow+1;r<=values.length;r++) {
    const v=Number(String(values[r-1][header.dayCol-1]||'').replace(/[^0-9]/g,''));
    if (v===day){targetRow=r;break}
  }
  if (!targetRow) throw new Error(day + '日の行が見つかりません。');

  const text=[event.title,event.location].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
  const time=event.allDay?'終日':[event.startTime,event.endTime].filter(Boolean).join('〜');
  const meta=MONTHLY_META_PREFIX+JSON.stringify(event);

  event.categories.forEach(category=>{
    const group=matchCategory_(header.groups,category);
    if (!group) throw new Error('カテゴリー「'+category+'」の列が見つかりません。');
    const width=group.endCol-group.startCol+1;
    const range=sheet.getRange(targetRow,group.startCol,1,width);
    if (range.getDisplayValues()[0].some(v=>clean_(v))) {
      throw new Error(event.date+' '+category+'には既に予定があります。先に内容を確認してください。');
    }
    if (group.endCol>group.startCol) {
      sheet.getRange(targetRow,group.startCol).setValue(text||event.type);
      sheet.getRange(targetRow,group.startCol+1).setValue(time);
      if (group.endCol>group.startCol+1) sheet.getRange(targetRow,group.startCol+2,1,group.endCol-group.startCol-1).clearContent();
    } else {
      sheet.getRange(targetRow,group.startCol).setValue([text||event.type,time].filter(Boolean).join(' '));
    }
    range.setBackground(event.color);
    sheet.getRange(targetRow,group.startCol).setNote(meta);
  });
}

function clearMonthlyEventByIdV5_(ss,scheduleId) {
  let deleted=false;
  ss.getSheets().forEach(sheet=>{
    const month=monthKeyFromName_(sheet.getName());
    if(!month)return;
    const range=sheet.getDataRange();
    const notes=range.getNotes();
    for(let r=0;r<notes.length;r++){
      for(let c=0;c<notes[r].length;c++){
        const meta=parseMonthlyMetaV5_(notes[r][c]);
        if(meta&&clean_(meta.scheduleId)===scheduleId){
          const values=range.getDisplayValues();
          const header=detectHeaders_(sheet,values);
          const group=header&&header.groups.find(g=>c+1>=g.startCol&&c+1<=g.endCol);
          const startCol=group?group.startCol:c+1;
          const endCol=group?group.endCol:c+1;
          sheet.getRange(r+1,startCol,1,endCol-startCol+1)
            .clearContent().clearNote().setBackground('#ffffff');
          deleted=true;
        }
      }
    }
  });
  return deleted;
}

function findManagedEvent_(ss,id) {
  const event=findMonthlyEventByIdV5_(ss,id);
  return event&&event.source==='app'?event:null;
}

function findMonthlyEventByIdV5_(ss,scheduleId) {
  const id=clean_(scheduleId);
  if(id.indexOf('legacyview-')===0)return findMonthlySheetEventByIdV42_(ss,id);
  for(const sheet of ss.getSheets()){
    const month=monthKeyFromName_(sheet.getName());
    if(!month)continue;
    const events=readMonthlySheetEventsV5_(sheet,month,ss);
    const found=events.find(e=>e.scheduleId===id);
    if(found)return found;
  }
  return null;
}

function parseMonthlyMetaV5_(note) {
  const raw=clean_(note);
  if(raw.indexOf(MONTHLY_META_PREFIX)!==0)return null;
  try{
    const data=JSON.parse(raw.slice(MONTHLY_META_PREFIX.length));
    return data&&data.scheduleId?data:null;
  }catch(e){return null}
}

function monthlyMetaToEventV5_(meta,date,ss) {
  const event={
    scheduleId:clean_(meta.scheduleId),date:date,
    categories:parseCategories_(meta.categories),type:clean_(meta.type)||'練習',
    title:clean_(meta.title),location:clean_(meta.location),startTime:clean_(meta.startTime),
    endTime:clean_(meta.endTime),note:clean_(meta.note),
    color:sanitizeColor_(meta.color,colorForType_(meta.type)),source:'app',sourceRef:'monthly-note',
    updatedAt:clean_(meta.updatedAt),allDay:toBoolean_(meta.allDay),
    attendanceEnabled:toBoolean_(meta.attendanceEnabled),deadlineDays:Number(meta.deadlineDays)||0,
    deadlineTime:clean_(meta.deadlineTime)||'21:00',deadlineAt:clean_(meta.deadlineAt),attachments:[]
  };
  // 一覧取得時は添付を読まない。詳細画面を開いた時だけ取得する。
  if(ss)event.attachments=readAttachments_(ss,event.scheduleId);
  return event;
}

function uploadAttachment_(p) {
  const uploadId=clean_(p.uploadId),scheduleId=clean_(p.scheduleId);
  if (!uploadId) throw new Error('アップロードIDがありません。');
  if (!scheduleId || scheduleId.indexOf('app-')!==0) throw new Error('先に予定を保存してください。');
  const fileName=sanitizeFileName_(p.fileName);
  const mimeType=clean_(p.mimeType);
  const base64=clean_(p.base64);
  const allowed=[
    'image/jpeg','image/png','application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  if (!allowed.includes(mimeType)) throw new Error('対応していないファイル形式です。');
  if (!base64) throw new Error('ファイル内容がありません。');
  const bytes=Utilities.base64Decode(base64);
  if (bytes.length > 10*1024*1024) throw new Error('1ファイル10MB以下にしてください。');

  const ss=openScheduleSpreadsheet_();
  if (!findManagedEvent_(ss,scheduleId)) throw new Error('予定が見つかりません。');
  const existing=readAttachments_(ss,scheduleId);
  if (existing.length>=10) throw new Error('1予定につき添付は10件までです。');

  const folder=getAttachmentFolder_();
  const file=folder.createFile(Utilities.newBlob(bytes,mimeType,fileName));

  const attachmentId='att-'+Utilities.getUuid();
  const sheet=ensureAttachmentSheet_(ss);
  sheet.appendRow([attachmentId,scheduleId,file.getId(),fileName,mimeType,bytes.length,'','',new Date(),false]);
  SpreadsheetApp.flush();
  return ok_({attachmentId:attachmentId,fileName:fileName});
}

function readAttachments_(ss,scheduleId) {
  const sheet=ensureAttachmentSheet_(ss);
  if (sheet.getLastRow()<2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues()
    .filter(r=>clean_(r[1])===scheduleId&&!toBoolean_(r[9]))
    .map(r=>({
      attachmentId:clean_(r[0]),fileName:clean_(r[3]),mimeType:clean_(r[4]),size:Number(r[5])||0,
      createdAt:formatDateTime_(r[8])
    }));
}


function attachmentContent_(attachmentId, session) {
  const id=clean_(attachmentId);
  if (!id) throw new Error('添付IDがありません。');
  const ss=openScheduleSpreadsheet_();
  const sheet=ensureAttachmentSheet_(ss);
  if (sheet.getLastRow()<2) throw new Error('添付が見つかりません。');
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues();
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(clean_(r[0])===id&&!toBoolean_(r[9])){
      if(session.role==='player'){
        const event=findManagedEvent_(ss,clean_(r[1]));
        if(!event) throw new Error('この添付を閲覧する権限がありません。');
      }
      const file=DriveApp.getFileById(clean_(r[2]));
      const blob=file.getBlob();
      const bytes=blob.getBytes();
      if(bytes.length>10*1024*1024) throw new Error('このファイルは大きすぎるため表示できません。');
      return ok_({
        fileName:clean_(r[3])||file.getName(),
        mimeType:clean_(r[4])||blob.getContentType(),
        base64:Utilities.base64Encode(bytes)
      });
    }
  }
  throw new Error('添付が見つかりません。');
}

function deleteAttachment_(attachmentId) {
  const id=clean_(attachmentId);
  if (!id) throw new Error('添付IDがありません。');
  const ss=openScheduleSpreadsheet_();
  const sheet=ensureAttachmentSheet_(ss);
  if (sheet.getLastRow()<2) throw new Error('添付が見つかりません。');
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues();
  for(let i=0;i<rows.length;i++){
    if(clean_(rows[i][0])===id&&!toBoolean_(rows[i][9])){
      try{DriveApp.getFileById(clean_(rows[i][2])).setTrashed(true)}catch(e){}
      sheet.getRange(i+2,10).setValue(true);
      return ok_({deleted:true});
    }
  }
  throw new Error('添付が見つかりません。');
}

function trashAttachmentsForSchedule_(ss,scheduleId) {
  const sheet=ensureAttachmentSheet_(ss);
  if (sheet.getLastRow()<2) return;
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,10).getValues();
  rows.forEach((r,i)=>{
    if(clean_(r[1])===scheduleId&&!toBoolean_(r[9])){
      try{DriveApp.getFileById(clean_(r[2])).setTrashed(true)}catch(e){}
      sheet.getRange(i+2,10).setValue(true);
    }
  });
}

function getAttachmentFolder_() {
  const props=PropertiesService.getScriptProperties();
  let id=clean_(props.getProperty(PROP_ATTACHMENT_FOLDER_ID));
  if (id) {
    try{return DriveApp.getFolderById(id)}catch(e){}
  }
  const folder=DriveApp.createFolder('NINJA AIRS 練習予定表 添付ファイル');
  props.setProperty(PROP_ATTACHMENT_FOLDER_ID,folder.getId());
  return folder;
}

function putUploadResult_(uploadId,result) {
  if (!uploadId) return;
  CacheService.getScriptCache().put(UPLOAD_PREFIX+uploadId,JSON.stringify(result),600);
}
function uploadStatus_(uploadId) {
  const id=clean_(uploadId);
  if (!id) throw new Error('アップロードIDがありません。');
  const raw=CacheService.getScriptCache().get(UPLOAD_PREFIX+id);
  if (!raw) return {status:'pending'};
  CacheService.getScriptCache().remove(UPLOAD_PREFIX+id);
  return JSON.parse(raw);
}


function calculateDeadline_(date,days,time){
  const parts=date.split('-').map(Number);
  const t=time.split(':').map(Number);
  const d=new Date(parts[0],parts[1]-1,parts[2],t[0],t[1],0);
  d.setDate(d.getDate()-days);
  return d;
}
function eventAllowedForPlayer_(event,session){
  const cat=normalizeCategory_(session.category);
  return !cat||event.categories.some(c=>normalizeCategory_(c)===cat);
}
function ensureAttendanceSheet_(ss){
  const headers=['attendanceId','scheduleId','playerId','playerName','category','status','arrivalTime','reason','answeredAt','updatedAt','lineUserId','deleted'];
  let sheet=ss.getSheetByName(ATTENDANCE_SHEET);
  if(!sheet){
    sheet=ss.insertSheet(ATTENDANCE_SHEET);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);
  }
  return sheet;
}
function readAttendanceForPlayer_(scheduleId,playerId){
  const sheet=ensureAttendanceSheet_(openMasterSpreadsheet_());
  if(sheet.getLastRow()<2)return null;
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,12).getValues();
  for(let i=rows.length-1;i>=0;i--){
    const r=rows[i];
    if(clean_(r[1])===scheduleId&&clean_(r[2])===playerId&&!toBoolean_(r[11])){
      return {attendanceId:clean_(r[0]),status:clean_(r[5]),arrivalTime:clean_(r[6]),reason:clean_(r[7]),answeredAt:formatDateTime_(r[8]),updatedAt:formatDateTime_(r[9])};
    }
  }
  return null;
}
function attendanceMy_(scheduleId,session){
  const event=findManagedEvent_(openScheduleSpreadsheet_(),clean_(scheduleId));
  if(!event||!eventAllowedForPlayer_(event,session)) throw new Error('予定が見つかりません。');
  return ok_({event:event,attendance:readAttendanceForPlayer_(event.scheduleId,session.playerId),deadlineClosed:isDeadlineClosed_(event)});
}
function isDeadlineClosed_(event){
  if(!event.attendanceEnabled)return true;
  if(!event.deadlineAt)return false;
  const d=new Date(String(event.deadlineAt).replace(' ','T'));
  return !isNaN(d)&&new Date()>d;
}
function saveAttendance_(p,session){
  const scheduleId=clean_(p.scheduleId);
  const status=clean_(p.status);
  const arrivalTime=clean_(p.arrivalTime);
  const reason=clean_(p.reason);
  if(!['出席','遅刻','欠席'].includes(status)) throw new Error('出席・遅刻・欠席のいずれかを選択してください。');
  if(status==='遅刻'){
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) throw new Error('到着予定時刻を入力してください。');
    if(!reason) throw new Error('遅刻理由を入力してください。');
  }
  if(status==='欠席'&&!reason) throw new Error('欠席理由を入力してください。');
  const event=findManagedEvent_(openScheduleSpreadsheet_(),scheduleId);
  if(!event||!eventAllowedForPlayer_(event,session)) throw new Error('予定が見つかりません。');
  if(!event.attendanceEnabled) throw new Error('この予定は出欠回答を受け付けていません。');
  if(isDeadlineClosed_(event)) throw new Error('回答期限が終了しています。コーチへ直接連絡してください。');
  const ss=openMasterSpreadsheet_(),sheet=ensureAttendanceSheet_(ss),lock=LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const rows=sheet.getLastRow()>=2?sheet.getRange(2,1,sheet.getLastRow()-1,12).getValues():[];
    let row=0,id='';
    for(let i=0;i<rows.length;i++){
      if(clean_(rows[i][1])===scheduleId&&clean_(rows[i][2])===session.playerId&&!toBoolean_(rows[i][11])){row=i+2;id=clean_(rows[i][0]);break}
    }
    const now=new Date();if(!id)id='ans-'+Utilities.getUuid();
    const answeredAt=row?(sheet.getRange(row,9).getValue()||now):now;
    const target=row||sheet.getLastRow()+1;
    sheet.getRange(target,1,1,12).setValues([[id,scheduleId,session.playerId,session.playerName,session.category,status,status==='遅刻'?arrivalTime:'',status==='出席'?'':reason,answeredAt,now,session.lineUserId,false]]);
    SpreadsheetApp.flush();
    return ok_({attendance:readAttendanceForPlayer_(scheduleId,session.playerId)});
  }finally{lock.releaseLock()}
}
function attendanceSummary_(scheduleId){
  const event=findManagedEvent_(openScheduleSpreadsheet_(),clean_(scheduleId));
  if(!event)throw new Error('予定が見つかりません。');
  const master=openMasterSpreadsheet_(),playersSheet=master.getSheetByName(PLAYER_SHEET);
  const players=[];
  if(playersSheet&&playersSheet.getLastRow()>=2){
    const values=playersSheet.getDataRange().getDisplayValues(),headers=values[0].map(normalizeHeader_);
    const idCol=findHeaderIndex_(headers,['playerid','player_id','選手id','id']);
    const nameCol=findHeaderIndex_(headers,['name','playername','player_name','氏名','選手名']);
    const catCol=findHeaderIndex_(headers,['category','カテゴリー','所属カテゴリー']);
    if(idCol>=0&&nameCol>=0)for(let i=1;i<values.length;i++){
      const category=catCol>=0?clean_(values[i][catCol]):'';
      if(event.categories.some(c=>normalizeCategory_(c)===normalizeCategory_(category)))players.push({playerId:clean_(values[i][idCol]),playerName:clean_(values[i][nameCol]),category:category});
    }
  }
  const sheet=ensureAttendanceSheet_(master),map={};
  if(sheet.getLastRow()>=2)sheet.getRange(2,1,sheet.getLastRow()-1,12).getValues().forEach(r=>{
    if(clean_(r[1])===event.scheduleId&&!toBoolean_(r[11]))map[clean_(r[2])]={status:clean_(r[5]),arrivalTime:clean_(r[6]),reason:clean_(r[7]),updatedAt:formatDateTime_(r[9])};
  });
  const rows=players.map(p=>Object.assign({},p,map[p.playerId]||{status:'未回答',arrivalTime:'',reason:'',updatedAt:''}));
  const counts={出席:0,遅刻:0,欠席:0,未回答:0};rows.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  return ok_({counts:counts,total:rows.length,rows:rows,deadlineClosed:isDeadlineClosed_(event)});
}

function detectHeaders_(sheet,values) {
  let headerRow=0,dayCol=0,weekdayCol=0;
  for(let r=0;r<Math.min(values.length,15);r++){
    for(let c=0;c<values[r].length;c++){
      const v=clean_(values[r][c]);
      if(v==='日'||v==='日付'){headerRow=r+1;dayCol=c+1}
      if(v==='曜日')weekdayCol=c+1;
    }
    if(headerRow&&weekdayCol)break;
  }
  if(!headerRow)return null;
  if(!weekdayCol)weekdayCol=dayCol+1;
  const row=values[headerRow-1],merges=sheet.getDataRange().getMergedRanges(),groups=[];
  for(let c=weekdayCol+1;c<=row.length;c++){
    const text=clean_(row[c-1]);if(!text)continue;
    let startCol=c,endCol=c;
    const mr=merges.find(m=>m.getRow()===headerRow&&c>=m.getColumn()&&c<m.getColumn()+m.getNumColumns());
    if(mr){startCol=mr.getColumn();endCol=mr.getColumn()+mr.getNumColumns()-1}
    if(!groups.some(g=>g.startCol===startCol))groups.push({category:text,startCol:startCol,endCol:endCol});
  }
  return {headerRow:headerRow,dayCol:dayCol,weekdayCol:weekdayCol,groups:groups};
}

function findScheduleSheet_(ss,requestedMonth) {
  const target=normalizeMonthKey_(requestedMonth);
  return ss.getSheets().find(s=>monthKeyFromName_(s.getName())===target)||null;
}
function monthKeyFromName_(name) {
  const s=String(name||'').normalize('NFKC');
  let m=s.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])/);
  if(m)return m[1]+'-'+String(Number(m[2])).padStart(2,'0');
  m=s.match(/^(1[0-2]|0?[1-9])月$/);
  if(m)return new Date().getFullYear()+'-'+String(Number(m[1])).padStart(2,'0');
  return '';
}
function normalizeMonthKey_(value) {
  const s=String(value||'').normalize('NFKC'),m=s.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])/);
  return m?m[1]+'-'+String(Number(m[2])).padStart(2,'0'):'';
}
function matchCategory_(groups,category) {
  const key=categoryKey_(category);
  return groups.find(g=>categoryKey_(g.category)===key)||null;
}
function categoryKey_(value){
  const n=normalizeCategory_(value).toLowerCase();
  const age=(n.match(/u(13|14|15)/)||[])[1]||'';
  const gender=n.includes('男子')?'男子':n.includes('女子')?'女子':'';
  return age&&gender?gender+'u'+age:n;
}
function parseJsonArray_(v){try{const a=JSON.parse(String(v||'[]'));return Array.isArray(a)?a.map(clean_).filter(Boolean):[]}catch(e){return parseCategories_(v)}}
function parseCategories_(v){
  if(Array.isArray(v))return v.map(clean_).filter(Boolean);
  const s=clean_(v);if(!s)return [];
  try{const a=JSON.parse(s);if(Array.isArray(a))return a.map(clean_).filter(Boolean)}catch(e){}
  return s.split(/[\/,、|]/).map(clean_).filter(Boolean);
}
function parseMirrorRefs_(v){try{const a=JSON.parse(clean_(v)||'[]');return Array.isArray(a)?a:[]}catch(e){return []}}
function normalizeMirrorRefsJson_(v){const a=parseMirrorRefs_(v);if(a.length)return JSON.stringify(a);try{const x=JSON.parse(clean_(v));return JSON.stringify([x])}catch(e){return '[]'}}
function normalizeCategory_(v){return String(v||'').normalize('NFKC').replace(/\s+/g,'').replace(/[（）()]/g,'').trim()}
function normalizeDate_(v){if(v instanceof Date&&!isNaN(v))return Utilities.formatDate(v,Session.getScriptTimeZone()||'Asia/Tokyo','yyyy-MM-dd');const s=String(v||'').trim(),m=s.match(/(20\d{2})\D(\d{1,2})\D(\d{1,2})/);return m?m[1]+'-'+String(Number(m[2])).padStart(2,'0')+'-'+String(Number(m[3])).padStart(2,'0'):s}
function colorForType_(type){
  const map={'練習':'#2563eb','試合':'#dc2626','遠征':'#16a34a','イベント':'#eab308','ミーティング':'#7c3aed','特別練習':'#ea580c','シューティング':'#0891b2','女子':'#db2777','OFF':'#6b7280','その他':'#92400e'};
  return map[clean_(type)]||'#2563eb';
}
function sanitizeColor_(value,fallback){
  const color=clean_(value);
  return /^#[0-9a-fA-F]{6}$/.test(color)?color.toLowerCase():(fallback||'#2563eb');
}
function sanitizeFileName_(v){return clean_(v).replace(/[\\/:*?"<>|]/g,'_').slice(0,180)||'attachment'}
function formatDateTime_(v){return v instanceof Date&&!isNaN(v)?Utilities.formatDate(v,Session.getScriptTimeZone()||'Asia/Tokyo','yyyy-MM-dd HH:mm:ss'):clean_(v)}
function toBoolean_(v){return v===true||String(v).toLowerCase()==='true'||String(v)==='1'}
function clean_(v){return String(v==null?'':v).trim()}
function safeCallback_(v){const s=clean_(v);return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(s)?s:'callback'}
function constantTimeEquals_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function safeErrorMessage_(e){return e&&e.message?String(e.message):'処理に失敗しました。'}
function ok_(data){return Object.assign({status:'ok'},data||{})}
function error_(message){return {status:'error',message:message}}




function setupAttendanceV3() {
  const schedule=openScheduleSpreadsheet_();
  ensureAttachmentSheet_(schedule);
  const master=openMasterSpreadsheet_();
  ensureAttendanceSheet_(master);
  Logger.log('予定表: '+schedule.getName());
  Logger.log('管理表: '+master.getName());
  Logger.log('attendanceシート準備完了');
}

/**
 * 既存の月別予定表を直接読み取ります。
 * 月別シートを唯一の予定データとして直接読み取ります。
 */
function readMonthlySheetEventsV5_(sheet, month, ss) {
  const range = sheet.getDataRange();
  const values = range.getDisplayValues();
  const notes = range.getNotes();
  const header = detectHeaders_(sheet, values);

  if (!header) return [];

  const groups = header.groups
    .map(group => ({
      header: clean_(group.category),
      startCol: Number(group.startCol),
      endCol: Number(group.endCol),
      categories: categoriesForMonthlyHeaderV42_(group.category),
      forcedType: forcedTypeForMonthlyHeaderV42_(group.category)
    }))
    .filter(group => group.categories.length);

  if (!groups.length) return [];

  // 結合セル情報を一度だけ索引化します。
  const mergeIndex = {};
  range.getMergedRanges().forEach(merged => {
    const startRow = merged.getRow();
    const endRow = startRow + merged.getNumRows() - 1;
    const startCol = merged.getColumn();
    const endCol = startCol + merged.getNumColumns() - 1;
    const text = clean_(merged.getDisplayValue());

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        mergeIndex[row + ':' + col] = {
          startRow: startRow,
          endRow: endRow,
          startCol: startCol,
          endCol: endCol,
          text: text
        };
      }
    }
  });

  const results = [];
  const seen = new Set();
  const seenIds = new Set();

  for (let row = header.headerRow + 1; row <= values.length; row++) {
    const day = parseMonthlyDayV42_(values[row - 1][header.dayCol - 1]);
    if (!day) continue;

    const date = month + '-' + String(day).padStart(2, '0');

    groups.forEach(group => {
      const merge = mergeIndex[row + ':' + group.startCol] || null;
      const actualStartCol = merge ? merge.startCol : group.startCol;
      const actualEndCol = merge ? merge.endCol : group.endCol;

      // 結合セルは左端カテゴリーで1回だけ処理します。
      if (merge && group.startCol !== groups
          .filter(g => g.startCol <= actualEndCol && g.endCol >= actualStartCol)
          .map(g => g.startCol)
          .sort((a, b) => a - b)[0]) {
        return;
      }

      let text = '';
      let categories = group.categories.slice();
      let forcedType = group.forcedType;

      if (merge) {
        text = merge.text;
        const overlapping = groups.filter(g =>
          g.startCol <= actualEndCol && g.endCol >= actualStartCol
        );
        categories = uniqueMonthlyStringsV42_(
          overlapping.reduce((all, g) => all.concat(g.categories), [])
        );
        forcedType = overlapping.map(g => g.forcedType).find(Boolean) || '';
      } else {
        const cells = values[row - 1]
          .slice(group.startCol - 1, group.endCol)
          .map(clean_)
          .filter(Boolean);
        text = uniqueMonthlyStringsV42_(cells).join(' ');
      }

      const metaNote = notes[row - 1] && notes[row - 1][actualStartCol - 1] ? notes[row - 1][actualStartCol - 1] : '';
      const meta = parseMonthlyMetaV5_(metaNote);
      if (meta && text) {
        if (seenIds.has(clean_(meta.scheduleId))) return;
        seenIds.add(clean_(meta.scheduleId));
        results.push(monthlyMetaToEventV5_(meta, date, ss));
        return;
      }

      if (!text) return;

      const event = monthlyCellToEventV42_({
        sheet: sheet,
        row: row,
        startCol: actualStartCol,
        endCol: actualEndCol,
        date: date,
        categories: categories,
        text: text,
        forcedType: forcedType
      });

      const dedupeKey = [
        event.date,
        event.categories.slice().sort().join('|'),
        event.title,
        event.location,
        event.startTime,
        event.endTime
      ].join('::');

      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      results.push(event);
    });
  }

  return results;
}

function monthlyCellToEventV42_(info) {
  const raw = normalizeMonthlyTextV42_(info.text);
  const time = extractMonthlyTimeV42_(raw);
  const withoutTime = clean_(
    raw.replace(time.matchedText || '', '').replace(/\s+/g, ' ')
  );

  const type = info.forcedType || detectMonthlyTypeV42_(raw);
  let title = withoutTime || type;
  let location = '';

  if (
    ['練習', '特別練習', 'シューティング'].includes(type) &&
    withoutTime &&
    !/[試合交流戦大会カップ遠征クリニックトレーニングOFF]/i.test(withoutTime)
  ) {
    location = withoutTime;
    title = type;
  }

  return {
    scheduleId: [
      'legacyview',
      info.sheet.getSheetId(),
      info.row,
      info.startCol,
      info.endCol
    ].join('-'),
    date: info.date,
    categories: uniqueMonthlyStringsV42_(info.categories),
    type: type,
    title: title,
    location: location,
    startTime: time.startTime,
    endTime: time.endTime,
    note: raw,
    color: colorForType_(type),
    source: 'monthly-sheet',
    sourceRef: info.sheet.getName() + '!' + info.row + ':' + info.startCol,
    updatedAt: '',
    allDay: !time.startTime,
    attendanceEnabled: false,
    deadlineDays: 0,
    deadlineTime: '21:00',
    deadlineAt: '',
    attachments: []
  };
}

function findMonthlySheetEventByIdV42_(ss, scheduleId) {
  const match = clean_(scheduleId).match(
    /^legacyview-(\d+)-(\d+)-(\d+)-(\d+)$/
  );
  if (!match) return null;

  const sheetId = Number(match[1]);
  const row = Number(match[2]);
  const startCol = Number(match[3]);
  const endCol = Number(match[4]);

  const sheet = ss.getSheets().find(s => s.getSheetId() === sheetId);
  if (!sheet) return null;

  const month = monthKeyFromName_(sheet.getName());
  if (!month) return null;

  const events = readMonthlySheetEventsV5_(sheet, month, ss);
  return events.find(event =>
    event.scheduleId === scheduleId
  ) || null;
}

function categoriesForMonthlyHeaderV42_(header) {
  const normalized = normalizeCategory_(header)
    .replace(/[・／/]/g, '')
    .toLowerCase();

  if (normalized.includes('u15') && normalized.includes('男子')) return ['男子U15'];
  if (normalized.includes('u14') && normalized.includes('男子')) return ['男子U14'];
  if (normalized.includes('u13') && normalized.includes('男子')) return ['男子U13'];
  if (normalized.includes('u15') && normalized.includes('女子')) return ['女子U15'];
  if (normalized.includes('u14') && normalized.includes('女子')) return ['女子U14'];
  if (normalized.includes('u13') && normalized.includes('女子')) return ['女子U13'];
  if (normalized === '女子') return ['女子U13','女子U14','女子U15'];

  if (
    normalized.includes('夏の特別練習') ||
    normalized.includes('ステップupスキル') ||
    normalized.includes('備考')
  ) {
    return ['男子U13','男子U14','男子U15','女子U13','女子U14','女子U15'];
  }

  return [];
}

function forcedTypeForMonthlyHeaderV42_(header) {
  const normalized = normalizeCategory_(header).toLowerCase();
  if (normalized.includes('夏の特別練習')) return '特別練習';
  if (normalized.includes('ステップupスキル')) return '練習';
  return '';
}

function detectMonthlyTypeV42_(text) {
  const value = String(text || '').normalize('NFKC');

  if (/OFF|休み/i.test(value)) return 'OFF';
  if (/シューティング/i.test(value)) return 'シューティング';
  if (/ミーティング/i.test(value)) return 'ミーティング';
  if (/遠征|宿泊/i.test(value)) return '遠征';
  if (/交流戦|練習試合|試合|大会|カップ|招待/i.test(value)) return '試合';
  if (/クリニック/i.test(value)) return 'イベント';
  if (/ストレングス|コンディショニング|トレーニング|スキル/i.test(value)) {
    return '特別練習';
  }

  return '練習';
}

function extractMonthlyTimeV42_(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .replace(/[：]/g, ':')
    .replace(/[〜～~－—–]/g, '-');

  const match = normalized.match(
    /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/
  );

  if (!match) {
    return {
      startTime: '',
      endTime: '',
      matchedText: ''
    };
  }

  return {
    startTime: normalizeMonthlyClockV42_(match[1]),
    endTime: normalizeMonthlyClockV42_(match[2]),
    matchedText: match[0]
  };
}

function normalizeMonthlyClockV42_(value) {
  const parts = clean_(value).split(':');
  if (parts.length !== 2) return '';

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) return '';

  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function normalizeMonthlyTextV42_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMonthlyDayV42_(value) {
  const match = String(value || '').normalize('NFKC').match(/\d{1,2}/);
  if (!match) return 0;

  const day = Number(match[0]);
  return day >= 1 && day <= 31 ? day : 0;
}

function uniqueMonthlyStringsV42_(values) {
  return Array.from(new Set((values || []).map(clean_).filter(Boolean)));
}
