// The toolbar click grants activeTab access to the Suno tab and opens a compact side panel.
chrome.action.onClicked.addListener(tab => {
  if (Number.isInteger(tab.id) && /^https:\/\/(www\.)?suno\.com\//.test(tab.url || '')) {
    void chrome.storage.local.set({sourceTab: tab.id});
  }
  // Keep open() in the click handler: it requires an active user gesture (Chrome 116+).
  if (Number.isInteger(tab.windowId)) {
    void chrome.sidePanel.open({windowId: tab.windowId}).catch(console.error);
  }
});
