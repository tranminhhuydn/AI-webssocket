(() => {
  let domain = "";
  const UI = {};

  function bindUI() {
    document.querySelectorAll("[id]").forEach((el) => {
      UI[el.id] = el;
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function setConnectionState(state, details = "") {
    if (!UI.cmdConnectWS) return;

    UI.cmdConnectWS.dataset.state = state;
    if (state === "connected") {
      UI.cmdConnectWS.textContent = "Disconnect";
      UI.cmdConnectWS.classList.add("btn-success");
      UI.cmdConnectWS.classList.remove("btn-outline-secondary", "btn-danger");
    } else if (state === "connecting") {
      UI.cmdConnectWS.textContent = "Connecting…";
      UI.cmdConnectWS.classList.remove("btn-success", "btn-danger");
      UI.cmdConnectWS.classList.add("btn-outline-secondary");
    } else {
      UI.cmdConnectWS.textContent = "Connect";
      UI.cmdConnectWS.classList.remove("btn-success", "btn-danger");
      UI.cmdConnectWS.classList.add("btn-outline-secondary");
    }

    UI.cmdConnectWS.title = details;
  }

  function getCurrentDomain() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.url) return resolve("");

        try {
          resolve(new URL(tab.url).hostname);
        } catch {
          resolve("");
        }
      });
    });
  }

  function loadStorage() {
    chrome.storage.sync.get(["domainToggle", "inPort"], (res) => {
      const list = res.domainToggle || [];
      if (UI.domainToggle) UI.domainToggle.checked = list.includes(domain);
      if (UI.inPort) UI.inPort.value = res.inPort || 3000;
    });
  }

  function saveDomainToggle() {
    if (!UI.domainToggle) return;

    UI.domainToggle.addEventListener("change", () => {
      chrome.storage.sync.get(["domainToggle"], (res) => {
        let list = res.domainToggle || [];

        if (UI.domainToggle.checked) {
          if (!list.includes(domain)) list.push(domain);
        } else {
          list = list.filter((item) => item !== domain);
        }

        chrome.storage.sync.set({ domainToggle: list });
      });
    });
  }

  function savePort() {
    if (!UI.inPort) return;

    UI.inPort.addEventListener("change", () => {
      chrome.storage.sync.set({ inPort: UI.inPort.value });
    });
  }

  async function refreshConnectionState() {
    try {
      const status = await sendRuntimeMessage({ action: "aiLexiconStatus" });
      if (status?.connected) {
        setConnectionState(status.initialized ? "connected" : "connecting");
      } else {
        setConnectionState("disconnected");
      }
    } catch (error) {
      setConnectionState("disconnected", error.message);
    }
  }

  function bindEvents() {
    UI.cmdConnectWS.addEventListener("click", async () => {
      const currentState = UI.cmdConnectWS.dataset.state;
      setConnectionState("connecting");

      try {
        if (currentState === "connected" || currentState === "connecting") {
          await sendRuntimeMessage({ action: "disconnectWS" });
          setConnectionState("disconnected");
        } else {
          const port = String(UI.inPort.value || "3000").trim();
          const response = await sendRuntimeMessage({ action: "connectWS", port });

          if (response?.ok === false) {
            throw new Error(response.error || "Could not connect");
          }

          setConnectionState("connecting", response?.url || "");
        }
      } catch (error) {
        setConnectionState("disconnected", error.message);
        console.error("[options.js] WebSocket action failed:", error);
      }
    });

    saveDomainToggle();
    savePort();

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "WS_CONNECTED") {
        setConnectionState("connected", message.url || "");
      } else if (message?.type === "WS_DISCONNECTED") {
        setConnectionState("disconnected", message.url || "");
      }
    });
  }

  async function init() {
    console.log("[options.js] init");
    bindUI();

    domain = await getCurrentDomain();

    if (UI.domainLabel) {
      UI.domainLabel.textContent = domain ? `Cho phép ${domain}` : "Cho phép domain này";
    }

    loadStorage();
    bindEvents();
    await refreshConnectionState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();