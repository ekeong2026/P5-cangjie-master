/* 帳號 B 模式二字庫載入；不發送成績。 */
(function () {
  'use strict';
  var current=null, pending=null, loading=false;
  function status(message){var el=document.getElementById('word-bank-status');if(el)el.textContent=message;}
  function cacheKey(){return 'p5_mode2_cloud_cache_v1:'+String(CONFIG.WORD_BANK_URL||'');}
  function running(){return typeof window.isMode2Running==='function'&&window.isMode2Running();}
  function apply(data,offline){
    if(running()){pending={data:data,offline:offline};status('新字庫已取得，返回備戰畫面後更新。');return;}
    current=data;pending=null;
    window.MODE2_WEEKLY_BANKS=data.weeklyBanks;
    var seen={};window.SPEED_WEEK_SCHEDULES=[];
    Object.values(data.weeklyBanks).forEach(function(b){if(!seen[b.week]){seen[b.week]=true;window.SPEED_WEEK_SCHEDULES.push({week:b.week,name:b.weekName,title:b.weekName,start:new Date(b.startDate),end:new Date(b.endDate)});}});
    window.SPEED_WEEK_SCHEDULES.sort(function(a,b){return a.start-b.start;});
    var yearEl=document.getElementById('platform-school-year');if(yearEl)yearEl.textContent=data.schoolYear;
    document.querySelectorAll('[data-school-year]').forEach(function(el){el.textContent=data.schoolYear;});
    if(typeof window.initSpeedWeekDropdown==='function')window.initSpeedWeekDropdown();
    if(typeof window.renderSpeedLeaderboardTable==='function')window.renderSpeedLeaderboardTable();
    var count=Object.keys(data.weeklyBanks).length;
    status((offline?'離線備用・最後確認 ':'雲端字庫・')+data.schoolYear+'・'+(count?count+' 組':'字庫尚未發布')+'・版本 '+data.version.slice(0,8));
  }
  async function load(){
    if(loading)return;var url=String(CONFIG.WORD_BANK_URL||'').trim();
    if(!url){status('模式二字庫接口未設定，請教師完成帳號 B 安裝。');return;}
    loading=true;var controller=new AbortController();var timeout=setTimeout(function(){controller.abort();},12000);
    status('正在讀取模式二字庫及學年設定…');
    try{
      var target=new URL(url,window.location&&window.location.href);target.searchParams.set('action','get_word_bank');target.searchParams.set('t',String(Date.now()));
      var res=await fetch(target.toString(),{signal:controller.signal,cache:'no-store'});if(!res.ok)throw new Error('HTTP '+res.status);
      var data=WordBankCore.validate(await res.json());
      try{localStorage.setItem(cacheKey(),JSON.stringify(data));}catch(e){/* 可即時使用，瀏覽器未必允許持久快取 */}
      apply(data,false);
    }catch(error){
      if(current){status('字庫讀取失敗，保留最後有效 '+current.schoolYear+' 字庫；請重試。');}
      else{try{var saved=localStorage.getItem(cacheKey());if(saved)apply(WordBankCore.validate(JSON.parse(saved)),true);else status('字庫讀取失敗，沒有離線備用；請連線後重試。');}catch(e){try{localStorage.removeItem(cacheKey());}catch(ignore){}status('字庫讀取失敗，備用資料無效；請重試。');}}
    }finally{clearTimeout(timeout);loading=false;}
  }
  window.P5WordBank={load:load,schoolYear:function(){return current?current.schoolYear:null;},applyPending:function(){if(pending&&!running())apply(pending.data,pending.offline);}};
  window.addEventListener('DOMContentLoaded',load);
  window.addEventListener('online',load);
}());
