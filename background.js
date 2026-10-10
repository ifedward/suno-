chrome.action.onClicked.addListener(async tab => {
 if(tab.id && /^https:\/\/(www\.)?suno\.com\//.test(tab.url||'')) await chrome.storage.local.set({sourceTab:tab.id});
 const url=chrome.runtime.getURL('index.html');
 const tabs=await chrome.tabs.query({});const existing=tabs.find(t=>t.url===url);
 if(existing){await chrome.tabs.update(existing.id,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}
 else await chrome.tabs.create({url});
});