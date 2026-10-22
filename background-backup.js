let ui = {};
let ws;
let GLOBEL_PORT;
var actionList = {
  answerGPT: (msg, sendResponse) => {
    console.log(msg.text)
    // ws.send(JSON.stringify(msg));
    sendToVSCode(msg.text);
  },
  connectWS: (msg, sendResponse) => {
    console.log('[actionList->connectWS]', msg);
    GLOBEL_PORT = msg.port 
    connectWebSocket(GLOBEL_PORT, true)
  }
}
// Gửi message đến tab đang active
function sendToContent(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "doingGPT", text: message });
    }
  });
}
let reconnectTimeout = null;


function connectWebSocket(port = 8765, forceReconnect = false) {
  // Nếu có kết nối cũ và yêu cầu reconnect thì đóng nó
  if (forceReconnect && ws) {
    try {
      console.log(`✅ closing connected`);
      ws.close();
    } catch (e) {
      console.warn("⚠️ Error closing old WebSocket:", e?.stack || e);
    }
    ws = null;
  }

  // Nếu đang có kết nối hoặc đang kết nối mà KHÔNG ép reconnect thì giữ nguyên
  if (!forceReconnect && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return ws;
  }

  // if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
  //   return ws; // đã có kết nối thì không tạo thêm
  // }

  // Nếu trước đó có setTimeout reconnect thì hủy đi
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  try {
    ws = new WebSocket(`ws://localhost:${GLOBEL_PORT}`);

    ws.onopen = () => {
        console.log("✅ WebSocket connected");
        // chrome.tabs.sendMessage(tabs[0].id, {
        //     type: "WS_CONNECTED"
        // });
        chrome.runtime.sendMessage({
            type: "WS_CONNECTED"
        });
    };
    ws.onmessage = (event) => {
      console.log("📩 Từ VSCode:", event.data)
      // go to web site chatgtp.com and exec cmd
      sendToContent(event.data);
    };
    ws.onclose = () => {
      // chrome.tabs.sendMessage(tabs[0].id, {
      //     type: "WS_DISCONNECTED"
      // });
      chrome.runtime.sendMessage({
            type: "WS_DISCONNECTED"
      });
      console.log("❌ WebSocket closed. Reconnecting...");
      // thử kết nối lại sau 2s
      reconnectTimeout = setTimeout(connectWebSocket.apply(GLOBEL_PORT), 2000); 
      



    };
    ws.onerror = (err) => console.error(`⚠️ WebSocket with port ${GLOBEL_PORT} error:`, err);
  } catch (error) {
    console.error("❌ WebSocket error:", error?.stack || error);
  }
  return ws;
}


function sendToVSCode(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("sendToVSCode:", JSON.stringify(message));
    // ws.send(JSON.stringify(message));
    ws.send(message);
  } else {
    console.warn("⚠️ WebSocket chưa mở. Không gửi được:", message);
  }
}



chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log(msg.action);
  if (actionList[msg.action]) {
    actionList[msg.action](msg, sendResponse);
  } else {
    console.log("Không có action:", msg.action);
  }
  return true; // giữ cho sendResponse async
});

// === 2. Tự tạo bảng cấu hình domain trong Options UI
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    const domain = new URL(tab.url).hostname;
    console.log("domain: ", domain);
    chrome.storage.sync.get(["allowedDomains"], (res) => {
      const list = res.allowedDomains || [];
      if (list.includes(domain)) {
        console.log("✅ Cho phép:", domain);

        chrome.storage.sync.get(["inPort"], (res) => {
          GLOBEL_PORT = res.inPort || 8765;
          connectWebSocket(GLOBEL_PORT);
        });

        chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"]
        });
      } else {
        console.log("⛔ Chặn:", domain);
      }
    });
  }
});
