/** 共用的 Apps Script／Google 服務模擬環境。
 * 目的：讓多個測試檔以同一份模擬執行 apps-script/*.gs，避免各檔各自實作而行為分歧。
 * 只在本機測試使用，不會進入正式部署。
 */
const fs = require('node:fs');
const vm = require('node:vm');

const SCRIPT_FILES = ['apps-script/MasteryCore.gs', 'apps-script/Code.gs', 'apps-script/MasteryStore.gs'];

function sheetMock(tables, name, state) {
  const table = () => tables[name];
  const guard = () => {
    if (state.failSheet === name) throw new Error('模擬試算表故障：' + name);
  };
  const range = (row, column, numRows = 1, numColumns = 1) => ({
    getValues() {
      if (state.locked) state.sheetOpsWhileLocked.push('getValues:' + name);
      guard();
      const out = [];
      for (let r = row - 1; r < row - 1 + numRows; r++) {
        const src = table()[r] || [], line = [];
        for (let c = 0; c < numColumns; c++) line.push(src[column - 1 + c] === undefined ? '' : src[column - 1 + c]);
        out.push(line);
      }
      return out;
    },
    getDisplayValues() { return this.getValues().map(r => r.map(v => String(v))); },
    setValues(values) {
      if (state.locked) state.sheetOpsWhileLocked.push('setValues:' + name);
      guard();
      values.forEach((valuesRow, r) => {
        const target = row - 1 + r;
        while (table().length <= target) table().push([]);
        valuesRow.forEach((value, c) => { table()[target][column - 1 + c] = value; });
      });
    },
    setValue(value) { guard(); const target = row - 1; while (table().length <= target) table().push([]); table()[target][column - 1] = value; },
    setNumberFormat: () => {},
    createTextFinder(needle) {
      let entire = false, caseSensitive = true;
      const api = {
        matchEntireCell(value) { entire = value; return api; },
        matchCase(value) { caseSensitive = value; return api; },
        findNext() {
          guard();
          const want = String(needle), target = caseSensitive ? want : want.toLowerCase();
          for (let r = row - 1; r < row - 1 + numRows; r++) {
            const cell = String((table()[r] || [])[column - 1] === undefined ? '' : (table()[r] || [])[column - 1]);
            const have = caseSensitive ? cell : cell.toLowerCase();
            if (entire ? have === target : have.includes(target)) return { getRow: () => r + 1 };
          }
          return null;
        }
      };
      return api;
    }
  });
  return {
    getName: () => name,
    getLastRow: () => { guard(); return table().length; },
    getLastColumn: () => Math.max(0, ...table().map(r => r.length)),
    getRange: range,
    appendRow: values => { guard(); table().push(values.slice()); },
    setFrozenRows: () => {}
  };
}

function makeEnv(seed = {}, options = {}) {
  const tables = {};
  Object.keys(seed).forEach(name => { tables[name] = seed[name].map(row => row.slice()); });
  const sheets = {}, cache = new Map(), props = new Map([['SCORE_SPREADSHEET_ID', 'test-book']]);
  const state = { failSheet: null, failProps: false, locked: false, sheetOpsWhileLocked: [], lockHoldMs: 0, lockAttempts: 0, triggers: [] };
  const sheetFor = name => {
    if (!tables[name]) tables[name] = [];
    if (!sheets[name]) sheets[name] = sheetMock(tables, name, state);
    return sheets[name];
  };
  const book = {
    getId: () => 'test-book',
    getSheetByName: name => (tables[name] ? sheetFor(name) : null),
    insertSheet: name => sheetFor(name)
  };
  const s = {
    console: { log: () => {}, error: () => {}, warn: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (props.has(key) ? props.get(key) : null),
        setProperty: (key, value) => {
          if (state.failProps) throw new Error('模擬 Script Properties 容量上限');
          props.set(key, value);
        },
        deleteProperty: key => props.delete(key),
        getProperties: () => Object.fromEntries(props)
      })
    },
    SpreadsheetApp: {
      openById: () => book,
      getActiveSpreadsheet: () => book,
      flush: () => {},
      getUi: () => ({ alert: () => {}, createMenu: () => ({ addItem() { return this; }, addToUi() {} }) })
    },
    CacheService: {
      getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) })
    },
    LockService: {
      getScriptLock: () => ({
        // tryLock 在使用者程式中負責「取得鎖」，模擬時必須同步切換 locked 狀態，
        // 否則無法斷言「鎖內不含 Sheet 存取」這條 0D 的核心保證。
        tryLock: () => {
          state.lockAttempts = (state.lockAttempts || 0) + 1;
          if (state.failLock === true) return false;
          state.locked = true;
          state.lockStart = Date.now();
          return true;
        },
        waitLock: () => { state.locked = true; state.lockStart = Date.now(); },
        hasLock: () => state.locked,
        releaseLock: () => {
          if (state.locked && state.lockStart) state.lockHoldMs = (state.lockHoldMs || 0) + (Date.now() - state.lockStart);
          state.locked = false;
        }
      })
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => text }) },
    // 觸發器模擬：只記錄建立／刪除，讓 setupTriggers 的「先清後建」可被斷言。
    // 本機測試不建立真實觸發器，也不執行 atHour/everyDays 的排程。
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: trigger => {
        const i = state.triggers.indexOf(trigger);
        if (i >= 0) state.triggers.splice(i, 1);
      },
      newTrigger: handler => {
        const trigger = {
          getHandlerFunction: () => handler,
          _hour: null,
          timeBased() { return this; },
          atHour(h) { this._hour = h; return this; },
          nearMinute() { return this; },
          everyDays() { return this; },
          create() { state.triggers.push(trigger); return trigger; }
        };
        return trigger;
      }
    }
  };
  // Apps Script 的頂層 const（如 MODE_PATTERN、MAX_MODE_COLUMNS）不會成為全域屬性，
  // 測試無法由 s.X 取得。三個 .gs 尾端都有 `module.exports = {...}`（真環境不會執行），
  // 這裡提供一個會「合併」而非覆蓋的 module 物件，把常數與函式收集起來供測試取用。
  const exported = {};
  s.module = {
    set exports(value) { Object.assign(exported, value); },
    get exports() { return exported; }
  };
  vm.createContext(s);
  for (const file of SCRIPT_FILES) vm.runInContext(fs.readFileSync(file, 'utf8'), s);
  if (options.skipSetup !== true) s.setup();
  // setup() 內的 refreshSummary 也會取鎖並寫總覽；那些不屬於交卷路徑，
  // 必須清空計數器，否則「鎖內不得碰 Sheet」的斷言會被初始化的雜訊污染。
  state.locked = false;
  state.lockAttempts = 0;
  state.lockHoldMs = 0;
  state.sheetOpsWhileLocked = [];
  state.triggers = [];
  return { s, tables, cache, props, state, exported };
}

module.exports = { makeEnv };
